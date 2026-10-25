/**
 * Three.js runtime for the pixel rig: per-horse low-res render targets of a skinned, lit,
 * palette-quantised, outlined part rig. See README.md for the pipeline.
 */
import * as THREE from "three";
import type { HorseAppearance } from "@thoroughbred/shared";
import { generateFallbackRig } from "./fallback";
import { GaitRig, createSecondaryState, type Pose, type SecondaryState } from "./gait";
import {
  boneNames,
  countVariants,
  morphSkeleton,
  resolveLook,
  selectSkeleton,
  type HorseLookOptions,
  type ResolvedLook,
  type VariantSlot,
} from "./morph";
import { buildHorsePalette, paletteToBytes, RAMP_STEPS } from "./ramp";
import { parseRigDef, ROLE_COUNT, ROLE_ID, type RigDef, type Vec2 } from "./rigdef";
import { MAX_PARTS, partsFragment, partsVertex, resolveFragment, resolveVertex } from "./shaders";
import type { HorseRig, HorseRigFactory, HorseRigState } from "./index";

export interface RigLighting {
  /** Floor of the diffuse term (0..1). */
  ambient: number;
  /** 0 = keep the PixelLab source's own shading, 1 = fully relit from normals. */
  lightMix: number;
  /** Ordered-dither strength between adjacent ramp steps (0 = hard bands). */
  dither: number;
  /** Rim light strength (ramp fraction). */
  rim: number;
  /** How much darker the far-side limbs are (ramp fraction). */
  farShade: number;
  /** 1-px selective outline around the silhouette. */
  outline: boolean;
  /** Contour lines where front parts overlap back parts. */
  innerLines: boolean;
}

export const DEFAULT_LIGHTING: RigLighting = {
  ambient: 0.28,
  lightMix: 0.55,
  dither: 0.7,
  rim: 0.3,
  farShade: 0.24,
  outline: true,
  innerLines: true,
};

export interface HorseRigFactoryOptions {
  /** Base URL of the art folder (the rig lives in `${artBaseUrl}/rig/`). Default "/art". */
  artBaseUrl?: string;
  /** Native render-target size. Default 128 x 96. */
  width?: number;
  height?: number;
  /** Source-pixel -> render-target offset. Default [-4, 3] (ground line at y = 89). */
  offset?: Vec2;
  /** Rotation quantum, radians (default 2*pi/96). */
  angleStep?: number;
  /** Set false to skip loading the PixelLab atlas and use the code-generated parts. */
  loadSourceArt?: boolean;
  lighting?: Partial<RigLighting>;
}

/** Optional extras on the per-frame state (the contract's HorseRigState is enough). */
export interface HorseRigStateExtras {
  /** World direction that sprite +x maps to (the way the horse runs). Default (1, 0, 0). */
  spriteRight?: THREE.Vector3;
  /** World direction from the billboard towards the camera. Default (0, 0, 1). */
  spriteOut?: THREE.Vector3;
}

const LEG_INDEX: Record<string, number> = { foreFar: 0, foreNear: 1, hindFar: 2, hindNear: 3 };
const FACE_CODE: Record<string, number> = { none: 0, star: 1, snip: 2, stripe: 3, blaze: 4, bald: 5 };
const LEG_CODE: Record<string, number> = { none: 0, coronet: 1, sock: 2, stocking: 3 };
const PATTERN_CODE: Record<string, number> = { solid: 0, hoops: 1, stripes: 2, chevron: 3, diamonds: 4, sash: 5, quartered: 6, stars: 7 };

interface Assets {
  version: number;
  source: "pixellab" | "generated";
  def: RigDef;
  bones: string[];
  variantCounts: Record<VariantSlot, number>;
  index: THREE.Texture;
  index1x: THREE.Texture;
  normal: THREE.Texture;
  aux: THREE.Texture;
  parts: THREE.BufferGeometry;
  rein: THREE.BufferGeometry;
}

function configure<T extends THREE.Texture>(t: T): T {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function dataTexture(bytes: Uint8Array, w: number, h: number): THREE.DataTexture {
  return configure(new THREE.DataTexture(bytes, w, h, THREE.RGBAFormat, THREE.UnsignedByteType));
}

function legIndexOf(name: string): number {
  const m = /^(foreFar|foreNear|hindFar|hindNear)/.exec(name);
  return m ? LEG_INDEX[m[1]!]! : -1;
}

const SLOT_CODE: Record<string, number> = { head: 1, mane: 2, tail: 3, build: 4 };

/**
 * One shared geometry per rig definition: a quad per atlas part (every variant included; the
 * vertex shader hides the variants a horse does not use), skinned by bone index.
 */
function buildGeometry(def: RigDef, bones: string[]): { parts: THREE.BufferGeometry; rein: THREE.BufferGeometry } {
  if (bones.length > MAX_PARTS) throw new Error(`pixel-rig: at most ${MAX_PARTS} bones`);
  const [aw, ah] = def.atlas;
  const pos: number[] = [];
  const uv: number[] = [];
  const info: number[] = [];
  const solid: number[] = [];
  const variant: number[] = [];
  const src: number[] = [];
  const idx: number[] = [];
  def.parts.forEach((p) => {
    const bone = bones.indexOf(p.name);
    const [rx, ry, rw, rh] = p.rect;
    if (rw <= 0 || rh <= 0) return;
    const base = pos.length / 3;
    const corners: Vec2[] = [
      [0, 0],
      [rw, 0],
      [rw, rh],
      [0, rh],
    ];
    for (const [cx, cy] of corners) {
      pos.push(p.origin[0] + cx - p.pivot[0], p.origin[1] + cy - p.pivot[1], 0);
      uv.push((rx + cx) / aw, (ry + cy) / ah);
      info.push(bone, p.side === "far" ? 1 : 0, legIndexOf(p.name), p.z);
      solid.push(0);
      variant.push(p.slot ? (SLOT_CODE[p.slot] ?? 0) : 0, p.variant ?? 0);
      src.push(p.origin[0] + cx, p.origin[1] + cy);
    }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aInfo", new THREE.Float32BufferAttribute(info, 4));
  g.setAttribute("aSolid", new THREE.Float32BufferAttribute(solid, 1));
  g.setAttribute("aVariant", new THREE.Float32BufferAttribute(variant, 2));
  g.setAttribute("aSrc", new THREE.Float32BufferAttribute(src, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  // Rein: a 1-px GL line from the hand (bone origin) along +x, scaled to the bit by its bone.
  const reinBone = bones.indexOf("rein");
  const r = new THREE.BufferGeometry();
  r.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
  r.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 0, 0], 2));
  r.setAttribute("aInfo", new THREE.Float32BufferAttribute([reinBone, 0, -1, 0, reinBone, 0, -1, 0], 4));
  r.setAttribute("aSolid", new THREE.Float32BufferAttribute([ROLE_ID.tack, ROLE_ID.tack], 1));
  r.setAttribute("aVariant", new THREE.Float32BufferAttribute([0, 0, 0, 0], 2));
  r.setAttribute("aSrc", new THREE.Float32BufferAttribute([0, 0, 0, 0], 2));
  r.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return { parts: g, rein: r };
}

let assetCounter = 0;

function makeAssets(
  def: RigDef,
  tex: { index: THREE.Texture; index1x: THREE.Texture; normal: THREE.Texture; aux: THREE.Texture },
  source: Assets["source"],
): Assets {
  const bones = boneNames(def);
  const { parts, rein } = buildGeometry(def, bones);
  return { version: ++assetCounter, source, def, bones, variantCounts: countVariants(def), ...tex, parts, rein };
}

function generatedAssets(): Assets {
  const g = generateFallbackRig();
  const index = dataTexture(g.index, g.width, g.height);
  return makeAssets(
    g.def,
    { index, index1x: index, normal: dataTexture(g.normal, g.width, g.height), aux: dataTexture(g.aux, g.width, g.height) },
    "generated",
  );
}

async function loadSourceAssets(base: string): Promise<Assets> {
  const dir = `${base.replace(/\/$/, "")}/rig`;
  const res = await fetch(`${dir}/horse-rig.json`);
  if (!res.ok) throw new Error(`pixel-rig: ${dir}/horse-rig.json -> HTTP ${res.status}`);
  const def = parseRigDef(await res.json());
  const loader = new THREE.TextureLoader();
  const load = (f: string) => loader.loadAsync(`${dir}/${f}`).then(configure);
  const [index, normal, aux, index1x] = await Promise.all([
    load(def.textures.index),
    load(def.textures.normal),
    load(def.textures.aux),
    def.textures.index1x ? load(def.textures.index1x) : Promise.resolve(null),
  ]);
  return makeAssets(def, { index, normal, aux, index1x: index1x ?? index }, "pixellab");
}

function disposeAssets(a: Assets) {
  a.parts.dispose();
  a.rein.dispose();
  a.index.dispose();
  a.normal.dispose();
  a.aux.dispose();
  if (a.index1x !== a.index) a.index1x.dispose();
}

const FULLSCREEN = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
})();

export class PixelHorseRigFactory implements HorseRigFactory {
  readonly width: number;
  readonly height: number;
  readonly offset: Vec2;
  readonly angleStep: number;
  readonly lighting: RigLighting;
  /** The assets rigs currently use (generated until the PixelLab atlas has loaded). */
  assets: Assets;
  /** Shared pass-1 target (role / ramp data), reused by every rig in turn. */
  readonly scratch: THREE.WebGLRenderTarget;
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly loading: Promise<void>;
  private readonly rigs = new Set<PixelHorseRig>();
  private disposed = false;

  constructor(opts: HorseRigFactoryOptions = {}) {
    this.width = opts.width ?? 128;
    this.height = opts.height ?? 96;
    this.offset = opts.offset ?? [-4, 3];
    this.angleStep = opts.angleStep ?? (2 * Math.PI) / 96;
    this.lighting = { ...DEFAULT_LIGHTING, ...opts.lighting };
    this.assets = generatedAssets();
    this.scratch = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const base = opts.artBaseUrl ?? "/art";
    this.loading =
      opts.loadSourceArt === false || typeof fetch === "undefined"
        ? Promise.resolve()
        : loadSourceAssets(base).then(
            (a) => {
              if (this.disposed) return disposeAssets(a);
              const old = this.assets;
              this.assets = a;
              for (const r of this.rigs) r.syncAssets();
              disposeAssets(old);
            },
            (err) => {
              console.warn("[pixel-rig] PixelLab rig art unavailable, using generated parts:", err);
            },
          );
  }

  /** Which art the rigs use right now. */
  get source(): "pixellab" | "generated" {
    return this.assets.source;
  }

  ready(): Promise<void> {
    return this.loading;
  }

  /** How many variants each slot (head / mane / tail / build) has in the current atlas. */
  variantCounts(): Record<VariantSlot, number> {
    return { ...this.assets.variantCounts };
  }

  /**
   * One rig per horse. Optional look knobs (variants, morph, seed, sabino) default
   * deterministically from a hash of the appearance.
   */
  create(appearance: HorseAppearance, opts: HorseLookOptions = {}): PixelHorseRig {
    const rig = new PixelHorseRig(this, appearance, opts);
    this.rigs.add(rig);
    return rig;
  }

  /** @internal */
  release(rig: PixelHorseRig) {
    this.rigs.delete(rig);
  }

  dispose(): void {
    this.disposed = true;
    for (const r of [...this.rigs]) r.dispose();
    this.scratch.dispose();
    disposeAssets(this.assets);
  }
}

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _out = new THREE.Vector3();
const _clear = new THREE.Color();

export class PixelHorseRig implements HorseRig {
  readonly texture: THREE.Texture;
  readonly width: number;
  readonly height: number;
  readonly anchor: { x: number; y: number };
  private readonly rt: THREE.WebGLRenderTarget;
  private readonly partsMat: THREE.RawShaderMaterial;
  private readonly resolveMat: THREE.RawShaderMaterial;
  private readonly partsScene = new THREE.Scene();
  private readonly resolveScene = new THREE.Scene();
  private partsMesh!: THREE.Mesh;
  private reinLine!: THREE.LineSegments;
  private readonly bones = new Float32Array(MAX_PARTS * 8);
  private readonly palette: THREE.DataTexture;
  private readonly sec: SecondaryState = createSecondaryState();
  private pose!: Pose;
  private gait!: GaitRig;
  private appearance: HorseAppearance;
  private lookOpts: HorseLookOptions;
  /** The resolved per-horse look (variants, proportions, seed). */
  look!: ResolvedLook;
  readonly gate: number;
  private assetsVersion = -1;
  private disposed = false;

  constructor(
    private readonly factory: PixelHorseRigFactory,
    appearance: HorseAppearance,
    opts: HorseLookOptions = {},
  ) {
    this.gate = opts.gate ?? 0;
    this.appearance = appearance;
    this.lookOpts = opts;
    this.width = factory.width;
    this.height = factory.height;
    this.rt = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: THREE.SRGBColorSpace,
    });
    this.texture = this.rt.texture;
    this.texture.name = `pixel-rig gate ${this.gate}`;
    this.anchor = { x: 0, y: 0 };
    this.palette = new THREE.DataTexture(
      new Uint8Array(RAMP_STEPS * ROLE_COUNT * 4),
      RAMP_STEPS,
      ROLE_COUNT,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    configure(this.palette);
    this.palette.colorSpace = THREE.SRGBColorSpace;
    const L = factory.lighting;
    this.partsMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: partsVertex,
      fragmentShader: partsFragment,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uBones: { value: this.bones },
        uCanvas: { value: new THREE.Vector2(this.width, this.height) },
        uOffset: { value: new THREE.Vector2(...factory.offset) },
        uIndex: { value: null },
        uIndex1x: { value: null },
        uNormal: { value: null },
        uAux: { value: null },
        uAtlas: { value: new THREE.Vector2() },
        uLight: { value: new THREE.Vector3(0.4, 0.7, 0.6) },
        uAmbient: { value: L.ambient },
        uLightMix: { value: L.lightMix },
        uDither: { value: L.dither },
        uRim: { value: L.rim },
        uFarShade: { value: L.farShade },
        uLook: { value: new THREE.Vector4() },
        uLegMarks: { value: new THREE.Vector4() },
        uSilksFrame: { value: new THREE.Vector4() },
        uVariants: { value: new THREE.Vector4() },
        uSeed: { value: new THREE.Vector4() },
      },
    });
    this.resolveMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: resolveVertex,
      fragmentShader: resolveFragment,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      uniforms: {
        uData: { value: factory.scratch.texture },
        uPalette: { value: this.palette },
        uSize: { value: new THREE.Vector2(this.width, this.height) },
        uLight: { value: new THREE.Vector3(0.4, 0.7, 0.6) },
        uOutline: { value: L.outline ? 1 : 0 },
        uInner: { value: L.innerLines ? 1 : 0 },
      },
    });
    const quad = new THREE.Mesh(FULLSCREEN, this.resolveMat);
    quad.frustumCulled = false;
    this.resolveScene.add(quad);
    this.setAppearance(appearance);
    this.syncAssets();
  }

  /**
   * Re-skin this rig for another horse: palette (8x16 texture), markings, and, when `opts` is
   * given, variants / proportions / seed.
   */
  setAppearance(appearance: HorseAppearance, opts?: HorseLookOptions) {
    this.appearance = appearance;
    if (opts) this.lookOpts = opts;
    if (this.assetsVersion >= 0) this.applyLook();
    const pal = buildHorsePalette(appearance);
    paletteToBytes(pal, this.palette.image.data as Uint8Array);
    this.palette.needsUpdate = true;
    const u = this.partsMat.uniforms;
    // legs tuple is [FL, FR, HL, HR]; shader leg index 0 LF (far fore), 1 RF, 2 LH, 3 RH
    const [fl, fr, hl, hr] = appearance.legs;
    (u.uLegMarks!.value as THREE.Vector4).set(LEG_CODE[fl]!, LEG_CODE[fr]!, LEG_CODE[hl]!, LEG_CODE[hr]!);
    (u.uLook!.value as THREE.Vector4).set(FACE_CODE[appearance.face] ?? 0, pal.coatTexture, PATTERN_CODE[appearance.silks.pattern] ?? 0, 0);
  }

  /** Resolve variants / morph / seed against the current atlas and rebuild the skeleton. */
  private applyLook() {
    const a = this.factory.assets;
    this.look = resolveLook(this.appearance, this.lookOpts, a.variantCounts);
    const skel = morphSkeleton(selectSkeleton(a.def, this.look.variants), this.look.morph);
    this.gait = new GaitRig(skel);
    this.pose = this.gait.createPose();
    const v = this.look.variants;
    (this.partsMat.uniforms.uVariants!.value as THREE.Vector4).set(v.head, v.mane, v.tail, v.build);
    (this.partsMat.uniforms.uSeed!.value as THREE.Vector4).set((this.look.seed % 9973) / 9973, this.look.sabino, 1.4, 0);
  }

  /** @internal picks up the factory's current assets (PixelLab atlas once it has loaded). */
  syncAssets() {
    const a = this.factory.assets;
    if (a.version === this.assetsVersion || this.disposed) return;
    this.assetsVersion = a.version;
    const u = this.partsMat.uniforms;
    u.uIndex!.value = a.index;
    u.uIndex1x!.value = a.index1x;
    u.uNormal!.value = a.normal;
    u.uAux!.value = a.aux;
    (u.uAtlas!.value as THREE.Vector2).set(a.def.atlas[0], a.def.atlas[1]);
    const sf = a.def.silksFrame;
    (u.uSilksFrame!.value as THREE.Vector4).set(sf.origin[0], sf.origin[1], sf.shoulder[0] - sf.origin[0], sf.shoulder[1] - sf.origin[1]);
    if (this.partsMesh) this.partsScene.remove(this.partsMesh);
    if (this.reinLine) this.partsScene.remove(this.reinLine);
    this.partsMesh = new THREE.Mesh(a.parts, this.partsMat);
    this.partsMesh.frustumCulled = false;
    this.reinLine = new THREE.LineSegments(a.rein, this.partsMat);
    this.reinLine.frustumCulled = false;
    this.reinLine.renderOrder = 1;
    this.partsScene.add(this.partsMesh, this.reinLine);
    this.applyLook();
    const barrel = a.def.parts.find((p) => p.name === "barrel");
    this.anchor.x = Math.round((barrel?.pivot[0] ?? 64) + this.factory.offset[0]);
    this.anchor.y = Math.round(a.def.groundY + this.factory.offset[1]);
  }

  /** Compute the pose for `state` without rendering (also used by tests / tools). */
  computePose(state: HorseRigState): Pose {
    this.syncAssets();
    return this.gait.compute(state, this.sec, this.pose, { angleStep: this.factory.angleStep });
  }

  update(renderer: THREE.WebGLRenderer, state: HorseRigState & HorseRigStateExtras): void {
    if (this.disposed) return;
    const pose = this.computePose(state);
    const n = this.gait.n;
    const b = this.bones;
    const m = pose.m;
    for (let i = 0; i < n; i++) {
      b[i * 8] = m[i * 6]!;
      b[i * 8 + 1] = m[i * 6 + 1]!;
      b[i * 8 + 2] = m[i * 6 + 2]!;
      b[i * 8 + 3] = m[i * 6 + 3]!;
      b[i * 8 + 4] = m[i * 6 + 4]!;
      b[i * 8 + 5] = m[i * 6 + 5]!;
    }
    // World sun -> sprite space (x right, y up, z towards the viewer).
    _right.copy(state.spriteRight ?? _right.set(1, 0, 0)).normalize();
    _out.copy(state.spriteOut ?? _out.set(0, 0, 1));
    _up.crossVectors(_out, _right).normalize();
    _out.crossVectors(_right, _up).normalize();
    const L = state.lightDir;
    const lx = L.dot(_right);
    const ly = L.dot(_up);
    const lz = L.dot(_out);
    (this.partsMat.uniforms.uLight!.value as THREE.Vector3).set(lx, ly, lz);
    (this.resolveMat.uniforms.uLight!.value as THREE.Vector3).set(lx, ly, lz);

    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.getClearColor(_clear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.factory.scratch);
    renderer.clear(true, false, false);
    renderer.render(this.partsScene, this.factory.camera);
    renderer.setRenderTarget(this.rt);
    renderer.clear(true, false, false);
    renderer.render(this.resolveScene, this.factory.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(_clear, prevAlpha);
    renderer.autoClear = prevAuto;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rt.dispose();
    this.partsMat.dispose();
    this.resolveMat.dispose();
    this.palette.dispose();
    this.factory.release(this);
  }
}

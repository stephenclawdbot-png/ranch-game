/**
 * Trackside view: the real race (replay or live frames) drawn like the "track-dusk"
 * diorama. A side-on 2.5D long-lens shot rendered with three.js as screen-space layers:
 *
 *  sky wash, sky strip, sun glow, far hills, field, trees (baked DOF blur + haze)
 *  perspective turf (world-anchored, motion-blurred at speed, finish line)
 *  far rail, furlong poles and the winning post
 *  contact shadows, horses (depth-sorted by lane), hoof dust, "my horse" chevron
 *  out-of-focus near rail, light shafts, motes, rain, grade, vignette, photo flash
 *
 * Horses are palette-index strips + a per-runner LUT (real coat and silks colours),
 * rim-lit from their normal maps and resolved with a "sharp pixel" 2x2 filter, at an
 * exact downsampled level of detail so they never minify. The camera (layout.ts) eases
 * zoom and centre with springs, rests on a pixel-perfect zoom ladder and never cuts;
 * `placeField` guarantees every runner is inside the frame on every frame.
 *
 * The scene only renders what it is given: live mode passes the frames received so far
 * (never beyond the live edge) and no result.
 */
import type * as THREE from "three";
import { FURLONG_MM } from "@thoroughbred/shared";
import { createReplaySampler, type HorseSample, type ReplaySampler } from "../sampleReplay";
import { legPhase, strideLengthM } from "../scene/horse/gait";
import type { RenderQuality } from "../types";
import type { ArtSet } from "../three/art";
import type { SceneFrame, SceneRaceData } from "../three/HD2DScene";
import { hexToRgb } from "../three/color";
import { loadTracksideArt, type StripSet, type TracksideArt } from "./art";
import * as bake from "./bake";
import { StallGate } from "./gate";
import { LANE_K, LANE_W, SRC_PX_PER_M, TracksideCamera, laneScale, laneY, placeField, squeezeX, type FieldLayout, type SpriteMetrics } from "./layout";
import { lookFor, type TracksideLook } from "./looks";
import { LUT_W, PATTERN_ID, buildLut, frameOrigin } from "./strips";
import * as S from "./shaders";
import type { RaceReplay } from "@thoroughbred/shared";

export interface TracksideOptions {
  quality: RenderQuality;
  highlightHorseId?: string;
  art: ArtSet;
}

const PULLUP_TAU = 2.6;
const NEAR_RAIL_LANE = -1.6;
const IDLE_FPS = 6;
const DUST_MAX = 260;

const O = {
  wash: 0,
  sky: 1,
  sun: 2,
  hills: 3,
  field: 4,
  trees: 5,
  ground: 6,
  railFar: 7,
  props: 8,
  shadow: 9,
  horse: 100,
  dust: 140,
  marker: 141,
  railNear: 150,
  rays: 160,
  motes: 161,
  rain: 162,
  grade: 170,
  vignette: 171,
  flash: 172,
} as const;

interface Runner {
  index: number;
  horseId: string;
  mat: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  phase: number;
  idlePhase: number;
  lastX: number;
  x: number;
  lane: number;
  speed: number;
  finishT: number | null;
  finishSpeed: number;
  prevLeg: [number, number];
  lod: number;
  rect: { x: number; y: number; w: number; h: number };
}

interface LodTex {
  idx: THREE.DataTexture;
  nrm: THREE.DataTexture | null;
}

type Uniform<V> = { value: V };

function rgb01(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

/** Metric box of a strip at its own density (m). */
function stripMetrics(st: StripSet): SpriteMetrics {
  const l = st.lods[0]!;
  const pad = 4 / st.pxPerM;
  return { lenM: l.fw / st.pxPerM + pad * 2, heightM: l.anchor.y / st.pxPerM + pad, noseM: (l.fw - l.anchor.x) / st.pxPerM + pad, tailM: l.anchor.x / st.pxPerM + pad };
}
function unionMetrics(a: SpriteMetrics, b: SpriteMetrics | null): SpriteMetrics {
  if (!b) return a;
  const noseM = Math.max(a.noseM, b.noseM);
  const tailM = Math.max(a.tailM, b.tailM);
  return { lenM: noseM + tailM, heightM: Math.max(a.heightM, b.heightM), noseM, tailM };
}

export class TracksideScene {
  readonly canvas: HTMLCanvasElement;
  private T: typeof THREE;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private geo: THREE.PlaneGeometry;
  private disposables: { dispose(): void }[] = [];
  private textures: THREE.Texture[] = [];
  private data: SceneRaceData;
  private sampler: ReplaySampler;
  private samples: HorseSample[] = [];
  private scratch: HorseSample[] = [];
  private art: TracksideArt;
  private look: TracksideLook;
  private quality: RenderQuality;
  private runners: Runner[] = [];
  private byLane: Runner[] = [];
  private lodTex = new Map<StripSet, LodTex[]>();
  private lut: THREE.DataTexture;
  private sprite: SpriteMetrics;
  private cam = new TracksideCamera();
  private layout: FieldLayout | null = null;
  private uSat: Uniform<number>;
  private uBright: Uniform<number>;
  private W = 1;
  private H = 1;
  private B = 1;
  private L: number;
  private railLane: number;
  private highlight: number;
  private lastTime = Number.NaN;
  private animTime = 0;
  private realTime = 0;
  private firstFrame = true;
  private winnerTime = Number.POSITIVE_INFINITY;
  private prevCx = Number.NaN;
  private camSpeed = 0;
  // layers
  private wash!: THREE.Mesh;
  private sky: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; h: number; w: number; off: number } | null = null;
  private sun: THREE.Mesh | null = null;
  private rays: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  private bands: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; layer: bake.BakedLayer; depth: number; off: number; kind: "backdrop" | "railFar" | "railNear" }[] = [];
  private field: THREE.Mesh | null = null;
  private ground!: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial };
  private props: { mesh: THREE.Mesh; x: number; w: number; h: number; post: boolean }[] = [];
  private gate: StallGate | null = null;
  private marker: THREE.Mesh | null = null;
  private gradeTop!: THREE.Mesh;
  private gradeBottom!: THREE.Mesh;
  private vig!: THREE.Mesh;
  private flash!: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial };
  private dust: { pts: THREE.Points; pos: Float32Array; size: Float32Array; col: Float32Array; soft: Float32Array; state: Float32Array; n: number; geo: THREE.BufferGeometry };
  private motes: { pts: THREE.Points; pos: Float32Array; size: Float32Array; col: Float32Array; soft: Float32Array; state: Float32Array; geo: THREE.BufferGeometry } | null = null;
  private rain: { lines: THREE.LineSegments; pos: Float32Array; alpha: Float32Array; state: Float32Array; geo: THREE.BufferGeometry } | null = null;

  /** Largest per-frame camera centre jump (m, net of the field's travel): continuity metric. */
  maxCamStep = 0;
  /** Trackside never needs a picture-in-picture: every runner is always in frame. */
  pipShown = false;

  /** Loads the Trackside art; rejects when the keyed horse strip is unavailable. */
  static async create(T: typeof THREE, data: SceneRaceData, opts: TracksideOptions): Promise<TracksideScene> {
    const art = await loadTracksideArt(opts.art);
    if (!art) throw new Error("Trackside art unavailable");
    return new TracksideScene(T, data, opts, art);
  }

  private constructor(T: typeof THREE, data: SceneRaceData, opts: TracksideOptions, art: TracksideArt) {
    this.T = T;
    this.data = data;
    this.art = art;
    this.quality = opts.quality;
    this.sampler = createReplaySampler(data);
    this.L = data.trackLengthMm / 1000;
    this.railLane = Math.max(8, data.laneCount, data.horses.length) + 0.8;
    this.highlight = data.horses.findIndex((h) => h.horseId === opts.highlightHorseId);
    let hour: number | null = null;
    try {
      hour = new Date(data.race.postTimeMs).getHours();
    } catch {
      hour = null;
    }
    this.look = lookFor(data.race.weather, hour);
    this.uSat = { value: this.look.saturation };
    this.uBright = { value: this.look.brightness };
    this.sprite = unionMetrics(stripMetrics(art.gallop), art.idle ? stripMetrics(art.idle) : null);
    this.applyResult();

    const renderer = new T.WebGLRenderer({ antialias: false, alpha: false, stencil: false, depth: false, powerPreference: "high-performance" });
    renderer.autoClear = true;
    renderer.setClearColor(new T.Color(this.look.skyTop), 1);
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.scene = new T.Scene();
    this.camera = new T.OrthographicCamera(0, 1, 0, 1, -10, 10);
    this.camera.position.set(0, 0, 5);
    const geo = new T.PlaneGeometry(1, 1);
    geo.translate(0.5, 0.5, 0);
    this.geo = this.own(geo);

    this.lut = this.dataTex(buildLut(art.palette, art.keys, data.horses.map((h) => h.appearance)), LUT_W, Math.max(1, data.horses.length), T.RGBAFormat);
    for (const st of [art.gallop, art.idle]) {
      if (!st) continue;
      this.lodTex.set(
        st,
        st.lods.map((l) => ({ idx: this.dataTex(l.index, l.width, l.height, T.RedFormat), nrm: l.normal ? this.dataTex(l.normal, l.width, l.height, T.RGBAFormat) : null })),
      );
    }
    this.buildBackdrop();
    this.buildGround();
    this.buildProps();
    // Starting stalls: one bay per runner lane, world-anchored at the start line.
    let startM = 0;
    for (const s of this.sampler(0, [])) startM = Math.max(startM, s.x / 1000);
    this.gate = StallGate.build(this.art.images, this.look, data, startM, {
      own: (g) => this.own(g),
      canvasTex: (img, o) => this.canvasTex(img, o),
      bandMat: (tex, w, h, o) => this.bandMat(tex, w, h, o),
      quad: (m, order) => this.quad(m, order),
      place: (m, x, y, w, h) => this.place(m, x, y, w, h),
    });
    this.buildRunners();
    this.buildFx();
    const dust = this.points(DUST_MAX, false, O.dust);
    this.dust = { ...dust, state: new Float32Array(DUST_MAX * 8), n: 0 };
  }

  // -------------------------------------------------------------------------- building

  private own<G extends { dispose(): void }>(g: G): G {
    this.disposables.push(g);
    return g;
  }

  private dataTex(data: Uint8Array, w: number, h: number, format: THREE.PixelFormat): THREE.DataTexture {
    const T = this.T;
    const t = new T.DataTexture(data, w, h, format, T.UnsignedByteType);
    t.unpackAlignment = 1;
    t.magFilter = T.NearestFilter;
    t.minFilter = T.NearestFilter;
    t.generateMipmaps = false;
    t.flipY = false;
    t.colorSpace = T.NoColorSpace;
    t.needsUpdate = true;
    this.textures.push(t);
    return this.own(t);
  }

  private canvasTex(c: HTMLCanvasElement | HTMLImageElement, o: { repeatX?: boolean; repeatY?: boolean; mip?: boolean; nearest?: boolean } = {}): THREE.Texture {
    const T = this.T;
    const t = c instanceof HTMLCanvasElement ? new T.CanvasTexture(c) : new T.Texture(c);
    t.flipY = false;
    t.premultiplyAlpha = true;
    t.colorSpace = T.NoColorSpace;
    t.wrapS = o.repeatX ? T.RepeatWrapping : T.ClampToEdgeWrapping;
    t.wrapT = o.repeatY ? T.RepeatWrapping : T.ClampToEdgeWrapping;
    t.magFilter = o.nearest ? T.NearestFilter : T.LinearFilter;
    t.minFilter = o.mip ? T.LinearMipmapLinearFilter : o.nearest ? T.NearestFilter : T.LinearFilter;
    t.generateMipmaps = !!o.mip;
    t.needsUpdate = true;
    this.textures.push(t);
    return this.own(t);
  }

  private mat(frag: string, uniforms: Record<string, Uniform<unknown>>, additive = false): THREE.ShaderMaterial {
    const T = this.T;
    const m = new T.ShaderMaterial({
      vertexShader: S.QUAD_VERT,
      fragmentShader: frag,
      uniforms: { ...uniforms, uSat: this.uSat, uBright: this.uBright },
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
      side: T.DoubleSide,
      blending: additive ? T.AdditiveBlending : T.NormalBlending,
    });
    return this.own(m);
  }

  private bandMat(tex: THREE.Texture, w: number, h: number, o: { sharp?: boolean; additive?: boolean; tint?: [string, number]; opacity?: number } = {}): THREE.ShaderMaterial {
    const T = this.T;
    const tint = o.tint ? rgb01(o.tint[0]) : [0, 0, 0];
    return this.mat(
      S.BAND_FRAG,
      {
        uMap: { value: tex },
        uTexSize: { value: new T.Vector2(w, h) },
        uUvRect: { value: new T.Vector4(0, 0, 1, 1) },
        uSharp: { value: o.sharp ? 1 : 0 },
        uBlur: { value: 0 },
        uTint: { value: new T.Vector4(tint[0], tint[1], tint[2], o.tint ? o.tint[1] : 0) },
        uOpacity: { value: o.opacity ?? 1 },
      },
      o.additive,
    );
  }

  private gradMat(top: [string, number], bottom: [string, number]): THREE.ShaderMaterial {
    const T = this.T;
    const v = (c: [string, number]) => {
      const [r, g, b] = rgb01(c[0]);
      return new T.Vector4(r, g, b, c[1]);
    };
    return this.mat(S.GRAD_FRAG, { uTop: { value: v(top) }, uMid: { value: v(bottom) }, uBottom: { value: v(bottom) }, uMidAt: { value: 1 } });
  }

  private quad(m: THREE.Material, order: number): THREE.Mesh {
    const mesh = new this.T.Mesh(this.geo, m);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  private points(n: number, additive: boolean, order: number) {
    const T = this.T;
    const geo = this.own(new T.BufferGeometry());
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const col = new Float32Array(n * 4);
    const soft = new Float32Array(n);
    geo.setAttribute("position", new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
    geo.setAttribute("aSize", new T.BufferAttribute(size, 1).setUsage(T.DynamicDrawUsage));
    geo.setAttribute("aCol", new T.BufferAttribute(col, 4).setUsage(T.DynamicDrawUsage));
    geo.setAttribute("aSoft", new T.BufferAttribute(soft, 1).setUsage(T.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const m = this.own(
      new T.ShaderMaterial({
        vertexShader: S.POINTS_VERT,
        fragmentShader: S.POINTS_FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
        blending: additive ? T.AdditiveBlending : T.NormalBlending,
      }),
    );
    const pts = new T.Points(geo, m);
    pts.frustumCulled = false;
    pts.renderOrder = order;
    this.scene.add(pts);
    return { pts, pos, size, col, soft, geo };
  }

  private buildBackdrop(): void {
    const look = this.look;
    const img = this.art.images;
    this.wash = this.quad(this.gradMat([look.skyTop, 1], [look.skyBottom, 1]), O.wash);
    const sky = bake.bakeSky(img, look);
    if (sky) {
      const mat = this.bandMat(this.canvasTex(sky.canvas, { repeatX: true }), sky.canvas.width, sky.canvas.height);
      this.sky = { mesh: this.quad(mat, O.sky), mat, h: sky.canvas.height, w: sky.canvas.width, off: 0 };
    }
    if (look.sun) {
      this.sun = this.quad(this.bandMat(this.canvasTex(bake.glow(look.sun.color)), 128, 128, { additive: true, opacity: look.sun.alpha }), O.sun);
    }
    const hills = bake.bakeHills(img, look);
    if (hills) this.addBand(hills, 0.08, O.hills, "backdrop");
    this.field = this.quad(this.bandMat(this.canvasTex(bake.bakeField(look)), 4, 64), O.field);
    const trees = bake.bakeTrees(img, look);
    if (trees) this.addBand(trees, 0.3, O.trees, "backdrop");
    const railFar = bake.bakeRailFar(img, look);
    if (railFar) this.addBand(railFar, 1, O.railFar, "railFar");
    const railNear = bake.bakeRailNear(img);
    if (railNear) this.addBand(railNear, 1, O.railNear, "railNear");
  }

  private addBand(layer: bake.BakedLayer, depth: number, order: number, kind: "backdrop" | "railFar" | "railNear") {
    const sharp = kind === "railFar";
    const tex = this.canvasTex(layer.canvas, { repeatX: true, mip: kind !== "backdrop" });
    const mat = this.bandMat(tex, layer.canvas.width, layer.canvas.height, { sharp });
    this.bands.push({ mesh: this.quad(mat, order), mat, layer, depth, off: 0, kind });
  }

  private buildGround(): void {
    const T = this.T;
    const surface = this.data.race.surface;
    const im = this.art.images.get(surface === "turf" ? "track-turf" : "track-dirt") ?? this.art.images.get("track-turf") ?? this.art.images.get("track-dirt");
    let src: HTMLCanvasElement | HTMLImageElement;
    if (im) src = im;
    else {
      const c = bake.canvas(64, 64);
      const x = c.getContext("2d")!;
      x.fillStyle = surface === "turf" ? "#3f6a2c" : "#8a5a34";
      x.fillRect(0, 0, 64, 64);
      src = c;
    }
    const tex = this.canvasTex(src, { repeatX: true, repeatY: true, mip: true, nearest: true });
    const fog = rgb01(this.look.fog);
    const tint = surface === "synthetic" ? ["#4d4466", 0.38] : [this.look.ground.tint, this.look.ground.amount];
    const tc = rgb01(tint[0] as string);
    const mat = this.mat(S.GROUND_FRAG, {
      uTex: { value: tex },
      uTexSize: { value: new T.Vector2(src.width, src.height) },
      uView: { value: new T.Vector2(1, 1) },
      uY0: { value: 0 },
      uPpm: { value: 100 },
      uCamH: { value: 6 },
      uK: { value: LANE_K },
      uLaneW: { value: LANE_W },
      uTexPerM: { value: SRC_PX_PER_M },
      uCxMod: { value: 0 },
      uFinishPx: { value: 1e7 },
      uBlurM: { value: 0 },
      uRailL: { value: this.railLane },
      uStripes: { value: surface === "turf" ? 0.045 : 0.018 },
      uFog: { value: new T.Vector3(fog[0], fog[1], fog[2]) },
      uHaze: { value: 0.5 * this.look.hazeMul },
      uTint: { value: new T.Vector4(tc[0], tc[1], tc[2], tint[1] as number) },
    });
    this.ground = { mesh: this.quad(mat, O.ground), mat };
  }

  private buildProps(): void {
    const post = this.art.images.get("finish-post");
    const pole = this.art.images.get("furlong-pole");
    const tint: [string, number] = this.look.spriteTint;
    if (post) {
      const m = this.bandMat(this.canvasTex(post), post.width, post.height, { sharp: true, tint });
      this.props.push({ mesh: this.quad(m, O.props), x: this.L, w: post.width, h: post.height, post: true });
    }
    if (pole) {
      const tex = this.canvasTex(pole);
      const furlong = FURLONG_MM / 1000;
      for (let d = furlong; this.L - d > 20; d += furlong) {
        const m = this.bandMat(tex, pole.width, pole.height, { sharp: true, tint });
        this.props.push({ mesh: this.quad(m, O.props), x: this.L - d, w: pole.width, h: pole.height, post: false });
      }
    }
  }

  private buildRunners(): void {
    const T = this.T;
    const look = this.look;
    const rim = rgb01(look.rim.color);
    const tint = rgb01(look.spriteTint[0]);
    const shadowTex = this.canvasTex(bake.shadowBlob());
    const shadowMat = this.bandMat(shadowTex, 64, 16, { opacity: look.sun ? 1 : 0.7 });
    const g = this.art.gallop;
    const l0 = g.lods[0]!;
    const lt = this.lodTex.get(g)![0]!;
    this.data.horses.forEach((h, i) => {
      const mat = this.mat(S.HORSE_FRAG, {
        uIdx: { value: lt.idx },
        uNrm: { value: lt.nrm ?? lt.idx },
        uLut: { value: this.lut },
        uIdxSize: { value: new T.Vector2(l0.width, l0.height) },
        uFrame: { value: new T.Vector4(0, 0, l0.fw, l0.fh) },
        uLodS: { value: 1 },
        uSilk: { value: new T.Vector4(0, 0, 1, 1) },
        uPattern: { value: PATTERN_ID[h.appearance.silks.pattern] ?? 0 },
        uRow: { value: i },
        uLutRows: { value: Math.max(1, this.data.horses.length) },
        uUseNrm: { value: lt.nrm ? 1 : 0 },
        uLight: { value: new T.Vector3(...look.rim.dir) },
        uRimCol: { value: new T.Vector3(rim[0], rim[1], rim[2]) },
        uRimAmt: { value: look.rim.amount },
        uTint: { value: new T.Vector4(tint[0], tint[1], tint[2], look.spriteTint[1]) },
        uOpacity: { value: 1 },
      });
      const r: Runner = {
        index: i,
        horseId: h.horseId,
        mat,
        mesh: this.quad(mat, O.horse + i),
        shadow: this.quad(shadowMat, O.shadow),
        phase: ((i * 0.37) % 1) + 0.01,
        idlePhase: (i * 5.3) % 14,
        lastX: Number.NaN,
        x: 0,
        lane: h.gate - 1,
        speed: 0,
        finishT: null,
        finishSpeed: 8,
        prevLeg: [0, 0],
        lod: 0,
        rect: { x: 0, y: 0, w: 0, h: 0 },
      };
      this.runners.push(r);
    });
    this.byLane = [...this.runners];
    if (this.highlight >= 0) {
      const c = bake.chevron();
      this.marker = this.quad(this.bandMat(this.canvasTex(c), c.width, c.height, { sharp: true }), O.marker);
    }
  }

  private buildFx(): void {
    const look = this.look;
    if (look.rays && this.sun) {
      for (const c of bake.bakeRays(look.rays.color)) {
        const mat = this.bandMat(this.canvasTex(c), c.width, c.height, { additive: true, opacity: look.rays.alpha });
        this.rays.push({ mesh: this.quad(mat, O.rays), mat });
      }
    }
    const motes = this.quality === "high" ? look.motes.count : Math.round(look.motes.count * 0.5);
    if (motes > 0) {
      const p = this.points(motes, true, O.motes);
      const st = new Float32Array(motes * 5);
      let a = 7;
      const rnd = () => {
        a = (a * 1103515245 + 12345) & 0x7fffffff;
        return a / 0x7fffffff;
      };
      for (let i = 0; i < motes; i++) st.set([rnd(), rnd(), 0.35 + rnd() * 1.35, rnd() * Math.PI * 2, 0.5 + rnd()], i * 5);
      p.geo.setDrawRange(0, motes);
      this.motes = { ...p, state: st };
    }
    if (look.rain) {
      const T = this.T;
      const n = this.quality === "high" ? 420 : 200;
      const geo = this.own(new T.BufferGeometry());
      const pos = new Float32Array(n * 6);
      const alpha = new Float32Array(n * 2);
      geo.setAttribute("position", new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
      geo.setAttribute("aAlpha", new T.BufferAttribute(alpha, 1).setUsage(T.DynamicDrawUsage));
      const m = this.own(
        new T.ShaderMaterial({
          vertexShader: S.LINES_VERT,
          fragmentShader: S.LINES_FRAG,
          uniforms: { uColor: { value: new T.Vector3(0.8, 0.86, 0.92) } },
          transparent: true,
          premultipliedAlpha: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      const lines = new T.LineSegments(geo, m);
      lines.frustumCulled = false;
      lines.renderOrder = O.rain;
      this.scene.add(lines);
      const state = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) state.set([Math.random(), Math.random(), 0.6 + Math.random() * 0.6], i * 3);
      this.rain = { lines, pos, alpha, state, geo };
    }
    const g = look.grade;
    this.gradeTop = this.quad(this.gradMat([g.top, g.topA], [g.top, 0]), O.grade);
    this.gradeBottom = this.quad(this.gradMat([g.bottom, 0], [g.bottom, g.bottomA]), O.grade);
    this.vig = this.quad(this.bandMat(this.canvasTex(bake.vignette(g.vignette)), 160, 90), O.vignette);
    const fm = this.gradMat(["#ffffff", 1], ["#ffffff", 1]);
    this.flash = { mesh: this.quad(fm, O.flash), mat: fm };
  }

  // -------------------------------------------------------------------------- runtime

  setQuality(q: RenderQuality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.resize(this.W, this.H);
  }

  resize(W: number, H: number): void {
    this.W = Math.max(1, W);
    this.H = Math.max(1, H);
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    // HD pixel standard: device resolution on desktop (capped at 2x); low quality renders
    // at CSS resolution (still >= 1 device px per sprite texel thanks to the LOD copies).
    const ratio = this.quality === "low" ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.W, this.H, false);
    const buf = this.renderer.getDrawingBufferSize(new this.T.Vector2());
    this.B = buf.x / this.W;
    this.camera.left = 0;
    this.camera.right = buf.x;
    this.camera.top = 0;
    this.camera.bottom = buf.y;
    this.camera.updateProjectionMatrix();
  }

  get lastSamples(): readonly HorseSample[] {
    return this.samples;
  }

  get cameraInfo(): { x: number; zoom: number; shot: string } {
    const lay = this.layout;
    return { x: this.cam.cx, zoom: this.cam.ppm / 100, shot: `trackside ${((lay?.ppm ?? 0) * this.B / SRC_PX_PER_M).toFixed(2)}px/tx${lay?.compressed ? " squeezed" : ""}` };
  }

  /** Drawn horse quads in stage CSS px (dev hook for the all-runners-visible check). */
  debugRects(): { id: string; x: number; y: number; w: number; h: number; lane: number }[] {
    return this.runners.map((r) => ({ id: r.horseId, ...r.rect, lane: r.lane }));
  }

  private applyResult(): void {
    const res = this.data.result ?? null;
    this.winnerTime = res ? res.winningTimeUs / 1e6 : Number.POSITIVE_INFINITY;
  }

  /** The race is over: switch to the official replay (same horses, same scene). */
  setFinal(final: RaceReplay): void {
    this.data = final;
    this.sampler = createReplaySampler(final);
    this.applyResult();
    for (const r of this.runners) r.finishT = null;
    // No camera reset: a continuous live -> official hand-off keeps easing (a photo-finish
    // replay jumps back in time and is caught by the seek check instead).
  }

  render(f: SceneFrame): void {
    const raceT = f.time;
    const tS = Math.max(0, raceT);
    let simDt = Number.isNaN(this.lastTime) ? 0 : raceT - this.lastTime;
    const seek = Math.abs(simDt) > 0.6 || simDt < -1e-9;
    if (seek) {
      simDt = 0;
      this.dust.n = 0;
    }
    if (f.frozen) simDt = 0;
    const snap = this.firstFrame || seek || Number.isNaN(this.lastTime);
    this.lastTime = raceT;
    this.animTime += simDt;
    const realDt = Math.min(0.1, Math.max(0, f.realDt));
    if (!f.frozen) this.realTime += realDt;
    const L = this.L;

    // --- Runners from the frames (live: only the frames received so far) ----------
    this.samples = this.sampler(tS, this.samples);
    const haveFrames = this.data.frames.length > 0;
    for (const r of this.runners) {
      const s = this.samples[r.index]!;
      if (r.finishT === null && s.finishTimeSec !== null) {
        r.finishT = s.finishTimeSec;
        const before = this.sampler(Math.max(0, r.finishT - 0.05), this.scratch)[r.index]!;
        r.finishSpeed = Math.max(8, before.speed / 1000);
        this.samples = this.sampler(tS, this.samples);
      }
      if (!this.data.result && r.finishT !== null) this.winnerTime = Math.min(this.winnerTime, r.finishT);
      if (r.finishT !== null && tS > r.finishT) {
        const e = Math.exp(-(tS - r.finishT) / PULLUP_TAU);
        r.x = L + r.finishSpeed * PULLUP_TAU * (1 - e);
        r.speed = r.finishSpeed * e;
      } else {
        r.x = s.x / 1000;
        r.speed = raceT < 0 ? 0 : s.speed / 1000;
      }
      r.lane = haveFrames ? s.lane : this.data.horses[r.index]!.gate - 1;
    }

    // --- Camera + layout (every runner on screen, guaranteed by placeField) ---------
    const sprite = this.sprite;
    this.cam.update(
      { W: this.W, H: this.H, dpr: this.B, sprite, railLane: this.railLane, finishX: L, runners: this.runners.map((r) => ({ x: r.x, lane: r.lane, speed: r.speed })) },
      snap ? 0 : realDt,
      snap,
    );
    const lay = placeField({
      W: this.W,
      H: this.H,
      ppm: this.cam.ppm,
      cx: this.cam.cx,
      sprite,
      runners: this.runners,
      railLane: this.railLane,
      laneSpan: this.cam.laneSpan,
      headroomM: this.highlight >= 0 ? 0.5 : 0.25,
    });
    this.layout = lay;
    const dcx = snap || Number.isNaN(this.prevCx) ? 0 : lay.cx - this.prevCx;
    if (!snap && simDt > 0) {
      let fieldV = 0;
      for (const r of this.runners) fieldV += r.speed;
      fieldV /= Math.max(1, this.runners.length);
      if (raceT > 1) this.maxCamStep = Math.max(this.maxCamStep, Math.abs(dcx - fieldV * simDt));
    }
    this.prevCx = lay.cx;
    const v = realDt > 0 && !f.frozen ? dcx / realDt : 0;
    this.camSpeed += (Math.abs(v) - this.camSpeed) * (snap ? 1 : 1 - Math.exp(-realDt * 8));
    this.firstFrame = false;

    this.drawBackdrop(lay, dcx, realDt, f.frozen);
    this.drawGround(lay);
    this.drawProps(lay);
    this.drawRunners(lay, simDt, raceT, tS);
    this.gate?.draw(lay, raceT, this.byLane.map((r) => r.index), O.horse, this.B);
    this.drawFx(lay, realDt, f.frozen, f.flash);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  private setUv(m: THREE.ShaderMaterial, u0: number, v0: number, du: number, dv: number) {
    (m.uniforms.uUvRect!.value as THREE.Vector4).set(u0, v0, du, dv);
  }

  private place(mesh: THREE.Mesh, x: number, y: number, w: number, h: number) {
    mesh.position.set(x, y, 0);
    mesh.scale.set(Math.max(1e-3, w), Math.max(1e-3, h), 1);
    mesh.visible = w > 0 && h > 0;
  }

  /** Backdrop art scale (CSS px per art px): mostly follows the stage, a little the zoom. */
  private backdropScale(ppm: number): number {
    return Math.pow(ppm / SRC_PX_PER_M, 0.45) * Math.pow(this.H / 400, 0.55);
  }

  private drawBackdrop(lay: FieldLayout, dcx: number, dt: number, frozen: boolean) {
    const B = this.B;
    const Wb = this.W * B;
    const Hb = this.H * B;
    const railY = laneY(lay, this.railLane) * B;
    const a = this.backdropScale(lay.ppm);
    const k = a * B;
    this.place(this.wash, 0, 0, Wb, Hb);
    if (this.sky) {
      const s = this.sky;
      s.off += (frozen ? 0 : 1.2 * dt) + (dcx * lay.ppm * 0.04) / a;
      const bottom = railY - 42 * k;
      this.place(s.mesh, 0, 0, Wb, bottom + 2);
      const dv = (bottom + 2) / (s.h * k);
      this.setUv(s.mat, s.off / s.w - Wb / 2 / (k * s.w), 1 - dv, Wb / (k * s.w), dv);
    }
    const sunX = (this.look.sun?.x ?? 0.7) * Wb;
    const sunY = railY - 82 * k;
    if (this.sun && this.look.sun) {
      const r = 260 * k * (1 + Math.sin(this.realTime * 0.5) * 0.03);
      this.place(this.sun, sunX - r, sunY - r, r * 2, r * 2);
    }
    for (const b of this.bands) {
      const P = b.layer.canvas.width;
      const h = b.layer.canvas.height;
      const blurM = Math.min(1.2, this.camSpeed / 60);
      if (b.kind === "backdrop") {
        b.off += (dcx * lay.ppm * b.depth) / a;
        this.place(b.mesh, 0, railY - b.layer.baseline * k, Wb, h * k);
        this.setUv(b.mat, b.off / P - Wb / 2 / (k * P), 0, Wb / (k * P), 1);
        b.mat.uniforms.uBlur!.value = blurM * lay.ppm * b.depth / a;
      } else {
        const ls = laneScale(b.kind === "railFar" ? this.railLane : NEAR_RAIL_LANE, lay.k);
        const kr = (lay.ppm * ls * B) / SRC_PX_PER_M;
        const centre = (((lay.cx * SRC_PX_PER_M) % P) + P) % P;
        let top: number;
        if (b.kind === "railFar") top = railY - b.layer.baseline * kr;
        else {
          let maxFeet = lay.y0;
          for (const p of lay.placed) maxFeet = Math.max(maxFeet, p.feetY);
          top = Math.max(lay.y0 + 0.1 * lay.ppm, maxFeet + 3) * B;
        }
        // The near rail runs on to the bottom of the frame (its blurred grass row repeats).
        const hh = b.kind === "railNear" ? Math.max(h * kr, this.H * B - top) : h * kr;
        this.place(b.mesh, 0, top, Wb, hh);
        this.setUv(b.mat, centre / P - Wb / 2 / (kr * P), 0, Wb / (kr * P), hh / (h * kr));
        b.mat.uniforms.uBlur!.value = blurM * SRC_PX_PER_M;
      }
    }
    if (this.field) this.place(this.field, 0, railY - 40 * k, Wb, 40 * k + 2 * B);
    // light shafts from the sun
    this.rays.forEach((r, i) => {
      const size = 1040 * k;
      this.place(r.mesh, sunX - size / 2, sunY - size / 2, size, size);
      const wa = 0.5 + 0.5 * Math.sin(this.realTime * 0.23 + 17);
      r.mat.uniforms.uOpacity!.value = (this.look.rays?.alpha ?? 0) * (0.55 + 0.45 * (i === 0 ? wa : 1 - wa));
    });
  }

  private drawGround(lay: FieldLayout) {
    const B = this.B;
    const u = this.ground.mat.uniforms;
    const railY = laneY(lay, this.railLane) * B;
    this.place(this.ground.mesh, 0, railY - 2 * B, this.W * B, this.H * B - railY + 2 * B);
    (u.uView!.value as THREE.Vector2).set(this.W * B, this.H * B);
    u.uY0!.value = lay.y0 * B;
    u.uPpm!.value = lay.ppm * B;
    u.uCamH!.value = lay.camH;
    u.uK!.value = lay.k;
    u.uCxMod!.value = ((lay.cx % 8) + 8) % 8;
    u.uFinishPx!.value = (squeezeX(lay, this.W / 2 + (this.L - lay.cx) * lay.ppm) - this.W / 2) * B;
    u.uBlurM!.value = Math.min(1.2, this.camSpeed / 60);
  }

  private drawProps(lay: FieldLayout) {
    const B = this.B;
    const ls = laneScale(this.railLane - 0.45, lay.k);
    const pxPerM = lay.ppm * ls;
    const feet = laneY(lay, this.railLane - 0.45);
    for (const p of this.props) {
      const k = (pxPerM * B) / SRC_PX_PER_M;
      const sx = (this.W / 2 + (squeezeX(lay, this.W / 2 + (p.x - lay.cx) * lay.ppm) - this.W / 2) * ls) * B;
      const w = p.w * k;
      const h = p.h * k;
      const x = Math.round(sx - w / 2);
      if (x > this.W * B + 4 || x + w < -4) {
        p.mesh.visible = false;
        continue;
      }
      this.place(p.mesh, x, Math.round(feet * B - h), w, h);
    }
  }

  private chooseLod(q: number, cur: number): number {
    let ideal = 4;
    for (let s = 1; s <= 4; s++) {
      if (q * s >= 1) {
        ideal = s;
        break;
      }
    }
    if (!cur) return ideal;
    if (ideal > cur) return q * cur < 0.92 ? ideal : cur;
    if (ideal < cur) return q * ideal >= 1.08 ? ideal : cur;
    return cur;
  }

  private drawRunners(lay: FieldLayout, simDt: number, raceT: number, tS: number) {
    const B = this.B;
    const art = this.art;
    // depth order: far lanes first
    this.byLane.sort((a, b) => b.lane - a.lane || a.x - b.x);
    this.byLane.forEach((r, i) => (r.mesh.renderOrder = O.horse + i));
    for (const r of this.runners) {
      const p = lay.placed[r.index]!;
      const stride = strideLengthM(Math.max(r.speed, 6));
      if (Number.isNaN(r.lastX) || simDt === 0) r.lastX = r.x;
      const dx = r.x - r.lastX;
      r.lastX = r.x;
      if (dx > 0 && dx < 5) r.phase += dx / stride;
      const finished = r.finishT !== null && tS >= r.finishT;
      const standing = art.idle && (raceT < 0 || (finished && r.speed < 1.4));
      const st = standing ? art.idle! : art.gallop;
      const q = (p.pxPerM * B) / st.pxPerM;
      if (standing !== (r.mat.userData.idle === true)) r.lod = 0;
      r.mat.userData.idle = standing;
      r.lod = this.chooseLod(q, r.lod);
      const lod = st.lods[r.lod - 1]!;
      const tex = this.lodTex.get(st)![r.lod - 1]!;
      const frames = lod.frames;
      const frame = standing ? Math.floor(this.realTime * IDLE_FPS + r.idlePhase) % frames : Math.floor((r.phase - Math.floor(r.phase)) * frames) % frames;
      const [ox, oy] = frameOrigin(lod, frame);
      const k = q * r.lod; // buffer px per LOD texel
      const w = lod.fw * k;
      const h = lod.fh * k;
      const x = Math.round(p.ax * B - lod.anchor.x * k);
      const y = Math.round(p.feetY * B - lod.anchor.y * k);
      const u = r.mat.uniforms;
      u.uIdx!.value = tex.idx;
      u.uNrm!.value = tex.nrm ?? tex.idx;
      u.uUseNrm!.value = tex.nrm ? 1 : 0;
      (u.uIdxSize!.value as THREE.Vector2).set(lod.width, lod.height);
      (u.uFrame!.value as THREE.Vector4).set(ox, oy, lod.fw, lod.fh);
      u.uLodS!.value = r.lod;
      const sb = st.silk;
      (u.uSilk!.value as THREE.Vector4).set(sb[frame * 4]!, sb[frame * 4 + 1]!, Math.max(1, sb[frame * 4 + 2]!), Math.max(1, sb[frame * 4 + 3]!));
      this.place(r.mesh, x, y, w, h);
      r.rect = { x: x / B, y: y / B, w: w / B, h: h / B };
      // contact shadow under the barrel
      const bodyLen = 2.2 * p.pxPerM * B;
      const sw = bodyLen * 0.95;
      const sh = sw * 0.25;
      this.place(r.shadow, p.ax * B - bodyLen * 0.52 - sw / 2, p.feetY * B - sh * 0.55, sw, sh);
      // hoof strikes -> dust
      if (simDt > 0 && r.speed > 4) {
        const legs: ["FR" | "HR", number][] = [
          ["FR", -0.35],
          ["HR", -1.9],
        ];
        legs.forEach(([leg, off], li) => {
          const ph = legPhase(r.phase, leg);
          if (ph < r.prevLeg[li]!) this.emitDust(r, r.x + off);
          r.prevLeg[li] = ph;
        });
      }
    }
    if (this.marker && this.highlight >= 0) {
      const r = this.runners[this.highlight]!;
      const p = lay.placed[this.highlight]!;
      const m = Math.max(2, Math.round(B * Math.min(3, Math.max(1.5, p.pxPerM / 70))));
      const bob = Math.round(Math.sin(this.realTime * 4) * 1.5) * m * 0.5;
      const cxm = p.ax * B - 0.62 * p.pxPerM * B;
      this.place(this.marker, Math.round(cxm - 5.5 * m), Math.round(r.rect.y * B + 0.06 * p.pxPerM * B - 10 * m + bob), 11 * m, 9 * m);
    }
  }

  private emitDust(r: Runner, wx: number) {
    const d = this.dust;
    const per = this.quality === "high" ? 3 : 1;
    for (let i = 0; i < per; i++) {
      if (d.n >= DUST_MAX) return;
      const o = d.n * 8;
      // x (m), lane, height (m), vx, vy, life, owner, max life
      const life = 0.5 + Math.random() * 0.7;
      d.state.set([wx + (Math.random() - 0.5) * 0.4, r.lane + (Math.random() - 0.5) * 0.4, Math.random() * 0.1, -1 - Math.random() * 2.5, 0.4 + Math.random() * 1.1, life, r.index, life], o);
      d.n++;
    }
  }

  private drawFx(lay: FieldLayout, dt: number, frozen: boolean, flash: number) {
    const B = this.B;
    const Wb = this.W * B;
    const Hb = this.H * B;
    const look = this.look;
    // hoof dust (world-anchored, follows its runner's on-screen squeeze)
    const d = this.dust;
    const sdt = frozen ? 0 : dt;
    let w = 0;
    const dc = rgb01(look.dust);
    for (let i = 0; i < d.n; i++) {
      const o = i * 8;
      const life = d.state[o + 5]! - sdt;
      if (life <= 0) continue;
      const n = w * 8;
      for (let j = 0; j < 8; j++) d.state[n + j] = d.state[o + j]!;
      d.state[n] = d.state[n]! + d.state[n + 3]! * sdt;
      d.state[n + 2] = Math.max(0, d.state[n + 2]! + d.state[n + 4]! * sdt);
      d.state[n + 4] = d.state[n + 4]! - 2.2 * sdt;
      d.state[n + 5] = life;
      const lane = d.state[n + 1]!;
      const owner = lay.placed[d.state[n + 6]!]!;
      const ls = laneScale(lane, lay.k);
      const ppl = lay.ppm * ls;
      const x = (this.W / 2 + (d.state[n]! - lay.cx) * ppl + owner.shift) * B;
      const y = (laneY(lay, lane) - d.state[n + 2]! * ppl) * B;
      d.pos[w * 3] = Math.round(x);
      d.pos[w * 3 + 1] = Math.round(y);
      d.pos[w * 3 + 2] = 0;
      const texel = (ppl * B) / SRC_PX_PER_M;
      d.size[w] = Math.max(1, Math.round(texel * (life / d.state[n + 7]! > 0.6 ? 3 : 2)));
      d.col.set([dc[0], dc[1], dc[2], 0.55 * Math.min(1, life * 1.6)], w * 4);
      d.soft[w] = 0;
      w++;
    }
    d.n = w;
    d.geo.setDrawRange(0, w);
    for (const name of ["position", "aSize", "aCol", "aSoft"]) (d.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;

    // motes: crisp sparks in the focal band, soft bokeh near the lens
    if (this.motes) {
      const m = this.motes;
      const n = m.state.length / 5;
      const a = this.backdropScale(lay.ppm);
      const y0 = laneY(lay, this.railLane) - 110 * a;
      const y1 = this.H;
      const mc = rgb01(look.motes.color);
      const gc = rgb01(look.motes.glow);
      const t = this.realTime;
      for (let i = 0; i < n; i++) {
        const s = m.state;
        const o = i * 5;
        const z = s[o + 2]!;
        if (!frozen) {
          s[o] = s[o]! + ((look.motes.wind * z + Math.sin(t * 0.6 + s[o + 3]!) * 4) * dt) / Math.max(1, this.W) - (this.camSpeed * lay.ppm * 0.02 * z * dt) / Math.max(1, this.W);
          s[o + 1] = s[o + 1]! + ((Math.cos(t * 0.45 + s[o + 3]! * 1.7) * 3 - 1.5 * s[o + 4]!) * dt) / Math.max(1, y1 - y0);
          if (s[o]! > 1.05) s[o] = -0.05;
          if (s[o]! < -0.05) s[o] = 1.05;
          if (s[o + 1]! < -0.02) s[o + 1] = 1.02;
          if (s[o + 1]! > 1.02) s[o + 1] = -0.02;
        }
        const tw = 0.55 + 0.45 * Math.sin(t * (1.3 + s[o + 4]!) + s[o + 3]!);
        m.pos[i * 3] = Math.round(s[o]! * Wb);
        m.pos[i * 3 + 1] = Math.round((y0 + s[o + 1]! * (y1 - y0)) * B);
        if (z > 1.35) {
          m.size[i] = (z - 1.1) * 7 * a * B * 2;
          m.col.set([gc[0], gc[1], gc[2], 0.5 * tw], i * 4);
          m.soft[i] = 1;
        } else {
          m.size[i] = Math.max(1, Math.round((z > 0.9 ? 2 : 1) * a * B));
          m.col.set([mc[0], mc[1], mc[2], 0.35 + 0.65 * tw * Math.min(1, z)], i * 4);
          m.soft[i] = 0;
        }
      }
      for (const name of ["position", "aSize", "aCol", "aSoft"]) (m.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }

    if (this.rain) {
      const r = this.rain;
      const n = r.state.length / 3;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        const sp = r.state[o + 2]!;
        if (!frozen) {
          r.state[o + 1] = r.state[o + 1]! + dt * 1.6 * sp;
          r.state[o] = r.state[o]! - dt * (0.12 + (this.camSpeed * lay.ppm * 0.6) / Math.max(1, this.W)) * sp;
          if (r.state[o + 1]! > 1.05) {
            r.state[o + 1] = -0.05;
            r.state[o] = Math.random();
          }
          if (r.state[o]! < -0.05) r.state[o] = r.state[o]! + 1.1;
        }
        const x = r.state[o]! * Wb;
        const y = r.state[o + 1]! * Hb;
        const len = 10 * B * sp;
        r.pos.set([Math.round(x), Math.round(y), 0, Math.round(x - len * 0.25), Math.round(y + len), 0], i * 6);
        r.alpha[i * 2] = 0.05;
        r.alpha[i * 2 + 1] = 0.32 * sp;
      }
      (r.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (r.geo.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
    }

    this.place(this.gradeTop, 0, 0, Wb, Hb * 0.45);
    this.place(this.gradeBottom, 0, Hb * 0.7, Wb, Hb * 0.3);
    this.place(this.vig, 0, 0, Wb, Hb);
    const fl = Math.min(1, Math.max(0, flash)) * 0.85;
    this.flash.mat.uniforms.uTop!.value.w = fl;
    this.flash.mat.uniforms.uMid!.value.w = fl;
    this.flash.mat.uniforms.uBottom!.value.w = fl;
    this.place(this.flash.mesh, 0, 0, fl > 0.001 ? Wb : 0, fl > 0.001 ? Hb : 0);
  }

  /**
   * Pre-warm the GPU so nothing compiles or uploads mid-race: upload every texture (all
   * sprite levels of detail), compile every program, draw one full frame.
   */
  warmup(): void {
    const r = this.renderer;
    for (const t of this.textures) {
      try {
        r.initTexture(t);
      } catch {
        /* not ready */
      }
    }
    // Every horse material once with each LOD bound, so the uniform paths are warm too.
    for (const st of this.lodTex.values()) {
      for (const lt of st) {
        for (const run of this.runners) run.mat.uniforms.uIdx!.value = lt.idx;
        r.compile(this.scene, this.camera);
      }
    }
    for (const run of this.runners) run.mesh.visible = true;
    this.render({ time: -1, realDt: 0, camera: "director", frozen: false, flash: 0.5 });
    this.lastTime = Number.NaN;
    this.firstFrame = true;
  }

  destroy(): void {
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* already gone */
      }
    }
    this.disposables = [];
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

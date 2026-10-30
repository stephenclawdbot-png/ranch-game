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
 * zoom and centre with springs, rests on a pixel-perfect zoom ladder and never cuts.
 * Whole-field mode: `placeField` guarantees every runner is inside the frame on every
 * frame; a gap it has to squeeze for that gets a soft haze cut and a true-length chip ("8L")
 * hung on the far rail, so the picture never claims a straggler is closer than it is.
 * Follow-mine mode (`SceneFrame.follow`): the camera locks the highlighted runner
 * at ~40 % from the left at the close-up zoom and the rest of the field may leave the
 * frame (the minimap and standings still show everyone).
 *
 * The scene only renders what it is given: live mode passes the frames received so far
 * (never beyond the live edge) and no result.
 */
import type * as THREE from "three";
import type { HorseSample } from "../sampleReplay";
import type { RenderQuality } from "../types";
import type { ArtSet } from "../three/art";
import type { SceneFrame, SceneRaceData } from "../three/HD2DScene";
import type { Director, DirectorInput } from "../director";
import { hexToRgb } from "../three/color";
import { loadFxPalette, loadStageArt, loadTracksideArt, type FxPalette, type StripSet, type TracksideArt } from "./art";
import * as bake from "./bake";
import { StallGate } from "./gate";
import { LANE_K, LANE_W, SRC_PX_PER_M, TracksideCamera, laneScale, laneY, placeField, squeezeX, type FieldGap, type FieldLayout, type SpriteMetrics } from "./layout";
import { CHIP_H, chipLabel, pickChips, type ChipCandidate } from "./gapMarks";
import { lookFor, type TracksideLook } from "./looks";
import { finishTilt, sceneryFor } from "./scenery";
import { LUT_W, PATTERN_ID, buildLut, frameOrigin } from "./strips";
import * as S from "./shaders";
import type { RaceReplay } from "@thoroughbred/shared";
import type { CourseInfo } from "../course/geometry";
import { buildRaceStage, type RaceStage, type StageInventory } from "../stage/buildRaceStage";
import { FieldMotion, injuredFromEvents, type AnimId, type RunnerState } from "../stage/motion";
import { crowdCheering, crowdFrame, fxStripCanvas, judgeBoxCanvas, plateCanvas, stripFrames } from "../stage/paint";
import { tracksideInventory, tracksidePlan, type TracksidePlan } from "./stagePlan";

export interface TracksideOptions {
  quality: RenderQuality;
  highlightHorseId?: string;
  art: ArtSet;
  /** The racecourse: its scenery set and finish gradient. Omitted: today's look, flat. */
  course?: CourseInfo | null;
  /** The race stage both views render from (built from course + race when omitted). */
  stage?: RaceStage;
  /** Horses injured in the race (pulled up after the line). Default: the replay's injury events. */
  injured?: ReadonlySet<string>;
}

/** Art the stage needs beyond the strips (loaded once in `create`). */
interface StageArtSet {
  images: Map<string, HTMLImageElement>;
  fx: FxPalette | null;
}

/**
 * Grandstand: centred where the stage puts it (~30 m before the post, facing the run-in), its
 * feet this far above the rail line (art px), and its parallax. It slides a little slower than
 * the midground it stands in front of, so it stays in view for the last hundred metres or so
 * instead of flashing past (the midground is blurred; the cheat reads).
 */
const STAND_LIFT = 26;
const STAND_DEPTH = 0.16;
/** Track layers drawn wider/taller than the stage while tilted, so no corner shows through. */
const TILT_MARGIN = 0.12;

const NEAR_RAIL_LANE = -1.6;
/** Ground-fx bursts alive at once (one per stride per runner, ~0.6 s each). */
const FX_MAX = 48;
/** Ground fx: frames, fps per strip (art STATUS 1b). */
const FX_FPS: Record<string, number> = { "fx-mud": 14, "fx-dust": 12, "fx-divot": 14 };
const FX_ANCHOR: Record<string, [number, number]> = { "fx-mud": [0.812, 0.812], "fx-dust": [0.729, 0.812], "fx-divot": [0.792, 0.844] };

const O = {
  wash: 0,
  sky: 1,
  sun: 2,
  hills: 3,
  field: 4,
  trees: 5,
  stand: 5.5,
  ground: 6,
  railFar: 7,
  judge: 6.9,
  crowd: 6.95,
  props: 8,
  gapHaze: 8.5,
  shadow: 9,
  horse: 100,
  dust: 140,
  marker: 141,
  railNear: 150,
  rays: 160,
  motes: 161,
  rain: 162,
  gapChip: 169,
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
  x: number;
  lane: number;
  speed: number;
  /** Shared motion state (stage/motion.ts). */
  st: RunnerState;
  /** Stride phase last frame (hoof strikes -> ground fx). */
  lastPhase: number;
  strip: StripSet | null;
  lod: number;
  rect: { x: number; y: number; w: number; h: number };
}

interface GapMark {
  haze: THREE.Mesh;
  hazeMat: THREE.ShaderMaterial;
  chip: THREE.Mesh;
  chipMat: THREE.ShaderMaterial;
  /** Eased haze / chip opacity (0..1). */
  a: number;
  chipA: number;
  /** Eased screen x (CSS px). */
  x: number;
  label: string;
}

/** Gap markers ease in and out over about this long (s): a squeeze never pops or flickers. */
const GAP_FADE_S = 0.25;

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
  private motion: FieldMotion;
  private states: RunnerState[] = [];
  private samples: HorseSample[] = [];
  private art: TracksideArt;
  private stage: RaceStage;
  private plan: TracksidePlan;
  private stageArt: StageArtSet;
  private look: TracksideLook;
  private quality: RenderQuality;
  private runners: Runner[] = [];
  private byLane: Runner[] = [];
  private lodTex = new Map<StripSet, LodTex[]>();
  private mskTex = new Map<StripSet, THREE.DataTexture>();
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
  private props: { mesh: THREE.Mesh; x: number; w: number; h: number; lift: number; lane: number }[] = [];
  private crowd: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; tex: THREE.Texture[]; w: number; h: number; x0: number; x1: number } | null = null;
  private fx: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; strip: number; x: number; lane: number; age: number; flip: boolean }[] = [];
  private fxStrips: { tex: THREE.Texture; frames: number; fw: number; fh: number; fps: number; anchor: [number, number] }[] = [];
  private gate: StallGate | null = null;
  private marker: THREE.Mesh | null = null;
  /** Gap markers, one slot per runner (the gap in front of it): haze cut + true-length chip. */
  private gapMarks: GapMark[] = [];
  private gapCells = new Map<string, { x: number; y: number; w: number; h: number }>();
  private gapAtlasSize: [number, number] = [1, 1];
  private gapScratch: (FieldGap | null)[] = [];
  private gradeTop!: THREE.Mesh;
  private gradeBottom!: THREE.Mesh;
  private vig!: THREE.Mesh;
  private flash!: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial };
  // course
  private course: CourseInfo | null;
  private stand: { mesh: THREE.Mesh; w: number; h: number; pad: number } | null = null;
  /** Everything on the track (ground, rails, posts, stalls, runners, dust) tilts as one for a finish gradient. */
  private trackLayer: THREE.Object3D;
  /** Where new quads go (the scene, or the tilting track layer while it is being built). */
  private into: THREE.Object3D | null = null;
  private tilt = 0;
  private bank: THREE.Mesh | null = null;
  private motes: { pts: THREE.Points; pos: Float32Array; size: Float32Array; col: Float32Array; soft: Float32Array; state: Float32Array; geo: THREE.BufferGeometry } | null = null;
  private rain: { lines: THREE.LineSegments; pos: Float32Array; alpha: Float32Array; state: Float32Array; geo: THREE.BufferGeometry } | null = null;

  /** Largest per-frame camera centre jump (m, net of the field's travel): continuity metric. */
  maxCamStep = 0;
  /** Trackside never needs a picture-in-picture: the highlighted runner is always in frame. */
  pipShown = false;

  /** Loads the Trackside art; rejects when the keyed horse strip is unavailable. */
  static async create(T: typeof THREE, data: SceneRaceData, opts: TracksideOptions): Promise<TracksideScene> {
    const stage = opts.stage ?? buildRaceStage(opts.course, data);
    const [art, images, fx] = await Promise.all([loadTracksideArt(opts.art, sceneryFor(opts.course?.scenery)), loadStageArt(opts.art, stage), loadFxPalette(opts.art)]);
    if (!art) throw new Error("Trackside art unavailable");
    return new TracksideScene(T, data, { ...opts, stage }, art, { images, fx });
  }

  private constructor(T: typeof THREE, data: SceneRaceData, opts: TracksideOptions, art: TracksideArt, stageArt: StageArtSet) {
    this.T = T;
    this.data = data;
    this.art = art;
    this.stageArt = stageArt;
    this.quality = opts.quality;
    this.course = opts.course ?? null;
    this.stage = opts.stage ?? buildRaceStage(this.course, data);
    this.plan = tracksidePlan(this.stage);
    this.motion = new FieldMotion(data, { injured: opts.injured ?? injuredFromEvents(data.events) });
    this.L = this.stage.L;
    this.railLane = this.stage.lanes.count + 0.8;
    this.highlight = data.horses.findIndex((h) => h.horseId === opts.highlightHorseId);
    this.look = this.stage.look.trackside;
    this.uSat = { value: this.look.saturation };
    this.uBright = { value: this.look.brightness };
    let sprite = unionMetrics(stripMetrics(art.gallop), art.idle ? stripMetrics(art.idle) : null);
    for (const st of Object.values(art.strips)) sprite = unionMetrics(sprite, stripMetrics(st));
    this.sprite = sprite;
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
    // A plain Object3D (not a Group): its children keep sorting by their own renderOrder.
    this.trackLayer = new T.Object3D();
    this.trackLayer.matrixAutoUpdate = false;
    this.scene.add(this.trackLayer);

    this.lut = this.dataTex(buildLut(art.palette, art.keys, data.horses.map((h) => h.appearance)), LUT_W, Math.max(1, data.horses.length), T.RGBAFormat);
    for (const st of [art.gallop, art.idle, ...Object.values(art.strips)]) {
      if (!st) continue;
      this.lodTex.set(
        st,
        st.lods.map((l) => ({ idx: this.dataTex(l.index, l.width, l.height, T.RedFormat), nrm: l.normal ? this.dataTex(l.normal, l.width, l.height, T.RGBAFormat) : null })),
      );
      this.mskTex.set(st, this.dataTex(st.mask, st.lods[0]!.width, st.lods[0]!.height, T.RGBAFormat));
    }
    this.buildBackdrop();
    this.into = this.trackLayer;
    this.buildGround();
    this.buildProps();
    // Starting stalls: one bay per runner lane, world-anchored at the start line.
    let startM = 0;
    for (const s of this.motion.stateAt(0)) startM = Math.max(startM, s.x);
    this.gate = StallGate.build(this.art.images, this.look, data, startM, {
      own: (g) => this.own(g),
      canvasTex: (img, o) => this.canvasTex(img, o),
      bandMat: (tex, w, h, o) => this.bandMat(tex, w, h, o),
      quad: (m, order) => this.quad(m, order),
      place: (m, x, y, w, h) => this.place(m, x, y, w, h),
    });
    this.buildRunners();
    this.buildGapMarks();
    this.buildGroundFx();
    this.into = null;
    this.buildFx();
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
    (this.into ?? this.scene).add(mesh);
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
    (this.into ?? this.scene).add(pts);
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
    // The stage's scenery (course far panorama, midground, field colours, rail decor and the
    // grandstand ~30 m before the post). No known course: the parkland set.
    const sc = this.stage.scenery;
    const get = (src: string) => this.stageArt.images.get(src);
    const hills = bake.bakeHills(img, look, get(sc.far) ?? null, sc.farIsCourse);
    if (hills) this.addBand(hills, this.plan.depth.far, O.hills, "backdrop");
    const fieldTex = this.canvasTex(bake.bakeField(look, sc.field));
    this.field = this.quad(this.bandMat(fieldTex, 4, 64), O.field);
    const trees = bake.bakeMid(get, sc.midTemplate, look) ?? bake.bakeTrees(img, look);
    if (trees) this.addBand(trees, this.plan.depth.mid, O.trees, "backdrop");
    const standImg = get(sc.stand.src);
    if (standImg) {
      const s = bake.bakeStand(standImg, look);
      const mat = this.bandMat(this.canvasTex(s.canvas, { mip: true }), s.canvas.width, s.canvas.height);
      this.stand = { mesh: this.quad(mat, O.stand), w: s.canvas.width, h: s.canvas.height, pad: s.pad };
    }
    const decorImg = sc.railDecor ? get(sc.railDecor.src) : undefined;
    const railFar = bake.bakeRailFar(img, look, { railFill: sc.railFill, decor: decorImg && sc.railDecor ? { img: decorImg, every: sc.railDecor.everyPx, lift: sc.railDecor.liftPx } : null });
    if (railFar) this.addBand(railFar, 1, O.railFar, "railFar");
    this.buildCrowd();
    if (this.stage.elevation.gradientPermille !== 0) {
      // On a sloping finish the rail dips below its usual line at the low end of the frame:
      // a level bank of the field's grass covers the backdrop's foot there (drawn before the
      // track, so the tilted ground and rail paint over it wherever they rise).
      const bank = this.bandMat(fieldTex, 4, 64);
      this.setUv(bank, 0, 0.96, 1, 0.04); // the field strip's own bottom colour, hazed alike
      this.bank = this.quad(bank, O.ground - 0.1);
    }
    const railNear = bake.bakeRailNear(img);
    if (railNear) this.addBand(railNear, 1, O.railNear, "railNear");
  }

  private addBand(layer: bake.BakedLayer, depth: number, order: number, kind: "backdrop" | "railFar" | "railNear") {
    const sharp = kind === "railFar";
    const tex = this.canvasTex(layer.canvas, { repeatX: true, mip: kind !== "backdrop" });
    const mat = this.bandMat(tex, layer.canvas.width, layer.canvas.height, { sharp });
    // Rails belong to the track: they tilt with it on a sloping finish.
    if (kind !== "backdrop") this.into = this.trackLayer;
    this.bands.push({ mesh: this.quad(mat, order), mat, layer, depth, off: 0, kind });
    this.into = null;
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
      uLaneW: { value: this.stage?.lanes.widthM ?? LANE_W },
      uTexPerM: { value: SRC_PX_PER_M },
      uCxMod: { value: 0 },
      uFinishPx: { value: 1e7 },
      uBlurM: { value: 0 },
      uRailL: { value: this.railLane },
      uStripes: { value: surface === "turf" ? 0.045 : 0.018 },
      uFog: { value: new T.Vector3(fog[0], fog[1], fog[2]) },
      uHaze: { value: 0.5 * this.look.hazeMul },
      uTint: { value: new T.Vector4(tc[0], tc[1], tc[2], tint[1] as number) },
      uPivot: { value: new T.Vector2(0, 0) },
      uRotCS: { value: new T.Vector2(1, 0) },
    });
    this.ground = { mesh: this.quad(mat, O.ground), mat };
  }

  /** The stage's landmarks on the far rail: numbered poles, distance boards, judge's box, post. */
  private buildProps(): void {
    const tint: [string, number] = this.look.spriteTint;
    const pole = this.art.images.get("furlong-pole");
    const post = this.art.images.get("finish-post");
    const add = (c: HTMLCanvasElement | HTMLImageElement, x: number, lift: number, lane: number, order: number = O.props) => {
      const m = this.bandMat(this.canvasTex(c), c.width, c.height, { sharp: true, tint });
      this.props.push({ mesh: this.quad(m, order), x, w: c.width, h: c.height, lift, lane });
    };
    const poleLane = this.railLane - 0.45;
    for (const p of this.plan.props) {
      if (p.kind === "post") {
        if (post) add(post, p.x, 0, poleLane);
      } else if (p.kind === "judge") {
        add(judgeBoxCanvas(), p.x, 0, this.railLane + 1.6, O.judge);
      } else {
        const h = pole?.height ?? 142;
        if (pole) add(pole, p.x, 0, poleLane);
        // the plate sits on top of the pole (its foot 6 px into the pole's cap)
        if (p.plate) add(plateCanvas(p.plate), p.x, h - 6, poleLane);
      }
    }
  }

  /** The cheering crowd strip along the far rail around the line (frame 0 = the static crowd). */
  private buildCrowd(): void {
    const c = this.stage.scenery.crowd[0];
    const img = c ? this.stageArt.images.get(c.src) : undefined;
    if (!c || !img) return;
    const frames = stripFrames(img, 320);
    const tex = frames.map((f) => this.canvasTex(f, { repeatX: true, mip: true }));
    const mat = this.bandMat(tex[0]!, 320, img.height, { sharp: true, tint: this.look.spriteTint });
    this.into = this.trackLayer;
    this.crowd = { mesh: this.quad(mat, O.crowd), mat, tex, w: 320, h: img.height, x0: c.fromX, x1: c.toX };
    this.into = null;
  }

  /** Ground fx sprites (mud / dust / divots by surface and going), a small recycled pool. */
  private buildGroundFx(): void {
    for (const id of this.stage.fx.emit) {
      const img = this.stageArt.images.get(`race/${id}.png`);
      if (!img) continue;
      const c = fxStripCanvas(img, this.stageArt.fx, id, this.stage.fx.key);
      this.fxStrips.push({ tex: this.canvasTex(c, { nearest: true }), frames: 8, fw: 48, fh: 32, fps: FX_FPS[id] ?? 12, anchor: FX_ANCHOR[id] ?? [0.8, 0.8] });
    }
    if (!this.fxStrips.length) return;
    const n = this.quality === "high" ? FX_MAX : FX_MAX / 2;
    for (let i = 0; i < n; i++) {
      const st = this.fxStrips[0]!;
      const mat = this.bandMat(st.tex, st.fw * st.frames, st.fh, { sharp: true, tint: this.look.spriteTint });
      const mesh = this.quad(mat, O.dust);
      mesh.visible = false;
      this.fx.push({ mesh, mat, strip: 0, x: 0, lane: 0, age: -1, flip: false });
    }
  }

  /** What this scene built from the stage (guard test: must equal the 3D view's). */
  get inventory(): StageInventory {
    return tracksideInventory(this.stage, this.plan);
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
        uMsk: { value: this.mskTex.get(g) },
        uIdxSize: { value: new T.Vector2(l0.width, l0.height) },
        uMskSize: { value: new T.Vector2(l0.width, l0.height) },
        uMskOrigin: { value: new T.Vector2(0, 0) },
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
        x: 0,
        lane: h.gate - 1,
        speed: 0,
        st: { x: 0, lane: h.gate - 1, speed: 0, gait: "stand", phase: 0, anim: "break", frame: 0 },
        lastPhase: Number.NaN,
        strip: null,
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

  /**
   * Gap markers (honest compression): when the whole-field shot squeezes a gap to keep every
   * runner on screen, a soft haze cut stands on the turf in that gap and a chip gives the
   * true gap in lengths. One slot per runner (the gap in front of it); all art is baked here.
   */
  private buildGapMarks(): void {
    const atlas = bake.gapChipAtlas();
    this.gapCells = atlas.cells;
    this.gapAtlasSize = [atlas.canvas.width, atlas.canvas.height];
    const chipTex = this.canvasTex(atlas.canvas, { nearest: true });
    const hazeTex = this.canvasTex(bake.gapHaze());
    for (let i = 0; i < this.runners.length; i++) {
      const hazeMat = this.bandMat(hazeTex, 32, 64, { tint: [this.look.fog, 1], opacity: 0 });
      const chipMat = this.bandMat(chipTex, atlas.canvas.width, atlas.canvas.height, { sharp: true, opacity: 0 });
      const haze = this.quad(hazeMat, O.gapHaze);
      const chip = this.quad(chipMat, O.gapChip);
      haze.visible = false;
      chip.visible = false;
      this.gapMarks.push({ haze, hazeMat, chip, chipMat, a: 0, chipA: 0, x: 0, label: "" });
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
    this.motion.setSource(final);
    this.applyResult();
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
      for (const p of this.fx) p.age = -1;
    }
    if (f.frozen) simDt = 0;
    const snap = this.firstFrame || seek || Number.isNaN(this.lastTime);
    this.lastTime = raceT;
    this.animTime += simDt;
    const realDt = Math.min(0.1, Math.max(0, f.realDt));
    if (!f.frozen) this.realTime += realDt;
    const L = this.L;

    // --- Runners: the shared motion (replay x up to the line, the run-out after it) ----
    this.states = this.motion.stateAt(raceT, this.states);
    this.samples = this.motion.samples;
    const haveFrames = this.data.frames.length > 0;
    for (const r of this.runners) {
      const st = this.states[r.index]!;
      r.st = st;
      const ft = this.motion.finishInfo(r.index).finishT;
      if (!this.data.result && ft !== null) this.winnerTime = Math.min(this.winnerTime, ft);
      r.x = st.x;
      r.speed = st.speed;
      r.lane = haveFrames ? st.lane : this.data.horses[r.index]!.gate - 1;
    }

    // --- Camera + layout -------------------------------------------------------
    // Whole field: every runner stays on screen (placeField's guarantee). Follow mine:
    // the camera locks on the highlighted runner (that guarantee is whole-field only).
    const sprite = this.sprite;
    // Shared shot intent: the viewer's one director runs on whichever view is showing (so a
    // switch keeps its shot); on "pull-up follow" the camera goes with the horse being
    // celebrated (the 3D view frames the same horse); "Follow mine" always wins.
    const winner = this.motion.winner();
    if (f.director) this.direct(f.director, raceT, seek || snap, winner);
    const intent = f.director ? f.director.intent : null;
    const followWinner = intent?.kind === "pullup" && winner >= 0 && tS > this.winnerTime + 2;
    const followIdx = f.follow === true && this.highlight >= 0 ? this.highlight : followWinner ? winner : -1;
    const followOn = followIdx >= 0;
    // Camera feed-forward must describe the target's ACTUAL motion: while paused or frozen
    // (sim time not advancing) the sampled speeds are non-zero but nothing moves, and the
    // follow lock's spring would settle 2*v/omega ahead of the runner — enough to push it
    // out of the close-up frame. The whole-field centre drifted the same way (~10 m ahead
    // of the field while paused), leaving the leader mid-frame and squeezing the rest harder.
    const camV = simDt === 0 ? 0 : 1;
    this.cam.update(
      {
        W: this.W,
        H: this.H,
        dpr: this.B,
        sprite,
        railLane: this.railLane,
        finishX: L,
        runners: this.runners.map((r) => ({ x: r.x, lane: r.lane, speed: r.speed * camV })),
        followIndex: followOn ? followIdx : null,
      },
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
      follow: followOn ? followIdx : null,
    });
    this.layout = lay;
    const dcx = snap || Number.isNaN(this.prevCx) ? 0 : lay.cx - this.prevCx;
    if (!snap && simDt > 0) {
      // Continuity metric: net of the tracked point's own travel (follow mode tracks the
      // highlighted runner, whole-field tracks the field mean).
      let fieldV = 0;
      for (const r of this.runners) fieldV += r.speed;
      fieldV /= Math.max(1, this.runners.length);
      const refV = followOn ? this.runners[followIdx]!.speed : fieldV;
      if (raceT > 1) this.maxCamStep = Math.max(this.maxCamStep, Math.abs(dcx - refV * simDt));
    }
    this.prevCx = lay.cx;
    const v = realDt > 0 && !f.frozen ? dcx / realDt : 0;
    this.camSpeed += (Math.abs(v) - this.camSpeed) * (snap ? 1 : 1 - Math.exp(-realDt * 8));
    this.firstFrame = false;

    this.applyTilt(lay);
    this.drawBackdrop(lay, dcx, realDt, f.frozen);
    this.drawGround(lay);
    this.drawProps(lay);
    this.drawRunners(lay, simDt, raceT, tS);
    this.drawGapMarks(lay, snap ? 0 : realDt, snap);
    this.gate?.draw(lay, raceT, this.byLane.map((r) => r.index), O.horse, this.B);
    this.drawFx(lay, realDt, f.frozen, f.flash);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  private dirScan = 0;
  private dirInput: DirectorInput = { t: 0, runners: [], trackLengthM: 0, winnerTime: Infinity, photoFinish: false, newEvents: [], highlightId: null, winnerId: null };
  private dirEvents: { type: string; horseId?: string }[] = [];

  /** Feed the shared director the same inputs the 3D view gives it. */
  private direct(d: Director, raceT: number, jumped: boolean, winner: number) {
    const evs = this.data.events;
    const tS = Math.max(0, raceT);
    if (jumped) {
      this.dirScan = 0;
      while (this.dirScan < evs.length && evs[this.dirScan]!.tick / this.data.tickHz < tS) this.dirScan++;
    }
    const ne = this.dirEvents;
    ne.length = 0;
    for (; this.dirScan < evs.length && evs[this.dirScan]!.tick / this.data.tickHz <= tS; this.dirScan++) ne.push(evs[this.dirScan]!);
    const inp = this.dirInput;
    if (inp.runners.length !== this.runners.length) inp.runners = this.runners.map((r) => ({ id: r.horseId, x: r.x }));
    for (let i = 0; i < this.runners.length; i++) inp.runners[i]!.x = this.runners[i]!.x;
    inp.t = raceT;
    inp.trackLengthM = this.L;
    inp.winnerTime = this.winnerTime;
    inp.photoFinish = !!this.data.result?.photoFinish;
    inp.newEvents = ne;
    inp.highlightId = this.highlight >= 0 ? this.data.horses[this.highlight]!.horseId : null;
    inp.winnerId = winner >= 0 ? this.data.horses[winner]!.horseId : null;
    d.update(inp);
  }

  /**
   * Finish gradient (Harrowgate's uphill run-in, Larkspur's gentle drop): once the camera is
   * on the final stretch the whole track layer (ground, rails, posts, runners, dust) tilts
   * against the level backdrop, so the field is seen climbing (or running down) the hill.
   */
  private applyTilt(lay: FieldLayout) {
    const e = this.stage.elevation;
    let tilt = 0;
    if (e.gradientPermille !== 0) tilt = finishTilt(e.gradientPermille, (lay.cx - e.fromX + 40) / 90);
    this.tilt = tilt;
    const B = this.B;
    const px = (this.W / 2) * B;
    const py = laneY(lay, this.railLane * 0.5) * B;
    const m = this.trackLayer.matrix;
    if (tilt === 0) m.identity();
    else {
      // p' = R(-tilt) (p - pivot) + pivot   (y down: a negative angle lifts the right side)
      const cs = Math.cos(-tilt);
      const sn = Math.sin(-tilt);
      m.set(cs, -sn, 0, px - cs * px + sn * py, sn, cs, 0, py - sn * px - cs * py, 0, 0, 1, 0, 0, 0, 0, 1);
    }
    this.trackLayer.matrixWorldNeedsUpdate = true;
    const u = this.ground.mat.uniforms;
    (u.uPivot!.value as THREE.Vector2).set(px, py);
    (u.uRotCS!.value as THREE.Vector2).set(Math.cos(-tilt), Math.sin(-tilt));
  }

  /** Extra width (CSS px, each side) the track layers draw while tilted. */
  private tiltMargin(): number {
    return this.tilt === 0 ? 0 : Math.ceil(this.W * TILT_MARGIN + Math.abs(Math.sin(this.tilt)) * this.H);
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
        const mx = this.tiltMargin() * B;
        const hh = b.kind === "railNear" ? Math.max(h * kr, this.H * B - top + mx) : h * kr;
        this.place(b.mesh, -mx, top, Wb + mx * 2, hh);
        this.setUv(b.mat, centre / P - (Wb / 2 + mx) / (kr * P), 0, (Wb + mx * 2) / (kr * P), hh / (h * kr));
        b.mat.uniforms.uBlur!.value = blurM * SRC_PX_PER_M;
      }
    }
    // The field strip reaches under a tilted far rail too (its low end drops below the line).
    const drop = Math.abs(Math.sin(this.tilt)) * Wb * 0.6;
    if (this.field) this.place(this.field, 0, railY - 40 * k, Wb, 40 * k + 2 * B + drop);
    if (this.bank) {
      // Level, from just above the midground's foot down past the dipped rail; the tilted
      // ground and rail draw over it wherever they rise.
      if (this.tilt === 0) this.place(this.bank, 0, 0, 0, 0);
      else this.place(this.bank, 0, railY - 24 * k, Wb, 24 * k + drop + 4 * B);
    }
    if (this.stand) {
      // World-anchored by the post (STAND_DEPTH parallax).
      const s = this.stand;
      const sx = (this.W / 2 + (this.stage.scenery.stand.centreX - lay.cx) * lay.ppm * STAND_DEPTH) * B;
      const w = s.w * k;
      const h = s.h * k;
      const x = sx - w / 2;
      if (x > Wb || x + w < 0) s.mesh.visible = false;
      else this.place(s.mesh, Math.round(x), Math.round(railY - (STAND_LIFT - s.pad) * k - h), Math.round(w), Math.round(h));
    }
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
    const mx = this.tiltMargin() * B;
    this.place(this.ground.mesh, -mx, railY - 2 * B, this.W * B + mx * 2, this.H * B - railY + 2 * B + mx);
    (u.uView!.value as THREE.Vector2).set(this.W * B, this.H * B);
    u.uY0!.value = lay.y0 * B;
    u.uPpm!.value = lay.ppm * B;
    u.uCamH!.value = lay.camH;
    u.uK!.value = lay.k;
    u.uCxMod!.value = ((lay.cx % 8) + 8) % 8;
    u.uFinishPx!.value = (squeezeX(lay, this.W / 2 + (this.L - lay.cx) * lay.ppm) - this.W / 2) * B;
    u.uBlurM!.value = Math.min(1.2, this.camSpeed / 60);
  }

  /** Screen x (buffer px) of world x at a lane, through the runners' squeeze. */
  private screenX(lay: FieldLayout, x: number, lane: number): number {
    const ls = laneScale(lane, lay.k);
    return (this.W / 2 + (squeezeX(lay, this.W / 2 + (x - lay.cx) * lay.ppm) - this.W / 2) * ls) * this.B;
  }

  private drawProps(lay: FieldLayout) {
    const B = this.B;
    for (const p of this.props) {
      const ls = laneScale(p.lane, lay.k);
      const k = (lay.ppm * ls * B) / SRC_PX_PER_M;
      const feet = laneY(lay, p.lane) * B;
      const sx = this.screenX(lay, p.x, p.lane);
      const w = p.w * k;
      const h = p.h * k;
      const x = Math.round(sx - w / 2);
      if (x > this.W * B + 4 || x + w < -4) {
        p.mesh.visible = false;
        continue;
      }
      this.place(p.mesh, x, Math.round(feet - p.lift * k - h), w, h);
    }
    // The cheering crowd behind the far rail, world-anchored between its two ends.
    const c = this.crowd;
    if (c) {
      const lane = this.railLane + 0.3;
      const ls = laneScale(lane, lay.k);
      const k = (lay.ppm * ls * B) / SRC_PX_PER_M;
      const x0 = this.screenX(lay, c.x0, lane);
      const x1 = this.screenX(lay, c.x1, lane);
      const cl0 = Math.max(-4, x0);
      const cl1 = Math.min(this.W * B + 4, x1);
      if (cl1 <= cl0) c.mesh.visible = false;
      else {
        const h = c.h * k;
        const feet = laneY(lay, this.railLane) * B;
        this.place(c.mesh, Math.round(cl0), Math.round(feet - h + 4 * k), Math.round(cl1 - cl0), Math.round(h));
        const span = (x1 - x0) / (c.w * k);
        this.setUv(c.mat, ((cl0 - x0) / (x1 - x0)) * span, 0, ((cl1 - cl0) / (x1 - x0)) * span, 1);
        let lead = 0;
        for (const r of this.runners) lead = Math.max(lead, r.x);
        const tex = c.tex[crowdFrame(crowdCheering(this.L - lead, this.lastTime, this.winnerTime), this.animTime, c.tex.length)]!;
        if (c.mat.uniforms.uMap!.value !== tex) c.mat.uniforms.uMap!.value = tex;
      }
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

  /** The strip for a runner's animation, falling back to the gallop/idle when art is missing. */
  private stripFor(anim: AnimId): { st: StripSet; idle: boolean } {
    const art = this.art;
    if (anim === "idle") return art.idle ? { st: art.idle, idle: true } : { st: art.strips.break ?? art.gallop, idle: false };
    if (anim === "gallop") return { st: art.gallop, idle: false };
    const s = art.strips[anim];
    if (s) return { st: s, idle: false };
    if (anim === "break" && art.idle) return { st: art.idle, idle: true };
    return { st: anim === "drive" || anim === "lunge" ? art.strips.drive ?? art.gallop : art.gallop, idle: false };
  }

  private drawRunners(lay: FieldLayout, simDt: number, raceT: number, tS: number) {
    void tS;
    const B = this.B;
    // depth order: far lanes first
    this.byLane.sort((a, b) => b.lane - a.lane || a.x - b.x);
    this.byLane.forEach((r, i) => (r.mesh.renderOrder = O.horse + i));
    for (const r of this.runners) {
      const p = lay.placed[r.index]!;
      const s = r.st;
      const { st } = this.stripFor(s.anim);
      const q = (p.pxPerM * B) / st.pxPerM;
      if (st !== r.strip) r.lod = 0;
      r.strip = st;
      r.lod = this.chooseLod(q, r.lod);
      const lod = st.lods[r.lod - 1]!;
      const tex = this.lodTex.get(st)![r.lod - 1]!;
      const frames = lod.frames;
      const frame = Math.max(0, Math.min(frames - 1, s.anim === "gallop" || s.anim === "drive" ? Math.floor((s.phase - Math.floor(s.phase)) * frames) % frames : s.frame % frames));
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
      u.uMsk!.value = this.mskTex.get(st);
      (u.uIdxSize!.value as THREE.Vector2).set(lod.width, lod.height);
      (u.uMskSize!.value as THREE.Vector2).set(st.lods[0]!.width, st.lods[0]!.height);
      (u.uMskOrigin!.value as THREE.Vector2).set(...frameOrigin(st.lods[0]!, frame));
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
      // one ground-fx burst per stride, from the leading hind hoof (~1.9 m behind the nose)
      if (simDt > 0 && r.speed > 5 && !Number.isNaN(r.lastPhase) && Math.floor(s.phase) > Math.floor(r.lastPhase)) this.emitFx(r, r.x - 1.9);
      r.lastPhase = s.phase;
    }
    void raceT;
    if (this.marker && this.highlight >= 0) {
      const r = this.runners[this.highlight]!;
      const p = lay.placed[this.highlight]!;
      const m = Math.max(2, Math.round(B * Math.min(3, Math.max(1.5, p.pxPerM / 70))));
      const bob = Math.round(Math.sin(this.realTime * 4) * 1.5) * m * 0.5;
      const cxm = p.ax * B - 0.62 * p.pxPerM * B;
      this.place(this.marker, Math.round(cxm - 5.5 * m), Math.round(r.rect.y * B + 0.06 * p.pxPerM * B - 10 * m + bob), 11 * m, 9 * m);
    }
  }

  /** Device px per chip texel: an integer, ~2 CSS px on desktop, ~1.5 on phones. */
  private chipScale(): number {
    return Math.max(2, Math.round(this.B * (this.W < 560 ? 1.5 : 2)));
  }

  /**
   * Haze cut + true-length chip in every squeezed gap (`FieldGap.strength`), eased so they
   * fade in and out with the squeeze. Chips never overlap: when two would, the bigger true
   * gap keeps its number (the other keeps its haze cut). Uses only the current layout, i.e.
   * the frames already shown.
   */
  private drawGapMarks(lay: FieldLayout, dt: number, snap: boolean) {
    const B = this.B;
    const marks = this.gapMarks;
    const byAhead = this.gapScratch;
    byAhead.length = marks.length;
    byAhead.fill(null);
    for (const g of lay.gaps) byAhead[g.ahead] = g;
    const m = this.chipScale();
    const cands: ChipCandidate[] = [];
    const { l: il, r: ir } = lay.insets;
    for (let i = 0; i < marks.length; i++) {
      const g = byAhead[i];
      if (!g || g.strength <= 0.25) continue; // below this the chip stays out (haze only)
      const label = chipLabel(g.trueM);
      const cell = label ? this.gapCells.get(label) : undefined;
      if (!label || !cell) continue;
      const w = (cell.w * m) / B;
      cands.push({ key: i, x: Math.min(Math.max(g.x, il + w / 2), this.W - ir - w / 2), w, priority: g.trueM, sticky: marks[i]!.chipA > 0.5 });
    }
    const shown = pickChips(cands, 4, this.W < 560 ? 4 : 6);
    const k = snap ? 1 : 1 - Math.exp(-dt / (GAP_FADE_S / 2.5));
    const kx = snap ? 1 : 1 - Math.exp(-dt / 0.08);
    const hazeTop = laneY(lay, this.railLane - 0.45) - 0.3 * lay.ppm;
    const hazeBottom = lay.y0 + 0.25 * lay.ppm;
    // Chips hang on the far rail, at the head of their haze column (clear of the bottom HUD
    // and of the near-lane horses), never above the HUD-safe band.
    const chipH = (CHIP_H * m) / B;
    const chipTop = Math.max(lay.insets.t + 2, laneY(lay, this.railLane - 0.45) - chipH - 2);
    for (let i = 0; i < marks.length; i++) {
      const st = marks[i]!;
      const g = byAhead[i];
      const target = g ? g.strength : 0;
      st.a += (target - st.a) * k;
      // The haze follows the squeeze itself; the chip only comes in on a clear squeeze and is
      // fully opaque from half strength on (a ghostly half-faded number reads as a glitch).
      const cs = g && shown.has(i) ? Math.min(1, Math.max(0, (g.strength - 0.25) / 0.25)) : 0;
      st.chipA += (cs * cs * (3 - 2 * cs) - st.chipA) * k;
      if (g) {
        const c = cands.find((cc) => cc.key === i);
        const tx = c ? c.x : g.x;
        st.x = st.a < 0.02 && st.chipA < 0.02 ? tx : st.x + (tx - st.x) * kx;
        if (target > 0) st.label = chipLabel(g.trueM) ?? st.label;
      }
      if (st.a > 0.01) {
        const hw = Math.max(12, 0.9 * lay.ppm);
        st.hazeMat.uniforms.uOpacity!.value = 0.3 * st.a;
        this.place(st.haze, (st.x - hw / 2) * B, hazeTop * B, hw * B, Math.max(1, hazeBottom - hazeTop) * B);
      } else st.haze.visible = false;
      const cell = this.gapCells.get(st.label);
      if (st.chipA > 0.01 && cell) {
        const [aw, ah] = this.gapAtlasSize;
        this.setUv(st.chipMat, cell.x / aw, cell.y / ah, cell.w / aw, cell.h / ah);
        st.chipMat.uniforms.uOpacity!.value = Math.min(1, st.chipA);
        const w = cell.w * m;
        this.place(st.chip, Math.round(st.x * B - w / 2), Math.round(chipTop * B), w, cell.h * m);
      } else st.chip.visible = false;
    }
  }

  /** Gap chips on screen (dev hook): label, centre x (CSS px) and opacity. */
  debugGapMarks(): { label: string; x: number; alpha: number }[] {
    return this.gapMarks.filter((g) => g.chipA > 0.05).map((g) => ({ label: g.label, x: g.x, alpha: g.chipA }));
  }

  /** Deterministic per-runner jitter (no Math.random in what both views show). */
  private fxCount = 0;
  private emitFx(r: Runner, wx: number) {
    if (!this.fx.length) return;
    const slot = this.fx.find((p) => p.age < 0) ?? null;
    if (!slot) return;
    const n = this.fxCount++;
    // main strip, an occasional second one (1 in 4) when the going has one
    const strip = this.fxStrips.length > 1 && n % 4 === 3 ? 1 : 0;
    slot.strip = strip;
    slot.x = wx + (((n * 37) % 7) - 3) * 0.03;
    slot.lane = r.lane + (((n * 13) % 5) - 2) * 0.04;
    slot.age = 0;
    slot.flip = n % 5 === 2;
    const st = this.fxStrips[strip]!;
    if (slot.mat.uniforms.uMap!.value !== st.tex) slot.mat.uniforms.uMap!.value = st.tex;
  }

  private drawFx(lay: FieldLayout, dt: number, frozen: boolean, flash: number) {
    const B = this.B;
    const Wb = this.W * B;
    const Hb = this.H * B;
    const look = this.look;
    // ground fx sprites: world-anchored where the hoof struck, one-shot frames, whole pixels
    const sdt = frozen ? 0 : dt;
    for (const p of this.fx) {
      if (p.age < 0) {
        p.mesh.visible = false;
        continue;
      }
      p.age += sdt;
      const st = this.fxStrips[p.strip]!;
      const frame = Math.floor(p.age * st.fps);
      if (frame >= st.frames) {
        p.age = -1;
        p.mesh.visible = false;
        continue;
      }
      const ls = laneScale(p.lane, lay.k);
      const k = Math.max(1, Math.round((lay.ppm * ls * B) / SRC_PX_PER_M));
      const sx = this.screenX(lay, p.x, p.lane);
      const feet = laneY(lay, p.lane) * B;
      const w = st.fw * k;
      const h = st.fh * k;
      const ax = (p.flip ? 1 - st.anchor[0] : st.anchor[0]) * w;
      this.place(p.mesh, Math.round(sx - ax), Math.round(feet - st.anchor[1] * h), w, h);
      this.setUv(p.mat, p.flip ? (frame + 1) / st.frames : frame / st.frames, 0, (p.flip ? -1 : 1) / st.frames, 1);
    }

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
    for (const [st, lts] of this.lodTex) {
      for (const lt of lts) {
        for (const run of this.runners) {
          run.mat.uniforms.uIdx!.value = lt.idx;
          run.mat.uniforms.uMsk!.value = this.mskTex.get(st);
        }
        r.compile(this.scene, this.camera);
      }
    }
    for (const run of this.runners) run.mesh.visible = true;
    for (const p of this.fx) p.mesh.visible = true;
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

/**
 * HD-2D race scene (Three.js): the 3D broadcast view. It renders the race STAGE
 * (stage/buildRaceStage.ts) that Trackside renders too: the same course scenery, the same
 * light (sun on the right, front key light), the same far-rail landmarks, the same runner
 * motion and animation strips (stage/motion.ts), only through a perspective broadcast camera.
 *
 * World units are metres. x runs along the track (start at 0, finish at trackLength),
 * y is up, z is across: the inner rail is at z = 0 (nearest the camera) and lanes run
 * away from the camera towards -z. The grandstand stands beyond the far (outer) rail.
 *
 * Crisp pixels in motion: horse, jockey and ground-fx billboards face the camera square-on,
 * pick an exact integer level of detail, snap their scale towards whole screen pixels per
 * texel and their anchor onto the pixel grid; the camera itself moves in whole pixels at the
 * focal plane. Depth of field and bloom only touch the far scenery, never the field.
 */
import type * as THREE from "three";
import type { RaceReplay } from "@thoroughbred/shared";
import type { HorseSample } from "../sampleReplay";
import { Spring } from "../scene/camera";
import { pipRect, type CameraMode, type RenderQuality } from "../types";
import type { ArtSet } from "./art";
import type { HorseRig, HorseRigFactory, LitHorseRig, RigKind } from "./horseRig";
import { hexToRgb, rng } from "./color";
import { blobShadow, cloudSprite, gatePanelTile, grassTile, hedgeTile, hillsStrip, skyStrip, sunSprite, surfaceTile, type Look } from "./pixelTextures";
import { PostFX } from "./post";
import { PixelRain } from "./vfx";
import { Director, SHOT_REACH, type DirectorInput, type ShotType } from "../director";
import { buildRaceStage, elevationAt, type RaceStage, type StageInventory } from "../stage/buildRaceStage";
import { FieldMotion, injuredFromEvents, type AnimId, type RunnerState } from "../stage/motion";
import { POST_CANTER, preOffStep, type PreOffPlan } from "../stage/preoff";
import { crowdCheering, crowdFrame, fxStripCanvas, judgeBoxCanvas, plateCanvas, stripFrames } from "../stage/paint";
import { TRACK_POST, TRACK_PRE, hd2dInventory, hd2dPlan, laneZ as stageLaneZ, type Hd2dPlan } from "./stagePlan";
import type { FxPalette, StripSet, TracksideArt } from "../trackside/art";
import { LUT_W, PATTERN_ID, buildLut, frameOrigin } from "../trackside/strips";
import { HORSE_FRAG, QUAD_VERT } from "../trackside/shaders";

/**
 * Race data the scene renders. A finished `RaceReplay` satisfies it; a live broadcast
 * passes its header with the frames/events received so far and no result (the scene
 * never reads a result it doesn't have; `setFinal` hands it over at the end).
 */
const NO_IDS: readonly string[] = [];

export interface SceneRaceData {
  race: RaceReplay["race"];
  horses: RaceReplay["horses"];
  tickHz: number;
  sampleEvery: number;
  trackLengthMm: number;
  laneCount: number;
  readonly frames: ReadonlyArray<ReadonlyArray<number>>;
  readonly events: ReadonlyArray<RaceReplay["events"][number]>;
  result?: RaceReplay["result"] | null;
}

export interface SceneFrame {
  time: number;
  realDt: number;
  camera: CameraMode;
  /** Trackside only: "Follow mine" camera (locks on the highlighted runner). Ignored here. */
  follow?: boolean;
  frozen: boolean;
  flash: number;
  /** The viewer's one director (shared by both views, so a switch keeps the shot's subject). */
  director?: Director;
}

export interface HD2DSceneOptions {
  quality: RenderQuality;
  highlightHorseId?: string;
  /** Render at a low internal resolution and upscale with nearest filtering. */
  pixelated?: boolean;
  art: ArtSet;
  rigs: HorseRigFactory;
  rigKind: RigKind;
  /** The race stage (both views). Built from the race alone (default look) when omitted. */
  stage?: RaceStage;
  /** Stage art by manifest src (trackside/art.ts loadStageArt). */
  stageArt?: Map<string, HTMLImageElement>;
  /** Palette-index horse strips (the same frames and colours as Trackside); null = rig sprites. */
  strips?: TracksideArt | null;
  fxPalette?: FxPalette | null;
  /** Horses injured in the race (pulled up after the line). */
  injured?: ReadonlySet<string>;
  /** The build-up before the off (stage/preoff.ts); null/omitted = standing in the stalls. */
  preOff?: PreOffPlan | null;
}

/**
 * Pixel density (HD pixel standard v2): texels per metre by depth plane, so one texel
 * covers about the same screen area across a plane. Focal plane = horses, props, ground.
 */
const FOCAL_PX_PER_M = 96;
/** Nose-to-tail length of a racehorse (m); low-density strips are scaled to it. */
const HORSE_LEN_M = 2.4;
/** Ground fx pool. */
const FX_MAX = 48;
const FX_FPS: Record<string, number> = { "fx-mud": 14, "fx-dust": 12, "fx-divot": 14 };
const FX_ANCHOR: Record<string, [number, number]> = { "fx-mud": [0.812, 0.812], "fx-dust": [0.729, 0.812], "fx-divot": [0.792, 0.844] };

/** The 3D horse shader: Trackside's palette/LUT horse, linearised for the 3D pipeline. */
const HORSE_FRAG_3D = HORSE_FRAG.replace(
  "gl_FragColor = col * uOpacity;\n}",
  `vec4 o = col * uOpacity;
  o.rgb = pow(max(o.rgb, vec3(0.0)), vec3(2.2));
  gl_FragColor = o;
  #include <colorspace_fragment>
}`,
);

/** Device rows per sky art-pixel step: the sky's whole-pixel scale is round(viewport h / this)
 *  (about Trackside's backdrop scale: 1 on a 700 px desktop stage, 2-3 on a phone). */
const SKY_ROWS_PER_K = 560;
/** Art rows of the sky's bottom tucked below the horizon (behind the far hills). */
const SKY_SINK = 10;
/** Sky parallax (art px per metre of camera travel) and drift (art px per second). */
const SKY_PARALLAX = 0.5;
const SKY_DRIFT = 1.2;

const SKY_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }
`;

/** Screen-space pixel sky: whole device pixels per art pixel (nearest), mirror-tiled in x. */
const SKY_FRAG = /* glsl */ `
uniform sampler2D uSky; uniform vec2 uSize; uniform float uK; uniform float uHorizon; uniform float uOff; uniform float uVpX;
void main() {
  float y = floor((gl_FragCoord.y - uHorizon) / uK);
  float x = floor((gl_FragCoord.x - uVpX) / uK + uOff);
  float m = mod(x, 2.0 * uSize.x);
  float xx = m < uSize.x ? m : 2.0 * uSize.x - 1.0 - m;
  vec2 uv = vec2((xx + 0.5) / uSize.x, (clamp(y, 0.0, uSize.y - 1.0) + 0.5) / uSize.y);
  gl_FragColor = vec4(texture2D(uSky, uv).rgb, 1.0);
  #include <colorspace_fragment>
}
`;

interface Runner {
  index: number;
  horseId: string;
  /** Rig sprite (fallback path) or null when drawn from the shared strips. */
  rig: HorseRig | null;
  group: THREE.Group;
  plane: THREE.Mesh;
  mat: THREE.Material;
  shadow: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  bodyX: number;
  bodyZ: number;
  speed: number;
  st: RunnerState;
  lastPhase: number;
  strip: StripSet | null;
  lod: number;
}

class Spring3 {
  x: Spring;
  y: Spring;
  z: Spring;
  constructor(v: THREE.Vector3, omega: number) {
    this.x = new Spring(v.x, omega);
    this.y = new Spring(v.y, omega);
    this.z = new Spring(v.z, omega);
  }
  step(t: THREE.Vector3, dt: number, velX = 0): void {
    this.x.step(t.x, dt, velX);
    this.y.step(t.y, dt);
    this.z.step(t.z, dt);
  }
  snap(t: THREE.Vector3): void {
    this.x.snap(t.x);
    this.y.snap(t.y);
    this.z.snap(t.z);
  }
  into(v: THREE.Vector3): THREE.Vector3 {
    return v.set(this.x.x, this.y.x, this.z.x);
  }
}

/** Field/rail colour as a multiplier over the grass tile (brightest channel -> ~1). */
function tintOver(hex: string, lift = 1): string {
  const [r, g, b] = hexToRgb(hex);
  const m = Math.max(r, g, b, 1);
  const f = (c: number) => Math.round(Math.min(255, (c / m) * 255 * lift));
  return `#${((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1)}`;
}

export class HD2DScene {
  readonly canvas: HTMLCanvasElement;
  private T: typeof THREE;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private post: PostFX | null = null;
  private replay: SceneRaceData;
  private stage: RaceStage;
  private plan: Hd2dPlan;
  private stageArt: Map<string, HTMLImageElement>;
  private strips: TracksideArt | null;
  private motion: FieldMotion;
  private states: RunnerState[] = [];
  private samples: HorseSample[] = [];
  private look: Look;
  private runners: Runner[] = [];
  private disposables: { dispose(): void }[] = [];
  private rigs: HorseRigFactory;
  private rain: PixelRain | null = null;
  private sky: THREE.Mesh;
  private sun: THREE.Sprite | null = null;
  private sunLight: THREE.DirectionalLight;
  private sunDir: THREE.Vector3;
  private keyDir: THREE.Vector3;
  private nearRail: THREE.Material[] = [];
  private nearRailA = 1;
  private crowd: { mesh: THREE.Mesh; tex: THREE.Texture[] } | null = null;
  private fx: { mesh: THREE.Mesh; mats: THREE.MeshBasicMaterial[]; strip: number; x: number; y: number; z: number; age: number; flip: boolean }[] = [];
  private fxPal: FxPalette | null;
  private fxStrips: { tex: THREE.Texture; frames: number; fw: number; fh: number; fps: number; anchor: [number, number] }[] = [];
  private fxCount = 0;
  private doors: THREE.Group[] = [];
  private marker: THREE.Sprite | null = null;
  private ring: THREE.Mesh | null = null;
  private camPos: Spring3;
  private camLook: Spring3;
  private fov: Spring;
  private ownDirector = new Director();
  private director: Director = this.ownDirector;
  private byX: Runner[] = [];
  private dirEvents: { type: string; horseId?: string }[] = [];
  private dirInput: DirectorInput = { t: 0, runners: [], trackLengthM: 0, winnerTime: Infinity, photoFinish: false, newEvents: [], highlightId: null, winnerId: null };
  private dirEventScan = 0;
  private shotType: ShotType = "gate";
  private shotSubject: string | null = null;
  private pipCam: THREE.PerspectiveCamera | null = null;
  private pipPos: Spring3;
  private pipLook: Spring3;
  private pv1: THREE.Vector3;
  private pv2: THREE.Vector3;
  private pipActive = false;
  private pipWasActive = false;
  private lastTime = Number.NaN;
  private animTime = 0;
  /** Sky drift (art px), real time. */
  private skyDrift = 0;
  private firstFrame = true;
  /** Build-up shot last frame (0 none, 1 to post, 2 the stalls): a change is a cut. */
  private preCut = 0;
  private quality: RenderQuality;
  private pixelated: boolean;
  private highlight: number;
  private L: number;
  private trackW: number;
  /** Official winner time once the result is known, else the first frame-derived crossing. */
  private winnerTime = Number.POSITIVE_INFINITY;
  private photoFinish = false;
  private nearBuf: Runner[] = [];
  private W = 1;
  private H = 1;
  private v1: THREE.Vector3;
  private v2: THREE.Vector3;
  private v3: THREE.Vector3;
  private v4: THREE.Vector3;
  private v5: THREE.Vector3;
  private buf: THREE.Vector2;
  private focusDist = 15;
  private focusRange = 4;
  private lodTex = new Map<StripSet, { idx: THREE.DataTexture; nrm: THREE.DataTexture | null }[]>();
  private mskTex = new Map<StripSet, THREE.DataTexture>();
  private lut: THREE.DataTexture | null = null;

  constructor(T: typeof THREE, replay: SceneRaceData, opts: HD2DSceneOptions) {
    this.T = T;
    this.replay = replay;
    this.quality = opts.quality;
    this.pixelated = !!opts.pixelated;
    this.rigs = opts.rigs;
    this.stage = opts.stage ?? buildRaceStage(null, replay);
    this.plan = hd2dPlan(this.stage);
    this.stageArt = opts.stageArt ?? new Map();
    this.strips = opts.strips ?? null;
    this.fxPal = opts.fxPalette ?? null;
    this.motion = new FieldMotion(replay, { injured: opts.injured ?? injuredFromEvents(replay.events), preOff: opts.preOff ?? null });
    this.look = this.stage.look.three;
    this.L = this.stage.L;
    this.trackW = this.plan.trackW;
    this.applyResult();
    this.highlight = replay.horses.findIndex((h) => h.horseId === opts.highlightHorseId);
    this.v1 = new T.Vector3();
    this.v2 = new T.Vector3();
    this.v3 = new T.Vector3();
    this.v4 = new T.Vector3();
    this.v5 = new T.Vector3();
    this.buf = new T.Vector2();

    const renderer = new T.WebGLRenderer({ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false });
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.NoToneMapping;
    renderer.shadowMap.enabled = opts.quality === "high";
    renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";

    const scene = new T.Scene();
    this.scene = scene;
    scene.fog = new T.Fog(this.look.fog, this.look.fogNear, this.look.fogFar);
    scene.background = new T.Color(this.look.fog);
    this.camera = new T.PerspectiveCamera(34, 16 / 9, 0.3, 2400);

    // --- Light: the sun disc on the right beyond the far rail (as Trackside's glow), the
    // key light from the camera side on the same side, so the flank we see is lit.
    this.sunDir = new T.Vector3(...this.stage.look.sunDir).normalize();
    this.keyDir = new T.Vector3(...this.stage.look.keyDir).normalize();
    this.sunLight = new T.DirectionalLight(this.look.sunColor, this.look.sunIntensity);
    this.sunLight.castShadow = opts.quality === "high";
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 200;
    this.sunLight.shadow.bias = -0.0008;
    scene.add(this.sunLight, this.sunLight.target);
    scene.add(new T.HemisphereLight(this.look.hemiSky, this.look.hemiGround, this.look.hemiIntensity));

    this.sky = this.buildSky(opts.art);
    this.buildGround(opts.art, replay.race.surface);
    this.buildBackdrop(opts.art);
    this.buildRails();
    this.buildLandmarks(opts.art);
    this.buildGate();
    this.buildHorses(opts);
    this.buildGroundFx();
    this.buildMarker();

    if (this.look.rain) {
      this.rain = new PixelRain(T, opts.quality === "high" ? 900 : 350);
      scene.add(this.rain.lines);
      this.disposables.push(this.rain);
    }
    if (opts.quality === "high") {
      this.post = new PostFX(T, renderer);
      this.disposables.push(this.post);
    }

    const start = new T.Vector3(0, 14, 26);
    this.camPos = new Spring3(start, 2.2);
    this.pv1 = new T.Vector3();
    this.pv2 = new T.Vector3();
    this.pipPos = new Spring3(start, 2.6);
    this.pipLook = new Spring3(start, 3);
    if (opts.quality === "high" && this.highlight >= 0) this.pipCam = new T.PerspectiveCamera(22, 16 / 9, 0.3, 2400);
    this.camLook = new Spring3(new T.Vector3(2, 0, -this.trackW / 2), 2.6);
    this.fov = new Spring(34, 2);
  }

  // ---------------------------------------------------------------------------
  // Construction helpers
  // ---------------------------------------------------------------------------

  private el(x: number): number {
    return elevationAt(this.stage.elevation, x);
  }

  private laneZ(lane: number): number {
    return stageLaneZ(this.stage, lane);
  }

  private tex(src: HTMLCanvasElement | HTMLImageElement, opts: { repeat?: boolean; mip?: boolean } = {}): THREE.Texture {
    const T = this.T;
    const t = src instanceof HTMLCanvasElement ? new T.CanvasTexture(src) : new T.Texture(src);
    t.colorSpace = T.SRGBColorSpace;
    t.magFilter = T.NearestFilter;
    // Ground tiles and far scenery: crisp nearest magnification up close, trilinear
    // minification far away. Sprites on the field plane never get mipmaps.
    t.minFilter = opts.mip ? T.LinearMipmapLinearFilter : T.NearestFilter;
    t.generateMipmaps = !!opts.mip;
    if (opts.mip) t.anisotropy = Math.min(8, this.renderer?.capabilities.getMaxAnisotropy?.() ?? 4);
    if (opts.repeat) {
      t.wrapS = T.RepeatWrapping;
      t.wrapT = T.RepeatWrapping;
    }
    t.needsUpdate = true;
    this.disposables.push(t);
    return t;
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
    return this.own(t);
  }

  private own<G extends { dispose(): void }>(g: G): G {
    this.disposables.push(g);
    return g;
  }

  private buildSky(art: ArtSet): THREE.Mesh {
    const T = this.T;
    const artSky = art.images.get(this.stage.look.sky.art);
    const src = artSky ?? skyStrip(this.look);
    const map = this.tex(src);
    // The sky is pixel art drawn the way Trackside draws it: in screen space, at a whole
    // number of device pixels per art pixel, its bottom on the horizon, mirror-tiled sideways
    // and drifting a little with the camera. (A dome stretched ~70 art pixels across the
    // screen in the wide shots: huge blurred blocks.)
    const w = src instanceof HTMLCanvasElement ? src.width : src.naturalWidth || src.width;
    const h = src instanceof HTMLCanvasElement ? src.height : src.naturalHeight || src.height;
    const mat = this.own(
      new T.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: { uSky: { value: map }, uSize: { value: new T.Vector2(w, h) }, uK: { value: 1 }, uHorizon: { value: 0 }, uOff: { value: 0 }, uVpX: { value: 0 } },
        depthTest: false,
        depthWrite: false,
      }),
    );
    const sky = new T.Mesh(this.own(new T.PlaneGeometry(2, 2)), mat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    // Per camera (the main view, the post target and the PiP inset): the horizon's row in
    // that viewport and the art scale for its height.
    const vp = new T.Vector4();
    const fwd = new T.Vector3();
    const hp = new T.Vector3();
    sky.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getCurrentViewport(vp);
      const u = mat.uniforms;
      const k = Math.max(1, Math.round(vp.w / SKY_ROWS_PER_K));
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      hp.copy(camera.position).addScaledVector(fwd, 5000).project(camera);
      u.uK!.value = k;
      u.uHorizon!.value = vp.y + ((hp.y + 1) / 2) * vp.w - SKY_SINK * k;
      u.uVpX!.value = vp.x;
      u.uOff!.value = this.skyDrift + camera.position.x * SKY_PARALLAX;
    };
    this.scene.add(sky);
    if (this.look.sunDisc && this.stage.look.sun) {
      this.sun = new T.Sprite(this.own(new T.SpriteMaterial({ map: this.tex(sunSprite(this.look)), fog: false, depthWrite: false, transparent: true })));
      this.sun.scale.set(150, 150, 1);
      this.sun.renderOrder = -9;
      this.scene.add(this.sun);
    }
    // Code-drawn pixel clouds, far away, only over the code-drawn sky: the art sky has its own
    // clouds (as in Trackside), and these blocky sprites magnified over it were the "pixelated sky".
    const r = rng(77);
    const cloudTex = artSky ? [] : [0, 1, 2].map((i) => this.tex(cloudSprite(this.look, 100 + i)));
    for (let i = 0; i < (artSky ? 0 : this.look.cloudCount); i++) {
      const s = new T.Sprite(this.own(new T.SpriteMaterial({ map: cloudTex[i % 3]!, fog: false, depthWrite: false, transparent: true, alphaTest: 0.5 })));
      const w = 180 + r() * 160;
      s.scale.set(w, w * 0.42, 1);
      s.position.set(-700 + r() * (this.L + 1400), 140 + r() * 260, -1100 - r() * 300);
      s.renderOrder = -8;
      this.scene.add(s);
    }
    return sky;
  }

  /** A plane in x/z subdivided along x, its vertices lifted onto the finish slope. */
  private groundPlane(x0: number, x1: number, z0: number, z1: number, segM: number, lift: number): THREE.BufferGeometry {
    const T = this.T;
    const nx = Math.max(1, Math.ceil((x1 - x0) / segM));
    const g = new T.PlaneGeometry(x1 - x0, z1 - z0, nx, 1);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.el(pos.getX(i)) + lift);
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return this.own(g);
  }

  private buildGround(art: ArtSet, surface: RaceReplay["race"]["surface"]): void {
    const T = this.T;
    const L = this.L;
    const len = L + TRACK_PRE + TRACK_POST;
    const cx = (L - TRACK_PRE + L + TRACK_POST) / 2;
    const sc = this.stage.scenery;
    // Outfield and the field beyond the far rail in the course's colours (stage), the inner
    // field in front of the track plain grass.
    const grassImg = art.images.get("tex-grass");
    const gCanvas = grassImg ?? grassTile(this.look);
    const gTile = gCanvas.width / FOCAL_PX_PER_M;
    const field = (x0: number, x1: number, z0: number, z1: number, tint: string, seg: number) => {
      const tex = this.tex(gCanvas, { repeat: true, mip: true });
      tex.repeat.set((x1 - x0) / gTile, (z1 - z0) / gTile);
      const m = new T.Mesh(this.groundPlane(x0, x1, z0, z1, seg, 0), this.own(new T.MeshLambertMaterial({ map: tex, color: tint })));
      m.receiveShadow = true;
      this.scene.add(m);
    };
    const far = -this.trackW;
    field(cx - len / 2 - 800, cx + len / 2 + 800, far - 1600, far - 4, tintOver(sc.field[1], 0.95), 20);
    field(cx - len / 2 - 800, cx + len / 2 + 800, far - 4, far - 0.2, tintOver(sc.railFill[0], 0.95), 20);
    field(cx - len / 2 - 800, cx + len / 2 + 800, 0.25, 120, "#ffffff", 20);
    // Racing surface: fine tile + soft mowing bands (vertex colours), on the slope.
    const sImg = surface === "synthetic" ? undefined : art.images.get(surface === "turf" ? "tex-turf" : "tex-dirt");
    const sCanvas = sImg ?? surfaceTile(this.look, surface);
    const sTex = this.tex(sCanvas, { repeat: true, mip: true });
    const tile = sCanvas.width / FOCAL_PX_PER_M;
    const tileD = sCanvas.height / FOCAL_PX_PER_M;
    this.scene.add(this.stripedStrip(sTex, -TRACK_PRE, len, tile, tileD, 4, surface === "turf" ? 0.955 : 0.98));
    // Finish line across the track.
    const line = new T.Mesh(this.own(new T.PlaneGeometry(0.2, this.trackW)), this.own(new T.MeshLambertMaterial({ color: 0xf6f6f0 })));
    line.rotation.x = -Math.PI / 2;
    line.position.set(L, this.el(L) + 0.012, -this.trackW / 2);
    line.receiveShadow = true;
    this.scene.add(line);
    // Infield hedge in the foreground (camera side), in segments on the slope.
    const hImg = art.images.get("tex-hedge");
    const hTex = this.tex(hImg ?? hedgeTile(this.look), { repeat: true, mip: true });
    const hImgW = (hImg ?? { width: 64 }).width / FOCAL_PX_PER_M;
    const seg = 20;
    hTex.repeat.set(seg / hImgW, 0.75 / hImgW);
    const n = Math.ceil(len / seg);
    const hedge = new T.InstancedMesh(this.own(new T.BoxGeometry(seg, 0.75, 0.8)), this.own(new T.MeshLambertMaterial({ map: hTex })), n);
    const d = new T.Object3D();
    for (let i = 0; i < n; i++) {
      const x = -TRACK_PRE + (i + 0.5) * seg;
      d.position.set(x, this.el(x) + 0.375, 3.4);
      d.rotation.z = Math.atan(this.slopeAt(x));
      d.updateMatrix();
      hedge.setMatrixAt(i, d.matrix);
    }
    hedge.castShadow = true;
    hedge.receiveShadow = true;
    this.scene.add(hedge);
  }

  private slopeAt(x: number): number {
    return x > this.stage.elevation.fromX ? this.stage.elevation.gradientPermille / 1000 : 0;
  }

  /** Track surface as quads of alternating tint, UVs in world metres, on the slope. */
  private stripedStrip(map: THREE.Texture, x0: number, len: number, tileW: number, tileD: number, stripe: number, dark: number): THREE.Mesh {
    const T = this.T;
    const n = Math.ceil(len / stripe);
    const zA = 0.3;
    const zB = -this.trackW - 0.3;
    const pos = new Float32Array(n * 4 * 3);
    const uv = new Float32Array(n * 4 * 2);
    const col = new Float32Array(n * 4 * 3);
    const idx: number[] = [];
    map.repeat.set(1, 1);
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * stripe;
      const xb = Math.min(x0 + len, xa + stripe);
      const c = i % 2 ? dark : 1;
      const v = [
        [xa, zA],
        [xb, zA],
        [xb, zB],
        [xa, zB],
      ];
      v.forEach(([x, z], k) => {
        const o = i * 4 + k;
        pos.set([x!, this.el(x!) + 0.006, z!], o * 3);
        uv.set([x! / tileW, -z! / tileD], o * 2);
        col.set([c, c, c], o * 3);
      });
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = this.own(new T.BufferGeometry());
    g.setAttribute("position", new T.BufferAttribute(pos, 3));
    g.setAttribute("uv", new T.BufferAttribute(uv, 2));
    g.setAttribute("color", new T.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, this.own(new T.MeshLambertMaterial({ map, vertexColors: true })));
    mesh.receiveShadow = true;
    return mesh;
  }

  private billboardMat(map: THREE.Texture, tint = this.look.billboardTint, fog = true): THREE.MeshBasicMaterial {
    return this.own(new this.T.MeshBasicMaterial({ map, alphaTest: 0.5, color: tint, side: this.T.DoubleSide, fog }));
  }

  /** An upright billboard plane with its bottom-centre at the origin. */
  private uprightGeo(w: number, h: number, ax = 0.5): THREE.PlaneGeometry {
    const g = this.own(new this.T.PlaneGeometry(w, h));
    g.translate((0.5 - ax) * w, h / 2, 0);
    return g;
  }

  /** The stage's scenery: course far panorama, midground, grandstand, crowd, rail decor. */
  private buildBackdrop(art: ArtSet): void {
    const T = this.T;
    const L = this.L;
    const sc = this.stage.scenery;
    const plan = this.plan;
    // Far panorama: a long plane well beyond the fog (own haze baked in), square texels (the
    // same proportions as Trackside's far band), its foot on the horizon.
    const farImg = this.stageArt.get(sc.far) ?? art.images.get("far-hills");
    const farSrc = farImg ?? hillsStrip(this.look);
    const hTex = this.tex(farSrc, { repeat: true, mip: true });
    hTex.wrapT = T.ClampToEdgeWrapping;
    const hw = L + 5000;
    const mPerPx = 760 / farSrc.width;
    hTex.repeat.set(hw / 760, 1);
    const hh = farSrc.height * mPerPx;
    const hills = new T.Mesh(this.own(new T.PlaneGeometry(hw, hh)), this.own(new T.MeshBasicMaterial({ map: hTex, transparent: true, alphaTest: 0.5, fog: false, depthWrite: false, color: this.look.billboardTint })));
    hills.position.set(L / 2, hh / 2 - 3, -1000);
    hills.renderOrder = -7;
    this.scene.add(hills);

    // Midground billboards (instanced per art file), on the slope, with aerial fog.
    const dummy = new T.Object3D();
    const bySrc = new Map<string, Hd2dPlan["mid"]>();
    for (const m of plan.mid) {
      const list = bySrc.get(m.src) ?? [];
      list.push(m);
      bySrc.set(m.src, list);
    }
    for (const [src, list] of bySrc) {
      const img = this.stageArt.get(src);
      if (!img) continue;
      const first = list[0]!;
      const mesh = new T.InstancedMesh(this.uprightGeo(first.widthM, first.heightM), this.billboardMat(this.tex(img, { mip: true })), list.length);
      list.forEach((m, i) => {
        dummy.position.set(m.xM, m.y, m.z);
        dummy.scale.set(m.flip ? -1 : 1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }

    // The course's grandstand, centred ~30 m before the line, facing the run-in.
    const st = plan.stand;
    const standImg = this.stageArt.get(st.src);
    if (standImg) {
      const stand = new T.Mesh(this.uprightGeo(st.w, st.h), this.billboardMat(this.tex(standImg, { mip: true })));
      stand.position.set(st.x, st.y, st.z);
      this.scene.add(stand);
    }

    // Rail spectators (the cheering crowd strip) behind the far rail around the line.
    const c = plan.crowd[0];
    const cImg = c ? this.stageArt.get(c.src) : undefined;
    if (c && cImg) {
      const frames = stripFrames(cImg, 320);
      const len = c.x1 - c.x0;
      const tex = frames.map((f) => {
        const t = this.tex(f, { repeat: true });
        t.wrapT = T.ClampToEdgeWrapping;
        t.repeat.set(len / (320 / FOCAL_PX_PER_M), 1);
        return t;
      });
      const mesh = new T.Mesh(this.uprightGeo(len, c.h), this.billboardMat(tex[0]!));
      mesh.position.set((c.x0 + c.x1) / 2, c.y, c.z);
      this.scene.add(mesh);
      this.crowd = { mesh, tex };
    }

    // Rail decor (gorse, boards, flowers, walls) along the far rail, behind it.
    const d0 = plan.railDecor[0];
    const dImg = d0 ? this.stageArt.get(d0.src) : undefined;
    if (d0 && dImg) {
      const mesh = new T.InstancedMesh(this.uprightGeo(d0.w, d0.h), this.billboardMat(this.tex(dImg)), plan.railDecor.length);
      plan.railDecor.forEach((d, i) => {
        dummy.position.set(d.x, d.y, d.z);
        dummy.scale.set(d.flip ? -1 : 1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
  }

  /** White rails: the far rail solid; the near rail fades out in the low close shots. */
  private buildRails(): void {
    const T = this.T;
    const L = this.L;
    const x0 = -TRACK_PRE + 20;
    const x1 = L + TRACK_POST - 20;
    const spacing = 2.5;
    const per = Math.floor((x1 - x0) / spacing) + 1;
    const seg = 5;
    const nSeg = Math.ceil((x1 - x0) / seg);
    const dummy = new T.Object3D();
    for (const z of [0, -this.trackW]) {
      const near = z === 0;
      const mat = this.own(new T.MeshLambertMaterial({ color: 0xf4f4ef, transparent: near, opacity: 1 }));
      if (near) this.nearRail.push(mat);
      const postGeo = this.own(new T.BoxGeometry(0.09, 1.05, 0.09));
      postGeo.translate(0, 0.525, 0);
      const posts = new T.InstancedMesh(postGeo, mat, per);
      for (let i = 0; i < per; i++) {
        const x = x0 + i * spacing;
        dummy.position.set(x, this.el(x), z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        posts.setMatrixAt(i, dummy.matrix);
      }
      const bars = new T.InstancedMesh(this.own(new T.BoxGeometry(seg + 0.02, 0.1, 0.16)), mat, nSeg);
      for (let i = 0; i < nSeg; i++) {
        const x = x0 + (i + 0.5) * seg;
        dummy.position.set(x, this.el(x) + 1.06, z + (near ? 0.05 : -0.05));
        dummy.rotation.set(0, 0, Math.atan(this.slopeAt(x)));
        dummy.updateMatrix();
        bars.setMatrixAt(i, dummy.matrix);
      }
      for (const m of [posts, bars]) {
        m.castShadow = !near;
        m.frustumCulled = false;
        if (near) m.renderOrder = 5;
        this.scene.add(m);
      }
    }
  }

  /** The stage's landmarks, all on the far rail: numbered poles, 200/100 boards, judge's box, post. */
  private buildLandmarks(art: ArtSet): void {
    const T = this.T;
    const poleImg = this.stageArt.get("race/furlong-pole.png") ?? art.images.get("furlong-pole");
    const postImg = this.stageArt.get(this.stage.landmarks.winningPost.art) ?? art.images.get("finish-post");
    const tint = this.look.billboardTint;
    // Flat billboards cast no shadow-map shadows (an alpha-tested caster would also need its
    // own depth program the first time it entered the light's frustum: a mid-race hitch).
    const add = (src: HTMLCanvasElement | HTMLImageElement, x: number, y: number, z: number) => {
      const m = new T.Mesh(this.uprightGeo(src.width / FOCAL_PX_PER_M, src.height / FOCAL_PX_PER_M), this.billboardMat(this.tex(src), tint));
      m.position.set(x, y, z);
      this.scene.add(m);
    };
    for (const p of this.plan.props) {
      if (p.kind === "post") {
        if (postImg) add(postImg, p.x, p.y, p.z);
      } else if (p.kind === "judge") {
        add(judgeBoxCanvas(), p.x, p.y, p.z);
      } else {
        const h = (poleImg?.height ?? 142) / FOCAL_PX_PER_M;
        if (poleImg) add(poleImg, p.x, p.y, p.z);
        if (p.plate) add(plateCanvas(p.plate), p.x, p.y + h - 6 / FOCAL_PX_PER_M, p.z + 0.02);
      }
    }
  }

  private buildGate(): void {
    const T = this.T;
    const lw = this.stage.lanes.widthM;
    // Starting lanes: frame 0 if we have it (live: maybe not yet), else gate order.
    const maxLane = this.replay.frames.length
      ? Math.max(0, ...this.motion.stateAt(0).map((s) => Math.round(s.lane)))
      : Math.max(0, ...this.replay.horses.map((h) => h.gate - 1));
    const BACK = -3.4;
    const FRONT = 0.35;
    const panelCanvas = gatePanelTile();
    const panel = this.tex(panelCanvas, { repeat: true, mip: true });
    panel.repeat.set((FRONT - BACK) / (panelCanvas.width / FOCAL_PX_PER_M), 0.95 / (panelCanvas.height / FOCAL_PX_PER_M));
    const panelMat = this.own(new T.MeshLambertMaterial({ map: panel }));
    const frameMat = this.own(new T.MeshLambertMaterial({ color: 0xe9ecea }));
    const doorMat = this.own(new T.MeshLambertMaterial({ color: 0x2a8a5a }));
    const g = new T.Group();
    const zs: number[] = [];
    for (let l = -0.5; l <= maxLane + 0.5; l += 1) zs.push(this.laneZ(l));
    const panelGeo = this.own(new T.BoxGeometry(FRONT - BACK, 0.95, 0.12));
    const postGeo = this.own(new T.BoxGeometry(0.09, 2.5, 0.09));
    const barGeo = this.own(new T.BoxGeometry(FRONT - BACK, 0.08, 0.08));
    for (const z of zs) {
      const p = new T.Mesh(panelGeo, panelMat);
      p.position.set((BACK + FRONT) / 2, 0.95, z);
      const a = new T.Mesh(postGeo, frameMat);
      a.position.set(BACK, 1.25, z);
      const b = new T.Mesh(postGeo, frameMat);
      b.position.set(FRONT, 1.25, z);
      const top = new T.Mesh(barGeo, frameMat);
      top.position.set((BACK + FRONT) / 2, 2.45, z);
      for (const m of [p, a, b, top]) m.castShadow = true;
      g.add(p, a, b, top);
    }
    const span = Math.abs(zs[zs.length - 1]! - zs[0]!);
    for (const x of [BACK, FRONT]) {
      const beam = new T.Mesh(this.own(new T.BoxGeometry(0.12, 0.14, span)), frameMat);
      beam.position.set(x, 2.5, (zs[0]! + zs[zs.length - 1]!) / 2);
      beam.castShadow = true;
      g.add(beam);
    }
    // Front doors: two leaves per stall, hinged on the partitions.
    const leafW = lw / 2 - 0.04;
    const leafGeo = this.own(new T.BoxGeometry(0.05, 1.35, leafW));
    for (let i = 0; i < zs.length - 1; i++) {
      for (const side of [0, 1]) {
        const hinge = new T.Group();
        const hz = side === 0 ? zs[i]! : zs[i + 1]!;
        hinge.position.set(FRONT + 0.05, 0, hz);
        const leaf = new T.Mesh(leafGeo, doorMat);
        leaf.position.set(0, 1.0, side === 0 ? -leafW / 2 - 0.02 : leafW / 2 + 0.02);
        leaf.castShadow = true;
        hinge.add(leaf);
        hinge.userData.side = side;
        this.doors.push(hinge);
        g.add(hinge);
      }
    }
    this.scene.add(g);
  }

  private buildHorses(opts: HD2DSceneOptions): void {
    const T = this.T;
    const shadowTex = this.tex(blobShadow());
    const shadowGeo = this.own(new T.PlaneGeometry(1, 1));
    const strips = this.strips;
    if (strips) {
      this.lut = this.dataTex(buildLut(strips.palette, strips.keys, this.replay.horses.map((h) => h.appearance)), LUT_W, Math.max(1, this.replay.horses.length), T.RGBAFormat);
      for (const st of [strips.gallop, strips.idle, ...Object.values(strips.strips)]) {
        if (!st) continue;
        this.lodTex.set(
          st,
          st.lods.map((l) => ({ idx: this.dataTex(l.index, l.width, l.height, T.RedFormat), nrm: l.normal ? this.dataTex(l.normal, l.width, l.height, T.RGBAFormat) : null })),
        );
        this.mskTex.set(st, this.dataTex(st.mask, st.lods[0]!.width, st.lods[0]!.height, T.RGBAFormat));
      }
    }
    // Unit quad, bottom-left at the origin, v flipped (row 0 = the frame's top, as in Trackside).
    const quad = this.own(new T.PlaneGeometry(1, 1));
    quad.translate(0.5, 0.5, 0);
    const uv = quad.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const ts = this.stage.look.trackside;
    const rim = hexToRgb(ts.rim.color).map((c) => c / 255) as [number, number, number];
    const tint = hexToRgb(ts.spriteTint[0]).map((c) => c / 255) as [number, number, number];
    this.replay.horses.forEach((h, i) => {
      let rig: HorseRig | null = null;
      let plane: THREE.Mesh;
      let mat: THREE.Material;
      const group = new T.Group();
      if (strips && this.lut) {
        const g = strips.gallop;
        const l0 = g.lods[0]!;
        const lt = this.lodTex.get(g)![0]!;
        mat = this.own(
          new T.ShaderMaterial({
            vertexShader: QUAD_VERT,
            fragmentShader: HORSE_FRAG_3D,
            transparent: true,
            premultipliedAlpha: true,
            depthWrite: true,
            depthTest: true,
            side: T.DoubleSide,
            uniforms: {
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
              uLutRows: { value: Math.max(1, this.replay.horses.length) },
              uUseNrm: { value: lt.nrm ? 1 : 0 },
              uLight: { value: new T.Vector3(...ts.rim.dir) },
              uRimCol: { value: new T.Vector3(...rim) },
              uRimAmt: { value: ts.rim.amount },
              uTint: { value: new T.Vector4(tint[0], tint[1], tint[2], ts.spriteTint[1]) },
              uOpacity: { value: 1 },
              uSat: { value: 1 },
              uBright: { value: 1 },
            },
          }),
        );
        plane = new T.Mesh(quad, mat);
        plane.frustumCulled = false;
        this.scene.add(plane);
      } else {
        rig = opts.rigs.create(h.appearance, { gate: h.gate });
        // HD strips (>= 200 px frames) sit at the focal density; low-res strips are scaled
        // so the horse is still life-size (nose-to-tail ~93% of the frame).
        const WUPP = rig.width >= 200 ? 1 / FOCAL_PX_PER_M : HORSE_LEN_M / (rig.width * 0.93);
        const geo = this.own(new T.PlaneGeometry(rig.width * WUPP, rig.height * WUPP));
        geo.translate((rig.width / 2 - rig.anchor.x) * WUPP, (rig.anchor.y - rig.height / 2) * WUPP, 0);
        const normalMap = (rig as LitHorseRig).normalMap;
        mat = normalMap
          ? this.own(
              new T.MeshStandardMaterial({
                map: rig.texture,
                normalMap,
                normalScale: new T.Vector2(1, 1),
                alphaTest: 0.5,
                roughness: 0.75,
                metalness: 0,
                emissive: new T.Color(this.look.billboardTint),
                emissiveMap: rig.texture,
                emissiveIntensity: 0.35,
              }),
            )
          : this.own(new T.MeshBasicMaterial({ map: rig.texture, alphaTest: 0.5, color: this.look.billboardTint }));
        plane = new T.Mesh(geo, mat);
        group.add(plane);
        this.scene.add(group);
      }
      const shadow = new T.Mesh(shadowGeo, this.own(new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 1 })));
      shadow.rotation.x = -Math.PI / 2;
      shadow.renderOrder = 1;
      this.scene.add(shadow);
      this.runners.push({
        index: i,
        horseId: h.horseId,
        rig,
        group,
        plane,
        mat,
        shadow,
        x: 0,
        y: 0,
        z: 0,
        bodyX: 0,
        bodyZ: 0,
        speed: 0,
        st: { x: 0, lane: h.gate - 1, speed: 0, gait: "stand", phase: 0, anim: "break", frame: 0 },
        lastPhase: Number.NaN,
        strip: null,
        lod: 0,
      });
    });
  }

  /** Ground fx sprites (the same recoloured strips as Trackside), a small recycled pool. */
  private buildGroundFx(): void {
    const T = this.T;
    for (const id of this.stage.fx.emit) {
      const img = this.stageArt.get(`race/${id}.png`);
      if (!img) continue;
      const c = fxStripCanvas(img, this.fxPal, id, this.stage.fx.key);
      this.fxStrips.push({ tex: this.tex(c), frames: 8, fw: 48, fh: 32, fps: FX_FPS[id] ?? 12, anchor: FX_ANCHOR[id] ?? [0.8, 0.8] });
    }
    if (!this.fxStrips.length) return;
    const quad = this.own(new T.PlaneGeometry(1, 1));
    quad.translate(0.5, 0.5, 0);
    const n = this.quality === "high" ? FX_MAX : FX_MAX / 2;
    for (let i = 0; i < n; i++) {
      // One material per strip per slot (each with its own frame offset; the image is shared).
      const mats = this.fxStrips.map((st) => {
        const map = this.own(st.tex.clone());
        map.repeat.set(1 / st.frames, 1);
        return this.own(new T.MeshBasicMaterial({ map, alphaTest: 0.5, color: this.look.billboardTint, side: T.DoubleSide }));
      });
      const mesh = new T.Mesh(quad, mats[0]!);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.fx.push({ mesh, mats, strip: 0, x: 0, y: 0, z: 0, age: -1, flip: false });
    }
  }

  private buildMarker(): void {
    if (this.highlight < 0) return;
    const T = this.T;
    // Pixel chevron.
    const c = document.createElement("canvas");
    c.width = 11;
    c.height = 9;
    const ctx = c.getContext("2d")!;
    const rows = ["11111111111", "12222222221", "01222222210", "00122222100", "00012221000", "00001210000", "00000100000"];
    rows.forEach((row, y) =>
      [...row].forEach((v, x) => {
        if (v === "0") return;
        ctx.fillStyle = v === "1" ? "#3a2604" : y < 2 ? "#ffe08a" : "#d9a441";
        ctx.fillRect(x, y + 1, 1, 1);
      }),
    );
    this.marker = new T.Sprite(this.own(new T.SpriteMaterial({ map: this.tex(c), depthTest: false, transparent: true, fog: false })));
    this.marker.scale.set(0.62, 0.5, 1);
    this.marker.renderOrder = 20;
    this.scene.add(this.marker);
    // Ground ring.
    const rc = document.createElement("canvas");
    rc.width = 40;
    rc.height = 14;
    const rctx = rc.getContext("2d")!;
    for (let y = 0; y < 14; y++) {
      for (let x = 0; x < 40; x++) {
        const d = Math.hypot((x - 19.5) / 20, (y - 6.5) / 7);
        if (d > 0.78 && d < 1) {
          rctx.fillStyle = "#f2c230";
          rctx.fillRect(x, y, 1, 1);
        }
      }
    }
    this.ring = new T.Mesh(this.own(new T.PlaneGeometry(3.2, 1.2)), this.own(new T.MeshBasicMaterial({ map: this.tex(rc), transparent: true, depthWrite: false })));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 2;
    this.scene.add(this.ring);
  }

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------

  setQuality(q: RenderQuality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.shadowMap.enabled = q === "high";
    this.sunLight.castShadow = q === "high";
    if (q === "low" && this.post) {
      this.post.dispose();
      this.disposables = this.disposables.filter((d) => d !== this.post);
      this.post = null;
    }
    this.resize(this.W, this.H);
  }

  resize(W: number, H: number): void {
    // Phones: the director keeps to close tracking shots (no tiny-horse aerials).
    this.director.compact = W < 640;
    this.ownDirector.compact = W < 640;
    this.W = Math.max(1, W);
    this.H = Math.max(1, H);
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    let ratio: number;
    // HD pixel standard: never below ~540 lines internally; desktop renders at device
    // resolution (all sprites/tiles sample with nearest filtering).
    if (this.quality === "low") ratio = Math.min(Math.max(dpr, 1), 2);
    else if (this.pixelated) ratio = Math.max(540 / this.H, Math.min(1, dpr));
    else ratio = Math.min(dpr, 2, Math.sqrt((2560 * 1440) / (this.W * this.H)));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.W, this.H, false);
    this.canvas.style.imageRendering = ratio < dpr * 0.75 ? "pixelated" : "auto";
    this.camera.aspect = this.W / this.H;
    this.camera.updateProjectionMatrix();
    const buf = this.renderer.getDrawingBufferSize(this.buf);
    this.post?.setSize(buf.x, buf.y);
  }

  get lastSamples(): readonly HorseSample[] {
    return this.samples;
  }

  get cameraInfo(): { x: number; zoom: number; shot: string } {
    return { x: this.camera.position.x, zoom: 34 / this.camera.fov, shot: this.shotSubject ? `${this.shotType}:${this.shotSubject}` : this.shotType };
  }

  /** What this scene built from the stage (guard test: must equal Trackside's). */
  get inventory(): StageInventory {
    return hd2dInventory(this.stage, this.plan);
  }

  /** The strip for an animation (fallbacks when a strip is missing). */
  private stripFor(anim: AnimId): StripSet {
    const a = this.strips!;
    if (anim === "idle") return a.idle ?? a.strips.break ?? a.gallop;
    if (anim === "gallop") return a.gallop;
    return a.strips[anim] ?? (anim === "lunge" ? a.strips.drive : undefined) ?? (anim === "break" ? a.idle ?? a.gallop : a.gallop);
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

  /**
   * Screen-square billboard of a strip frame with its anchor on the world point (x, y, z):
   * exact LOD, scale pulled towards whole screen pixels per texel, anchor snapped to the
   * pixel grid. Returns the scale used (buffer px per LOD texel).
   */
  private placeSprite(mesh: THREE.Object3D, wx: number, wy: number, wz: number, fw: number, fh: number, ax: number, ay: number, texelM: number, snapScale: boolean): number {
    const cam = this.camera;
    const buf = this.renderer.getDrawingBufferSize(this.buf);
    const right = this.v3.setFromMatrixColumn(cam.matrixWorld, 0);
    const up = this.v4.setFromMatrixColumn(cam.matrixWorld, 1);
    const p = this.v1.set(wx, wy, wz);
    const depth = -this.v5.copy(p).applyMatrix4(cam.matrixWorldInverse).z;
    const wpp = (2 * Math.max(0.1, depth) * Math.tan((cam.fov * Math.PI) / 360)) / buf.y; // metres per buffer px
    let k = texelM / wpp; // buffer px per texel
    if (snapScale) {
      const n = Math.max(1, Math.round(k));
      const w = Math.max(0, 1 - Math.abs(k - n) / (0.15 * n));
      k = k + (n - k) * w;
    }
    const sw = fw * k * wpp;
    const sh = fh * k * wpp;
    // Anchor -> whole pixels.
    const ndc = this.v5.copy(p).project(cam);
    const px = ((ndc.x + 1) / 2) * buf.x;
    const py = ((ndc.y + 1) / 2) * buf.y;
    const dx = (Math.round(px) - px) * wpp;
    const dy = (Math.round(py) - py) * wpp;
    mesh.quaternion.copy(cam.quaternion);
    mesh.scale.set(sw, sh, 1);
    mesh.position.copy(p).addScaledVector(right, dx - ax * sw).addScaledVector(up, dy - (1 - ay) * sh);
    return k;
  }

  render(f: SceneFrame): void {
    const raceT = f.time;
    const tS = Math.max(0, raceT);
    let simDt = Number.isNaN(this.lastTime) ? 0 : raceT - this.lastTime;
    const seek = Math.abs(simDt) > 0.6 || simDt < -1e-9;
    this.director = f.director ?? this.ownDirector;
    // Phones: the director keeps to close tracking shots (no tiny-horse aerials).
    this.director.compact = this.W < 640;
    if (seek || Number.isNaN(this.lastTime)) {
      this.dirEventScan = 0;
      const tickNow = Math.max(0, raceT) * this.replay.tickHz;
      while (this.dirEventScan < this.replay.events.length && this.replay.events[this.dirEventScan]!.tick < tickNow) this.dirEventScan++;
    }
    if (seek) {
      simDt = 0;
      for (const p of this.fx) p.age = -1;
    }
    if (f.frozen) simDt = 0;
    this.lastTime = raceT;
    this.animTime += simDt;
    const realDt = Math.min(0.1, Math.max(0, f.realDt));
    const L = this.L;

    // --- Runners: the shared motion (replay x up to the line, the run-out after it) -------
    this.states = this.motion.stateAt(raceT, this.states);
    this.samples = this.motion.samples;
    let lead: Runner | null = null;
    let last: Runner | null = null;
    // The build-up before the off: lanes come from the shared motion, and going down to post /
    // the stalls are two places on the course (a cut between them, as Trackside cuts).
    const pre = this.motion.preOffAt(raceT);
    const preKind = pre ? preOffStep(raceT).kind : null;
    const preCut = !pre ? 0 : preKind === "parade" || preKind === "post" ? 1 : 2;
    const cut = preCut !== 0 && this.preCut !== 0 && preCut !== this.preCut;
    this.preCut = preCut;
    const haveFrames = this.replay.frames.length > 0 || pre;
    for (const r of this.runners) {
      const st = this.states[r.index]!;
      r.st = st;
      const ft = this.motion.finishInfo(r.index).finishT;
      if (!this.replay.result && ft !== null) this.winnerTime = Math.min(this.winnerTime, ft);
      r.x = st.x;
      r.y = this.el(st.x);
      r.speed = st.speed;
      r.z = this.laneZ(haveFrames ? st.lane : this.replay.horses[r.index]!.gate - 1);
      if (!lead || r.x > lead.x) lead = r;
      if (!last || r.x < last.x) last = r;
    }
    if (!lead || !last) return;
    const winnerIdx = this.motion.winner();
    const winner = winnerIdx >= 0 ? this.runners[winnerIdx]! : null;

    // --- Camera direction -------------------------------------------------------
    // Side-on broadcast camera. The (shared) director only changes what it frames and
    // around whom; the camera always eases there with critically damped springs.
    const mine = this.highlight >= 0 ? this.runners[this.highlight]! : null;
    let mode = f.camera;
    if (mode === "mine" && !mine) mode = "director";
    const byX = this.byX;
    if (byX.length !== this.runners.length) byX.splice(0, byX.length, ...this.runners);
    byX.sort((a, b) => b.x - a.x);
    const evs = this.replay.events;
    const newEvents = this.dirEvents;
    newEvents.length = 0;
    for (; this.dirEventScan < evs.length && evs[this.dirEventScan]!.tick / this.replay.tickHz <= tS; this.dirEventScan++) newEvents.push(evs[this.dirEventScan]!);
    const dirInput = this.dirInput;
    dirInput.t = raceT;
    if (dirInput.runners.length !== this.runners.length) dirInput.runners = this.runners.map((r) => ({ id: r.horseId, x: r.x }));
    for (let i = 0; i < this.runners.length; i++) dirInput.runners[i]!.x = this.runners[i]!.x;
    dirInput.trackLengthM = L;
    dirInput.winnerTime = this.winnerTime;
    dirInput.photoFinish = this.photoFinish;
    dirInput.newEvents = newEvents;
    dirInput.highlightId = mine?.horseId ?? null;
    dirInput.winnerId = winner?.horseId ?? null;
    dirInput.pipForMine = !!this.pipCam && this.quality === "high" && pipRect(this.W, this.H) !== null;
    dirInput.preOff = preCut === 1 ? "post" : preCut === 2 ? "loading" : null;
    let shotType: ShotType;
    let subjectId: string | null;
    if (mode === "director") {
      const r = this.director.update(dirInput);
      shotType = r.shot.type;
      subjectId = r.shot.subject;
    } else {
      const photo = this.photoFinish && tS > this.winnerTime - 1.6 && tS < this.winnerTime + 0.9;
      const after = tS > this.winnerTime + 0.9;
      shotType = preCut === 1 ? "topost" : raceT < 1 ? "gate" : photo ? "judge" : mode === "wide" ? "establish" : after && mode !== "mine" ? "post" : "close";
      subjectId = mode === "mine" ? mine!.horseId : shotType === "post" ? (winner?.horseId ?? null) : null;
    }
    this.shotType = shotType;
    this.shotSubject = subjectId;
    const subject = (subjectId ? this.runners.find((r) => r.horseId === subjectId) : null) ?? lead;
    const pos = this.v1;
    const at = this.v2;
    const sc = this.shotCamera(shotType, subject, byX, raceT, pos, at, mode === "director" ? this.director.mustFrame : NO_IDS);
    if (this.firstFrame || seek || cut) {
      this.camPos.snap(pos);
      this.camLook.snap(at);
      this.fov.snap(sc.fov);
      this.firstFrame = false;
    } else {
      const ff = f.frozen ? 0 : sc.vel * (simDt > 0 && realDt > 0 ? simDt / realDt : 0);
      this.camPos.step(pos, realDt, ff);
      this.camLook.step(at, realDt, ff);
      this.fov.step(sc.fov, realDt);
    }
    const cam = this.camera;
    const px = cam.position.x;
    const py = cam.position.y;
    const pz = cam.position.z;
    this.camPos.into(cam.position);
    cam.lookAt(this.camLook.into(this.v2));
    const vfov = this.vfovFor(this.fov.x);
    if (Math.abs(cam.fov - vfov) > 1e-3) {
      cam.fov = vfov;
      cam.updateProjectionMatrix();
    }
    // Whole pixels: move the camera in its own plane so the focal plane lands on the pixel
    // grid (no sub-pixel shimmer on the rails, poles and turf while tracking).
    {
      cam.updateMatrixWorld();
      const buf = this.renderer.getDrawingBufferSize(this.buf);
      const fd = Math.max(1, cam.position.distanceTo(this.v2));
      const wpp = (2 * fd * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, buf.y);
      const right = this.v3.setFromMatrixColumn(cam.matrixWorld, 0);
      const up = this.v4.setFromMatrixColumn(cam.matrixWorld, 1);
      const pr = cam.position.dot(right) / wpp;
      const pu = cam.position.dot(up) / wpp;
      cam.position.addScaledVector(right, (Math.round(pr) - pr) * wpp).addScaledVector(up, (Math.round(pu) - pu) * wpp);
      cam.updateMatrixWorld();
    }
    if (!this.firstFrame && !seek && simDt >= 0) {
      const step = Math.hypot(cam.position.x - px - subject.speed * simDt, cam.position.y - py, cam.position.z - pz);
      if (raceT > 1) this.maxCamStep = Math.max(this.maxCamStep, step);
    }
    this.focusDist = cam.position.distanceTo(this.v1.set((sc.x0 + sc.x1) / 2, this.el((sc.x0 + sc.x1) / 2) + 1.0, (sc.z0 + sc.z1) / 2));
    // The whole field depth plus the far rail and its landmarks stay in the sharp band.
    this.focusRange = Math.max(8, this.trackW * 0.7 + (sc.x1 - sc.x0) * 0.25 + 6);
    const focus = subject;

    // The near rail would cut across the horses in the low shots: fade it there.
    const lowShot = shotType !== "establish" && shotType !== "wide" && shotType !== "gate" && shotType !== "topost";
    const aim = lowShot ? 0 : 1;
    this.nearRailA += (aim - this.nearRailA) * (1 - Math.exp(-(realDt || 0.016) * 4));
    for (const m of this.nearRail) {
      (m as THREE.MeshLambertMaterial).opacity = this.nearRailA;
      m.visible = this.nearRailA > 0.02;
      (m as THREE.MeshLambertMaterial).depthWrite = this.nearRailA > 0.98;
    }

    // Picture-in-picture: my horse, when the director isn't showing it (desktop/high only).
    this.pipActive = false;
    if (this.pipCam && mine && mode === "director" && raceT > 1 && tS < this.winnerTime + 0.9 && this.quality === "high" && !this.director.shows(mine.horseId, dirInput)) {
      const pc = this.shotCamera("close", mine, byX, raceT, this.pv1, this.pv2);
      if (!this.pipWasActive) {
        this.pipPos.snap(this.pv1);
        this.pipLook.snap(this.pv2);
      } else {
        const ff = mine.speed * (simDt > 0 && realDt > 0 ? simDt / realDt : 0);
        this.pipPos.step(this.pv1, realDt, ff);
        this.pipLook.step(this.pv2, realDt, ff);
      }
      this.pipPos.into(this.pipCam.position);
      this.pipCam.lookAt(this.pipLook.into(this.pv2));
      if (Math.abs(this.pipCam.fov - pc.fov) > 1e-3) {
        this.pipCam.fov = pc.fov;
        this.pipCam.updateProjectionMatrix();
      }
      this.pipActive = true;
    }
    this.pipWasActive = this.pipActive;

    // --- World animation ---------------------------------------------------------
    if (!f.frozen) this.skyDrift += realDt * SKY_DRIFT;
    if (this.sun) this.sun.position.copy(cam.position).addScaledVector(this.sunDir, 1500);
    this.sunLight.target.position.set(focus.x, this.el(focus.x), -this.trackW / 2);
    this.sunLight.position.copy(this.sunLight.target.position).addScaledVector(this.keyDir, 80);
    if (this.crowd) {
      const m = this.crowd.mesh.material as THREE.MeshBasicMaterial;
      const next = this.crowd.tex[crowdFrame(crowdCheering(L - lead.x, tS, this.winnerTime), this.animTime, this.crowd.tex.length)]!;
      if (m.map !== next) m.map = next;
    }
    const open = Math.min(1, Math.max(0, raceT / 0.3));
    for (const d of this.doors) d.rotation.y = (d.userData.side === 0 ? 1 : -1) * open * 1.45;

    // --- Horses ------------------------------------------------------------------
    cam.updateMatrixWorld();
    for (const r of this.runners) {
      const s = r.st;
      if (r.rig) {
        // Fallback rig sprites: upright, facing the camera.
        r.rig.update(this.renderer, { phase: s.phase, speedMs: r.speed, drive: s.anim === "drive" || s.anim === "lunge" ? 1 : 0, lightDir: this.keyDir, time: this.animTime });
        r.group.position.set(r.x, r.y, r.z);
        r.group.quaternion.copy(cam.quaternion);
      } else {
        const st = this.stripFor(s.anim);
        const texelM = 1 / st.pxPerM;
        // Choose the LOD from the on-screen size of a source texel at this depth.
        const buf = this.renderer.getDrawingBufferSize(this.buf);
        const depth = -this.v1.set(r.x, r.y, r.z).applyMatrix4(cam.matrixWorldInverse).z;
        const q = texelM / ((2 * Math.max(0.1, depth) * Math.tan((cam.fov * Math.PI) / 360)) / buf.y);
        if (st !== r.strip) r.lod = 0;
        r.strip = st;
        r.lod = this.chooseLod(q, r.lod);
        const lod = st.lods[r.lod - 1]!;
        const tex = this.lodTex.get(st)![r.lod - 1]!;
        const frames = lod.frames;
        const frame = Math.max(0, Math.min(frames - 1, s.anim === "gallop" || s.anim === "drive" ? Math.floor((s.phase - Math.floor(s.phase)) * frames) % frames : s.frame % frames));
        const [ox, oy] = frameOrigin(lod, frame);
        const u = (r.mat as THREE.ShaderMaterial).uniforms;
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
        this.placeSprite(r.plane, r.x, r.y, r.z, lod.fw, lod.fh, lod.anchor.x / lod.fw, lod.anchor.y / lod.fh, texelM * r.lod, true);
      }
      r.bodyX = r.x - 1.25;
      r.bodyZ = r.z;
      r.shadow.position.set(r.bodyX - this.keyDir.x * 0.4, r.y + 0.014, r.bodyZ - 0.15);
      r.shadow.rotation.z = 0;
      r.shadow.scale.set(2.7, 0.95, 1);
      // one ground-fx burst per stride, from the leading hind hoof
      if (simDt > 0 && r.speed > 5 && !Number.isNaN(r.lastPhase) && Math.floor(s.phase) > Math.floor(r.lastPhase)) this.emitFx(r, r.x - 1.9);
      r.lastPhase = s.phase;
    }

    // --- Ground fx: world-anchored bursts, screen-square, whole pixels ---------------
    const sdt = f.frozen ? 0 : simDt;
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
      p.mesh.visible = true;
      const map = p.mats[p.strip]!.map!;
      map.repeat.set((p.flip ? -1 : 1) / st.frames, 1);
      map.offset.set((p.flip ? frame + 1 : frame) / st.frames, 0);
      const ax = p.flip ? 1 - st.anchor[0] : st.anchor[0];
      this.placeSprite(p.mesh, p.x, p.y, p.z, st.fw, st.fh, ax, st.anchor[1], 1 / FOCAL_PX_PER_M, true);
    }
    if (this.rain) this.rain.update(f.frozen ? 0 : realDt, cam.position.x, cam.position.z - 12);

    if (this.marker && this.ring && this.highlight >= 0) {
      const r = this.runners[this.highlight]!;
      this.marker.position.set(r.bodyX + 0.3, r.y + 2.05 + Math.sin(performance.now() / 250) * 0.06, r.bodyZ);
      this.ring.position.set(r.bodyX, r.y + 0.016, r.bodyZ);
    }

    // --- Draw ----------------------------------------------------------------------
    const g = this.look.grade;
    if (this.post) {
      this.post.render(this.scene, cam, {
        focusDist: this.focusDist,
        focusRange: this.focusRange,
        dofAmount: this.W < 640 ? 0.22 : 0.45,
        tiltShift: 0,
        bloom: this.look.bloom,
        tint: g.tint,
        saturation: g.saturation,
        contrast: g.contrast,
        vignette: 0.42,
        flash: Math.min(1, f.flash) * 0.85,
      });
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, cam);
    }
    // Picture-in-picture: a second, direct render of the same scene into a scissored inset.
    const rect = this.pipActive && this.pipCam ? pipRect(this.W, this.H) : null;
    this.pipShown = !!rect;
    if (rect && this.pipCam) {
      const r = this.renderer;
      const x = this.W - rect.right - rect.w;
      const y = rect.bottom;
      if (Math.abs(this.pipCam.aspect - rect.w / rect.h) > 1e-3) {
        this.pipCam.aspect = rect.w / rect.h;
        this.pipCam.updateProjectionMatrix();
      }
      r.setRenderTarget(null);
      r.setScissorTest(true);
      r.setScissor(x, y, rect.w, rect.h);
      r.setViewport(x, y, rect.w, rect.h);
      const auto = r.autoClear;
      r.autoClear = false;
      r.clear(true, true, false);
      const t0 = performance.now();
      const p0 = r.info.programs?.length ?? 0;
      const x0 = r.info.memory.textures;
      r.render(this.scene, this.pipCam);
      const ms = performance.now() - t0;
      const ps = this.pipStats;
      if (ps.draws === 0) {
        ps.firstMs = ms;
        ps.progNew = (r.info.programs?.length ?? 0) - p0;
        ps.texNew = r.info.memory.textures - x0;
      }
      else ps.maxLaterMs = Math.max(ps.maxLaterMs, ms);
      ps.draws++;
      r.autoClear = auto;
      r.setScissorTest(false);
      r.setViewport(0, 0, this.W, this.H);
    }
  }

  /**
   * PiP draw timings (CPU ms) and what the first draw had to create (dev measurement of the
   * first-appearance stall; read through the viewer's `rvdebug` hook).
   */
  pipStats = { draws: 0, firstMs: 0, maxLaterMs: 0, progNew: 0, texNew: 0 };

  private emitFx(r: Runner, wx: number): void {
    if (!this.fx.length) return;
    const slot = this.fx.find((p) => p.age < 0);
    if (!slot) return;
    const n = this.fxCount++;
    const strip = this.fxStrips.length > 1 && n % 4 === 3 ? 1 : 0;
    slot.strip = strip;
    slot.mesh.material = slot.mats[strip]!;
    slot.x = wx + (((n * 37) % 7) - 3) * 0.03;
    slot.z = r.z + (((n * 13) % 5) - 2) * 0.05 + 0.2;
    slot.y = this.el(slot.x);
    slot.age = 0;
    slot.flip = n % 5 === 2;
  }

  /**
   * Pre-warm the GPU so nothing compiles or uploads mid-race (the cause of hitches on
   * camera moves): upload every texture, compile every program, and draw one frame of
   * the full pipeline (shadows, post passes, PiP) from a camera that sees the whole course.
   */
  warmup(): void {
    const r = this.renderer;
    const tex: THREE.Texture[] = [];
    for (const d of this.disposables) if ((d as THREE.Texture).isTexture) tex.push(d as THREE.Texture);
    for (const run of this.runners) {
      if (!run.rig) continue;
      tex.push(run.rig.texture);
      const nm = (run.rig as LitHorseRig).normalMap;
      if (nm) tex.push(nm);
    }
    for (const t of tex) {
      try {
        r.initTexture(t);
      } catch {
        /* texture without an image yet */
      }
    }
    const cam = this.camera;
    const saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
    for (const p of this.fx) p.mesh.visible = true;
    r.compile(this.scene, cam);
    // One full frame from high over the middle of the course: every object in view once.
    cam.position.set(this.L / 2, 260, 520);
    cam.fov = 60;
    cam.updateProjectionMatrix();
    cam.lookAt(this.L / 2, 0, -this.trackW / 2);
    const g = this.look.grade;
    if (this.post) {
      this.post.render(this.scene, cam, { focusDist: 50, focusRange: 10, dofAmount: 0.45, tiltShift: 0, bloom: this.look.bloom, tint: g.tint, saturation: g.saturation, contrast: g.contrast, vignette: 0.42, flash: 0.5 });
    } else {
      r.setRenderTarget(null);
      r.render(this.scene, cam);
    }
    if (this.pipCam) {
      // A real (tiny) picture-in-picture draw: it renders straight to the screen, so its
      // program variants and shadow pass must exist before the first time it shows mid-race.
      // It must see EVERY object (the main warm camera's whole-course frustum, not the inset's
      // narrow 22-degree lens): each object drawn into the screen framebuffer for the first time
      // costs a pipeline build for that target, which was the 0.3-0.8 s stall when the inset
      // first appeared mid-race (no new programs or textures were involved).
      this.pipCam.position.copy(cam.position);
      this.pipCam.quaternion.copy(cam.quaternion);
      const pipFov = this.pipCam.fov;
      this.pipCam.fov = cam.fov;
      this.pipCam.aspect = cam.aspect;
      this.pipCam.updateProjectionMatrix();
      const rect = pipRect(this.W, this.H) ?? { right: 12, bottom: 100, w: 320, h: 180 };
      const x = Math.max(0, this.W - rect.right - rect.w);
      r.setRenderTarget(null);
      r.setScissorTest(true);
      r.setScissor(x, rect.bottom, rect.w, rect.h);
      r.setViewport(x, rect.bottom, rect.w, rect.h);
      const auto = r.autoClear;
      r.autoClear = false;
      r.clear(true, true, false);
      r.render(this.scene, this.pipCam);
      r.autoClear = auto;
      r.setScissorTest(false);
      r.setViewport(0, 0, this.W, this.H);
      this.pipCam.fov = pipFov;
      this.pipCam.aspect = rect.w / rect.h;
      this.pipCam.updateProjectionMatrix();
    }
    for (const p of this.fx) p.mesh.visible = false;
    // Draw one horse quad with every strip level of detail bound (and every fx material), so
    // the first close-up never pays for a first-use texture or sampler setup mid-race.
    const run0 = this.runners.find((x) => !x.rig);
    if (run0) {
      const T = this.T;
      const tiny = new T.WebGLRenderTarget(4, 4);
      const sc = new T.Scene();
      const probe = new T.Mesh(run0.plane.geometry, run0.mat);
      probe.frustumCulled = false;
      sc.add(probe);
      for (const p of this.fx) for (const m of p.mats) sc.add(new T.Mesh(p.mesh.geometry, m));
      const cam2 = new T.OrthographicCamera(-1, 1, 1, -1, -10, 10);
      const u = (run0.mat as THREE.ShaderMaterial).uniforms;
      // Into an offscreen target (the post path) and onto the screen (low quality, PiP).
      for (const target of [tiny, null]) {
        r.setRenderTarget(target);
        if (!target) {
          r.setScissorTest(true);
          r.setScissor(0, 0, 2, 2);
          r.setViewport(0, 0, 2, 2);
        }
        for (const [st, lts] of this.lodTex) {
          for (const lt of lts) {
            u.uIdx!.value = lt.idx;
            u.uNrm!.value = lt.nrm ?? lt.idx;
            u.uMsk!.value = this.mskTex.get(st);
            r.render(sc, cam2);
          }
        }
      }
      r.setScissorTest(false);
      r.setViewport(0, 0, this.W, this.H);
      r.setRenderTarget(null);
      tiny.dispose();
    }
    cam.position.copy(saved.pos);
    cam.quaternion.copy(saved.quat);
    cam.fov = saved.fov;
    cam.updateProjectionMatrix();
  }

  /** Largest per-frame camera jump (m, net of subject motion) since load: continuity metric. */
  maxCamStep = 0;

  /** True when the PiP inset was drawn this frame (the HUD frames it). */
  pipShown = false;

  private applyResult(): void {
    const res = this.replay.result ?? null;
    this.winnerTime = res ? res.winningTimeUs / 1e6 : Number.POSITIVE_INFINITY;
    this.photoFinish = res ? res.photoFinish : false;
  }

  /** The build-up before the off on (a plan) or off (null: standing in the stalls). */
  setPreOff(plan: PreOffPlan | null): void {
    this.motion.setPreOff(plan);
  }

  /** The race is over: switch to the official replay (same horses, same scene). */
  setFinal(final: RaceReplay): void {
    this.replay = final;
    this.motion.setSource(final);
    this.applyResult();
    this.lastTime = Number.NaN;
  }

  /**
   * Camera for one shot type around `sub`: writes the target position/aim into `pos` /
   * `at` and returns the lens, tracking velocity and the framed box.
   */
  private shotCamera(type: ShotType, sub: Runner, byX: Runner[], raceT: number, pos: THREE.Vector3, at: THREE.Vector3, must: readonly string[] = NO_IDS) {
    const L = this.L;
    let group: Runner[] = [sub];
    let elev = 8;
    let yaw = -4;
    let fillX = 0.9;
    let fillY = 0.62;
    let fov = 22;
    let vel = sub.speed;
    let leadPad = 1;
    let maxSpan = 10;
    let composeShift = 0.12;
    // The subject plus its nearest rivals within `reach` (no per-frame allocation).
    const buf = this.nearBuf;
    const near = (reach: number, max: number) => {
      buf.length = 0;
      buf.push(sub);
      while (buf.length < max) {
        let best: Runner | null = null;
        let bd = reach;
        for (const r of byX) {
          if (buf.includes(r)) continue;
          const d = Math.abs(r.x - sub.x);
          if (d <= bd) {
            bd = d;
            best = r;
          }
        }
        if (!best) break;
        buf.push(best);
      }
      return buf;
    };
    switch (type) {
      case "gate": {
        // Side-on at the stalls, a touch higher before the off, settling at the off.
        const k = Math.min(1, Math.max(0, (raceT + 1.6) / 2.6));
        group = byX;
        elev = 14 - 4 * k;
        yaw = -4;
        fillX = 0.8;
        fillY = 0.62;
        fov = 30;
        vel = 0;
        maxSpan = 1e9;
        composeShift = 0.16;
        break;
      }
      case "topost":
        // Going down to post: the whole field cantering past the stands, the stand above it.
        group = byX;
        elev = 9;
        yaw = -3;
        fillX = 0.86;
        fillY = 0.42;
        fov = 32;
        vel = POST_CANTER;
        maxSpan = 1e9;
        leadPad = 2;
        composeShift = 0.3;
        break;
      case "close":
        // Side-on tracking, 2-4 horses filling the frame.
        group = near(SHOT_REACH.close, 4);
        elev = 7;
        yaw = -4;
        fillX = 0.9;
        fillY = 0.62;
        fov = 22;
        maxSpan = 9;
        break;
      case "pack":
        group = near(SHOT_REACH.pack, 7);
        elev = 10;
        yaw = -6;
        fillX = 0.9;
        fillY = 0.58;
        fov = 26;
        maxSpan = 24;
        composeShift = 0.14;
        break;
      case "wide":
      case "establish":
        // The whole field at ~11 degrees, the course's scenery above it (as Trackside frames it).
        // A wider lens aimed above the field: the field sits in the lower half, the course's
        // midground, stand and sky above it.
        group = byX;
        elev = 11;
        yaw = -3;
        fillX = 0.92;
        fillY = 0.3;
        fov = 36;
        leadPad = 3;
        maxSpan = 42;
        composeShift = 0.42;
        vel = (byX[0]!.speed + byX[byX.length - 1]!.speed) / 2;
        break;
      case "judge":
        group = byX.filter((r) => Math.abs(r.x - L) < 5);
        if (group.length < 2) group = byX.slice(0, 2);
        elev = 12;
        yaw = 0;
        fillX = 0.8;
        fillY = 0.62;
        fov = 28;
        vel = 0;
        leadPad = 0;
        maxSpan = 1e9;
        composeShift = 0.06;
        break;
      case "post":
        // Pull-up follow: tracks the horse being celebrated as it eases down, framed left of
        // centre with room ahead (as Trackside's follow places it; the finale's cards sit right).
        group = near(8, 3);
        elev = 9;
        yaw = -3;
        fov = 24;
        vel = sub.speed;
        maxSpan = 12;
        leadPad = 9;
        break;
      case "replay":
        // The slow-motion finish replay: low and side-on, the winner and its nearest rivals.
        group = near(SHOT_REACH.replay, 4);
        elev = 6;
        yaw = -4;
        fillX = 0.86;
        fillY = 0.6;
        fov = 22;
        maxSpan = 12;
        leadPad = 1.5;
        break;
    }
    // The director's framing rules (final furlong: everything within two lengths of the
    // leader; your horse when the shot was chosen to show it) widen the group as needed.
    let mustSpan = 0;
    if (must.length) {
      if (group !== buf) {
        buf.length = 0;
        for (const r of group) buf.push(r);
        group = buf;
      }
      let m0 = Infinity;
      let m1 = -Infinity;
      for (const r of byX) {
        if (!must.includes(r.horseId)) continue;
        if (!group.includes(r)) group.push(r);
        m0 = Math.min(m0, r.x - 2.7);
        m1 = Math.max(m1, r.x + 0.3);
      }
      if (m1 > m0) mustSpan = m1 - m0 + 1;
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const r of group) {
      x0 = Math.min(x0, r.x - 2.7);
      x1 = Math.max(x1, r.x + 0.3);
      z0 = Math.min(z0, r.z);
      z1 = Math.max(z1, r.z);
    }
    if (type === "gate") {
      x0 = Math.min(x0, -3.6);
      x1 = Math.max(x1, 0.6);
      z0 = Math.min(z0, this.laneZ(-0.5));
      z1 = Math.max(z1, this.laneZ(-0.5));
    }
    if (type === "establish" || type === "wide") {
      // Take in the far rail and its landmarks too.
      z0 = Math.min(z0, -this.trackW);
    }
    // Narrow screens: less track, a little more elevation to separate the lanes.
    const narrowK = Math.min(1, Math.max(0.5, this.camera.aspect / (16 / 9)));
    maxSpan *= Math.pow(narrowK, type === "close" ? 1.2 : 1.5);
    if (type !== "judge" && type !== "gate") elev += (1 - narrowK) * (type === "close" ? 5 : 8);
    // Portrait phones: a width-limited lens leaves a tall frame; the tracking shots sit the
    // runners lower (above the controls) so the frame is not a band of empty grass under them,
    // with the course's scenery behind the HUD above.
    if (type === "close" || type === "pack" || type === "post" || type === "replay") composeShift += (1 - narrowK) * 0.22;
    fillY *= 0.85 + 0.15 * narrowK;
    maxSpan = Math.max(maxSpan, mustSpan);
    if (x1 - x0 > maxSpan) {
      // Keep the subject in the frame, trimmed towards the front of the group.
      const keepFront = Math.min(x1, Math.max(sub.x + 0.3, x0 + maxSpan));
      x1 = keepFront;
      x0 = x1 - maxSpan;
    }
    if (type === "judge") {
      x0 = Math.min(x0, L - 2.5);
      x1 = Math.max(x1, L + 2.5);
    }
    const cx = (x0 + x1) / 2 + leadPad * 0.5;
    at.set(cx, this.el(cx) + 0.9, (z0 + z1) / 2);
    const D = this.fitDistance(x0, x1, z0, z1, at, elev, yaw, fov, fillX, fillY);
    const e = (elev * Math.PI) / 180;
    const a = (yaw * Math.PI) / 180;
    pos.set(at.x + Math.sin(a) * Math.cos(e) * D, at.y + Math.sin(e) * D, at.z + Math.cos(a) * Math.cos(e) * D);
    // Aim above the group so it sits in the HUD-free band, horizon in the upper third.
    at.y += (composeShift * D * Math.tan((this.vfovFor(fov) * Math.PI) / 360)) / Math.cos(e);
    return { fov, vel, x0, x1, z0, z1 };
  }

  /** Vertical FOV that keeps a 16:9 frame's horizontal field of view on narrow screens. */
  private vfovFor(fov: number): number {
    const aspectFix = Math.max(1, 16 / 9 / Math.max(0.3, this.camera.aspect));
    return Math.min(70, (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * aspectFix) * 180) / Math.PI);
  }

  /**
   * Camera distance from `at` (looking back along elevation/yaw) so that the box
   * x0..x1, y 0..2.6, z0..z1 fits within fillX / fillY of the frame (NDC half-extents).
   */
  private fitDistance(x0: number, x1: number, z0: number, z1: number, at: THREE.Vector3, elevDeg: number, yawDeg: number, fov: number, fillX: number, fillY: number): number {
    const e = (elevDeg * Math.PI) / 180;
    const a = (yawDeg * Math.PI) / 180;
    const dx = Math.sin(a) * Math.cos(e);
    const dy = Math.sin(e);
    const dz = Math.cos(a) * Math.cos(e);
    const fx = -dx;
    const fy = -dy;
    const fz = -dz;
    let rx = fy * 0 - fz * 1;
    let ry = 0;
    let rz = fx * 1 - fy * 0;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;
    const tanV = Math.tan(((this.vfovFor(fov) * Math.PI) / 180) / 2);
    const tanH = tanV * this.camera.aspect;
    const y0 = at.y - 0.9;
    let D = 10;
    for (const x of [x0, x1]) {
      for (const y of [y0, y0 + 2.6]) {
        for (const z of [z0 - 0.6, z1 + 0.6]) {
          const qx = x - at.x;
          const qy = y - at.y;
          const qz = z - at.z;
          const qf = qx * fx + qy * fy + qz * fz;
          const qr = Math.abs(qx * rx + qy * ry + qz * rz);
          const qu = Math.abs(qx * ux + qy * uy + qz * uz);
          D = Math.max(D, qr / (fillX * tanH) - qf, qu / (fillY * tanV) - qf);
        }
      }
    }
    return Math.min(D, 220);
  }

  destroy(): void {
    for (const r of this.runners) r.rig?.dispose();
    this.rigs.dispose();
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

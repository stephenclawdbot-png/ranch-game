/**
 * HD-2D race scene (Three.js): a real 3D racecourse with code-drawn pixel textures,
 * pixel-art billboards for horses / trees / stands, warm sun + hemisphere fill + fog,
 * a directed camera and a screen-space lens (DOF, bloom, grade).
 *
 * World units are metres. x runs along the track (start at 0, finish at trackLength),
 * y is up, z is across: the inner rail is at z = 0 (nearest the camera) and lanes run
 * away from the camera towards -z. The grandstand stands beyond the outer rail.
 */
import type * as THREE from "three";
import { FURLONG_MM, type RaceReplay } from "@thoroughbred/shared";
import { createReplaySampler, type HorseSample, type ReplaySampler } from "../sampleReplay";
import { Spring } from "../scene/camera";
import { legPhase, strideLengthM } from "../scene/horse/gait";
import { pipRect, type CameraMode, type RenderQuality } from "../types";
import type { ArtSet } from "./art";
import type { HorseRig, HorseRigFactory, LitHorseRig, RigKind } from "./horseRig";
import { hexToRgb, mixHex, rng } from "./color";
import {
  LOOKS,
  blobShadow,
  cloudSprite,
  flagStrip,
  gatePanelTile,
  grandstandSprite,
  railCrowdSprite,
  grassTile,
  hedgeTile,
  hillsStrip,
  roundelSprite,
  signSprite,
  skyStrip,
  sunSprite,
  surfaceTile,
  treeSprite,
  type Look,
} from "./pixelTextures";
import { PostFX } from "./post";
import { PixelParticles, PixelRain } from "./vfx";

/**
 * Race data the scene renders. A finished `RaceReplay` satisfies it; a live broadcast
 * passes its header with the frames/events received so far and no result (the scene
 * never reads a result it doesn't have; `setFinal` hands it over at the end).
 */
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
  frozen: boolean;
  flash: number;
}

export interface HD2DSceneOptions {
  quality: RenderQuality;
  highlightHorseId?: string;
  /** Render at a low internal resolution and upscale with nearest filtering. */
  pixelated?: boolean;
  art: ArtSet;
  rigs: HorseRigFactory;
  rigKind: RigKind;
}

/** Visual lane width (cosmetic; wider than real so lanes separate on screen). */
const LANE_W = 2.2;
const RAIL_GAP = 1.2;
/**
 * Pixel density (HD pixel standard v2): texels per metre by depth plane, so one texel
 * covers about the same screen area across a plane. Focal plane = horses, props, ground.
 */
const FOCAL_PX_PER_M = 96;
const MID_PX_PER_M = 32;
const BG_PX_PER_M = 10;
/** Nose-to-tail length of a racehorse (m); low-density strips are scaled to it. */
const HORSE_LEN_M = 2.4;
const PULLUP_TAU = 2.6;
const TRACK_PRE = 180;
const TRACK_POST = 340;
const x0Track = (_L: number) => -TRACK_PRE;

interface Runner {
  index: number;
  horseId: string;
  rig: HorseRig;
  group: THREE.Group;
  plane: THREE.Mesh;
  mat: THREE.Material;
  shadow: THREE.Mesh;
  phase: number;
  lastX: number;
  x: number;
  z: number;
  bodyX: number;
  bodyZ: number;
  speed: number;
  drive: number;
  finishT: number | null;
  finishSpeed: number;
  kickT: number | null;
  prevLeg: [number, number];
  rand: () => number;
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

import { Director, SHOT_REACH, type ShotType } from "../director";

export class HD2DScene {
  readonly canvas: HTMLCanvasElement;
  private T: typeof THREE;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private post: PostFX | null = null;
  private replay: SceneRaceData;
  private kickScan = 0;
  private kicks = new Map<string, number>();
  private sampler: ReplaySampler;
  private samples: HorseSample[] = [];
  private scratch: HorseSample[] = [];
  private look: Look;
  private runners: Runner[] = [];
  private disposables: { dispose(): void }[] = [];
  private rigs: HorseRigFactory;
  private particles: PixelParticles;
  private rain: PixelRain | null = null;
  private sky: THREE.Mesh;
  private sun: THREE.Sprite | null = null;
  private sunLight: THREE.DirectionalLight;
  private sunDir: THREE.Vector3;
  private crowdTex: THREE.Texture[] = [];
  private stand: THREE.Mesh | null = null;
  private flagTex: THREE.Texture[] = [];
  private railCrowdTex: THREE.Texture[] = [];
  private railCrowd: THREE.Mesh | null = null;
  private doors: THREE.Group[] = [];
  private marker: THREE.Sprite | null = null;
  private ring: THREE.Mesh | null = null;
  private camPos: Spring3;
  private camLook: Spring3;
  private fov: Spring;
  private director = new Director();
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
  private firstFrame = true;
  private quality: RenderQuality;
  private pixelated: boolean;
  private highlight: number;
  private L: number;
  private trackW: number;
  private laneCount: number;
  /** Official winner time once the result is known, else the first frame-derived crossing. */
  private winnerTime = Number.POSITIVE_INFINITY;
  private photoFinish = false;
  private confettiDone = false;
  private W = 1;
  private H = 1;
  private v1: THREE.Vector3;
  private v2: THREE.Vector3;
  private buf: THREE.Vector2;
  private focusDist = 15;
  private focusRange = 4;

  constructor(T: typeof THREE, replay: SceneRaceData, opts: HD2DSceneOptions) {
    this.T = T;
    this.replay = replay;
    this.quality = opts.quality;
    this.pixelated = !!opts.pixelated;
    this.rigs = opts.rigs;
    this.sampler = createReplaySampler(replay);
    this.look = LOOKS[replay.race.weather] ?? LOOKS.clear;
    this.L = replay.trackLengthMm / 1000;
    this.laneCount = Math.max(2, replay.laneCount);
    this.trackW = RAIL_GAP * 2 + (this.laneCount - 1) * LANE_W;
    this.applyResult();
    this.highlight = replay.horses.findIndex((h) => h.horseId === opts.highlightHorseId);
    this.v1 = new T.Vector3();
    this.v2 = new T.Vector3();
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

    // --- Light -----------------------------------------------------------------
    this.sunDir = new T.Vector3(...this.look.sunDir).normalize();
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
    this.buildPoles();
    this.buildGate();
    this.buildHorses(opts);
    this.buildMarker();

    this.particles = new PixelParticles(T, opts.quality === "high" ? 900 : 300);
    this.particles.density = opts.quality === "high" ? 1 : 0.4;
    scene.add(this.particles.points);
    this.disposables.push(this.particles);
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

  private tex(src: HTMLCanvasElement | HTMLImageElement, opts: { repeat?: boolean; mip?: boolean } = {}): THREE.Texture {
    const T = this.T;
    const t = src instanceof HTMLCanvasElement ? new T.CanvasTexture(src) : new T.Texture(src);
    t.colorSpace = T.SRGBColorSpace;
    t.magFilter = T.NearestFilter;
    t.minFilter = opts.mip ? T.NearestMipmapLinearFilter : T.NearestFilter;
    t.generateMipmaps = !!opts.mip;
    if (opts.mip) t.anisotropy = 4;
    if (opts.repeat) {
      t.wrapS = T.RepeatWrapping;
      t.wrapT = T.RepeatWrapping;
    }
    t.needsUpdate = true;
    this.disposables.push(t);
    return t;
  }

  private own<G extends { dispose(): void }>(g: G): G {
    this.disposables.push(g);
    return g;
  }

  private buildSky(art: ArtSet): THREE.Mesh {
    const T = this.T;
    const weather = this.replay.race.weather;
    const artSky = art.images.get(weather === "dusk" ? "sky-dusk" : weather === "clear" ? "sky-clear" : "sky-overcast");
    const map = this.tex(artSky ?? skyStrip(this.look));
    if (!artSky) map.magFilter = T.NearestFilter;
    const sky = new T.Mesh(this.own(new T.SphereGeometry(1800, 24, 24)), this.own(new T.MeshBasicMaterial({ map, side: T.BackSide, fog: false, depthWrite: false })));
    sky.renderOrder = -10;
    this.scene.add(sky);
    if (this.look.sunDisc) {
      this.sun = new T.Sprite(this.own(new T.SpriteMaterial({ map: this.tex(sunSprite(this.look)), fog: false, depthWrite: false, transparent: true })));
      this.sun.scale.set(150, 150, 1);
      this.sun.renderOrder = -9;
      this.scene.add(this.sun);
    }
    // Pixel clouds, far away (so they barely parallax).
    const r = rng(77);
    const cloudTex = [0, 1, 2].map((i) => this.tex(cloudSprite(this.look, 100 + i)));
    for (let i = 0; i < this.look.cloudCount; i++) {
      const s = new T.Sprite(this.own(new T.SpriteMaterial({ map: cloudTex[i % 3]!, fog: false, depthWrite: false, transparent: true, alphaTest: 0.5 })));
      const w = 180 + r() * 160;
      s.scale.set(w, w * 0.42, 1);
      s.position.set(-700 + r() * (this.L + 1400), 140 + r() * 260, -1100 - r() * 300);
      s.renderOrder = -8;
      this.scene.add(s);
    }
    return sky;
  }

  private buildGround(art: ArtSet, surface: RaceReplay["race"]["surface"]): void {
    const T = this.T;
    const L = this.L;
    const len = L + TRACK_PRE + TRACK_POST;
    const cx = (L - TRACK_PRE + L + TRACK_POST) / 2;
    // Outfield / infield grass (tiles at focal density, mipmapped for distance).
    const grassImg = art.images.get("tex-grass");
    const gCanvas = grassImg ?? grassTile(this.look);
    const gTex = this.tex(gCanvas, { repeat: true, mip: true });
    const gTile = gCanvas.width / FOCAL_PX_PER_M;
    const gW = len + 1600;
    const gD = 1700;
    gTex.repeat.set(gW / gTile, gD / gTile);
    const grass = new T.Mesh(this.own(new T.PlaneGeometry(gW, gD)), this.own(new T.MeshLambertMaterial({ map: gTex })));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(cx, 0, -gD / 2 + 80);
    grass.receiveShadow = true;
    this.scene.add(grass);
    // Racing surface: fine tile + broad mowing stripes / harrow bands as vertex colours.
    const stem = surface === "turf" ? "tex-turf" : "tex-dirt";
    const sImg = art.images.get(stem);
    const sCanvas = sImg ?? surfaceTile(this.look, surface);
    const sTex = this.tex(sCanvas, { repeat: true, mip: true });
    const tile = sCanvas.width / FOCAL_PX_PER_M;
    const tileD = sCanvas.height / FOCAL_PX_PER_M;
    this.scene.add(this.stripedStrip(sTex, x0Track(L), len, tile, tileD, surface === "turf" ? 6 : 3, surface === "turf" ? 0.84 : 0.95));
    // Finish line across the track.
    const line = new T.Mesh(this.own(new T.PlaneGeometry(0.2, this.trackW)), this.own(new T.MeshLambertMaterial({ color: 0xf6f6f0 })));
    line.rotation.x = -Math.PI / 2;
    line.position.set(L, 0.012, -this.trackW / 2);
    line.receiveShadow = true;
    this.scene.add(line);
    // Infield hedge in the foreground (camera side).
    const hImg = art.images.get("tex-hedge");
    const hTex = this.tex(hImg ?? hedgeTile(this.look), { repeat: true, mip: true });
    const hImgW = (hImg ?? { width: 64 }).width / FOCAL_PX_PER_M;
    hTex.repeat.set(len / hImgW, 0.75 / hImgW);
    const hedge = new T.Mesh(this.own(new T.BoxGeometry(len, 0.75, 0.8)), this.own(new T.MeshLambertMaterial({ map: hTex })));
    hedge.position.set(cx, 0.375, 3.4);
    hedge.castShadow = true;
    hedge.receiveShadow = true;
    this.scene.add(hedge);
  }

  /** Track surface as quads of alternating tint (hard-edged stripes), UVs in world metres. */
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
        pos.set([x!, 0.006, z!], o * 3);
        uv.set([x! / tileW, -z! / tileD], o * 2);
        col.set([c, c, c], o * 3);
      });
      const b = i * 4;
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
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

  private billboardMat(map: THREE.Texture, tint = this.look.billboardTint): THREE.MeshBasicMaterial {
    return this.own(new this.T.MeshBasicMaterial({ map, alphaTest: 0.5, color: tint, side: this.T.DoubleSide }));
  }

  private buildBackdrop(art: ArtSet): void {
    const T = this.T;
    const L = this.L;
    const far = -this.trackW;
    // Distant hills: a long plane well beyond the fog (own haze baked in).
    const hImg = art.images.get("far-hills");
    const hTex = this.tex(hImg ?? hillsStrip(this.look), { repeat: true });
    hTex.wrapT = T.ClampToEdgeWrapping;
    const hw = L + 5000;
    hTex.repeat.set(hw / 760, 1);
    const hills = new T.Mesh(this.own(new T.PlaneGeometry(hw, 150)), this.own(new T.MeshBasicMaterial({ map: hTex, transparent: true, alphaTest: 0.5, fog: false, depthWrite: false })));
    hills.position.set(L / 2, 58, -1000);
    hills.renderOrder = -7;
    this.scene.add(hills);

    // Grandstand along the home straight beyond the outer rail, with crowd animation.
    const standImg = art.images.get("bb-grandstand");
    this.crowdTex = standImg ? [this.tex(standImg, { repeat: true })] : [0, 1].map((f) => this.tex(grandstandSprite(this.look, f), { repeat: true }));
    for (const t of this.crowdTex) t.wrapT = T.ClampToEdgeWrapping;
    const standSrc = standImg ?? { width: 256, height: 128 };
    const modW = standSrc.width / BG_PX_PER_M;
    const mods = Math.max(3, Math.round(200 / modW));
    const standH = standSrc.height / BG_PX_PER_M;
    for (const t of this.crowdTex) t.repeat.set(mods, 1);
    this.stand = new T.Mesh(this.own(new T.PlaneGeometry(modW * mods, standH)), this.billboardMat(this.crowdTex[0]!));
    this.stand.position.set(L - 50, standH / 2, far - 30);
    this.stand.receiveShadow = false;
    this.scene.add(this.stand);
    // Bunting flags on the roof.
    const flagColors = ["#c8102e", "#f2c230", "#1d3f8f", "#ffffff", "#0f6b3a"];
    this.flagTex = flagColors.map((c) => {
      const t = this.tex(flagStrip(c));
      t.repeat.set(1 / 4, 1);
      return t;
    });
    const flagGeo = this.own(new T.PlaneGeometry(1.8, 1.5));
    const poleGeo = this.own(new T.BoxGeometry(0.08, 2.4, 0.08));
    const poleMat = this.own(new T.MeshLambertMaterial({ color: 0x8b8f93 }));
    for (let i = 0; i < 16; i++) {
      const x = L - 50 - (modW * mods) / 2 + 6 + i * ((modW * mods - 12) / 15);
      const pole = new T.Mesh(poleGeo, poleMat);
      pole.position.set(x, standH + 1.0, far - 30.2);
      const flag = new T.Mesh(flagGeo, this.billboardMat(this.flagTex[i % this.flagTex.length]!, "#ffffff"));
      flag.position.set(x + 0.95, standH + 1.6, far - 30.2);
      this.scene.add(pole, flag);
    }

    // Spectators along the outer rail through the last ~200 m, with a lawn apron.
    this.railCrowdTex = [0, 1].map((f) => {
      const t = this.tex(railCrowdSprite(this.look, f), { repeat: true });
      t.wrapT = T.ClampToEdgeWrapping;
      return t;
    });
    const crowdLen = 230;
    for (const t of this.railCrowdTex) t.repeat.set(crowdLen / 10.7, 1);
    this.railCrowd = new T.Mesh(this.own(new T.PlaneGeometry(crowdLen, 2.0)), this.billboardMat(this.railCrowdTex[0]!));
    this.railCrowd.position.set(L - crowdLen / 2 + 30, 1.0, far - 2.6);
    this.scene.add(this.railCrowd);

    // Trees: instanced pixel billboards beyond the outer rail and around the stand.
    const kinds: [string, number][] = [
      ["bb-tree-oak", 0],
      ["bb-tree-poplar", 1],
      ["bb-bush", 2],
    ];
    const r = rng(61);
    const dummy = new T.Object3D();
    kinds.forEach(([stem, kind]) => {
      const img = art.images.get(stem);
      const canvas = img ?? treeSprite(this.look, kind, 51 + kind);
      const map = this.tex(canvas);
      const w = canvas.width / BG_PX_PER_M;
      const h = canvas.height / BG_PX_PER_M;
      const geo = this.own(new T.PlaneGeometry(w, h));
      geo.translate(0, h / 2, 0);
      const count = kind === 2 ? 90 : 55;
      const mesh = new T.InstancedMesh(geo, this.billboardMat(map), count);
      let n = 0;
      for (let i = 0; i < count; i++) {
        const x = -TRACK_PRE - 60 + r() * (L + TRACK_PRE + TRACK_POST + 120);
        const behindStand = x > L - 50 - 110 && x < L - 50 + 110;
        let z = kind === 2 ? far - 8 - r() * 14 : far - (behindStand ? 46 : 30) - r() * 120;
        if (kind === 2 && behindStand) z = far - 40 - r() * 20;
        const s = 0.75 + r() * 0.6;
        dummy.position.set(x, 0, z);
        dummy.scale.set(s, s, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(n++, dummy.matrix);
      }
      mesh.count = n;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    });
  }

  private buildRails(): void {
    const T = this.T;
    const L = this.L;
    const x0 = -TRACK_PRE + 20;
    const x1 = L + TRACK_POST - 20;
    const white = this.own(new T.MeshLambertMaterial({ color: 0xf4f4ef }));
    const spacing = 2.5;
    const per = Math.floor((x1 - x0) / spacing) + 1;
    const postGeo = this.own(new T.BoxGeometry(0.09, 1.05, 0.09));
    postGeo.translate(0, 0.525, 0);
    const posts = new T.InstancedMesh(postGeo, white, per * 2);
    const dummy = new T.Object3D();
    let n = 0;
    for (const z of [0, -this.trackW]) {
      for (let i = 0; i < per; i++) {
        dummy.position.set(x0 + i * spacing, 0, z);
        dummy.updateMatrix();
        posts.setMatrixAt(n++, dummy.matrix);
      }
      const bar = new T.Mesh(this.own(new T.BoxGeometry(x1 - x0, 0.1, 0.16)), white);
      bar.position.set((x0 + x1) / 2, 1.06, z + (z === 0 ? 0.05 : -0.05));
      bar.castShadow = true;
      this.scene.add(bar);
    }
    posts.castShadow = true;
    posts.frustumCulled = false;
    this.scene.add(posts);
  }

  private stripes(colors: string[], bands: number): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = bands;
    const ctx = c.getContext("2d")!;
    for (let i = 0; i < bands; i++) {
      ctx.fillStyle = colors[i % colors.length]!;
      ctx.fillRect(0, i, 2, 1);
    }
    return this.tex(c);
  }

  private buildPoles(): void {
    const T = this.T;
    const L = this.L;
    const furlong = FURLONG_MM / 1000;
    const poleMat = this.own(new T.MeshLambertMaterial({ map: this.stripes(["#f4f4f2", "#c8102e"], 8) }));
    const poleGeo = this.own(new T.CylinderGeometry(0.06, 0.06, 2.3, 6));
    poleGeo.translate(0, 1.15, 0);
    for (let i = 1; L - i * furlong > 1; i++) {
      const x = L - i * furlong;
      const pole = new T.Mesh(poleGeo, poleMat);
      pole.position.set(x, 0, 0.3);
      pole.castShadow = true;
      const sign = signSprite(`${i}f`);
      const sw = sign.width / FOCAL_PX_PER_M;
      const sh = sign.height / FOCAL_PX_PER_M;
      const plate = new T.Mesh(this.own(new T.PlaneGeometry(sw, sh)), this.billboardMat(this.tex(sign), "#ffffff"));
      plate.position.set(x, 2.3 + sh / 2, 0.36);
      this.scene.add(pole, plate);
    }
    // Winning post (far side, by the stands) with roundel; short post on the near side.
    const wpMat = this.own(new T.MeshLambertMaterial({ map: this.stripes(["#ffffff", "#d71920"], 12) }));
    const wp = new T.Mesh(this.own(new T.CylinderGeometry(0.09, 0.09, 3.6, 8)), wpMat);
    wp.position.set(L, 1.8, -this.trackW - 0.5);
    wp.castShadow = true;
    const rs = roundelSprite();
    const roundel = new T.Mesh(this.own(new T.PlaneGeometry(rs.width / FOCAL_PX_PER_M, rs.height / FOCAL_PX_PER_M)), this.billboardMat(this.tex(rs), "#ffffff"));
    roundel.position.set(L, 3.6 + 0.6, -this.trackW - 0.45);
    const np = new T.Mesh(this.own(new T.CylinderGeometry(0.07, 0.07, 1.8, 8)), wpMat);
    np.position.set(L, 0.9, 0.35);
    np.castShadow = true;
    this.scene.add(wp, roundel, np);
  }

  private laneZ(lane: number): number {
    return -(RAIL_GAP + lane * LANE_W);
  }

  private buildGate(): void {
    const T = this.T;
    // Starting lanes: frame 0 if we have it (live: maybe not yet), else gate order.
    const maxLane = this.replay.frames.length
      ? Math.max(0, ...this.sampler(0).map((s) => Math.round(s.lane)))
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
    // Cross beams over the stalls.
    const span = Math.abs(zs[zs.length - 1]! - zs[0]!);
    for (const x of [BACK, FRONT]) {
      const beam = new T.Mesh(this.own(new T.BoxGeometry(0.12, 0.14, span)), frameMat);
      beam.position.set(x, 2.5, (zs[0]! + zs[zs.length - 1]!) / 2);
      beam.castShadow = true;
      g.add(beam);
    }
    // Front doors: two leaves per stall, hinged on the partitions.
    const leafW = LANE_W / 2 - 0.04;
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
    this.replay.horses.forEach((h, i) => {
      const rig = opts.rigs.create(h.appearance, { gate: h.gate });
      // HD strips (>= 200 px frames) sit at the focal density; low-res strips are scaled
      // so the horse is still life-size (nose-to-tail ~93% of the frame).
      const WUPP = rig.width >= 200 ? 1 / FOCAL_PX_PER_M : HORSE_LEN_M / (rig.width * 0.93);
      const w = rig.width * WUPP;
      const hh = rig.height * WUPP;
      const geo = this.own(new T.PlaneGeometry(w, hh));
      // Put the rig's ground-contact anchor at the group origin.
      // Anchor pixel (y down from the top) -> group origin on the ground.
      geo.translate((rig.width / 2 - rig.anchor.x) * WUPP, (rig.anchor.y - rig.height / 2) * WUPP, 0);
      // Strip rigs with a normal map are lit by the scene's sun + sky (rim light on the
      // gallop); rigs that light themselves (pixel-rig) use an unlit material.
      const normalMap = (rig as LitHorseRig).normalMap;
      const mat = normalMap
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
      const plane = new T.Mesh(geo, mat);
      const group = new T.Group();
      group.add(plane);
      this.scene.add(group);
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
        phase: rng(i * 977 + 13)(),
        lastX: Number.NaN,
        x: 0,
        z: 0,
        bodyX: 0,
        bodyZ: 0,
        speed: 0,
        drive: 0,
        finishT: null,
        finishSpeed: 8,
        kickT: null,
        prevLeg: [0, 0],
        rand: rng(i * 7919 + 1),
      });
    });
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
    this.particles.density = q === "high" ? 1 : 0.4;
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
    this.W = Math.max(1, W);
    this.H = Math.max(1, H);
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    let ratio: number;
    // HD pixel standard: never below ~540 lines internally; desktop renders at device
    // resolution (all sprites/tiles sample with nearest filtering).
    if (this.quality === "low") ratio = Math.min(Math.max(dpr, 1), Math.max(1, 540 / this.H));
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

  render(f: SceneFrame): void {
    const T = this.T;
    const raceT = f.time;
    const tS = Math.max(0, raceT);
    let simDt = Number.isNaN(this.lastTime) ? 0 : raceT - this.lastTime;
    const seek = Math.abs(simDt) > 0.6 || simDt < -1e-9;
    if (seek || Number.isNaN(this.lastTime)) {
      this.director.reset(raceT);
      this.dirEventScan = 0;
      const tickNow = Math.max(0, raceT) * this.replay.tickHz;
      while (this.dirEventScan < this.replay.events.length && this.replay.events[this.dirEventScan]!.tick < tickNow) this.dirEventScan++;
    }
    if (seek) {
      simDt = 0;
      this.particles.clear();
      if (raceT < this.winnerTime) this.confettiDone = false;
    }
    if (f.frozen) simDt = 0;
    this.lastTime = raceT;
    this.animTime += simDt;
    const realDt = Math.min(0.1, Math.max(0, f.realDt));
    const L = this.L;
    const furlong = FURLONG_MM / 1000;

    this.samples = this.sampler(tS, this.samples);
    let lead: Runner | null = null;
    let last: Runner | null = null;
    let zSum = 0;
    // New kick events (live: events grow).
    const evs = this.replay.events;
    for (; this.kickScan < evs.length; this.kickScan++) {
      const ev = evs[this.kickScan]!;
      if (ev.type === "kick" && ev.horseId && !this.kicks.has(ev.horseId)) this.kicks.set(ev.horseId, ev.tick / this.replay.tickHz);
    }
    for (const r of this.runners) {
      const s = this.samples[r.index]!;
      // Finish time: official when the result is known, else frame-derived (sampler).
      if (r.finishT === null && s.finishTimeSec !== null) {
        r.finishT = s.finishTimeSec;
        const before = this.sampler(Math.max(0, r.finishT - 0.05), this.scratch)[r.index]!;
        r.finishSpeed = Math.max(8, before.speed / 1000);
        this.samples = this.sampler(tS, this.samples);
      }
      if (r.kickT === null) r.kickT = this.kicks.get(r.horseId) ?? null;
      if (!this.replay.result && r.finishT !== null) this.winnerTime = Math.min(this.winnerTime, r.finishT);
      if (r.finishT !== null && tS > r.finishT) {
        const e = Math.exp(-(tS - r.finishT) / PULLUP_TAU);
        r.x = L + r.finishSpeed * PULLUP_TAU * (1 - e);
        r.speed = r.finishSpeed * e;
      } else {
        r.x = s.x / 1000;
        r.speed = raceT < 0 ? 0 : s.speed / 1000;
      }
      r.z = this.laneZ(this.replay.frames.length ? s.lane : this.replay.horses[r.index]!.gate - 1);
      zSum += r.z;
      if (!lead || r.x > lead.x) lead = r;
      if (!last || r.x < last.x) last = r;
    }
    if (!lead || !last) return;
    const fieldZ = zSum / this.runners.length;

    // --- Camera direction -------------------------------------------------------
    // A TV director picks the shot (hard cuts); each shot frames its subject with a
    // fixed lens/angle and the camera moves smoothly within it.
    const mine = this.highlight >= 0 ? this.runners[this.highlight]! : null;
    let mode = f.camera;
    if (mode === "mine" && !mine) mode = "director";
    const byX = [...this.runners].sort((a, b) => b.x - a.x);
    // Events that have just happened (for motivated cuts).
    const newEvents: { type: string; horseId?: string }[] = [];
    for (; this.dirEventScan < evs.length && evs[this.dirEventScan]!.tick / this.replay.tickHz <= tS; this.dirEventScan++) newEvents.push(evs[this.dirEventScan]!);
    const dirInput = {
      t: raceT,
      runners: this.runners.map((r) => ({ id: r.horseId, x: r.x })),
      trackLengthM: L,
      winnerTime: this.winnerTime,
      photoFinish: this.photoFinish,
      newEvents,
      highlightId: mine?.horseId ?? null,
    };
    let shotType: ShotType;
    let subjectId: string | null;
    let cut: boolean;
    if (mode === "director") {
      const r = this.director.update(dirInput);
      shotType = r.shot.type;
      subjectId = r.shot.subject;
      cut = r.cut;
    } else {
      const photo = this.photoFinish && tS > this.winnerTime - 1.6 && tS < this.winnerTime + 0.9;
      shotType = raceT < 1 ? "gate" : photo ? "judge" : mode === "wide" ? "wide" : tS > this.winnerTime + 0.9 && mode !== "mine" ? "post" : "close";
      subjectId = mode === "mine" ? mine!.horseId : null;
      cut = shotType !== this.shotType || subjectId !== this.shotSubject;
      // Keep tracking smooth when a locked camera merely changes subject.
      if (cut && (shotType === "close" || shotType === "wide") && (this.shotType === "close" || this.shotType === "wide")) cut = false;
    }
    this.shotType = shotType;
    this.shotSubject = subjectId;
    const subject = (subjectId ? this.runners.find((r) => r.horseId === subjectId) : null) ?? lead;
    const pos = this.v1;
    const at = this.v2;
    const sc = this.shotCamera(shotType, subject, byX, raceT, pos, at);
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
    this.camPos.into(cam.position);
    cam.lookAt(this.camLook.into(this.v2));
    const vfov = this.vfovFor(this.fov.x);
    if (Math.abs(cam.fov - vfov) > 1e-3) {
      cam.fov = vfov;
      cam.updateProjectionMatrix();
    }
    this.focusDist = cam.position.distanceTo(this.v1.set((sc.x0 + sc.x1) / 2, 1.0, (sc.z0 + sc.z1) / 2));
    // Keep the framed horses plus the near rail in the sharp band.
    this.focusRange = Math.max(5, (sc.z1 - sc.z0) * 0.6 + (sc.x1 - sc.x0) * 0.25 + 4);
    const shot = shotType;
    const focus = subject;

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
    this.sky.position.copy(cam.position);
    if (this.sun) this.sun.position.copy(cam.position).addScaledVector(this.sunDir, 1500);
    this.sunLight.target.position.set(focus.x, 0, -this.trackW / 2);
    this.sunLight.position.copy(this.sunLight.target.position).addScaledVector(this.sunDir, 80);
    if (this.crowdTex.length > 1 && this.stand) {
      const m = this.stand.material as THREE.MeshBasicMaterial;
      const next = this.crowdTex[Math.floor(this.animTime * 3) % 2]!;
      if (m.map !== next) {
        m.map = next;
      }
    }
    if (this.railCrowd && this.railCrowdTex.length > 1) {
      const excite = tS > this.winnerTime - 8 ? 6 : 1.5;
      (this.railCrowd.material as THREE.MeshBasicMaterial).map = this.railCrowdTex[Math.floor(this.animTime * excite) % 2]!;
    }
    const ff = Math.floor(this.animTime * 8 + 0.0001);
    this.flagTex.forEach((t, i) => (t.offset.x = ((ff + i) % 4) / 4));
    const open = Math.min(1, Math.max(0, raceT / 0.3));
    for (const d of this.doors) d.rotation.y = (d.userData.side === 0 ? 1 : -1) * open * 1.45;

    // --- Horses ------------------------------------------------------------------
    const lightDir = this.sunDir;
    for (const r of this.runners) {
      const stride = strideLengthM(Math.max(r.speed, 6));
      if (seek || Number.isNaN(r.lastX)) r.lastX = r.x;
      const dx = r.x - r.lastX;
      r.lastX = r.x;
      if (dx > 0 && dx < 5) r.phase += dx / stride;
      const finished = r.finishT !== null && tS >= r.finishT;
      const kicked = r.kickT !== null && tS >= r.kickT;
      let driveT = 0;
      if (!finished && raceT > 0) driveT = L - r.x < furlong ? (kicked ? 1 : 0.7) : kicked ? 0.55 : 0;
      r.drive += (driveT - r.drive) * (1 - Math.exp(-4 * simDt));
      r.rig.update(this.renderer, { phase: r.phase, speedMs: r.speed, drive: r.drive, lightDir, time: this.animTime });
      r.group.position.set(r.x, 0, r.z);
      // Axis-locked billboard, limited yaw so side-view sprites never turn edge-on.
      const yaw = Math.atan2(cam.position.x - r.x, cam.position.z - r.z);
      const ry = Math.max(-0.62, Math.min(0.62, yaw));
      // Lean the sprite back towards an elevated camera so it isn't squashed.
      const horiz = Math.hypot(cam.position.x - r.x, cam.position.z - r.z);
      const tilt = Math.min(0.55, Math.max(0, Math.atan2(cam.position.y - 1.0, horiz) * 0.75));
      r.group.rotation.order = "YXZ";
      r.group.rotation.y = ry;
      r.group.rotation.x = -tilt;
      // Body centre follows the yawed sprite plane.
      r.bodyX = r.x - 1.25 * Math.cos(ry);
      r.bodyZ = r.z + 1.25 * Math.sin(ry);
      // Contact shadow: under the barrel, nudged away from the sun.
      r.shadow.position.set(r.bodyX - this.sunDir.x * 0.5, 0.014, r.bodyZ - this.sunDir.z * 0.35);
      r.shadow.rotation.z = ry;
      r.shadow.scale.set(2.7, 0.95, 1);
      // Hoof strikes -> pixel dust / turf.
      if (simDt > 0 && r.speed > 4) {
        const legs: ["FR" | "HR", number][] = [
          ["FR", -0.35],
          ["HR", -2.0],
        ];
        legs.forEach(([leg, off], li) => {
          const ph = legPhase(r.phase, leg);
          if (ph < r.prevLeg[li]!) this.hoofStrike(r, r.x + off);
          r.prevLeg[li] = ph;
        });
      }
    }

    // Confetti as the winner hits the line.
    if (!this.confettiDone && tS >= this.winnerTime && simDt > 0) {
      this.confettiDone = true;
      const cols = ["#d9a441", "#f3e7c9", "#c8102e", "#1d3f8f", "#2e9259", "#ffffff"];
      for (let i = 0; i < 260; i++) {
        this.particles.emit("confetti", L - 4 + Math.random() * 10, 5 + Math.random() * 5, -this.trackW * Math.random(), (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, cols[i % cols.length]!, 0.09, 5 + Math.random() * 3);
      }
    }
    this.particles.update(simDt);
    const buf = this.renderer.getDrawingBufferSize(this.buf);
    this.particles.setPxScale(buf.y / (2 * Math.tan((cam.fov * Math.PI) / 360)));
    if (this.rain) this.rain.update(f.frozen ? 0 : realDt, cam.position.x, cam.position.z - 12);

    if (this.marker && this.ring && this.highlight >= 0) {
      const r = this.runners[this.highlight]!;
      this.marker.position.set(r.bodyX + 0.3, 2.7 + Math.sin(performance.now() / 250) * 0.06, r.bodyZ);
      this.ring.position.set(r.bodyX, 0.016, r.bodyZ);
    }

    // --- Draw ----------------------------------------------------------------------
    const g = this.look.grade;
    if (this.post) {
      this.post.render(this.scene, cam, {
        focusDist: this.focusDist,
        focusRange: this.focusRange,
        dofAmount: 0.55,
        tiltShift: 0.12,
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
      r.render(this.scene, this.pipCam);
      r.autoClear = auto;
      r.setScissorTest(false);
      r.setViewport(0, 0, this.W, this.H);
    }
    void T;
  }

  /** True when the PiP inset was drawn this frame (the HUD frames it). */
  pipShown = false;

  private applyResult(): void {
    const res = this.replay.result ?? null;
    this.winnerTime = res ? res.winningTimeUs / 1e6 : Number.POSITIVE_INFINITY;
    this.photoFinish = res ? res.photoFinish : false;
  }

  /** The race is over: switch to the official replay (same horses, same scene). */
  setFinal(final: RaceReplay): void {
    this.replay = final;
    this.sampler = createReplaySampler(final);
    this.applyResult();
    for (const r of this.runners) {
      r.finishT = null;
      r.kickT = null;
    }
    this.kickScan = 0;
    this.kicks.clear();
    this.lastTime = Number.NaN;
  }

  /**
   * Camera for one shot type around `sub`: writes the target position/aim into `pos` /
   * `at` and returns the lens, tracking velocity and the framed box.
   */
  private shotCamera(type: ShotType, sub: Runner, byX: Runner[], raceT: number, pos: THREE.Vector3, at: THREE.Vector3) {
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
    const near = (reach: number, max: number) => {
      const g = byX.filter((r) => Math.abs(r.x - sub.x) <= reach).sort((a, b) => Math.abs(a.x - sub.x) - Math.abs(b.x - sub.x)).slice(0, max);
      return g.includes(sub) ? g : [sub, ...g.slice(0, max - 1)];
    };
    switch (type) {
      case "gate": {
        const k = Math.min(1, Math.max(0, (raceT + 1.6) / 2.6));
        group = byX;
        elev = 26 - 14 * k;
        yaw = -50 + 46 * k;
        fillX = 0.8;
        fillY = 0.62;
        fov = 32;
        vel = 0;
        maxSpan = 1e9;
        composeShift = 0.16;
        break;
      }
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
        elev = 12;
        yaw = -6;
        fillX = 0.9;
        fillY = 0.58;
        fov = 26;
        maxSpan = 24;
        composeShift = 0.14;
        break;
      case "headon":
        // Three-quarter front: ahead of the leaders looking back down the track
        // (side-view sprites turn at most ~35 deg, so a true head-on would look flat).
        group = near(SHOT_REACH.headon, 5);
        elev = 6;
        yaw = 50;
        fillX = 0.75;
        fillY = 0.6;
        fov = 24;
        leadPad = 2;
        maxSpan = 12;
        break;
      case "aerial":
        group = byX;
        elev = 52;
        yaw = -8;
        fillX = 0.88;
        fillY = 0.55;
        fov = 34;
        maxSpan = 1e9;
        composeShift = 0.08;
        break;
      case "wide":
        group = byX;
        elev = 20;
        yaw = -4;
        fillX = 0.86;
        fillY = 0.55;
        fov = 30;
        leadPad = 4;
        maxSpan = 80;
        composeShift = 0.16;
        break;
      case "rail": {
        // Low rail cam: just inside the inner rail at hoof-to-hip height, the rail posts
        // whipping past in the foreground.
        const g = near(SHOT_REACH.rail, 4);
        let zz = 0;
        for (const r of g) zz += r.z;
        zz /= g.length;
        pos.set(sub.x - 3.0, 1.35, 1.9);
        at.set(sub.x + 1.5, 1.05, zz);
        return { fov: 44, vel: sub.speed, x0: sub.x - 6, x1: sub.x + 1, z0: zz - 1, z1: zz + 1 };
      }
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
        group = byX.filter((r) => r.x > L - 40);
        if (group.length < 3) group = byX.slice(0, 3);
        elev = 14;
        yaw = 10;
        fov = 30;
        vel = 0;
        maxSpan = 30;
        break;
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
    // Narrow screens: less track, a little more elevation to separate the lanes.
    const narrowK = Math.min(1, Math.max(0.5, this.camera.aspect / (16 / 9)));
    maxSpan *= Math.pow(narrowK, type === "close" ? 0.5 : 1.5);
    if (type !== "judge" && type !== "gate" && type !== "aerial") elev += (1 - narrowK) * 12;
    fillY *= 0.85 + 0.15 * narrowK;
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
    at.set((x0 + x1) / 2 + leadPad * 0.5, 0.9, (z0 + z1) / 2);
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
    // d: unit vector from the target towards the camera; f = -d (view direction).
    const dx = Math.sin(a) * Math.cos(e);
    const dy = Math.sin(e);
    const dz = Math.cos(a) * Math.cos(e);
    // right = f x up, up' = right x f
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
    let D = 10;
    for (const x of [x0, x1]) {
      for (const y of [0, 2.6]) {
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
    return Math.min(D, 160);
  }

  private hoofStrike(r: Runner, x: number): void {
    const turf = this.replay.race.surface === "turf";
    const power = Math.min(1, r.speed / 15);
    const z = r.z + (r.rand() - 0.5) * 0.3;
    if (turf) {
      const n = r.rand() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const col = r.rand() < 0.5 ? this.look.turf[1]! : "#4a3220";
        this.particles.emit("clod", x, 0.05, z, (-1.5 - r.rand() * 3) * power, (1.6 + r.rand() * 2.2) * power, (r.rand() - 0.5) * 0.6, col, 0.07, 0.9);
      }
      this.particles.emit("dust", x, 0.08, z, -1, 0.4, 0, this.look.turf[3]!, 0.06, 0.45, 0.4);
    } else {
      const dust = mixHex(this.look.dirt[3]!, "#ffffff", 0.2);
      for (let i = 0; i < 2; i++) {
        this.particles.emit("dust", x - r.rand() * 0.3, 0.1 + r.rand() * 0.1, z, (-0.8 - r.rand() * 1.6) * power, (0.35 + r.rand() * 0.5) * power, (r.rand() - 0.5) * 0.4, dust, 0.035 + r.rand() * 0.03, 0.7 + r.rand() * 0.4, 0.45);
      }
      if (r.rand() < 0.5) this.particles.emit("clod", x, 0.05, z, -2 * power, 1.4 * power, 0, this.look.dirt[0]!, 0.06, 0.7);
    }
  }

  destroy(): void {
    for (const r of this.runners) r.rig.dispose();
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
    void hexToRgb;
  }
}

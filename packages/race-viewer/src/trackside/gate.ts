/**
 * Trackside starting stalls: one starting-stall bay sprite drawn once per runner lane,
 * world-anchored at the start line. Before the off the horses idle inside their bays
 * (the bays stack into a gate as the lanes recede); at the off the front gate slabs of
 * every bay swing out (a pixel-snapped horizontal collapse around their hinge) and the
 * field breaks out; the gate then stays put and slides out of frame as the camera
 * follows the field.
 *
 * Art (art-src/finish-stall.py from a PixelLab generation, 92 px/m): a LOW, OPEN bay —
 * no truss, no number board, no solid side boarding; posts + top rail + bars + a low rail
 * on a wheeled base, about as tall as a horse and visible straight through, so every
 * runner's head and jockey show above and through the bay in front of it.
 *   starting-stall.png        the bay frame, front post + gate cut out  -> behind the horse
 *   starting-stall-front.png  the front post                            -> in front, static
 *   starting-stall-door.png   the padded front gate                     -> in front, swings
 * Depth sort interleaves with the horses (far lanes first): frame at depth - 0.5, post
 * and gate at depth + epsilon. Everything goes through the same squeezeX mapping as the
 * runners and props, one exact integer LOD ladder per lane (nearest filtering; LODs are
 * exact s:1 block copies, bottom-aligned so the wheels keep the ground line).
 *
 * If the keyed art is missing the gate is skipped entirely (build returns null).
 */
import type * as THREE from "three";
import { laneScale, laneY, squeezeX, type FieldLayout } from "./layout";
import type { TracksideLook } from "./looks";
import type { SceneRaceData } from "../three/HD2DScene";
import type { BackdropStem } from "./art";

const STEMS = ["starting-stall", "starting-stall-front", "starting-stall-door"] as const;

/** Authored source pixels per metre: the gate is drawn at horse density (96 would match the
 *  strips exactly); a touch looser keeps a bay a snug ~2.9 m shell around a 2.4 m horse. */
export const GATE_PX_PER_M = 92;
/** Metres from a horse's nose (its anchor) forward to its bay's front-door plane. */
const NOSE_LEAD_M = 0.35;
/** Door plane as a fraction of the frame width from the left (see starting-stall.meta.json). */
const PLANE_FRAC = 216 / 266;
/** Seconds for the gates to swing fully open. */
const OPEN_S = 0.22;
/** Edge-on remnant of an open gate (never fully 0: open doors stay visible as a sliver). */
const OPEN_MIN = 0.12;
/** Integer LOD copies (exact s:1, bottom-aligned) — same idea as the strip lods. */
const LOD_SCALES = [1, 2, 3, 4];

/** Private helpers of TracksideScene handed over so the gate stays self-contained. */
export interface GateHost {
  own<G extends { dispose(): void }>(g: G): G;
  canvasTex(src: HTMLCanvasElement | HTMLImageElement, o?: { nearest?: boolean }): THREE.Texture;
  bandMat(tex: THREE.Texture, w: number, h: number, o?: { sharp?: boolean; tint?: [string, number] }): THREE.ShaderMaterial;
  quad(m: THREE.Material, order: number): THREE.Mesh;
  place(mesh: THREE.Mesh, x: number, y: number, w: number, h: number): void;
}

interface LodLevel {
  s: number;
  tex: THREE.Texture;
  w: number;
  h: number;
  mat: THREE.ShaderMaterial;
}

interface Part {
  lods: LodLevel[];
}

interface Bay {
  runner: number;
  lane: number;
  /** World x (m) of this bay's front-door plane. */
  x: number;
  lod: number;
  frame: THREE.Mesh;
  post: THREE.Mesh;
  door: THREE.Mesh;
}

/** Exact s:1 bottom-aligned copy of an image on a canvas (nearest). */
function lodCanvas(img: HTMLImageElement, s: number): HTMLCanvasElement {
  const w = Math.max(2, Math.floor(img.naturalWidth / s));
  const h = Math.max(2, Math.floor(img.naturalHeight / s));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  x.imageSmoothingEnabled = false;
  // Source rect keeps the bottom rows (ground contact) exact.
  x.drawImage(img, 0, img.naturalHeight - h * s, w * s, h * s, 0, 0, w, h);
  return c;
}

export class StallGate {
  private bays: Bay[] = [];
  private frame!: Part;
  private post!: Part;
  private door!: Part;
  private host: GateHost;

  private constructor(host: GateHost) {
    this.host = host;
  }

  /** Builds the gate, or returns null when any piece of the keyed art is unavailable. */
  static build(
    images: Map<BackdropStem, HTMLImageElement>,
    look: TracksideLook,
    data: SceneRaceData,
    startM: number,
    host: GateHost,
  ): StallGate | null {
    const imgs = STEMS.map((s) => images.get(s));
    if (imgs.some((i) => !i || !i.naturalWidth)) return null;
    if (typeof document === "undefined") return null;
    const g = new StallGate(host);
    const parts = imgs.map((img) => ({
      lods: LOD_SCALES.filter((s) => Math.floor(img!.naturalWidth / s) >= 4 && Math.floor(img!.naturalHeight / s) >= 4).map((s) => {
        const src = s === 1 ? img! : lodCanvas(img!, s);
        const w = Math.min(src.width, img!.naturalWidth);
        const h = Math.min(src.height, img!.naturalHeight);
        const tex = host.canvasTex(src, { nearest: true });
        return { s, tex, w, h, mat: host.bandMat(tex, w, h, { sharp: true, tint: look.spriteTint }) };
      }),
    }));
    if (parts.some((p) => !p.lods.length)) return null;
    [g.frame, g.post, g.door] = parts as [Part, Part, Part];
    const doorPlaneWorld = startM + NOSE_LEAD_M;
    for (let i = 0; i < data.horses.length; i++) {
      g.bays.push({
        runner: i,
        lane: data.horses[i]!.gate - 1,
        x: doorPlaneWorld,
        lod: 0,
        frame: host.quad(g.frame.lods[0]!.mat, 0),
        post: host.quad(g.post.lods[0]!.mat, 0),
        door: host.quad(g.door.lods[0]!.mat, 0),
      });
    }
    return g;
  }

  private pickLod(part: Part, q: number, cur: number): number {
    const lods = part.lods;
    let ideal = lods[lods.length - 1]!.s;
    for (const l of lods) {
      if (q * l.s >= 1) {
        ideal = l.s;
        break;
      }
    }
    if (!cur || !lods.some((l) => l.s === cur)) return ideal;
    if (ideal > cur) return q * cur < 0.92 ? ideal : cur;
    if (ideal < cur) return q * ideal >= 1.08 ? ideal : cur;
    return cur;
  }

  /**
   * Places every bay for this frame. `depthOrder` lists runner indices far-to-near, the
   * same order the horses are drawn in (`depthBase` is the horses' first renderOrder).
   */
  draw(lay: FieldLayout, raceT: number, depthOrder: readonly number[], depthBase: number, B: number): void {
    const host = this.host;
    const Wb = lay.W * B;
    // Gate swing: closed before the off, swings open over OPEN_S.
    const u = Math.min(1, Math.max(0, raceT / OPEN_S));
    const ease = 1 - (1 - u) * (1 - u);
    const doorK = 1 - (1 - OPEN_MIN) * ease;
    for (const b of this.bays) {
      const di = depthOrder.indexOf(b.runner);
      const ls = laneScale(b.lane, lay.k);
      const ppl = lay.ppm * ls;
      const q = (ppl * B) / GATE_PX_PER_M;
      b.lod = this.pickLod(this.frame, q, b.lod);
      const fl = this.frame.lods.find((l) => l.s === b.lod) ?? this.frame.lods[0]!;
      // Coarsest LOD a part has at or below the bay's (thin parts stop at 2:1).
      const near = (p: Part) => p.lods.reduce((a, l) => (l.s <= b.lod && l.s > a.s ? l : a), p.lods[0]!);
      const pl = near(this.post);
      const dl = near(this.door);
      const k = q * fl.s; // buffer px per LOD texel
      // Front-door plane through the runner squeeze (same mapping as the props).
      const sx = (lay.W / 2 + (squeezeX(lay, lay.W / 2 + (b.x - lay.cx) * lay.ppm) - lay.W / 2) * ls) * B;
      const feet = laneY(lay, b.lane) * B;
      const frameW = Math.round(fl.w * k);
      // Door plane in LOD texels from the left edge (k is already buffer px per LOD texel).
      const frameX = Math.round(sx - PLANE_FRAC * fl.w * k);
      if (frameX > Wb + 8 || frameX + frameW < -8) {
        b.frame.visible = b.post.visible = b.door.visible = false;
        continue;
      }
      const bind = (mesh: THREE.Mesh, l: LodLevel, order: number) => {
        if (mesh.material !== l.mat) mesh.material = l.mat;
        mesh.renderOrder = order;
      };
      bind(b.frame, fl, depthBase + di - 0.5);
      bind(b.post, pl, depthBase + di + 0.005);
      bind(b.door, dl, depthBase + di + 0.011);
      host.place(b.frame, frameX, Math.round(feet - fl.h * k), frameW, Math.round(fl.h * k));
      // Front post: its right edge sits at the door plane; bottom on the ground.
      // Small parts may lack the coarse LODs (lods[0] fallback), so scale each by its own s.
      const kp = q * pl.s;
      const kd = q * dl.s;
      host.place(b.post, Math.round(sx - pl.w * kp), Math.round(feet - pl.h * kp), Math.round(pl.w * kp), Math.round(pl.h * kp));
      // Front gate: hinge at the plane; swings out to an edge-on sliver at the off.
      host.place(b.door, Math.round(sx), Math.round(feet - dl.h * kd), Math.round(dl.w * kd * doorK), Math.round(dl.h * kd));
    }
  }
}

/**
 * Camera framing and sprite level-of-detail for the diorama (pure, no DOM). Shared by the
 * engine and the poster <img>, so the static poster sits exactly where the canvas will draw.
 */
import { DIORAMA_ATLAS } from "./atlas.generated";
import type { AnimItem, SceneDef } from "./scenes";

/** Art px of bake margin on each side of a non-repeating layer. */
export const MARGIN = 96;

const ANIMS = DIORAMA_ATLAS.anims as Record<string, { fw: number; fh: number; frames: number; fps: number }>;
const lodBase = (src: string) => src.replace(/^.*\//, "").replace(/\.png$/, "").replace(/-s\d$/, "");
/** The strip to draw for an LOD item at scene detail factor f (null = no such copy: hide it). */
export function lodStrip(a: AnimItem, f: number, viewH = Infinity): { src: string; fw: number; fh: number; frames: number; r: number } | null {
  // lodMax sprites keep their size and simply leave a band too short to hold them
  if (a.lodMax !== undefined && a.fh > viewH * 0.9) return null;
  if (!a.lod || f === 1 || a.lodMax !== undefined) return { src: a.src, fw: a.fw, fh: a.fh, frames: a.frames, r: 1 };
  const n = a.lod * f;
  const name = `${lodBase(a.src)}-s${n}`;
  const at = ANIMS[name];
  if (!at) return null;
  return { src: `diorama/${name}.png`, fw: at.fw, fh: at.fh, frames: at.frames, r: f };
}

export interface Frame {
  /** device px per art px, split into k (backing px per art px) * m (CSS upscale). */
  s: number;
  k: number;
  m: number;
  bw: number;
  bh: number;
  viewW: number;
  viewH: number;
  vx: number;
  vy: number;
  /** LOD factor for sprites marked `lod` (1 = full size). */
  f: number;
}

/** Pure camera framing for a box (shared by the engine and the poster <img>). */
export function computeFrame(scene: SceneDef, cssW: number, cssH: number, dpr: number, quality: "high" | "low" = "high"): Frame {
  const devW = Math.max(1, Math.round(cssW * dpr));
  const devH = Math.max(1, Math.round(cssH * dpr));
  // device px per art px: aim for ~720 art px across, at most ~480 tall, at least 360 wide,
  // and at least ~140 tall when the world is wide enough to allow a smaller scale
  let s = Math.max(1, Math.round(devW / 720));
  while (devH / s > 480 && devW / (s + 1) >= 360) s++;
  while (s > 1 && devH / s < 140 && devW / (s - 1) <= scene.width + MARGIN * 2 - 8) s--;
  // split s = k * m, keeping the backing store small
  let m = 1;
  const budget = quality === "high" ? 1.6e6 : 0.5e6;
  for (const cand of [1, 2, 3, 4, 6]) {
    if (s % cand) continue;
    m = cand;
    if ((devW / cand) * (devH / cand) <= budget) break;
  }
  if (quality === "low") m = s; // backing = art resolution
  const k = s / m;
  const bw = Math.round(devW / m);
  const bh = Math.round(devH / m);
  const viewW = bw / k;
  const viewH = bh / k;
  const W = scene.width;
  const vx = W <= viewW ? (W - viewW) / 2 : Math.min(Math.max(scene.focusX - viewW / 2, 0), W - viewW);
  // LOD: the biggest scalable sprite must fit in ~68 % of the view height (headroom above it)
  let maxH = 0;
  const lods: AnimItem[] = [];
  const visit = (a: AnimItem) => {
    if (a.lod) lods.push(a);
    if (a.lod && a.lodMax === undefined) maxH = Math.max(maxH, a.fh);
    a.with?.forEach(visit);
  };
  scene.layers.forEach((l) => l.anims?.forEach(visit));
  let f = 1;
  while (f < 4 && maxH / f > viewH * 0.68) f++;
  // keep the focal ground line (feet) in view, but only while a scalable sprite is shown there
  let vy = Math.min(scene.height - viewH, scene.focusY - viewH * 0.5);
  const grounded = lods.some((a) => lodStrip(a, f, viewH));
  if (scene.groundY !== undefined && grounded) vy = Math.min(scene.height - viewH, Math.max(vy, scene.groundY + 6 - viewH));
  return { s, k, m, bw, bh, viewW, viewH, vx, vy, f };
}

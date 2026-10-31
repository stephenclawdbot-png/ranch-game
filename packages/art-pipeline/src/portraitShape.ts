/**
 * Head shapes for the genetic 3/4 portrait (graphics round 2), pure: one painted head becomes a
 * breed's head (a dished Arabian, a Roman-nosed Andalusian, a heavy-jawed Quarter Horse, a
 * Marwari's curled ears...) and, while the horse is young, a foal's or a yearling's head
 * (short muzzle, big eye, short mane, no bridle for a foal). It is a geometric warp of the
 * painting, built from the role map: every output pixel points at the still pixel it shows, so
 * the gene recolour, markings and patterns (portrait34.ts) run unchanged through it, and the
 * idle loop's frames are reshaped the same way. Deterministic: the same appearance always gives
 * the same pixels.
 */
import type { HorseAppearance } from "@thoroughbred/shared";
import { PORTRAIT_ART_SIZE, PORTRAIT_ROLES, portraitNoise } from "./portrait34";

/** Bump when shapes change (it is part of the portrait cache key). */
export const PORTRAIT_SHAPE_VERSION = 1;

export interface HeadShape {
  /** Whole head and neck, about the base of the neck (1 = as painted). */
  scale: number;
  /** Eye-to-nose length (1 = as painted; < 1 shorter). */
  muzzle: number;
  /** Width of the lower face across the eye-to-nose line (jaw and muzzle depth). */
  jaw: number;
  /** Profile: > 0 dished (concave), < 0 Roman (convex), px at mid-face. */
  dish: number;
  /** Eye size (radial). */
  eye: number;
  /** Ear length, and inward curl of the tips (Marwari), px. */
  ears: number;
  curl: number;
  /** Neck thickness behind the jaw. */
  neck: number;
  /** Foal: mane cut to a short brush; no tack. */
  foal: boolean;
  /** Yearling: mane shortened a little. */
  yearling: boolean;
}

const BASE: HeadShape = { scale: 1, muzzle: 1, jaw: 1, dish: 0, eye: 1, ears: 1, curl: 0, neck: 1, foal: false, yearling: false };

/** Each breed's head (game-core BREEDS), from the painted Thoroughbred. */
export const BREED_HEADS: Record<string, Partial<HeadShape>> = {
  thoroughbred: {},
  arabian: { scale: 0.95, muzzle: 0.84, dish: 3, eye: 1.14, ears: 0.88, neck: 0.95 },
  quarterHorse: { muzzle: 0.88, jaw: 1.12, ears: 0.88, neck: 1.1 },
  akhalTeke: { scale: 0.95, muzzle: 1.1, jaw: 0.9, eye: 1.06, ears: 1.12, neck: 0.88 },
  standardbred: { muzzle: 1.06, jaw: 1.04, dish: -1.6, ears: 1.04, neck: 1.04 },
  appaloosa: { muzzle: 0.96, jaw: 1.05, eye: 0.96, ears: 0.92 },
  paintHorse: { muzzle: 0.9, jaw: 1.09, ears: 0.9, neck: 1.08 },
  mustang: { scale: 0.94, muzzle: 0.94, jaw: 1.02, dish: -0.8, ears: 0.9 },
  andalusian: { muzzle: 1.02, jaw: 1.03, dish: -2.8, eye: 1.04, neck: 1.14 },
  friesian: { scale: 1.03, muzzle: 1.04, jaw: 1.06, dish: -1.6, ears: 1.1, neck: 1.18 },
  warmblood: { scale: 1.04, muzzle: 1.06, jaw: 1.07, ears: 1.02, neck: 1.1 },
  marwari: { muzzle: 0.96, dish: 1.2, eye: 1.04, ears: 1.22, curl: 3, neck: 0.98 },
};

/** The head to draw for an appearance: its breed's, made young while it is, nudged per horse. */
export function headShapeOf(a: Pick<HorseAppearance, "head" | "age" | "colour" | "face" | "coat">): HeadShape {
  const s: HeadShape = { ...BASE, ...(BREED_HEADS[a.head ?? "thoroughbred"] ?? {}) };
  // a little per-horse variety (from the genes, so stable): two of the same breed differ too
  const key = JSON.stringify([a.colour ?? a.coat, a.face]);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const r = (k: number) => (portraitNoise((h >>> 0) % 4093, k) - 0.5) * 2;
  s.muzzle *= 1 + 0.04 * r(1);
  s.ears *= 1 + 0.06 * r(2);
  s.jaw *= 1 + 0.03 * r(3);
  if (a.age === "foal") Object.assign(s, { scale: s.scale * 0.9, muzzle: s.muzzle * 0.76, jaw: s.jaw * 0.92, eye: s.eye * 1.3, ears: s.ears * 1.05, neck: s.neck * 0.82, dish: s.dish * 0.5, foal: true });
  else if (a.age === "yearling") Object.assign(s, { scale: s.scale * 0.9, muzzle: s.muzzle * 0.88, eye: s.eye * 1.12, neck: s.neck * 0.92, yearling: true });
  return s;
}

/** True when the shape is the painting as it is (no warp needed). */
export function isPaintedShape(s: HeadShape): boolean {
  return s.scale === 1 && s.muzzle === 1 && s.jaw === 1 && s.dish === 0 && s.eye === 1 && s.ears === 1 && s.curl === 0 && s.neck === 1 && !s.foal && !s.yearling;
}

export interface HeadAnchors {
  eye: [number, number];
  nose: [number, number];
  /** Base of the ears (top of the poll). */
  poll: [number, number];
  /** Base of the neck (the scale's fixed point). */
  base: [number, number];
}

/** Landmarks read from roles.png (RGBA, 128 x 128). */
export function headAnchors(roles: ArrayLike<number>): HeadAnchors {
  const S = PORTRAIT_ART_SIZE;
  let ex = 0, ey = 0, en = 0;
  let nx = S, nyS = 0, nyN = 0;
  let top = S;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const role = Math.round(roles[(y * S + x) * 4]! / 28);
      if (role === PORTRAIT_ROLES.clear) continue;
      if (y < top) top = y;
      if (role === PORTRAIT_ROLES.eye) {
        ex += x;
        ey += y;
        en++;
      }
      if (role === PORTRAIT_ROLES.muzzle) {
        if (x < nx) {
          nx = x;
          nyS = y;
          nyN = 1;
        } else if (x === nx) {
          nyS += y;
          nyN++;
        }
      }
    }
  const eye: [number, number] = en ? [ex / en, ey / en] : [53, 48];
  const nose: [number, number] = nyN ? [nx, nyS / nyN] : [20, 88];
  return { eye, nose, poll: [eye[0] - 10, Math.max(top + 14, eye[1] - 20)], base: [104, S - 1] };
}

/**
 * The warp: for each output pixel (row-major, 128 x 128) the still pixel it shows (y * 128 + x),
 * or -1 (empty). Built as the inverse of the deformations, applied in reverse order.
 */
export function headWarp(shape: HeadShape, roles: ArrayLike<number>, anchors: HeadAnchors = headAnchors(roles)): Int32Array {
  const S = PORTRAIT_ART_SIZE;
  const out = new Int32Array(S * S).fill(-1);
  const roleAt = (x: number, y: number) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : Math.round(roles[(y * S + x) * 4]! / 28));
  const [ex, ey] = anchors.eye;
  const [nx, ny] = anchors.nose;
  const dx = nx - ex;
  const dy = ny - ey;
  const dd = dx * dx + dy * dy;
  const len = Math.sqrt(dd);
  // unit normal of the eye->nose line, pointing into the head (away from the front profile)
  let nnx = -dy / len;
  let nny = dx / len;
  if (nnx < 0) {
    nnx = -nnx;
    nny = -nny;
  }
  const [bx, by] = anchors.base;
  const [px, py] = anchors.poll;
  const eyeR = 9;
  for (let oy = 0; oy < S; oy++) {
    for (let ox = 0; ox < S; ox++) {
      // 1. whole head scale about the neck base
      let x = bx + (ox + 0.5 - bx) / shape.scale;
      let y = by + (oy + 0.5 - by) / shape.scale;
      // 2. neck thickness behind the jaw (right of the eye, below the poll)
      if (x > ex + 14) x = ex + 14 + (x - ex - 14) / shape.neck;
      // 3. ears: length about the poll, tips curled inward
      if (y < py) {
        const t = (py - y) / Math.max(1, py);
        y = py - (py - y) / shape.ears;
        x += shape.curl * t * t * (x < px ? 1 : -1);
      }
      // 4. muzzle length and jaw depth along the eye->nose line
      const u = ((x - ex) * dx + (y - ey) * dy) / dd;
      if (u > 0) {
        const v = ((x - ex) * nnx + (y - ey) * nny);
        const us = u / shape.muzzle;
        const w = Math.min(1, u * 2);
        const vs = v / (1 + (shape.jaw - 1) * w);
        // 5. the profile: dished (concave) or Roman (convex), strongest mid-face
        const bump = Math.sin(Math.PI * Math.min(1, Math.max(0, us))) * shape.dish;
        x = ex + dx * us + nnx * (vs - bump * (v < 0 ? 1 : 0.4));
        y = ey + dy * us + nny * (vs - bump * (v < 0 ? 1 : 0.4));
      }
      // 6. the eye, magnified about its centre
      const er = Math.hypot(x - ex, y - ey);
      if (shape.eye !== 1 && er < eyeR) {
        const k = 1 / shape.eye;
        const f = er / eyeR;
        const m = k + (1 - k) * f * f;
        x = ex + (x - ex) * m;
        y = ey + (y - ey) * m;
      }
      const sx = Math.floor(x);
      const sy = Math.floor(y);
      if (sx < 0 || sy < 0 || sx >= S || sy >= S || roleAt(sx, sy) === PORTRAIT_ROLES.clear) continue;
      out[oy * S + ox] = sy * S + sx;
    }
  }
  if (shape.foal || shape.yearling) youngHead(out, roles, shape, anchors);
  return out;
}

/** Foal: no tack (strap pixels show the coat next to them), mane cut to a brush, outlined again. Yearling: mane a little shorter. */
function youngHead(out: Int32Array, roles: ArrayLike<number>, shape: HeadShape, anchors: HeadAnchors): void {
  const S = PORTRAIT_ART_SIZE;
  const R = PORTRAIT_ROLES;
  const role = (p: number) => Math.round(roles[p * 4]! / 28);
  // nearest coat pixel of every still pixel (multi-source BFS), for the straps
  const near = new Int32Array(S * S).fill(-1);
  const q = new Int32Array(S * S);
  let h = 0, t = 0;
  for (let p = 0; p < S * S; p++)
    if (role(p) === R.coat) {
      near[p] = p;
      q[t++] = p;
    }
  while (h < t) {
    const p = q[h++]!;
    const x = p % S;
    const y = (p / S) | 0;
    for (const n of [x > 0 ? p - 1 : -1, x < S - 1 ? p + 1 : -1, y > 0 ? p - S : -1, y < S - 1 ? p + S : -1]) {
      if (n < 0 || near[n] !== -1) continue;
      near[n] = near[p]!;
      q[t++] = n;
    }
  }
  // mane depth: distance (px) from the nearest non-mane opaque pixel, in output space
  const reach = shape.foal ? 4 : 9;
  const isMane = (o: number) => out[o]! >= 0 && role(out[o]!) === R.mane;
  const depth = new Int32Array(S * S).fill(-1);
  h = t = 0;
  for (let o = 0; o < S * S; o++)
    if (out[o]! >= 0 && !isMane(o)) {
      depth[o] = 0;
      q[t++] = o;
    }
  while (h < t) {
    const o = q[h++]!;
    const x = o % S;
    const y = (o / S) | 0;
    for (const n of [x > 0 ? o - 1 : -1, x < S - 1 ? o + 1 : -1, y > 0 ? o - S : -1, y < S - 1 ? o + S : -1]) {
      if (n < 0 || depth[n] !== -1 || !isMane(n)) continue;
      depth[n] = depth[o]! + 1;
      q[t++] = n;
    }
  }
  let ink = -1;
  for (let p = 0; p < S * S && ink < 0; p++) if (role(p) === R.ink) ink = p;
  // the strap lines are drawn in ink too: interior ink (coat on both sides, away from the eye,
  // the nostril and the mouth) is tack, not outline
  const opaque = (p: number) => role(p) !== R.clear;
  const strap = (p: number) => {
    if (role(p) !== R.ink) return false;
    const x = p % S;
    const y = (p / S) | 0;
    if (Math.hypot(x - anchors.eye[0], y - anchors.eye[1]) < 9 || Math.hypot(x - anchors.nose[0], y - anchors.nose[1]) < 12) return false;
    for (const n of [p - 1, p + 1, p - S, p + S, p - S - 1, p - S + 1, p + S - 1, p + S + 1]) if (n < 0 || n >= S * S || !opaque(n)) return false;
    return true;
  };
  const cut = new Uint8Array(S * S);
  for (let o = 0; o < S * S; o++) {
    const s = out[o]!;
    if (s < 0) continue;
    if (shape.foal && (role(s) === R.leather || role(s) === R.metal || strap(s)) && near[s]! >= 0) out[o] = near[s]!;
    // mane hanging beyond the brush: gone, but a ragged tuft or two stays
    if (isMane(o) && depth[o]! > reach + (portraitNoise(o % S, 7) > 0.8 ? 2 : 0)) {
      out[o] = -1;
      cut[o] = 1;
    }
  }
  // the new edge gets the painting's outline ink
  if (ink >= 0)
    for (let o = 0; o < S * S; o++) {
      if (out[o]! < 0) continue;
      const x = o % S;
      const y = (o / S) | 0;
      if ((x > 0 && cut[o - 1]) || (x < S - 1 && cut[o + 1]) || (y > 0 && cut[o - S]) || (y < S - 1 && cut[o + S])) out[o] = ink;
    }
}

/**
 * Reshape a painted strip (frames side by side) and its warp through a head warp: each output
 * pixel shows the strip pixel at its source position, and its warp entry is the source's (or,
 * for a still with no warp, the source position itself), so portrait34's recolour reads roles,
 * marks and patterns at the right place. Returns new arrays.
 */
export function reshapePortrait(pixels: ArrayLike<number>, frames: number, warp: ArrayLike<number> | null, map: Int32Array): { pixels: Uint8ClampedArray; warp: Uint8ClampedArray } {
  const S = PORTRAIT_ART_SIZE;
  const W = S * frames;
  const px = new Uint8ClampedArray(W * S * 4);
  const wp = new Uint8ClampedArray(W * S * 4);
  for (let f = 0; f < frames; f++) {
    for (let o = 0; o < S * S; o++) {
      const s = map[o]!;
      if (s < 0) continue;
      const si = (((s / S) | 0) * W + f * S + (s % S)) * 4;
      const oi = (((o / S) | 0) * W + f * S + (o % S)) * 4;
      if (pixels[si + 3]! === 0) continue;
      px[oi] = pixels[si]!;
      px[oi + 1] = pixels[si + 1]!;
      px[oi + 2] = pixels[si + 2]!;
      px[oi + 3] = pixels[si + 3]!;
      if (warp) {
        wp[oi] = warp[si]!;
        wp[oi + 1] = warp[si + 1]!;
        wp[oi + 2] = warp[si + 2]!;
      } else {
        wp[oi] = s % S;
        wp[oi + 1] = (s / S) | 0;
        wp[oi + 2] = 255;
      }
      wp[oi + 3] = 255;
    }
  }
  return { pixels: px, warp: wp };
}

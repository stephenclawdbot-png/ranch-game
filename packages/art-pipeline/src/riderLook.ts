/**
 * Rider looks (graphics round 2), pure: the silks patterns every rider picture shares, and the
 * per-jockey skin, hair and cap pattern painted onto keyed rider sprites (race strips, the
 * paddock and post-parade dioramas), so a jockey on a horse looks like their portrait: same
 * silks pattern, same cap, same skin, a hair cue under the cap.
 *
 * Rider sprites draw the face with the horse's coat keys (and a few fixed skin keys), so the
 * face is found geometrically on the KEYED source, before the per-horse recolour: the small
 * coat/mane/skin-keyed patches right under and in front of the cap (the horse's own coat is one
 * big region and never qualifies). `prepareRider` records them with a shade level; after the
 * recolour, `paintRiderLook` repaints them from the jockey's skin ramp and adds the hair.
 */
import type { SilkPattern } from "@thoroughbred/shared";

type RGB = [number, number, number];

export function hexRgb(h: string): RGB {
  const n = Number.parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const packRgb = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;

/** Resample dark->light stops to n colours (linear in sRGB, whole numbers). */
export function rampRgb(stops: readonly string[], n: number): RGB[] {
  const c = stops.map(hexRgb);
  if (n <= 0) return [];
  if (c.length === 1 || n === 1) return Array.from({ length: n }, (_, i) => c[Math.min(i, c.length - 1)]!);
  const out: RGB[] = [];
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * (c.length - 1);
    const k = Math.min(Math.floor(f), c.length - 2);
    const t = f - k;
    out.push([0, 1, 2].map((j) => Math.round(c[k]![j]! + (c[k + 1]![j]! - c[k]![j]!) * t)) as RGB);
  }
  return out;
}

const STAR_CENTRES: [number, number][] = [
  [6, 4], [10, 5], [5, 9], [9, 9], [2, 3], [13, 3],
];

/**
 * The silks pattern on the 16x13 jersey grid (components/Silks.tsx draws the stable's silks with
 * it; the bust maps its jacket onto the same grid, so a portrait wears what the silks icon shows).
 */
export function jerseyPatternAt(pattern: SilkPattern | string, x: number, y: number): boolean {
  switch (pattern) {
    case "hoops":
      return y >= 2 && (y - 2) % 4 >= 2;
    case "stripes":
      return x % 3 === 2;
    case "chevron":
      return Math.floor(y + Math.abs(x - 7.5)) % 5 < 2;
    case "diamonds":
      return (Math.floor((x + y) / 3) + Math.floor((x - y + 30) / 3)) % 2 === 0;
    case "sash":
      return Math.abs(x - (3 + y * 0.72)) < 1.4;
    case "quartered":
      return x >= 8 !== y >= 7;
    case "stars":
      return STAR_CENTRES.some(([cx, cy]) => Math.abs(x - cx) + Math.abs(y - cy) <= 1);
    default:
      return false;
  }
}

/**
 * The cap's pattern in the secondary colour, at (u, v) in [0,1]^2 of the cap's box: hooped,
 * striped, quartered, a star or diamonds to match the jacket; sash and chevron silks keep a
 * plain cap (as real racing caps do). The bust and every rider sprite use this one rule.
 */
export function capPatternAt(pattern: SilkPattern | string, u: number, v: number): boolean {
  switch (pattern) {
    case "hoops":
      return (v > 0.3 && v < 0.5) || (v > 0.7 && v < 0.88);
    case "stripes":
      return Math.floor(u * 6) % 2 === 1;
    case "quartered":
      return u < 0.5 !== v < 0.55;
    case "diamonds":
      return (Math.floor(u * 6) + Math.floor(v * 4)) % 2 === 0;
    case "stars":
      return Math.abs(u - 0.5) * 6 + Math.abs(v - 0.45) * 5 < 1;
    default:
      return false;
  }
}

export interface RiderKeys {
  /** Packed cap key colours. */
  cap: readonly number[];
  /** Packed key colours a rider's face may be drawn with (coat, mane, fixed skin). */
  face: readonly number[];
  /** The sprite's own skin keys (dark -> light): their shade is their place in that ramp. */
  skin?: readonly number[];
}

/** Shade level of the sprite's own skin key i of n: the shadow, the base tones, the highlight. */
export const skinKeyLevel = (i: number, n: number): number => (i === 0 ? 1 : i === n - 1 ? 3 : 2);

export interface RiderPrep {
  /** Per pixel: 0 = not the rider's face, 1..4 = face, skin shade level + 1 (dark -> light). */
  levels: Uint8Array;
  /** Per frame: the cap's box [x0, y0, x1, y1] (strip coordinates), or null. */
  caps: ([number, number, number, number] | null)[];
}

/**
 * Skin shade (0..3, dark -> light) of a rider-face key by its luma: the faces are drawn mostly in
 * the mid coat keys, which should land on the skin's base, so the bands are absolute (a rank
 * over the whole key set would push faces to the light end).
 */
export function riderSkinLevel(luma: number): number {
  return luma < 40 ? 0 : luma < 90 ? 1 : luma < 150 ? 2 : 3;
}

const lum = (c: number) => 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);

/**
 * Find each frame's rider face on the KEYED source strip: coat / mane / skin keyed pixels in a
 * window under and in front of the cap, in small 4-connected patches that don't run out of the
 * window (the horse's neck and head always do).
 */
export function prepareRider(src: ArrayLike<number>, width: number, height: number, frameWidth: number, keys: RiderKeys): RiderPrep {
  const capSet = new Set(keys.cap);
  const faceSet = new Set(keys.face);
  const levels = new Uint8Array(width * height);
  const caps: RiderPrep["caps"] = [];
  const frames = Math.max(1, Math.floor(width / frameWidth));
  const skinKeys = keys.skin ?? [];
  const levelOf = (c: number) => {
    const k = skinKeys.indexOf(c);
    return k >= 0 ? skinKeyLevel(k, skinKeys.length) : riderSkinLevel(lum(c));
  };
  for (let f = 0; f < frames; f++) {
    const fx = f * frameWidth;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = fx; x < fx + frameWidth; x++) {
        const i = (y * width + x) * 4;
        if (src[i + 3]! < 8) continue;
        if (capSet.has(packRgb(src[i]!, src[i + 1]!, src[i + 2]!))) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) {
      caps.push(null);
      continue;
    }
    caps.push([x0, y0, x1, y1]);
    const capW = x1 - x0 + 1;
    const wx0 = Math.max(fx, x0 - 2);
    const wx1 = Math.min(fx + frameWidth - 1, x1 + Math.max(4, Math.round(capW * 0.35)));
    const wy0 = y0;
    const wy1 = Math.min(height - 1, y1 + Math.max(8, Math.round(capW * 0.9)));
    const inWin = (x: number, y: number) => x >= wx0 && x <= wx1 && y >= wy0 && y <= wy1;
    const cand = (x: number, y: number) => {
      if (!inWin(x, y)) return false;
      const i = (y * width + x) * 4;
      return src[i + 3]! >= 8 && faceSet.has(packRgb(src[i]!, src[i + 1]!, src[i + 2]!));
    };
    const seen = new Uint8Array((wx1 - wx0 + 1) * (wy1 - wy0 + 1));
    const at = (x: number, y: number) => (y - wy0) * (wx1 - wx0 + 1) + (x - wx0);
    const maxPatch = Math.max(40, capW * 6);
    for (let y = wy0; y <= wy1; y++) {
      for (let x = wx0; x <= wx1; x++) {
        if (seen[at(x, y)] || !cand(x, y)) continue;
        const patch: number[] = [];
        let edge = false;
        const stack = [x, y];
        seen[at(x, y)] = 1;
        while (stack.length) {
          const py = stack.pop()!;
          const px = stack.pop()!;
          patch.push(px, py);
          if (px === wx1 || py === wy1) edge = true;
          for (const [qx, qy] of [
            [px + 1, py],
            [px - 1, py],
            [px, py + 1],
            [px, py - 1],
          ] as const) {
            if (!inWin(qx, qy) || seen[at(qx, qy)] || !cand(qx, qy)) continue;
            seen[at(qx, qy)] = 1;
            stack.push(qx, qy);
          }
        }
        if (edge || patch.length / 2 > maxPatch) continue;
        for (let k = 0; k < patch.length; k += 2) {
          const i = patch[k + 1]! * width + patch[k]!;
          const c = packRgb(src[i * 4]!, src[i * 4 + 1]!, src[i * 4 + 2]!);
          levels[i] = levelOf(c) + 1;
        }
      }
    }
  }
  return { levels, caps };
}

export interface RiderLookColours {
  skin: readonly string[];
  hair: readonly string[];
  long?: boolean;
}

export interface RiderPaintOptions {
  /** The strip faces left (a mirrored strip): the back of the head is on the right. */
  facingLeft?: boolean;
}

/**
 * After the per-horse recolour: paint the face from the jockey's skin ramp, and the hair cue
 * (a nape line under the back of the cap; a ponytail for long hair). Riders face right.
 */
export function paintRiderLook(data: Uint8ClampedArray, width: number, height: number, frameWidth: number, prep: RiderPrep, look: RiderLookColours, opts: RiderPaintOptions = {}): void {
  const skin = rampRgb(look.skin, 4);
  const hair = rampRgb(look.hair, 3);
  const set = (x: number, y: number, c: RGB) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = 255;
  };
  for (let p = 0; p < prep.levels.length; p++) {
    const l = prep.levels[p]!;
    if (!l) continue;
    const c = skin[l - 1]!;
    data[p * 4] = c[0];
    data[p * 4 + 1] = c[1];
    data[p * 4 + 2] = c[2];
  }
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3]! >= 8;
  prep.caps.forEach((cap, f) => {
    if (!cap) return;
    const [x0, , x1, y1] = cap;
    const fx0 = f * frameWidth;
    const fx1 = fx0 + frameWidth - 1;
    const dir = opts.facingLeft ? -1 : 1;
    // the back of the cap: its rear column (left when facing right)
    const back = opts.facingLeft ? Math.min(fx1, x1) : Math.max(fx0, x0);
    // nape: hair just under the back edge of the cap, over the face or neck pixels there
    for (let k = 0; k <= Math.min(2, x1 - x0); k++) {
      const x = back + k * dir;
      if (opaque(x, y1 + 1) && prep.levels[(y1 + 1) * width + x]) set(x, y1 + 1, hair[k === 0 ? 0 : 1]!);
    }
    if (look.long) {
      // a ponytail falling from the back of the cap, behind the rider
      const tail: [number, number, number][] = [
        [back - 1, y1 - 1, 1],
        [back - 1, y1, 1],
        [back - 2, y1 + 1, 2],
        [back - 2, y1 + 2, 1],
        [back - 3, y1 + 3, 0],
        [back - 1, y1 + 1, 0],
      ];
      for (const [x, y, k] of tail) {
        const tx = back + (x - back) * dir;
        if (tx >= fx0 && tx <= fx1) set(tx, y, hair[k]!);
      }
    }
  });
}

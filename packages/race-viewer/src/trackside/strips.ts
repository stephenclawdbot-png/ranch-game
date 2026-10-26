/**
 * Indexed horse strips for the Trackside view (pure array code; no DOM).
 *
 * The keyed PixelLab strips (race/horse-gallop.png, race/horse-idle.png) are converted ONCE
 * to palette-index textures (one byte per texel) shared by every horse. Per-horse coat and
 * silks colours live in a small lookup table (one row per runner), so twelve runners cost
 * twelve LUT rows instead of twelve recoloured strips. Smaller levels of detail are exact
 * s:1 downsamples that keep palette indices (block mode, darkest wins ties), so a far or
 * zoomed-out horse is still hard-edged palette art, never a resampled blur.
 */
import type { HorseAppearance } from "@thoroughbred/shared";
import { buildRecolorPlan, type KeyPalette } from "../three/recolor";

/** LUT width: [0, 64) base colour per index, [64, 128) silks-pattern colour per index. */
export const LUT_W = 128;
export const MAX_COLOURS = 63;
/** Silks pattern ids (shader). */
export const PATTERN_ID: Record<string, number> = { solid: 0, hoops: 1, stripes: 2, quartered: 3, sash: 4, chevron: 5, diamonds: 6, stars: 7 };

export interface Palette {
  /** packed rgb per index; index 0 = transparent. */
  colours: number[];
  lookup: Map<number, number>;
  /** Rec.601 luma per index (tie-breaks: darker wins, keeps outlines). */
  luma: number[];
}

export function newPalette(): Palette {
  return { colours: [0], lookup: new Map(), luma: [0] };
}

/** Index of a colour, adding it (returns -1 when the palette is full). */
function indexOf(p: Palette, packed: number): number {
  let i = p.lookup.get(packed);
  if (i !== undefined) return i;
  if (p.colours.length > MAX_COLOURS) return -1;
  i = p.colours.length;
  p.colours.push(packed);
  p.lookup.set(packed, i);
  p.luma.push(((packed >> 16) & 255) * 0.299 + ((packed >> 8) & 255) * 0.587 + (packed & 255) * 0.114);
  return i;
}

export interface IndexedFrames {
  frames: number;
  fw: number;
  fh: number;
  /** Frame grid: columns per texture row. */
  cols: number;
  /** Texture size. */
  width: number;
  height: number;
  /** Palette index per texel (row-major, row 0 = top). */
  index: Uint8Array;
  /** Tangent-space normal per texel (RGBA) or null. */
  normal: Uint8Array | null;
  /** Ground anchor in this level's texels (frame-local). */
  anchor: { x: number; y: number };
  /** Source texels per texel of this level. */
  s: number;
}

/** Texel origin of frame f. */
export function frameOrigin(f: IndexedFrames, i: number): [number, number] {
  return [(i % f.cols) * f.fw, Math.floor(i / f.cols) * f.fh];
}

function gridFor(frames: number, fw: number, fh: number, maxW: number) {
  const cols = Math.max(1, Math.min(frames, Math.floor(maxW / fw)));
  const rows = Math.ceil(frames / cols);
  return { cols, width: cols * fw, height: rows * fh };
}

/**
 * Index a horizontal RGBA strip (frames side by side). Opaque texels (alpha >= 128) take a
 * palette index; returns null when the strip has more colours than the LUT holds.
 */
export function indexStrip(
  rgba: Uint8ClampedArray | Uint8Array,
  stripW: number,
  fh: number,
  frames: number,
  palette: Palette,
  anchor: { x: number; y: number },
  normalRgba: Uint8ClampedArray | Uint8Array | null,
  maxW = 2048,
): IndexedFrames | null {
  const fw = Math.floor(stripW / frames);
  const g = gridFor(frames, fw, fh, maxW);
  const index = new Uint8Array(g.width * g.height);
  const normal = normalRgba ? new Uint8Array(g.width * g.height * 4) : null;
  for (let f = 0; f < frames; f++) {
    const ox = (f % g.cols) * fw;
    const oy = Math.floor(f / g.cols) * fh;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const si = (y * stripW + f * fw + x) * 4;
        const di = (oy + y) * g.width + ox + x;
        if (rgba[si + 3]! < 128) continue;
        const k = indexOf(palette, (rgba[si]! << 16) | (rgba[si + 1]! << 8) | rgba[si + 2]!);
        if (k < 0) return null;
        index[di] = k;
        if (normal && normalRgba) {
          normal[di * 4] = normalRgba[si]!;
          normal[di * 4 + 1] = normalRgba[si + 1]!;
          normal[di * 4 + 2] = normalRgba[si + 2]!;
          normal[di * 4 + 3] = 255;
        }
      }
    }
  }
  return { frames, fw, fh, cols: g.cols, width: g.width, height: g.height, index, normal, anchor: { ...anchor }, s: 1 };
}

/**
 * Exact s:1 downsample per frame. A block is opaque when >= 45 % of it is; its colour is the
 * most frequent index (ties: the darker colour), normals are averaged.
 */
export function downsampleFrames(src: IndexedFrames, s: number, palette: Palette, maxW = 2048): IndexedFrames {
  const fw = Math.ceil(src.fw / s);
  const fh = Math.ceil(src.fh / s);
  const g = gridFor(src.frames, fw, fh, maxW);
  const index = new Uint8Array(g.width * g.height);
  const normal = src.normal ? new Uint8Array(g.width * g.height * 4) : null;
  const counts = new Uint16Array(256);
  const seen: number[] = [];
  for (let f = 0; f < src.frames; f++) {
    const [sx0, sy0] = frameOrigin(src, f);
    const dx0 = (f % g.cols) * fw;
    const dy0 = Math.floor(f / g.cols) * fh;
    for (let by = 0; by < fh; by++) {
      for (let bx = 0; bx < fw; bx++) {
        let opaque = 0;
        let total = 0;
        let nx = 0;
        let ny = 0;
        let nz = 0;
        seen.length = 0;
        for (let yy = 0; yy < s; yy++) {
          const y = by * s + yy;
          if (y >= src.fh) continue;
          for (let xx = 0; xx < s; xx++) {
            const x = bx * s + xx;
            if (x >= src.fw) continue;
            total++;
            const si = (sy0 + y) * src.width + sx0 + x;
            const k = src.index[si]!;
            if (!k) continue;
            opaque++;
            if (counts[k] === 0) seen.push(k);
            counts[k]!++;
            if (src.normal) {
              nx += src.normal[si * 4]! / 127.5 - 1;
              ny += src.normal[si * 4 + 1]! / 127.5 - 1;
              nz += src.normal[si * 4 + 2]! / 127.5 - 1;
            }
          }
        }
        let best = 0;
        let bestN = 0;
        for (const k of seen) {
          const c = counts[k]!;
          if (c > bestN || (c === bestN && palette.luma[k]! < palette.luma[best]!)) {
            best = k;
            bestN = c;
          }
          counts[k] = 0;
        }
        if (!total || opaque / total < 0.45) continue;
        const di = (dy0 + by) * g.width + dx0 + bx;
        index[di] = best;
        if (normal) {
          const len = Math.hypot(nx, ny, nz) || 1;
          normal[di * 4] = Math.round((nx / len + 1) * 127.5);
          normal[di * 4 + 1] = Math.round((ny / len + 1) * 127.5);
          normal[di * 4 + 2] = Math.round((nz / len + 1) * 127.5);
          normal[di * 4 + 3] = 255;
        }
      }
    }
  }
  return { frames: src.frames, fw, fh, cols: g.cols, width: g.width, height: g.height, index, normal, anchor: { x: src.anchor.x / s, y: src.anchor.y / s }, s: src.s * s };
}

/** Per-frame bounding box (frame-local source texels: x0, y0, w, h) of the silks primary keys. */
export function silkBoxes(src: IndexedFrames, primary: Set<number>): Float32Array {
  const out = new Float32Array(src.frames * 4);
  for (let f = 0; f < src.frames; f++) {
    const [ox, oy] = frameOrigin(src, f);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let y = 0; y < src.fh; y++) {
      for (let x = 0; x < src.fw; x++) {
        if (!primary.has(src.index[(oy + y) * src.width + ox + x]!)) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 >= x0) out.set([x0, y0, x1 - x0 + 1, y1 - y0 + 1], f * 4);
    else out.set([0, 0, 1, 1], f * 4);
  }
  return out;
}

/** Palette indices of the silks primary keys. */
export function primaryIndices(palette: Palette, keys: KeyPalette): Set<number> {
  const set = new Set<number>();
  for (const h of keys.silksPrimary ?? []) {
    const i = palette.lookup.get(Number.parseInt(h.slice(1), 16));
    if (i !== undefined) set.add(i);
  }
  return set;
}

/**
 * Lookup table: one row per runner. Base colour = the recoloured key (coat, mane, points,
 * silks, cap) or the source colour for fixed roles; the pattern half holds the secondary
 * silks colour for primary keys (alpha 0 elsewhere).
 */
export function buildLut(palette: Palette, keys: KeyPalette, appearances: readonly HorseAppearance[]): Uint8Array {
  const rows = Math.max(1, appearances.length);
  const lut = new Uint8Array(LUT_W * rows * 4);
  appearances.forEach((a, row) => {
    const plan = buildRecolorPlan(keys, a);
    for (let i = 1; i < palette.colours.length; i++) {
      const src = palette.colours[i]!;
      const out = plan.map.get(src) ?? src;
      const o = (row * LUT_W + i) * 4;
      lut[o] = (out >> 16) & 255;
      lut[o + 1] = (out >> 8) & 255;
      lut[o + 2] = out & 255;
      lut[o + 3] = 255;
      const pi = plan.primaryIndex.get(src);
      if (pi !== undefined && plan.pattern !== "solid") {
        const sec = plan.secondaryRamp[pi] ?? out;
        const p = (row * LUT_W + 64 + i) * 4;
        lut[p] = (sec >> 16) & 255;
        lut[p + 1] = (sec >> 8) & 255;
        lut[p + 2] = sec & 255;
        lut[p + 3] = 255;
      }
    }
  });
  return lut;
}

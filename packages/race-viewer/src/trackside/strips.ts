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
import { rampRgb, resolveHorseColors, riderSkinLevel, skinKeyLevel } from "@thoroughbred/art-pipeline";
import { buildRecolorPlan, type KeyPalette } from "../three/recolor";

/** LUT width: [0, 64) base colour per index, [64, 128) silks-pattern colour per index,
 * 128 marking flags, 129 marking white, 130 dun stripe colour, 131..134 the rider's skin
 * (dark -> light), 135..137 the rider's hair, 138 rider flags, 139 spare. */
export const LUT_W = 140;
/** LUT columns of the rider's look (jockey looks): skin x4, hair x3, flags (R: has a look, G: long hair). */
export const LUT_SKIN_X = 131;
export const LUT_HAIR_X = 135;
export const LUT_RIDER_X = 138;
/** LUT column of the per-runner marking flags (R: leg levels packed 2 bits x4, G: face | coat pattern<<4). */
export const LUT_FLAG_X = 128;
/** LUT column of the marking paint colour (warm white, MARKING_WHITE in art-pipeline/palettes). */
export const LUT_WHITE_X = 129;
/** LUT column of the dun stripe colour (dorsal stripe / leg barring; alpha 0 = legacy darkening). */
export const LUT_STRIPE_X = 130;
export const MARKING_WHITE = 0xf3f0e8;
export const MAX_COLOURS = 63;
/** Silks pattern ids (shader). */
export const PATTERN_ID: Record<string, number> = { solid: 0, hoops: 1, stripes: 2, quartered: 3, sash: 4, chevron: 5, diamonds: 6, stars: 7 };

/** Leg marking levels (mask shader), indexed by LegMarking. */
export const LEG_LEVEL: Record<string, number> = { none: 0, coronet: 1, sock: 2, stocking: 3 };
/** Face marking ids (mask shader), indexed by FaceMarking. */
export const FACE_ID: Record<string, number> = { none: 0, star: 1, snip: 2, stripe: 3, blaze: 4, bald: 5 };
/** Coat pattern ids (mask shader), indexed by the coat texture in art-pipeline/palettes. */
export const COAT_PATTERN_ID: Record<string, number> = { none: 0, roan: 1, dapple: 2 };

/** Marking mask regions (mask R channel). */
export const MARK_REGION = { none: 0, frontNear: 1, frontFar: 2, hindNear: 3, hindFar: 4, face: 5, body: 6, riderFace: 7, riderHair: 8, cap: 9, womanTrim: 10, womanTexel: 11 } as const;

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
export function indexOf(p: Palette, packed: number): number {
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
 * Marking masks at a strip's level of detail 0 (one RGBA texel per source texel, same
 * frame grid):
 *   R = region (MARK_REGION: 0 none, 1/2 front legs near/far, 3/4 hind legs near/far,
 *       5 face, 6 body),
 *   G = within-region param (legs: 0 at the hoof .. 1 where the leg ducks under the body;
 *       face: 0 at the brow .. 1 at the nose; body: texels below the spine * 32 over the
 *       barrel columns only, 0 elsewhere — the dun dorsal stripe key),
 *   B = face only: horizontal distance to the profile edge in texels * 32 (blaze width),
 *   A = 255.
 *
 * Everything is derived from the strip itself, once, from the key-palette roles: horse
 * pixels are coat/points/mane indices. The face is the top run of the columns right of
 * the shoulder (its outline walks up to the ears); leg pixels are the bottom runs that
 * drop at least 8 texels below the median belly line, clustered by column into up to two
 * legs per pair (the bigger cluster reads as the near leg; when both legs overlap only the
 * near one can show, which matches how the art is drawn). Higher levels of detail sample
 * this same texture at source resolution, so markings stay registered to the animation.
 */
export function buildMarkMasks(src: IndexedFrames, palette: Palette, keys: KeyPalette): Uint8Array {
  const set = (ramp?: string[]) => {
    const s = new Set<number>();
    for (const h of ramp ?? []) {
      const i = palette.lookup.get(Number.parseInt(h.slice(1), 16));
      if (i !== undefined) s.add(i);
    }
    return s;
  };
  const isCoat = set(keys.coat);
  const isPoints = set(keys.points);
  const isMane = set(keys.mane);
  const isHorse = new Set<number>([...isCoat, ...isPoints, ...isMane]);
  const out = new Uint8Array(src.width * src.height * 4);
  const { fw, fh } = src;
  const idxAt = (f: [number, number], x: number, y: number) => src.index[(f[1] + y) * src.width + f[0] + x]!;
  const roleAt = (f: [number, number], x: number, y: number): number => {
    const k = idxAt(f, x, y);
    if (!k || !isHorse.has(k)) return 0;
    return isCoat.has(k) ? 1 : isPoints.has(k) ? 2 : 3; // 1 coat, 2 points (muzzle/lower leg), 3 mane
  };
  const paint = (f: [number, number], x: number, y: number, r: number, g: number, b: number) => {
    const o = ((f[1] + y) * src.width + f[0] + x) * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  };

  for (let fr = 0; fr < src.frames; fr++) {
    const f = frameOrigin(src, fr);
    // per-column runs of horse pixels (rows, gap break >= 3)
    const runs: [number, number][][] = [];
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < fw; x++) {
      const col: [number, number][] = [];
      let top = -1;
      let prev = -9;
      for (let y = 0; y < fh; y++) {
        if (!roleAt(f, x, y)) continue;
        if (top < 0 || y - prev >= 3) {
          if (top >= 0) col.push([top, prev]);
          top = y;
        }
        prev = y;
      }
      if (top >= 0) col.push([top, prev]);
      runs.push(col);
      if (col.length) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    if (x0 < 0 || x1 - x0 < 24) continue;
    const W = x1 - x0;
    const bots: number[] = [];
    const tops: number[] = [];
    for (let x = x0; x <= x1; x++) {
      const col = runs[x]!;
      if (!col.length) continue;
      bots.push(col[col.length - 1]![1]);
      if (x > x0 + W * 0.2 && x < x0 + W * 0.55) tops.push(col[0]![0]);
    }
    bots.sort((a, b) => a - b);
    tops.sort((a, b) => a - b);
    const belly = bots[Math.floor(bots.length / 2)]!;
    const back = tops.length ? tops[Math.floor(tops.length / 2)]! : 0;

    // ---- face: top run of the columns right of the shoulder -----------------
    const split = x0 + W * 0.55;
    const headish = (x: number) => {
      const r = runs[x]?.[0];
      return !!r && x > split && r[0] <= back + 4 && r[1] <= belly + 16;
    };
    let hx1 = -1;
    for (let x = fw - 1; x > split; x--) {
      if (headish(x)) {
        hx1 = x;
        break;
      }
    }
    const headCols: number[] = [];
    if (hx1 >= 0) {
      headCols.push(hx1);
      let gap = 0;
      for (let x = hx1 - 1; x > split + 4; x--) {
        if (!headish(x)) {
          if (++gap > 2) break;
          continue;
        }
        gap = 0;
        const r = runs[x]![0]!;
        if (r[1] > belly + 6) break; // connected mass reaches past the chin: chest, not face
        if (r[1] - r[0] >= 50 && hx1 - x >= 8) break; // into the neck: wide enough
        headCols.push(x);
      }
    }
    const hx0 = headCols.length ? headCols[headCols.length - 1]! : -1;
    let hy0 = fh;
    let hy1 = 0;
    for (const x of headCols) {
      const r = runs[x]![0]!;
      if (r[0] < hy0) hy0 = r[0];
      if (r[1] > hy1) hy1 = r[1];
    }
    if (hx0 >= 0 && hx1 - hx0 >= 10 && hy1 - hy0 >= 12) {
      const hh = hy1 - hy0;
      const yBrow = hy0 + hh * 0.28; // below the ears, at the poll
      const yNose = hy0 + hh * 0.94;
      // paintable rows per column: the head's own run, never a leg connected below
      const colBot = new Map<number, number>();
      for (const x of headCols) colBot.set(x, Math.min(runs[x]![0]![1], Math.round(belly + 16)));
      const inHead = (x: number, y: number) => roleAt(f, x, y) !== 0 && y <= colBot.get(x)!;
      for (let y = hy0; y <= hy1; y++) {
        // profile edge: rightmost head-run horse pixel of this row
        let edge = -1;
        for (const x of headCols) {
          if (inHead(x, y)) edge = Math.max(edge, x);
        }
        if (edge < 0) continue;
        const t = Math.min(1, Math.max(0, (y - yBrow) / Math.max(1, yNose - yBrow)));
        for (const x of headCols) {
          if (x > edge || !inHead(x, y)) continue;
          const role = roleAt(f, x, y);
          if (role !== 1 && role !== 2) continue; // paint over coat + muzzle, never mane/tack/ink
          paint(f, x, y, MARK_REGION.face, Math.round(t * 255), Math.min(255, (edge - x) * 32));
        }
      }
    }

    // ---- legs: bottom runs dropping well below the belly --------------------
    interface Leg {
      cols: number[];
      area: number;
      centre: number;
      near: boolean;
    }
    const legCols: { x: number }[] = [];
    for (let x = x0; x <= x1; x++) {
      const col = runs[x]!;
      if (!col.length) continue;
      const bot = col[col.length - 1]![1];
      if (bot < belly + 8) continue;
      // enough leg mass below the body line (the run may be broken by hoof gaps)
      let mass = 0;
      for (const [a, b] of col) mass += Math.max(0, b - Math.max(a, belly - 6) + 1);
      if (mass < 4) continue;
      legCols.push({ x });
    }
    const legs: Leg[] = [];
    for (const c of legCols) {
      const last = legs[legs.length - 1];
      if (last && c.x - last.cols[last.cols.length - 1]! <= 3) last.cols.push(c.x);
      else legs.push({ cols: [c.x], area: 0, centre: c.x, near: false });
    }
    // split clusters that straddle the fore/hind split line
    const grouped: Leg[] = [];
    for (const l of legs) {
      l.centre = (l.cols[0]! + l.cols[l.cols.length - 1]!) / 2;
      if (l.cols[0]! < split && l.cols[l.cols.length - 1]! > split) {
        const lo = l.cols.filter((x) => x < split);
        const hi = l.cols.filter((x) => x >= split);
        if (lo.length && hi.length) {
          grouped.push({ cols: lo, area: 0, centre: (lo[0]! + lo[lo.length - 1]!) / 2, near: false }, { cols: hi, area: 0, centre: (hi[0]! + hi[hi.length - 1]!) / 2, near: false });
          continue;
        }
      }
      grouped.push(l);
    }
    const assign = (group: Leg[]) => {
      group.sort((a, b) => b.area - a.area);
      group.forEach((l, i) => (l.near = i === 0));
    };
    for (const l of grouped) l.area = l.cols.reduce((n, x) => n + (runs[x]!.length ? runs[x]![runs[x]!.length - 1]![1] - Math.min(runs[x]![runs[x]!.length - 1]![0], belly) : 0), 0);
    assign(grouped.filter((l) => l.centre < split));
    assign(grouped.filter((l) => l.centre >= split));
    for (const l of grouped) {
      const region = l.centre >= split ? (l.near ? MARK_REGION.frontNear : MARK_REGION.frontFar) : l.near ? MARK_REGION.hindNear : MARK_REGION.hindFar;
      for (const x of l.cols) {
        const col = runs[x]!;
        const bot = col[col.length - 1]![1];
        // pin the leg top to the belly line; per-column runs fragment around hoof
        // gaps, so paint every coat/points row below it, not just the last run
        const effTop = belly - 6;
        for (let y = Math.max(0, Math.round(effTop)); y <= bot; y++) {
          const role = roleAt(f, x, y);
          if (role !== 1 && role !== 2) continue;
          const o = ((f[1] + y) * src.width + f[0] + x) * 4;
          if (out[o]) continue; // face region wins where a foreleg overlaps the head
          const h = (bot - y) / Math.max(1, bot - effTop);
          paint(f, x, y, region, Math.round(Math.min(1, Math.max(0, h)) * 255), 0);
        }
      }
    }

    // ---- body: every other coat pixel (roan / dapple texture zone) ----------
    // G carries texels below the spine over the barrel (rump .. shoulder), so the dun
    // dorsal stripe hugs the back however the frame poses the horse.
    for (let x = x0; x <= x1; x++) {
      const col = runs[x]!;
      const colTop = col?.length && x >= x0 + W * 0.08 && x <= split ? col[0]![0] : -1;
      for (let y = 0; y < fh; y++) {
        if (roleAt(f, x, y) !== 1) continue;
        const o = ((f[1] + y) * src.width + f[0] + x) * 4;
        if (out[o]) continue;
        paint(f, x, y, MARK_REGION.body, colTop >= 0 ? Math.min(255, (y - colTop) * 32) : 0, 0);
      }
    }
  }
  riderMasks(src, palette, keys, out);
  return out;
}

/**
 * Women riders (jockey gender): where the -f strip (same frames, edited with PixelLab: a slimmer
 * back and hair under the cap) differs from the shared strip, the mask says so, so one indexed
 * strip serves both: R = 10, the texel is empty for a woman rider (the slimmer back); R = 11,
 * a woman rider shows palette index G there (her hair, the re-shaped jacket). Both frame grids
 * must match (indexStrip with the same palette).
 */
export function womanMasks(male: IndexedFrames, woman: IndexedFrames, out: Uint8Array): number {
  if (male.width !== woman.width || male.height !== woman.height) return 0;
  let n = 0;
  for (let i = 0; i < male.index.length; i++) {
    const m = male.index[i]!;
    const w = woman.index[i]!;
    if (m === w) continue;
    const o = i * 4;
    out[o] = w === 0 ? MARK_REGION.womanTrim : MARK_REGION.womanTexel;
    out[o + 1] = w;
    out[o + 2] = 0;
    out[o + 3] = 255;
    n++;
  }
  return n;
}

/**
 * Rider regions of the mask (jockey looks): per frame, the cap's texels (R = 9, G/B = their
 * place in the cap's box, for the cap pattern), the rider's face (R = 7, G = skin level * 64 + 32:
 * the small coat / mane / skin-keyed patches under and in front of the cap; the horse's own coat
 * always runs out of that window) and the hair cue (R = 8): a nape line under the back of the
 * cap (G = level * 64) and a ponytail behind it (G = level * 64 + 32, drawn on empty texels too,
 * only for long-haired jockeys). Riders face right.
 */
function riderMasks(src: IndexedFrames, palette: Palette, keys: KeyPalette, out: Uint8Array): void {
  const set = (ramp?: string[]) => {
    const r = new Set<number>();
    for (const h of ramp ?? []) {
      const k = palette.lookup.get(Number.parseInt(h.slice(1), 16));
      if (k !== undefined) r.add(k);
    }
    return r;
  };
  const isCap = set(keys.cap);
  const faceKeys = new Set([...set(keys.coat), ...set(keys.mane), ...set(keys.points), ...set(keys.skin)]);
  if (!isCap.size) return;
  const skinIdx = (keys.skin ?? []).map((h) => palette.lookup.get(Number.parseInt(h.slice(1), 16)) ?? -1);
  const levelOf = (k: number) => {
    const i = skinIdx.indexOf(k);
    return i >= 0 ? skinKeyLevel(i, skinIdx.length) : riderSkinLevel(palette.luma[k]!);
  };
  const { fw, fh } = src;
  const paint = (f: [number, number], x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= fw || y >= fh) return;
    const o = ((f[1] + y) * src.width + f[0] + x) * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  };
  for (let fr = 0; fr < src.frames; fr++) {
    const f = frameOrigin(src, fr);
    const idx = (x: number, y: number) => src.index[(f[1] + y) * src.width + f[0] + x]!;
    let cx0 = fw, cy0 = fh, cx1 = -1, cy1 = -1;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++)
        if (isCap.has(idx(x, y))) {
          cx0 = Math.min(cx0, x);
          cx1 = Math.max(cx1, x);
          cy0 = Math.min(cy0, y);
          cy1 = Math.max(cy1, y);
        }
    if (cx1 < 0) continue;
    for (let y = cy0; y <= cy1; y++)
      for (let x = cx0; x <= cx1; x++)
        if (isCap.has(idx(x, y))) paint(f, x, y, MARK_REGION.cap, Math.round(((x - cx0) / Math.max(1, cx1 - cx0)) * 255), Math.round(((y - cy0) / Math.max(1, cy1 - cy0)) * 255));
    const capW = cx1 - cx0 + 1;
    const wx0 = Math.max(0, cx0 - 2);
    const wx1 = Math.min(fw - 1, cx1 + Math.max(4, Math.round(capW * 0.35)));
    const wy1 = Math.min(fh - 1, cy1 + Math.max(8, Math.round(capW * 0.9)));
    const inWin = (x: number, y: number) => x >= wx0 && x <= wx1 && y >= cy0 && y <= wy1;
    const cand = (x: number, y: number) => inWin(x, y) && faceKeys.has(idx(x, y));
    const seen = new Set<number>();
    const face = new Set<number>();
    for (let y = cy0; y <= wy1; y++) {
      for (let x = wx0; x <= wx1; x++) {
        if (seen.has(y * fw + x) || !cand(x, y)) continue;
        const patch: number[] = [];
        let edge = false;
        const stack = [x, y];
        seen.add(y * fw + x);
        while (stack.length) {
          const py = stack.pop()!;
          const px = stack.pop()!;
          patch.push(px, py);
          if (px === wx1 || py === wy1) edge = true;
          for (const [qx, qy] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]] as const) {
            if (seen.has(qy * fw + qx) || !cand(qx, qy)) continue;
            seen.add(qy * fw + qx);
            stack.push(qx, qy);
          }
        }
        if (edge || patch.length / 2 > Math.max(40, capW * 6)) continue;
        for (let n = 0; n < patch.length; n += 2) {
          face.add(patch[n + 1]! * fw + patch[n]!);
          paint(f, patch[n]!, patch[n + 1]!, MARK_REGION.riderFace, levelOf(idx(patch[n]!, patch[n + 1]!)) * 64 + 32, 0);
        }
      }
    }
    // hair: the nape under the back of the cap, a ponytail behind it
    for (let x = cx0; x <= Math.min(cx1, cx0 + 2); x++) if (face.has((cy1 + 1) * fw + x)) paint(f, x, cy1 + 1, MARK_REGION.riderHair, x === cx0 ? 0 : 64, 0);
    for (const [x, y, k] of [[cx0 - 1, cy1 - 1, 1], [cx0 - 1, cy1, 1], [cx0 - 2, cy1 + 1, 2], [cx0 - 2, cy1 + 2, 1], [cx0 - 3, cy1 + 3, 0], [cx0 - 1, cy1 + 1, 0]] as const) {
      if (x < 0 || y >= fh || isCap.has(idx(x, y))) continue;
      paint(f, x, y, MARK_REGION.riderHair, k * 64 + 32, 0);
    }
  }
}

/**
 * Lookup table: one row per runner. Base colour = the recoloured key (coat, mane, points,
 * silks, cap) or the source colour for fixed roles; the pattern half holds the secondary
 * silks colour for primary keys (alpha 0 elsewhere). Column LUT_FLAG_X packs the marking
 * flags: R = leg levels 2 bits each in tuple order (FL|FR<<2|HL<<4|HR<<6), G = face id |
 * coat pattern << 4, B = dun (primitive markings); column LUT_WHITE_X is the marking white;
 * column LUT_STRIPE_X the dun stripe colour (alpha 0 when the palette has none — the shader
 * falls back to the legacy fixed darkening).
 */
export function buildLut(palette: Palette, keys: KeyPalette, appearances: readonly HorseAppearance[]): Uint8Array {
  const rows = Math.max(1, appearances.length);
  const lut = new Uint8Array(LUT_W * rows * 4);
  appearances.forEach((a, row) => {
    const plan = buildRecolorPlan(keys, a);
    const colors = resolveHorseColors(a);
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
    const fl = LEG_LEVEL[a.legs?.[0] ?? "none"] ?? 0;
    const fr = LEG_LEVEL[a.legs?.[1] ?? "none"] ?? 0;
    const hl = LEG_LEVEL[a.legs?.[2] ?? "none"] ?? 0;
    const hr = LEG_LEVEL[a.legs?.[3] ?? "none"] ?? 0;
    // the cap pattern's colour: the secondary silks ramp at the cap key's shade
    plan.capIndex.forEach((ci, src) => {
      const k = palette.lookup.get(src);
      if (k === undefined || plan.pattern === "solid") return;
      const sec = plan.capSecondary[ci] ?? src;
      const p = (row * LUT_W + 64 + k) * 4;
      lut[p] = (sec >> 16) & 255;
      lut[p + 1] = (sec >> 8) & 255;
      lut[p + 2] = sec & 255;
      lut[p + 3] = 255;
    });
    // the rider's look (named jockeys)
    if (a.rider) {
      const put = (x: number, c: [number, number, number]) => {
        const o = (row * LUT_W + x) * 4;
        lut[o] = c[0];
        lut[o + 1] = c[1];
        lut[o + 2] = c[2];
        lut[o + 3] = 255;
      };
      rampRgb(a.rider.skin, 4).forEach((c, i) => put(LUT_SKIN_X + i, c));
      rampRgb(a.rider.hair, 3).forEach((c, i) => put(LUT_HAIR_X + i, c));
      put(LUT_RIDER_X, [255, a.rider.long ? 255 : 0, a.rider.gender === "f" ? 255 : 0]);
    }
    const fo = (row * LUT_W + LUT_FLAG_X) * 4;
    lut[fo] = fl | (fr << 2) | (hl << 4) | (hr << 6);
    lut[fo + 1] = (FACE_ID[a.face ?? "none"] ?? 0) | ((COAT_PATTERN_ID[colors.texture] ?? 0) << 4);
    lut[fo + 2] = a.dun ? 1 : 0;
    lut[fo + 3] = 255;
    const wo = (row * LUT_W + LUT_WHITE_X) * 4;
    lut[wo] = (MARKING_WHITE >> 16) & 255;
    lut[wo + 1] = (MARKING_WHITE >> 8) & 255;
    lut[wo + 2] = MARKING_WHITE & 255;
    lut[wo + 3] = 255;
    if (colors.stripe) {
      const n = Number.parseInt(colors.stripe.slice(1), 16);
      const so = (row * LUT_W + LUT_STRIPE_X) * 4;
      lut[so] = (n >> 16) & 255;
      lut[so + 1] = (n >> 8) & 255;
      lut[so + 2] = n & 255;
      lut[so + 3] = 255;
    }
  });
  return lut;
}

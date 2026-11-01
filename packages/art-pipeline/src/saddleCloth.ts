/**
 * Saddle cloths (runner identity, visual research 2026-11-01 V-03): every runner's cloth on the
 * track wears its gate colour and number, the same colours as the racecard's cloth tiles.
 *
 * The race strips draw the cloth in the fixed white keys (palette.json `fixed.white`), which the
 * rider's breeches share. The cloth is found per frame from the shared coat geometry (the horse's
 * back line, interpolated under the saddle and the rider): the cloth hangs below the back line,
 * the breeches sit above it. Pure array code (no DOM), shared by every view: Trackside and 3D
 * (a mask region read by the horse shader), the canvas painters (3D fallback strip, photo
 * finish) and the paddock / post-parade dioramas.
 */
import type { CoatGeometry } from "./coatGeometry";

/**
 * Cloth colours by gate (the single definition: the racecard's cloth tiles read it too).
 * `cloth` is the cloth, `number` the figure printed on it. Gate 13+ repeats from gate 1.
 */
export const SADDLE_CLOTHS: readonly { readonly cloth: string; readonly number: string }[] = [
  { cloth: "#c8242f", number: "#ffffff" },
  { cloth: "#f4efe3", number: "#0b0f0c" },
  { cloth: "#2346a8", number: "#ffffff" },
  { cloth: "#f2d24a", number: "#0b0f0c" },
  { cloth: "#1f8a4c", number: "#ffffff" },
  { cloth: "#1a1a1a", number: "#f2d24a" },
  { cloth: "#e8742a", number: "#0b0f0c" },
  { cloth: "#e47aa5", number: "#0b0f0c" },
  { cloth: "#3fb8b0", number: "#0b0f0c" },
  { cloth: "#5b2f8f", number: "#ffffff" },
  { cloth: "#a9b0b8", number: "#c8242f" },
  { cloth: "#9ccc3a", number: "#0b0f0c" },
];

/** A runner's cloth: its colours and the number printed on it (the gate). */
export interface SaddleClothLook {
  cloth: string;
  number: string;
  gate: number;
}

/** The cloth of a gate (1-based; 0 or less = no cloth drawn yet: null). */
export function saddleClothOf(gate: number): SaddleClothLook | null {
  if (!Number.isFinite(gate) || gate < 1) return null;
  const g = Math.floor(gate);
  const c = SADDLE_CLOTHS[(g - 1) % SADDLE_CLOTHS.length]!;
  return { cloth: c.cloth, number: c.number, gate: g };
}

/** 3x5 digit font (rows top to bottom, 3 bits each, high bit = left). */
export const CLOTH_DIGITS: readonly number[][] = [
  [7, 5, 5, 5, 7],
  [2, 6, 2, 2, 7],
  [7, 1, 7, 4, 7],
  [7, 1, 3, 1, 7],
  [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7],
  [7, 4, 7, 5, 7],
  [7, 1, 2, 2, 2],
  [7, 5, 7, 5, 7],
  [7, 5, 7, 1, 7],
];

/**
 * Glyph cells of the number box, 5 x 5: one digit sits in cells 1..3; gates 10-19 (fields hold
 * up to 16 runners) print a narrow "1" in cell 0, a gap, and the units digit in cells 2..4, so
 * every number fits the small cloth the rider's boot leaves visible.
 */
export const CLOTH_GLYPH_W = 5;
export const CLOTH_GLYPH_H = 5;

/** Is cell (cx, cy) of the number box inked for `gate`? (Gates of 20 and more show their units.) */
export function clothGlyphHit(gate: number, cx: number, cy: number): boolean {
  if (cy < 0 || cy >= CLOTH_GLYPH_H || cx < 0 || cx >= CLOTH_GLYPH_W) return false;
  const n = Math.max(0, Math.floor(gate));
  if (n >= 10 && n < 20) {
    if (cx === 0) return true;
    if (cx === 1) return false;
    return ((CLOTH_DIGITS[n % 10]![cy]! >> (4 - cx)) & 1) === 1;
  }
  const col = cx - 1;
  if (col < 0 || col > 2) return false;
  return ((CLOTH_DIGITS[n % 10]![cy]! >> (2 - col)) & 1) === 1;
}

/**
 * Per-texel cloth mask of a strip, frame-local layout `frame * fw * fh + y * fw + x` (like the
 * coat geometry): 0 not cloth; 1 cloth; 2 cloth inside the number box. `glyph` holds, for number
 * box texels, the box cell `cx + cy * 8` (255 elsewhere). `boxes` per frame: the cloth's box
 * (x0, y0, x1, y1; -1 when the frame shows none) and the number box (x, y, cell size).
 */
export interface SaddleClothMask {
  frames: number;
  fw: number;
  fh: number;
  mask: Uint8Array;
  glyph: Uint8Array;
  boxes: { cloth: [number, number, number, number]; number: [number, number, number] | null }[];
}

/**
 * Find the saddle cloth in every frame. `isCloth(f, x, y)` says whether a texel is drawn in a
 * cloth key (the fixed white keys); `geo` is the strip's coat geometry (same frame grid).
 *
 * Per frame: the core is the lowest-reaching big 4-connected patch of cloth-keyed texels at least
 * ~6 % of the barrel depth under the back line (the breeches and the rider's knee sit at or above it); rows
 * above the core join while they stay at least half as wide as the core's median row (the cloth's
 * top edge rides a little above the back line; the knee and thigh are narrow and stop the
 * growth); smaller deep patches beside the core (the cloth showing past the rider's boot) join
 * it. The number box (whole-texel cells, one size per strip) sits where it covers the most cloth,
 * nearest the cloth's centre; the boot may hide part of it, as it would on a real cloth.
 */
export function findSaddleCloth(isCloth: (f: number, x: number, y: number) => boolean, geo: CoatGeometry): SaddleClothMask {
  const { frames, fw, fh, H } = geo;
  const n = frames * fw * fh;
  const mask = new Uint8Array(n);
  const glyph = new Uint8Array(n).fill(255);
  const boxes: SaddleClothMask["boxes"] = [];
  const coreMin = Math.max(1, Math.round(H * 0.06));
  const minCore = Math.max(12, Math.round(H * H * 0.08));
  // number cells: whole texels, at most ~1/16 of the barrel depth (2-3 on the HD race strips)
  const cellMax = Math.max(1, Math.min(3, Math.round(H / 16)));
  const clothOf: ({ inCloth: Uint8Array; box: [number, number, number, number] } | null)[] = [];
  for (let f = 0; f < frames; f++) {
    const base = f * fw * fh;
    const at = (x: number, y: number) => base + y * fw + x;
    const cand = (x: number, y: number) => x >= 0 && y >= 0 && x < fw && y < fh && isCloth(f, x, y);
    // patches deep enough under the back line; the largest is the core
    const seen = new Uint8Array(fw * fh);
    const patches: number[][] = [];
    for (let y0 = 0; y0 < fh; y0++)
      for (let x0 = 0; x0 < fw; x0++) {
        if (seen[y0 * fw + x0] || !cand(x0, y0) || geo.v[at(x0, y0)]! < coreMin) continue;
        const patch: number[] = [];
        const stack = [x0, y0];
        seen[y0 * fw + x0] = 1;
        while (stack.length) {
          const py = stack.pop()!;
          const px = stack.pop()!;
          patch.push(py * fw + px);
          for (const [qx, qy] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]] as const) {
            if (qx < 0 || qy < 0 || qx >= fw || qy >= fh || seen[qy * fw + qx] || !cand(qx, qy) || geo.v[at(qx, qy)]! < coreMin) continue;
            seen[qy * fw + qx] = 1;
            stack.push(qx, qy);
          }
        }
        patches.push(patch);
      }
    // the core: of the big patches, the one reaching lowest (a standing rider's thighs can dip
    // under the back line too, but the cloth always hangs below them)
    const bottom = (p: number[]) => p.reduce((m, k) => Math.max(m, Math.floor(k / fw)), 0);
    patches.sort((a, b) => b.length - a.length);
    const big = patches.filter((p) => p.length >= minCore);
    const best = big.length ? big.reduce((a, b) => (bottom(b) > bottom(a) ? b : a)) : [];
    if (best.length < minCore) {
      clothOf.push(null);
      boxes.push({ cloth: [-1, -1, -1, -1], number: null });
      continue;
    }
    const inCloth = new Uint8Array(fw * fh);
    let x0 = fw, y0 = fh, x1 = -1, y1 = -1;
    const rowN = new Map<number, number>();
    for (const k of best) {
      inCloth[k] = 1;
      const x = k % fw;
      const y = (k - x) / fw;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      rowN.set(y, (rowN.get(y) ?? 0) + 1);
    }
    const widths = [...rowN.values()].sort((a, b) => a - b);
    const medW = widths[Math.floor(widths.length / 2)]!;
    // grow upward row by row while the row stays cloth-wide; then a narrow top edge (a slanted
    // cloth tapers off within a few rows) joins only when it ends there: a leg would carry on
    const rowAbove = (y: number, inside: (x: number, y: number) => boolean): number[] => {
      const row: number[] = [];
      const inRow = new Uint8Array(fw);
      const lo = Math.max(0, x0 - 2);
      const hi = Math.min(fw - 1, x1 + 2);
      for (let x = lo; x <= hi; x++) {
        if (inRow[x] || !cand(x, y) || !inside(x, y + 1)) continue;
        let a = x;
        let b = x;
        while (a - 1 >= lo && cand(a - 1, y)) a--;
        while (b + 1 <= hi && cand(b + 1, y)) b++;
        for (let k = a; k <= b; k++) if (!inRow[k]) (inRow[k] = 1), row.push(k);
      }
      return row;
    };
    const inC = (x: number, y: number) => inCloth[y * fw + x] === 1;
    for (let y = y0 - 1; y >= Math.max(0, y0 - H); y--) {
      const row = rowAbove(y, inC);
      if (row.length >= medW * 0.5) {
        for (const x of row) inCloth[y * fw + x] = 1;
        y0 = y;
        continue;
      }
      const taper: number[][] = [];
      const tent = new Uint8Array(fw * fh);
      let cur = row;
      let yy = y;
      while (cur.length && taper.length < 3) {
        taper.push(cur.map((x) => yy * fw + x));
        for (const x of cur) tent[yy * fw + x] = 1;
        yy--;
        cur = yy >= 0 ? rowAbove(yy, (x, q) => tent[q * fw + x] === 1) : [];
      }
      if (!cur.length)
        for (const r of taper)
          for (const k of r) {
            inCloth[k] = 1;
            y0 = Math.min(y0, Math.floor(k / fw));
          }
      break;
    }
    // the cloth showing past the rider's boot: smaller deep patches beside the core
    const reach = Math.round((x1 - x0 + 1) * 1.5);
    const nearCore = (k: number) => {
      const x = k % fw;
      const y = (k - x) / fw;
      return x >= x0 - reach && x <= x1 + reach && y >= y0 && y <= y1;
    };
    for (const p of patches) {
      if (p === best || p.length < 4) continue;
      const inside = p.filter(nearCore);
      // most of it beside the core and hanging as low as the cloth's middle (not a knee)
      if (inside.length < p.length * 0.7 || bottom(p) < (y0 + y1) / 2) continue;
      for (const k of inside) inCloth[k] = 1;
    }
    for (let i = 0; i < fw * fh; i++) if (inCloth[i]) mask[base + i] = 1;
    clothOf.push({ inCloth, box: [x0, y0, x1, y1] });
    boxes.push({ cloth: [x0, y0, x1, y1], number: null });
  }
  // The number box: one cell size for the whole strip (the biggest whose box the visible cloth
  // holds in most frames: the rider's boot covers the cloth's front), placed per frame where it
  // sits most on the cloth, nearest the cloth's centre on ties. Texels the boot covers stay boot.
  const place = (c: { inCloth: Uint8Array; box: [number, number, number, number] }, cell: number) => {
    const [x0, y0, x1, y1] = c.box;
    const bw = CLOTH_GLYPH_W * cell;
    const bh = CLOTH_GLYPH_H * cell;
    const cxm = (x0 + x1) / 2;
    const cym = (y0 + y1) / 2;
    let best: [number, number] | null = null;
    let bestOn = -1;
    let bestD = Infinity;
    for (let by = y0; by + bh - 1 <= y1; by++)
      for (let bx = x0 - 1; bx + bw - 1 <= x1 + 1; bx++) {
        let on = 0;
        for (let yy = by; yy < by + bh; yy++) for (let xx = bx; xx < bx + bw; xx++) on += xx >= 0 && xx < fw ? c.inCloth[yy * fw + xx]! : 0;
        const d = Math.hypot(bx + bw / 2 - cxm, by + bh / 2 - cym);
        if (on > bestOn || (on === bestOn && d < bestD)) {
          bestOn = on;
          bestD = d;
          best = [bx, by];
        }
      }
    return best ? { at: best, cover: bestOn / (bw * bh) } : null;
  };
  const shown = clothOf.filter((c): c is { inCloth: Uint8Array; box: [number, number, number, number] } => !!c);
  let cell = 1;
  for (let c = cellMax; c >= 1; c--) {
    const cov = shown.map((f) => place(f, c)?.cover ?? 0).sort((a, b) => a - b);
    cell = c;
    if (!cov.length || cov[Math.floor(cov.length / 2)]! >= 0.9) break;
  }
  clothOf.forEach((c, f) => {
    if (!c) return;
    const p = place(c, cell);
    if (!p || p.cover < 0.6) return;
    const [bx, by] = p.at;
    const base = f * fw * fh;
    for (let yy = by; yy < by + CLOTH_GLYPH_H * cell; yy++)
      for (let xx = bx; xx < bx + CLOTH_GLYPH_W * cell; xx++) {
        if (xx < 0 || xx >= fw || !c.inCloth[yy * fw + xx]) continue;
        mask[base + yy * fw + xx] = 2;
        glyph[base + yy * fw + xx] = Math.floor((xx - bx) / cell) + Math.floor((yy - by) / cell) * 8;
      }
    boxes[f]!.number = [bx, by, cell];
  });
  return { frames, fw, fh, mask, glyph, boxes };
}

/** Packed rgb set of a palette's cloth keys (`fixed.white`). */
export function clothKeySet(white: readonly string[] | undefined): Set<number> {
  return new Set((white ?? []).map((h) => Number.parseInt(h.slice(1), 16)));
}

/** Cloth mask of a horizontal RGBA strip whose cloth is drawn in `keys` (packed rgb). */
export function rgbaSaddleCloth(rgba: ArrayLike<number>, width: number, frameWidth: number, keys: Set<number>, geo: CoatGeometry): SaddleClothMask {
  return findSaddleCloth((f, x, y) => {
    const i = (y * width + f * frameWidth + x) * 4;
    if ((rgba[i + 3] ?? 0) < 128) return false;
    return keys.has((rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!);
  }, geo);
}

/** Brightest cloth-key luma the shading is relative to (the strips' top white key, #e4e3e4). */
export const CLOTH_KEY_TOP = 0.893;

/**
 * Shade of a cloth texel from its source white key (0..1 luma): the key's light relative to the
 * top white key, so folds and the shadow under the rider's leg carry over to the colour.
 */
export function clothShade(luma: number): number {
  return Math.min(1.08, Math.pow(Math.max(0, luma) / CLOTH_KEY_TOP, 1.25));
}

const hex = (h: string): [number, number, number] => {
  const v = Number.parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/**
 * Paint the cloth on a keyed RGBA strip in place (frames side by side, the same grid as `cm`),
 * before or after the recolour (the cloth keys are fixed, so either order works). The number is
 * printed only when `number` is true (the strip will be drawn large enough to read it).
 */
export function paintSaddleCloth(data: Uint8ClampedArray, width: number, frameWidth: number, cm: SaddleClothMask, look: SaddleClothLook, number = true): void {
  const bg = hex(look.cloth);
  const fg = hex(look.number);
  for (let f = 0; f < cm.frames; f++)
    for (let y = 0; y < cm.fh; y++)
      for (let x = 0; x < cm.fw; x++) {
        const k = (f * cm.fh + y) * cm.fw + x;
        const m = cm.mask[k]!;
        if (!m) continue;
        const i = (y * width + f * frameWidth + x) * 4;
        if (data[i + 3]! < 128) continue;
        const l = (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) / 255;
        const s = clothShade(l);
        const g = cm.glyph[k]!;
        const ink = number && m === 2 && g !== 255 && clothGlyphHit(look.gate, g & 7, g >> 3);
        const c = ink ? fg : bg;
        data[i] = Math.min(255, Math.round(c[0] * s));
        data[i + 1] = Math.min(255, Math.round(c[1] * s));
        data[i + 2] = Math.min(255, Math.round(c[2] * s));
      }
}

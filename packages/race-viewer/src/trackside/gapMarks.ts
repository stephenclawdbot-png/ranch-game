/**
 * Trackside gap markers (pure, no DOM): when the whole-field shot has to squeeze a gap to
 * keep every runner on screen, the turf in that gap gets a soft haze "cut" and a small
 * broadcast-style chip with the TRUE gap in lengths ("8L"), so a horse 20 lengths behind
 * never just looks 4 lengths behind. Lengths use the standings' definition (`gapLabel`).
 *
 * The chip is a tiny pixel bitmap (3x5 numerals, baked once into an atlas of every label),
 * drawn at an integer device-pixel scale like the "my horse" chevron.
 */
import { gapLabel } from "./layout";

/** 3x5 pixel numerals (and the few marks a gap label needs). */
export const GLYPHS: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "011", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  ".": ["0", "0", "0", "0", "1"],
  "+": ["000", "010", "111", "010", "000"],
  L: ["100", "100", "100", "100", "111"],
};

/** Longest gap a chip spells out; longer gaps read "99+L". */
export const CHIP_MAX_L = 99;

/** Chip text for a true gap (m), or null when it is too small to label (nose / head). */
export function chipLabel(trueM: number): string | null {
  const s = gapLabel(trueM);
  if (!s.endsWith("L")) return null;
  const n = Number(s.slice(0, -1));
  return n > CHIP_MAX_L ? `${CHIP_MAX_L}+L` : s;
}

/** Every label a chip can show (the atlas holds them all, so nothing is baked mid-race). */
export const CHIP_LABELS: readonly string[] = (() => {
  const out: string[] = [];
  for (let h = 1; h < 20; h++) out.push(`${(h / 2).toFixed(1).replace(/\.0$/, "")}L`);
  for (let n = 10; n <= CHIP_MAX_L; n++) out.push(`${n}L`);
  out.push(`${CHIP_MAX_L}+L`);
  return out;
})();

/** Pixel codes of a chip bitmap. */
export const CHIP_INK = 1;
export const CHIP_FILL = 2;
export const CHIP_NUM = 3;
export const CHIP_UNIT = 4;

/** Chip height in texels (5-row numerals, 2 texels padding, 1-texel border). */
export const CHIP_H = 11;

/** Chip bitmap: 1-texel ink border, dark green fill, brass numerals, cream "L". */
export function chipBitmap(label: string): { w: number; h: number; px: Uint8Array } {
  const glyphs = [...label].map((ch) => GLYPHS[ch] ?? GLYPHS["0"]!);
  const textW = glyphs.reduce((s, g) => s + g[0]!.length, 0) + Math.max(0, glyphs.length - 1);
  const padX = 2;
  const padY = 2;
  const w = textW + 2 * padX + 2;
  const h = CHIP_H;
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      // Rounded corners: the corner texels stay transparent.
      const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
      px[y * w + x] = corner ? 0 : edge ? CHIP_INK : CHIP_FILL;
    }
  let cx = 1 + padX;
  glyphs.forEach((g, gi) => {
    const unit = [...label][gi] === "L";
    g.forEach((row, ry) => {
      [...row].forEach((v, rx) => {
        if (v === "1") px[(1 + padY + ry) * w + cx + rx] = unit ? CHIP_UNIT : CHIP_NUM;
      });
    });
    cx += g[0]!.length + 1;
  });
  return { w, h, px };
}

export interface ChipCandidate {
  /** Stable key (the scene uses the runner index ahead of the gap). */
  key: number;
  /** Chip centre x (CSS px). */
  x: number;
  /** Chip width (CSS px). */
  w: number;
  /** Larger shows first (the true gap). */
  priority: number;
  /** Already on screen: keeps its place over a newcomer (hysteresis, no flip-flopping). */
  sticky: boolean;
}

/**
 * Which chips get their numbers on screen: chips may not overlap (a `margin` px apart);
 * already-visible chips first, then the biggest true gaps, at most `max` of them (a phone
 * shows the few biggest cuts, not a row of numbers). A gap that loses out still shows its
 * haze cut, so every squeezed gap stays visibly a cut. Returns the shown keys.
 */
export function pickChips(cands: readonly ChipCandidate[], margin = 4, max = Infinity): Set<number> {
  const sorted = [...cands].sort((a, b) => Number(b.sticky) - Number(a.sticky) || b.priority - a.priority || a.key - b.key);
  const taken: { l: number; r: number }[] = [];
  const shown = new Set<number>();
  for (const c of sorted) {
    const l = c.x - c.w / 2 - margin / 2;
    const r = c.x + c.w / 2 + margin / 2;
    if (shown.size >= max || taken.some((t) => l < t.r && r > t.l)) continue;
    taken.push({ l, r });
    shown.add(c.key);
  }
  return shown;
}

/**
 * Distance-marker plates as pixel grids (pure, no DOM): a 3x5 pixel font on a coloured plate
 * with a dark rim. Both views paint the same grid (stage/props.ts) at the same density, so a
 * pole reads "3f" the same way in Trackside and in 3D.
 */

const FONT: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "011", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  f: ["011", "010", "111", "010", "010"],
  m: ["000", "110", "111", "101", "101"],
};

export interface PlateGrid {
  w: number;
  h: number;
  /** 0 transparent, 1 rim, 2 plate, 3 glyph. Row-major, row 0 = top. */
  px: Uint8Array;
  colours: { rim: string; plate: string; glyph: string };
}

/** Source pixels per plate texel when painted at the horses' 96 px/m (0.0625 m texels). */
export const PLATE_TEXEL_PX = 6;

export function plateGrid(label: string, plate: string, glyph = "#f6f4ee", rim = "#1a1612"): PlateGrid {
  const chars = [...label].filter((c) => FONT[c]);
  const inner = Math.max(1, chars.length * 4 - 1);
  const w = inner + 4;
  const h = 5 + 4;
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 1 : 2;
  chars.forEach((c, i) => {
    const g = FONT[c]!;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (g[y]![x] === "1") px[(y + 2) * w + 2 + i * 4 + x] = 3;
  });
  return { w, h, px, colours: { rim, plate, glyph } };
}

import { describe, expect, it } from "vitest";
import type { HorseAppearance } from "@thoroughbred/shared";
import { buildLut, buildMarkMasks, indexStrip, LUT_FLAG_X, LUT_W, LUT_WHITE_X, MARK_REGION, MARKING_WHITE, newPalette } from "./strips";

const KEY = {
  coat: ["#401115", "#843216", "#ed8f39"],
  points: ["#010114", "#171721"],
  mane: ["#010113"],
  silksPrimary: ["#90097b"],
  silksSecondary: ["#0e8dac"],
  cap: ["#ae1397"],
};
const hex = (h: string) => [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];

const look = (over: Partial<HorseAppearance>): HorseAppearance =>
  ({
    coat: "bay",
    face: "none",
    legs: ["none", "none", "none", "none"],
    silks: { primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c", pattern: "solid" },
    ...over,
  }) as HorseAppearance;

describe("marking-flag packing", () => {
  it("packs leg levels, face id and coat pattern into the LUT flag column", () => {
    const pal = newPalette();
    const strip = new Uint8Array(4 * 2 * 4); // one 4x2 frame
    strip.set([...hex(KEY.coat[1]!), 255], 4 * 0 + 0); // one coat texel so columns exist
    const s = indexStrip(strip, 4, 2, 1, pal, { x: 0, y: 2 }, null)!;
    expect(s).toBeTruthy();
    const runners = [
      look({ legs: ["sock", "coronet", "none", "stocking"], face: "blaze", coat: "bay" }),
      look({ face: "star", coat: "roan" }),
      look({ legs: ["stocking", "none", "sock", "none"], coat: "dapple_grey" }),
      look({ coat: "chestnut" }),
    ];
    const lut = buildLut(pal, KEY, runners);
    const flags = (row: number) => [lut[(row * LUT_W + LUT_FLAG_X) * 4]!, lut[(row * LUT_W + LUT_FLAG_X) * 4 + 1]!];
    // legs tuple order is FL|FR<<2|HL<<4|HR<<6, levels none0/coronet1/sock2/stocking3
    expect(flags(0)[0]).toBe(2 | (1 << 2) | (3 << 6)); // sock, coronet, none, stocking
    expect(flags(0)[1]).toBe(4); // blaze, no coat pattern
    expect(flags(1)).toEqual([0, 1 | (1 << 4)]); // star; roan texture
    expect(flags(2)).toEqual([3 | (2 << 4), 2 << 4]); // stocking FL, sock HL; dapple
    expect(flags(3)).toEqual([0, 0]);
    // marking white column
    const w = (3 * LUT_W + LUT_WHITE_X) * 4;
    expect([lut[w], lut[w + 1], lut[w + 2], lut[w + 3]]).toEqual([(MARKING_WHITE >> 16) & 255, (MARKING_WHITE >> 8) & 255, MARKING_WHITE & 255, 255]);
  });
});

/**
 * One 48x36 frame: a coat barrel (rows 8..16, cols 4..30), a head block (rows 4..16,
 * cols 35..45, mane tuft at 43..45/4), one hind leg (cols 6..8 to row 32), a near front
 * leg (cols 26..29 to row 30) and a far front leg (col 33, rows 17..27).
 */
function horseStrip(): Uint8Array {
  const W = 48;
  const H = 36;
  const d = new Uint8Array(W * H * 4);
  const put = (x: number, y: number, c: string) => d.set([...hex(c), 255], (y * W + x) * 4);
  for (let x = 4; x <= 30; x++) for (let y = 8; y <= 16; y++) put(x, y, KEY.coat[1]!);
  for (let x = 35; x <= 45; x++) for (let y = 4; y <= 16; y++) put(x, y, KEY.coat[1]!);
  for (let x = 43; x <= 45; x++) put(x, 4, KEY.mane[0]!);
  for (let x = 6; x <= 8; x++) for (let y = 17; y <= 32; y++) put(x, y, KEY.points[1]!);
  for (let x = 26; x <= 29; x++) for (let y = 17; y <= 30; y++) put(x, y, KEY.points[1]!);
  for (let y = 17; y <= 27; y++) put(33, y, KEY.points[1]!);
  return d;
}

describe("marking masks", () => {
  const pal = newPalette();
  const s = indexStrip(horseStrip(), 48, 36, 1, pal, { x: 20, y: 32 }, null)!;
  const mask = buildMarkMasks(s, pal, KEY);
  const at = (x: number, y: number) => [mask[(y * s.width + x) * 4]!, mask[(y * s.width + x) * 4 + 1]!, mask[(y * s.width + x) * 4 + 2]!];

  it("marks legs per pair with a height param, near cluster before far", () => {
    expect(at(7, 32)).toEqual([MARK_REGION.hindNear, 0, 0]); // hoof: height 0
    const [r, g] = at(7, 24);
    expect(r).toBe(MARK_REGION.hindNear);
    expect(g!).toBeGreaterThan(60); // rises along the leg
    expect(at(27, 30)).toEqual([MARK_REGION.frontNear, 0, 0]);
    expect(at(33, 27)).toEqual([MARK_REGION.frontFar, 0, 0]);
    // body columns are never legs (col 15 stays barrel), ink-free zone above the hoof is taller
    expect(at(15, 16)[0]).toBe(MARK_REGION.body);
  });

  it("marks the face with brow->nose and edge-distance params, never the mane", () => {
    const [r, g, b] = at(38, 10);
    expect(r).toBe(MARK_REGION.face);
    expect(g!).toBeGreaterThan(0); // past the brow
    expect(b).toBe((45 - 38) * 32); // 7 texels from the profile edge
    expect(at(44, 4)[0]).toBe(0); // mane tuft: no face paint
  });
});

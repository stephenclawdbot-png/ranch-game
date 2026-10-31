/**
 * The race view draws the same per-horse pattern definition as every other view (art-pipeline
 * coatPatternOf): the LUT row decodes back to it, and the shader's atlas layout is the pipeline's.
 */
import { describe, expect, it } from "vitest";
import type { HorseAppearance, HorseColour } from "@thoroughbred/shared";
import { ATLAS_CELL, ATLAS_COLS, BODY, FACE, LEGS, TAIL, coatPatternOf, portraitLookOf } from "@thoroughbred/art-pipeline";
import { HORSE_FRAG } from "./shaders";
import { LUT_CELLS_X, LUT_LEGS_X, LUT_SLOT_X, LUT_W, MODE_ID, buildLut, indexStrip, newPalette } from "./strips";

const KEY = { coat: ["#401115", "#843216", "#ed8f39"], points: ["#010114", "#171721"], mane: ["#010113"], silksPrimary: ["#90097b"], silksSecondary: ["#0e8dac"], cap: ["#ae1397"] };
const SILKS = { primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c", pattern: "solid" } as const;
const look = (c: Partial<HorseColour>, a: Partial<HorseAppearance> = {}): HorseAppearance =>
  ({ coat: "bay", face: "none", legs: ["none", "none", "none", "none"], silks: SILKS, colour: { base: "bay", cream: 0, dun: false, roan: false, grey: "none", sabino: 0, seed: 5, ...c }, ...a }) as HorseAppearance;

const RUNNERS = [
  look({ tobiano: 1 }, { face: "blaze", legs: ["stocking", "none", "sock", "coronet"], feather: true }),
  look({ base: "chestnut", leopard: "leopard", seed: 99 }, { face: "snip" }),
  look({ roan: true, sooty: 2, pangare: true }),
  look({ brindle: true, rabicano: true, birdcatcher: true }),
  look({ base: "black", dun: true }, { dun: true }),
  look({ grey: "dapple" }),
  look({ dominantWhite: true }),
  look({ base: "chestnut", cream: 2, splash: 2 }),
];

describe("one pattern definition: race view = every other view", () => {
  const pal = newPalette();
  const strip = new Uint8Array(4 * 2 * 4);
  strip.set([0x84, 0x32, 0x16, 255], 0);
  indexStrip(strip, 4, 2, 1, pal, { x: 0, y: 2 }, null);
  const lut = buildLut(pal, KEY, RUNNERS);
  const px = (row: number, x: number) => [...lut.subarray((row * LUT_W + x) * 4, (row * LUT_W + x) * 4 + 4)];

  it("every runner's LUT row decodes to its coatPatternOf (and the portrait reads the same)", () => {
    RUNNERS.forEach((a, row) => {
      const p = coatPatternOf(a);
      expect(portraitLookOf(a).pattern).toEqual(p);
      const cells = px(row, LUT_CELLS_X);
      expect(cells[0]).toBe(p.faceCell >= 0 ? p.faceCell : 255);
      expect(cells[1]).toBe(p.feather ? 1 : 255);
      expect(cells[2]).toBe(Math.min(8, p.layers.length));
      expect(px(row, LUT_LEGS_X)).toEqual(p.legs.map((c) => (c >= 0 ? c : 255)));
      p.layers.slice(0, 8).forEach((L, k) => {
        const s = px(row, LUT_SLOT_X + k * 2);
        expect(s[0]).toBe(L.cell);
        expect(s[1]).toBe(MODE_ID[L.mode]);
        expect(s[2]).toBe(Math.round(Math.min(1, L.amount) * 255));
        const n = Number.parseInt(L.colour.slice(1), 16);
        expect(px(row, LUT_SLOT_X + k * 2 + 1).slice(0, 3)).toEqual([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
      });
    });
  });

  it("the shader's atlas layout is the pipeline's", () => {
    expect(HORSE_FRAG).toContain(`* ${ATLAS_CELL.w}.0, floor(cell / ${ATLAS_COLS}.0) * ${ATLAS_CELL.h}.0`);
    expect(HORSE_FRAG).toContain(`${LEGS.y}.0 + (1.0 - clamp(p1, 0.0, 1.0)) * ${LEGS.h - 1}.0`);
    expect(HORSE_FRAG).toContain(`(greg - 1.0) * ${LEGS.w}.0`);
    expect(HORSE_FRAG).toContain(`${FACE.x}.0 + max(0.0, ex) * ${FACE.w - 1}.0`);
    expect(HORSE_FRAG).toContain(`${TAIL.x}.0 + lx * ${TAIL.w - 1}.0, ${TAIL.y}.0`);
    expect(HORSE_FRAG).toContain(`(uv.y / H + ${-BODY.v0}) / ${(BODY.v1 - BODY.v0).toFixed(1)}`);
    expect(HORSE_FRAG).toContain(`by * ${((BODY.v1 - BODY.v0) * 48 - 1).toFixed(1)}`);
  });
});

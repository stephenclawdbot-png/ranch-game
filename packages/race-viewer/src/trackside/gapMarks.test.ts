import { describe, expect, it } from "vitest";
import { CHIP_H, CHIP_LABELS, CHIP_NUM, CHIP_UNIT, chipBitmap, chipLabel, pickChips, type ChipCandidate } from "./gapMarks";
import { LENGTH_M } from "./layout";

describe("gap marker chips", () => {
  it("the baked atlas holds every label a gap can produce (nothing baked mid-race)", () => {
    const set = new Set(CHIP_LABELS);
    for (let m = 0; m <= 400; m += 0.05) {
      const l = chipLabel(m);
      if (l !== null) expect(set.has(l), `${m} m -> ${l}`).toBe(true);
    }
    expect(chipLabel(0.2)).toBeNull(); // "nose" / "head" are never chips
    expect(chipLabel(8 * LENGTH_M)).toBe("8L");
    expect(chipLabel(150 * LENGTH_M)).toBe("99+L");
  });

  it("draws a bordered chip with brass numerals and a cream unit", () => {
    const b = chipBitmap("12L");
    expect(b.h).toBe(CHIP_H);
    expect(b.w).toBe(3 * 3 + 2 + 2 * 2 + 2);
    expect(b.px.includes(CHIP_NUM)).toBe(true);
    expect(b.px.includes(CHIP_UNIT)).toBe(true);
    expect(b.px[0]).toBe(0); // rounded corner
  });

  it("never overlaps chips: the biggest gaps (and chips already shown) keep their numbers", () => {
    const c = (key: number, x: number, priority: number, sticky = false): ChipCandidate => ({ key, x, w: 30, priority, sticky });
    expect([...pickChips([c(1, 100, 5), c(2, 120, 9), c(3, 200, 1)])].sort()).toEqual([2, 3]);
    // an already-visible chip holds its place against a bigger newcomer (no flip-flop)
    expect([...pickChips([c(1, 100, 5, true), c(2, 120, 9)])]).toEqual([1]);
    // at most `max`
    expect(pickChips([c(1, 0, 1), c(2, 100, 2), c(3, 200, 3)], 4, 2)).toEqual(new Set([2, 3]));
  });
});

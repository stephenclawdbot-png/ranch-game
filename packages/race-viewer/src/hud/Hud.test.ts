import { describe, expect, it } from "vitest";
import { fitCount } from "./Hud";

const chips = (n: number, w: number) => Array.from({ length: n }, () => w);
const base = {
  width: 2000,
  gap: 4,
  cap: 12,
  total: 12,
  meIdx: -1,
  w: chips(12, 100),
  meW: 0,
  plusW: () => 50,
};

describe("fitCount", () => {
  it("shows every chip when the whole order fits (no +N tail)", () => {
    expect(fitCount(base)).toBe(12);
  });

  it("fits only whole chips plus the +N tail", () => {
    // need(k) = 100k + 4k + 50 for k < 12 -> k = 4 (466 <= 520), k = 5 overflows.
    expect(fitCount({ ...base, width: 520 })).toBe(4);
  });

  it("reserves room for the +N chip (a chip alone may fit, chip + tail may not)", () => {
    // 4 chips = 412, but 4 chips + "+8" = 476 > 460 -> 3.
    expect(fitCount({ ...base, width: 460, plusW: () => 60 })).toBe(3);
  });

  it("never exceeds the cap", () => {
    expect(fitCount({ ...base, cap: 3 })).toBe(3);
  });

  it("counts the swapped-in highlighted chip against the fit", () => {
    // k = 3 with "me" replacing #3: 100 + 100 + 90 + 2 gaps + "+9" = 352 <= 352.
    expect(fitCount({ ...base, width: 352, meIdx: 7, meW: 90 })).toBe(3);
    expect(fitCount({ ...base, width: 351, meIdx: 7, meW: 90 })).toBe(2);
  });

  it("measures the highlighted chip from the last slot when it falls outside the cap", () => {
    const a = { ...base, cap: 4, meIdx: 7, w: [...chips(3, 100), 90], meW: 90 };
    // k = 4: 100 + 100 + 100 + 90 + 3 gaps + 4 + "+8" = 456 <= 456.
    expect(fitCount({ ...a, width: 456 })).toBe(4);
    expect(fitCount({ ...a, width: 455 })).toBe(3);
  });

  it("keeps at least one chip however narrow the strip", () => {
    expect(fitCount({ ...base, width: 10 })).toBe(1);
  });

  it("keeps the leader next to a trailing highlighted chip however narrow the strip", () => {
    expect(fitCount({ ...base, width: 10, meIdx: 6, meW: 90 })).toBe(2);
    expect(fitCount({ ...base, width: 10, meIdx: 0, meW: 100 })).toBe(1);
  });

  it("prefers the previous, smaller fit when the larger one only just fits", () => {
    // need(4) = 466 exactly: fresh -> 4, knife-edge rerun with prev 3 -> 3.
    expect(fitCount({ ...base, width: 466 })).toBe(4);
    expect(fitCount({ ...base, width: 466, prev: { w: 466, k: 3 } })).toBe(3);
    // A wider strip or a resize (prev width differs) drops the hysteresis.
    expect(fitCount({ ...base, width: 467, prev: { w: 466, k: 3 } })).toBe(4);
    expect(fitCount({ ...base, width: 466, prev: { w: 460, k: 3 } })).toBe(4);
  });
});
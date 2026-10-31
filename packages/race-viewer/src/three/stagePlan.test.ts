import { describe, expect, it } from "vitest";
import { TRACK_POST, TRACK_PRE, groundSpan } from "./stagePlan";

describe("groundSpan", () => {
  it("covers the whole built strip with the margin at both ends, for every race length", () => {
    for (const L of [800, 1000, 1609, 2000, 2548, 3219, 4800]) {
      const g = groundSpan(L);
      expect(g.x0).toBeLessThanOrEqual(-TRACK_PRE - 800);
      expect(g.x1).toBeGreaterThanOrEqual(L + TRACK_POST + 800);
      expect(g.len).toBe(L + TRACK_PRE + TRACK_POST);
    }
  });
});

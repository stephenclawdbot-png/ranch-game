import { describe, expect, it } from "vitest";
import { purseShares } from "@thoroughbred/shared";
import { splitPurse } from "@thoroughbred/racing-engine";

describe("purse split", () => {
  it("settlement pays exactly what the engine's replay shows, for every purse and field size", () => {
    for (let runners = 1; runners <= 14; runners++) {
      for (let purse = 0; purse <= 25_000; purse += 7) {
        const s = purseShares(purse, runners);
        expect(s).toEqual(splitPurse(purse, runners));
        if (runners >= 6) expect(s.reduce((a, b) => a + b, 0)).toBe(purse);
      }
    }
  });
});

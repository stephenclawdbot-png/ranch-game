import { describe, expect, it } from "vitest";
import { fakeReplay } from "./dev/fakeReplay";
import { buildRaceCall } from "./call/buildRaceCall";
import { WHAT_IF_BADGE, whatIfBadge, whatIfCall, whatIfFlags } from "./whatIf";

describe("what-if mode", () => {
  it("turns the finale and the results card off, and leaves an official replay alone", () => {
    expect(whatIfFlags(true, { finale: true, resultsCard: true })).toEqual({ finale: false, resultsCard: false });
    expect(whatIfFlags(false, { finale: true, resultsCard: false })).toEqual({ finale: true, resultsCard: false });
  });

  it("drops the photograph and the result readout from the race call, keeps the rest", () => {
    let official = 0;
    for (const seed of [7, 11, 23]) {
      const r = fakeReplay({ seed });
      const lines = buildRaceCall({ replay: r, names: Object.fromEntries(r.horses.map((h) => [h.horseId, h.name])), distanceM: r.race.distanceM, uptoSec: Number.POSITIVE_INFINITY, seed: String(seed) });
      official += lines.filter((l) => l.kind === "photo" || l.kind === "result").length;
      const kept = whatIfCall(lines);
      expect(kept.some((l) => l.kind === "photo" || l.kind === "result")).toBe(false);
      expect(kept).toEqual(lines.filter((l) => l.kind !== "photo" && l.kind !== "result"));
      expect(kept.some((l) => l.kind === "off")).toBe(true);
    }
    expect(official).toBeGreaterThan(0);
  });

  it("labels itself as not official", () => {
    expect(WHAT_IF_BADGE.toLowerCase()).toContain("what if");
    expect(WHAT_IF_BADGE.toLowerCase()).toContain("not official");
  });

  it("takes a host's badge for other unofficial races, the what-if badge otherwise", () => {
    expect(whatIfBadge("Match race · unofficial")).toBe("Match race · unofficial");
    expect(whatIfBadge()).toBe(WHAT_IF_BADGE);
    expect(whatIfBadge("  ")).toBe(WHAT_IF_BADGE);
    expect(whatIfBadge("x".repeat(80))).toHaveLength(40);
  });
});

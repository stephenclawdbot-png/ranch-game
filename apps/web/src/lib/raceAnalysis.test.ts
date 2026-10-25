import { describe, expect, it } from "vitest";
import { fixtureInput } from "@/server/testing";
import { simulateRace } from "@thoroughbred/racing-engine";
import { analyseRace } from "./raceAnalysis";

const NOW = Date.UTC(2026, 9, 25, 15, 0, 0);

describe("race analysis", () => {
  it("explains every runner of finished races", { timeout: 30_000 }, () => {
    const ratios: number[] = [];
    for (const [i, distanceM] of [1000, 1400, 2000, 2400].entries()) {
      const input = fixtureInput(`analysis-${i}`, NOW, { distanceM, runners: 8 + i });
      const replay = simulateRace(input);
      for (const e of input.entries) {
        const a = analyseRace(replay, e.horse.id, e.horse, e.tactic);
        expect(a).not.toBeNull();
        expect(a!.runningLine).toHaveLength(4);
        expect(a!.runningLine[3]).toBe(a!.position);
        expect(a!.sectionals.map((s) => s.segment)).toEqual(["early", "middle", "late"]);
        expect(a!.summary.length).toBeGreaterThan(10);
        if (a!.position === 1) expect(a!.lengthsBehind).toBe(0);
        ratios.push(a!.paceRatio);
      }
    }
    expect(ratios.every((x) => Number.isFinite(x) && x > 0.5 && x < 2)).toBe(true);
  });
});

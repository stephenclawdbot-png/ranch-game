import { describe, expect, it } from "vitest";
import { computeReplay, getRace, listScheduled } from "@/server/races";
import { analyseRace } from "./raceAnalysis";

const NOW = Date.UTC(2026, 9, 25, 15, 0, 0);

describe("race analysis", () => {
  it("explains every runner of finished races", { timeout: 30_000 }, () => {
    const { recent } = listScheduled(NOW, 1, 6);
    const ratios: number[] = [];
    for (const r of recent) {
      const card = getRace(r.id, NOW + 3_600_000);
      const replay = computeReplay(r.id);
      for (const e of card.field) {
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

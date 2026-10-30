import { describe, expect, it } from "vitest";
import { ABILITY_OR_TABLE, OR_PER_LB, abilityOrOf, abilityScore, abilityScoreOfOr, carryWeight, weightCostPoints } from "./ability";
import { BOTTOM_WEIGHT_LB, TOP_WEIGHT_LB, formatWeight, handicapWeights } from "./ratings";

describe("handicap weights: 1 lb costs 1 OR of ability", () => {
  it("abilityScoreOfOr inverts the table at its knots and carries on past its ends", () => {
    for (const [score, or] of ABILITY_OR_TABLE) expect(abilityScoreOfOr(or)).toBe(score);
    expect(abilityScoreOfOr(ABILITY_OR_TABLE[0]![1] - 6)).toBeLessThan(ABILITY_OR_TABLE[0]![0]);
    for (let or = 10; or < 100; or++) expect(abilityScoreOfOr(or + 1)).toBeGreaterThanOrEqual(abilityScoreOfOr(or));
  });

  it("carrying lb lowers the ability mark by lb OR (to within rounding), anywhere on the scale", () => {
    expect(OR_PER_LB).toBe(1);
    for (const base of [420, 500, 580, 650, 720, 800]) {
      for (const lb of [1, 3, 7, 12, 20]) {
        const stats = { speed: base + 20, stamina: base - 10, burst: base };
        const before = abilityOrOf(abilityScore(stats, 1600));
        if (before - lb < ABILITY_OR_TABLE[0]![1]) continue; // the mark itself is floored below the table
        const after = abilityOrOf(abilityScore(carryWeight(stats, 1600, lb), 1600));
        expect(Math.abs(before - after - lb), `${base} +${lb} lb`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("no weight costs nothing; the cost grows with the weight", () => {
    const stats = { speed: 600, stamina: 600, burst: 600, durability: 600 };
    expect(carryWeight(stats, 2000, 0)).toBe(stats);
    expect(weightCostPoints(600, 0)).toBe(0);
    expect(weightCostPoints(600, 10)).toBeGreaterThan(weightCostPoints(600, 5));
    // Speed, stamina and burst each pay the same; other stats are untouched.
    const w = carryWeight(stats, 2000, 6);
    expect(stats.speed - w.speed).toBe(weightCostPoints(600, 6));
    expect(w.stamina).toBe(w.speed);
    expect(w.durability).toBe(600);
  });

  it("weights from ratings: top-rated carries top weight, a pound less per OR below", () => {
    const w = handicapWeights([{ horseId: "a", or: 75 }, { horseId: "b", or: 68 }, { horseId: "c", or: 50 }], true);
    expect(w.map((x) => x.weightLb)).toEqual([TOP_WEIGHT_LB, TOP_WEIGHT_LB - 7, TOP_WEIGHT_LB - 25]);
    expect(w.map((x) => x.extraLb)).toEqual([25, 18, 0]);
    expect(formatWeight(TOP_WEIGHT_LB - 7)).toBe("9st 7lb");
    expect(Math.min(...handicapWeights([{ horseId: "a", or: 100 }, { horseId: "b", or: 20 }], true).map((x) => x.weightLb))).toBe(BOTTOM_WEIGHT_LB);
  });
});

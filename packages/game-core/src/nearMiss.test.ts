import { describe, expect, it } from "vitest";
import {
  FEATURE_QUALIFY_TOP,
  FEATURE_RATING_BY_RIGHT,
  PROMOTE,
  RELEGATE,
  Rng,
  SEASON_FINAL_MIN_RATING,
  featureRatingGap,
  leagueNearMiss,
  promotionText,
  qualifierNearMiss,
  ratingGap,
  ratingTrajectory,
  relegationText,
  seasonFinalGap,
  settleLeague,
  type LeagueMember,
  type LeagueTier,
} from "./index";

const m = (ownerId: string, points: number, wins = 0): LeagueMember => ({ ownerId, points, wins, bestFinish: points > 0 ? 3 : 0 });

describe("near misses: qualifiers and ratings", () => {
  it("qualifier places at the boundary", () => {
    expect(qualifierNearMiss(null)).toBeNull();
    expect(qualifierNearMiss(FEATURE_QUALIFY_TOP)).toBeNull();
    expect(qualifierNearMiss(FEATURE_QUALIFY_TOP + 1)).toEqual({ places: 1, text: `${FEATURE_QUALIFY_TOP + 1}th in a Qualifier, top ${FEATURE_QUALIFY_TOP} go through: 1 place short` });
    expect(qualifierNearMiss(9)!.text).toBe("9th in a Qualifier, top 3 go through: 6 places short");
  });

  it("rating gaps at the boundary", () => {
    expect(seasonFinalGap(SEASON_FINAL_MIN_RATING - 4)).toEqual({ short: 4, text: `OR ${SEASON_FINAL_MIN_RATING - 4}, needs ${SEASON_FINAL_MIN_RATING}: 4 short` });
    expect(seasonFinalGap(SEASON_FINAL_MIN_RATING).short).toBe(0);
    expect(seasonFinalGap(SEASON_FINAL_MIN_RATING + 3).text).toMatch(/high enough/);
    expect(featureRatingGap(99).short).toBe(1);
    expect(ratingGap(0, 1).short).toBe(1);
  });

  it("a trajectory from recent rated runs: about N weeks, or what would move the mark (fix 15)", () => {
    // +6 OR over two weeks of runs: about 55 short at +3 a week is about 19 weeks.
    const rising = ratingTrajectory(40, [
      { delta: 3, week: 10 },
      { delta: 3, week: 11 },
    ], SEASON_FINAL_MIN_RATING);
    expect(rising).toMatchObject({ weeks: 19, ratePerWeek: 3 });
    expect(rising.text).toBe("At your current rate (+3 OR a week), about 19 weeks");

    // A fractional rate rounds for reading, not for the sum.
    const half = ratingTrajectory(88, [
      { delta: 2, week: 4 },
      { delta: 2, week: 4 },
      { delta: 3, week: 5 },
    ], SEASON_FINAL_MIN_RATING);
    expect(half.weeks).toBe(2);
    expect(half.text).toBe("At your current rate (+3.5 OR a week), about 2 weeks");

    // No rated runs yet: the line names the level the rules would move the mark at.
    const unraced = ratingTrajectory(72, [], FEATURE_RATING_BY_RIGHT);
    expect(unraced.weeks).toBeNull();
    expect(unraced.text).toBe("Needs a win or two at Hcp 70-95 level to start the mark moving");

    // Recent form that hasn't risen: honest about it, still no promise.
    const flat = ratingTrajectory(90, [
      { delta: -2, week: 1 },
      { delta: 2, week: 2 },
    ], SEASON_FINAL_MIN_RATING);
    expect(flat.weeks).toBeNull();
    expect(flat.text).toBe("The mark hasn't risen over recent weeks: about a win or two at Listed level would move it");

    // Already there: nothing to project.
    expect(ratingTrajectory(100, [{ delta: 5, week: 1 }], FEATURE_RATING_BY_RIGHT).text).toBe("OR 100 already clears 100");
    // A low mark names its own band, the level the horse actually runs in.
    expect(ratingTrajectory(40, [], 95).text).toBe("Needs a win or two at Hcp 0-55 level to start the mark moving");
  });
});

describe("near misses: the League", () => {
  it("promotion gap names the next tier; 0 in the places; none at the top", () => {
    const members = [m("a", 50), m("b", 40), m("c", 30), m("d", 20), m("e", 12), m("me", 3)];
    const l = leagueNearMiss(members, "me", "bronze")!;
    expect(l.rank).toBe(6);
    expect(l.toPromotion).toBe(10);
    expect(promotionText(l)).toBe("10 points from Silver");
    expect(relegationText(l)).toBeNull(); // bronze is a floor
    expect(leagueNearMiss(members, "e", "bronze")!.toPromotion).toBe(0);
    expect(promotionText(leagueNearMiss(members, "e", "silver")!)).toBe("In the promotion places for Gold");
    expect(leagueNearMiss(members, "me", "champion")!.toPromotion).toBeNull();
    expect(leagueNearMiss(members, "nobody", "bronze")).toBeNull();
  });

  it("a small league: any points go up; none still needs one", () => {
    const l = leagueNearMiss([m("a", 0), m("me", 0)], "me", "bronze")!;
    expect(l.toPromotion).toBe(1);
    expect(leagueNearMiss([m("a", 0), m("me", 4)], "me", "bronze")!.toPromotion).toBe(0);
  });

  it("relegation: zone, clear, away and too few scorers", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => m(`o${i}`, 100 - i * 5)); // 100..45
    const zone = leagueNearMiss(twelve, "o10", "gold")!; // 50 points, 11th of 12 scorers: bottom 5 = o7..o11
    expect(zone.drop).toEqual({ state: "zone", toSafety: 70 - 50 + 1 }); // first safe: o6 on 70
    expect(relegationText(zone)).toBe("In the bottom 5, down to Silver: 21 points from safety");
    const clear = leagueNearMiss(twelve, "o3", "gold")!; // 85 vs top of the zone (o7, 65)
    expect(clear.drop).toEqual({ state: "clear", margin: 20 });
    expect(relegationText(clear)).toBe("20 points clear of the drop");
    expect(leagueNearMiss([...twelve, m("me", 0)], "me", "gold")!.drop).toEqual({ state: "away" });
    expect(leagueNearMiss(twelve.slice(0, PROMOTE + RELEGATE), "o9", "gold")!.drop).toEqual({ state: "none" });
    expect(leagueNearMiss(twelve, "o10", "silver")!.drop).toBeNull();
  });

  it("agrees with settleLeague on random tables", () => {
    const rng = new Rng("near-miss-agree");
    const tiers: LeagueTier[] = ["bronze", "silver", "gold", "platinum", "champion"];
    for (let n = 0; n < 300; n++) {
      const size = 1 + rng.int(30);
      const tier = tiers[rng.int(tiers.length)]!;
      const members = Array.from({ length: size }, (_, i) => m(`o${i}`, rng.chance(200) ? 0 : rng.int(120), rng.int(3)));
      const moves = new Map(settleLeague({ id: "x", week: 0, tier, members }).map((mv) => [mv.ownerId, mv.outcome]));
      for (const mem of members) {
        const l = leagueNearMiss(members, mem.ownerId, tier)!;
        if (l.toPromotion === 0) expect(moves.get(mem.ownerId)).toBe("promoted");
        if (l.toPromotion !== null && l.toPromotion > 0) expect(moves.get(mem.ownerId)).not.toBe("promoted");
        if (l.drop?.state === "zone") expect(moves.get(mem.ownerId)).toBe("relegated");
        if (moves.get(mem.ownerId) === "relegated") expect(l.drop?.state).toBe("zone");
      }
    }
    expect(RELEGATE).toBeGreaterThan(0);
  });
});

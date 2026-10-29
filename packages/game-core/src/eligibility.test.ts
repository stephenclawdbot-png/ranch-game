/**
 * Band eligibility: the peak rule (no sandbagging — a horse can't drop a band by losing on
 * purpose) and the ability floor (strong newcomers can't farm the low bands).
 */
import { describe, expect, it } from "vitest";
import type { HorseState, RaceSlot, RaceTier } from "./types";
import { applyRun, type RunConditions } from "./career";
import { ABILITY_MARGIN, PEAK_DROP, bandCheck, bandRating, classBand, eligibleTiers, entryBlock } from "./eligibility";
import { abilityMark, abilityOrOf, abilityScore } from "./ability";
import { currentStats } from "./phenotype";
import { seedFrom } from "./rng";
import { DAY, T0, makeHorse } from "./test-helpers";

/** A prime (20-start) horse whose CURRENT speed/stamina/burst are exactly `stats`: mature
 * (normal curve, in the peak window), fully realised, so current = potential, vigour 0. */
function horseOf(stats: { speed: number; stamina: number; burst: number }, rating: HorseState["rating"] = { or: 40, ratedRuns: 0, peakOr: 40 }): HorseState {
  const h = makeHorse("band", { starts: 20 });
  const pair = (v: number): [number, number] => [v, v];
  return {
    ...h,
    genome: { ...h.genome, stats: { ...h.genome.stats, speed: pair(stats.speed), stamina: pair(stats.stamina), burst: pair(stats.burst) }, vigour: [0, 0], maturity: ["normal", "normal"], coi: 0 },
    training: { ...h.training, realisation: { speed: 1000, stamina: 1000, burst: 1000, durability: 1000, adaptability: 1000, temperament: 1000 } },
    rating,
  };
}

/** A slot of the given tier closing in the future (like eligibleTiers' probe). */
function slotOf(tier: RaceTier, nowMs: number): RaceSlot {
  return {
    id: "probe",
    name: "probe",
    kind: "regular",
    tier,
    season: 1,
    postTimeMs: nowMs + 2 * 60_000,
    entryCloseMs: nowMs + 60_000,
    distanceM: 1600,
    surface: "turf",
    goingForecast: "good",
    weather: "clear",
    purse: 0,
    entryFee: 0,
    maxRunners: 12,
    handicap: false,
    division: null,
  };
}

const NOW = T0 + 5 * DAY;
const COND: RunConditions = { raceId: "r1", seed: seedFrom("eligibility", "r1"), atMs: NOW, tier: "hcp_0_55", distanceM: 1600, going: "good", fieldSize: 8, bigCrowd: false };

describe("bandRating: today's OR, never far below the peak or the settled ability", () => {
  it("the peak only lets a horse drop PEAK_DROP below it (bands overlap by 5: one band)", () => {
    expect(PEAK_DROP).toBe(10);
    expect(bandCheck({ or: 52, peakOr: 66 })).toEqual({ rating: 56, source: "peak" });
    expect(bandCheck({ or: 52, peakOr: 60 })).toEqual({ rating: 52, source: "or" }); // 50 < today's 52
    expect(bandRating({ or: 52, peakOr: 66 })).toBe(56);
  });

  it("the ability mark floors the band rating for strong newcomers", () => {
    expect(ABILITY_MARGIN).toBe(15);
    expect(bandCheck({ or: 40, peakOr: 40 }, 76)).toEqual({ rating: 61, source: "ability" });
    expect(bandCheck({ or: 62, peakOr: 70 }, 80)).toEqual({ rating: 65, source: "ability" });
    expect(bandRating({ or: 40, peakOr: 40 }, 76)).toBe(61);
  });
});

describe("peak rule (max checks use the peak, min checks keep current OR)", () => {
  it("OR 52 / peak 66 can't drop into 0-55 but fits 50-75", () => {
    const h = horseOf({ speed: 600, stamina: 600, burst: 600 }, { or: 52, ratedRuns: 12, peakOr: 66 });
    expect(entryBlock(h, slotOf("hcp_0_55", NOW), NOW)).toBe("rating_too_high");
    expect(entryBlock(h, slotOf("hcp_50_75", NOW), NOW)).toBeNull();
    expect(eligibleTiers(h, NOW)).not.toContain("hcp_0_55");
    expect(eligibleTiers(h, NOW)).toContain("hcp_50_75");
  });

  it("a peak only 10 above today's OR stays in the low band", () => {
    const h = horseOf({ speed: 600, stamina: 600, burst: 600 }, { or: 52, ratedRuns: 12, peakOr: 60 });
    expect(entryBlock(h, slotOf("hcp_0_55", NOW), NOW)).toBeNull();
    expect(eligibleTiers(h, NOW)).toContain("hcp_0_55");
  });

  it("min checks still use today's OR (the peak never lifts a horse into a band)", () => {
    const h = horseOf({ speed: 600, stamina: 600, burst: 600 }, { or: 45, ratedRuns: 12, peakOr: 80 });
    expect(entryBlock(h, slotOf("hcp_50_75", NOW), NOW)).toBe("rating_too_low");
    expect(eligibleTiers(h, NOW)).not.toContain("hcp_50_75");
    expect(eligibleTiers(h, NOW)).not.toContain("hcp_70_95");
  });

  it("a race updates the peak (and a loss never lowers it)", () => {
    const h = horseOf({ speed: 600, stamina: 600, burst: 600 }, { or: 50, ratedRuns: 12, peakOr: 50 });
    const won = applyRun(h, COND, { position: 1, prize: 0, intensity: "normal", vetLevel: 0, newOr: 58 });
    expect(won.state.rating).toEqual({ or: 58, ratedRuns: 13, peakOr: 58 });
    const lost = applyRun(won.state, COND, { position: 5, prize: 0, intensity: "normal", vetLevel: 0, newOr: 51 });
    expect(lost.state.rating).toEqual({ or: 51, ratedRuns: 14, peakOr: 58 });
  });
});

describe("ability mark (the OR a horse of its current running ability settles at)", () => {
  it("the calibrated table: starter grade settles near the entry OR, a grade is worth ~10 OR", () => {
    expect(abilityMark(horseOf({ speed: 500, stamina: 500, burst: 500 }))).toBe(41);
    expect(abilityMark(horseOf({ speed: 700, stamina: 700, burst: 700 }))).toBe(61);
    expect(abilityMark(horseOf({ speed: 800, stamina: 800, burst: 800 }))).toBe(76);
    // Equal stats make the score trip-independent; tilts pick up the trip weighting.
    expect(abilityScore({ speed: 900, stamina: 300, burst: 100 }, 1100)).toBeGreaterThan(abilityScore({ speed: 900, stamina: 300, burst: 100 }, 3200));
    expect(abilityOrOf(0)).toBe(18);
    expect(abilityOrOf(1000)).toBe(97);
  });

  it("a strong newcomer (800 current stats, OR 40) is blocked from the low band, not the novice", () => {
    const h = horseOf({ speed: 800, stamina: 800, burst: 800 });
    expect(bandCheck(h.rating, abilityMark(h)).source).toBe("ability");
    expect(entryBlock(h, slotOf("hcp_0_55", NOW), NOW)).toBe("rating_too_high");
    expect(entryBlock(h, slotOf("hcp_50_75", NOW), NOW)).toBe("rating_too_low"); // min check keeps OR 40 out until it climbs
    expect(entryBlock(h, slotOf("novice", NOW), NOW)).toBeNull(); // the entry point for a strong newcomer
    expect(eligibleTiers(h, NOW)).not.toContain("hcp_0_55");
  });

  it("a starter-grade (500) or B-grade (700) newcomer is not blocked from the low band", () => {
    // The calibrated boundary sits at ~760 stats: 700 settles at OR 61, so with ABILITY_MARGIN
    // 15 the floor (46) does not reach the 55 cap (see tools/balance/ability.report.ts).
    for (const stats of [500, 700]) {
      const h = horseOf({ speed: stats, stamina: stats, burst: stats });
      expect(entryBlock(h, slotOf("hcp_0_55", NOW), NOW)).toBeNull();
      expect(eligibleTiers(h, NOW)).toContain("hcp_0_55");
    }
  });

  it("the band the copy suggests is the one the band rating belongs in", () => {
    expect(classBand(bandRating({ or: 40, peakOr: 40 }, abilityMark(horseOf({ speed: 800, stamina: 800, burst: 800 }))))).toBe("hcp_50_75");
  });

  it("is deterministic (no Date, no Math.random)", () => {
    const h = horseOf({ speed: 650, stamina: 700, burst: 620 });
    expect(abilityMark(h)).toBe(abilityMark(h));
    expect(entryBlock(h, slotOf("hcp_0_55", NOW), NOW)).toBe(entryBlock(h, slotOf("hcp_0_55", NOW), NOW));
    expect(currentStats(h)).toMatchObject({ speed: 650, stamina: 700, burst: 620 });
  });
});
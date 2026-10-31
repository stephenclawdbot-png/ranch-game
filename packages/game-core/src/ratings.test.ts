import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { expectedScore, formatWeight, handicapWeights, ratingChangeReason, updateRatings, BOTTOM_WEIGHT_LB, MAX_GAIN_PER_RACE, MAX_LOSS_PER_RACE, TOP_WEIGHT_LB } from "./ratings";
import { classBand, eligibleTiers, entryBlock, stableEntriesLeft, TIER_RULES } from "./eligibility";
import { ENTRY_CLOSE_BEFORE_MS } from "./seasons";
import { DAY, T0, makeHorse } from "./test-helpers";
import type { RaceSlot } from "./types";

const fieldArb = fc
  .array(fc.record({ or: fc.integer({ min: 0, max: 140 }), ratedRuns: fc.integer({ min: 0, max: 30 }) }), { minLength: 2, maxLength: 14 })
  .chain((rs) => fc.shuffledSubarray(rs.map((_, i) => i + 1), { minLength: rs.length, maxLength: rs.length }).map((pos) => rs.map((r, i) => ({ ...r, horseId: `h${i}`, position: pos[i]! }))));

describe("official ratings", () => {
  it("expected score is a proper logistic (symmetric, monotone)", () => {
    expect(expectedScore(50, 50)).toBeCloseTo(0.5, 12);
    expect(expectedScore(75, 50)).toBeCloseTo(10 / 11, 6);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 140 }), fc.integer({ min: 0, max: 140 }), (a, b) => {
        expect(expectedScore(a, b) + expectedScore(b, a)).toBeCloseTo(1, 9);
      }),
    );
  });
  it("updates are bounded, deterministic, order-independent; the winner never loses rating", () => {
    fc.assert(
      fc.property(fieldArb, (field) => {
        const a = updateRatings(field);
        const b = updateRatings([...field].reverse());
        for (const c of a) {
          expect(c.delta).toBeLessThanOrEqual(MAX_GAIN_PER_RACE);
          expect(c.delta).toBeGreaterThanOrEqual(-MAX_LOSS_PER_RACE);
          expect(c.after).toBeGreaterThanOrEqual(0);
          expect(c.after).toBeLessThanOrEqual(140);
          expect(b.find((x) => x.horseId === c.horseId)).toEqual(c);
        }
        const winner = field.find((r) => r.position === 1)!;
        expect(a.find((c) => c.horseId === winner.horseId)!.delta).toBeGreaterThanOrEqual(0);
      }),
    );
  });
  it("does not inflate: among equally established horses deltas sum to ~0", () => {
    const field = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ horseId: `h${i}`, or: 60 + i * 3, ratedRuns: 10, position: 8 - i }));
    const sum = updateRatings(field).reduce((s, c) => s + c.delta, 0);
    expect(Math.abs(sum)).toBeLessThanOrEqual(4);
  });
  it("handicap weights: top weight to the top-rated, 1 lb per OR point, level weights otherwise", () => {
    const w = handicapWeights([{ horseId: "a", or: 80 }, { horseId: "b", or: 70 }, { horseId: "c", or: 20 }], true);
    expect(w[0]!.weightLb).toBe(TOP_WEIGHT_LB);
    expect(w[1]!.weightLb).toBe(TOP_WEIGHT_LB - 10);
    expect(w[2]!.weightLb).toBe(BOTTOM_WEIGHT_LB);
    expect(w[2]!.extraLb).toBe(0);
    expect(handicapWeights([{ horseId: "a", or: 80 }, { horseId: "b", or: 20 }], false).every((x) => x.extraLb === 0)).toBe(true);
    expect(formatWeight(140)).toBe("10st 0lb");
  });
  it("the result screen's rating reason: honest lines for a drop, a rise and a hold (fix 14)", () => {
    // Beaten by three horses rated 15 below: the handicapper had this one finishing close in.
    const upset = [
      { horseId: "mine", or: 70, ratedRuns: 10, position: 4 },
      { horseId: "a", or: 55, ratedRuns: 10, position: 1 },
      { horseId: "b", or: 55, ratedRuns: 10, position: 2 },
      { horseId: "c", or: 55, ratedRuns: 10, position: 3 },
    ];
    const down = ratingChangeReason(upset, "mine");
    const change = updateRatings(upset).find((r) => r.horseId === "mine")!;
    expect(change.delta).toBeLessThan(0);
    // The reason's number is the rule's own delta (cap included), so it never contradicts the
    // card's before/after; a big enough upset says the per-race cap held it.
    expect(down).toBe(`OR ${change.delta}: finished 4th of 4 in a race the handicapper expected it to finish close in — held by the per-race cap.`);

    // A 55 beating three 90s: expected back in the field, so the rise says so.
    const boost = [
      { horseId: "mine", or: 55, ratedRuns: 10, position: 1 },
      { horseId: "a", or: 90, ratedRuns: 10, position: 2 },
      { horseId: "b", or: 90, ratedRuns: 10, position: 3 },
      { horseId: "c", or: 90, ratedRuns: 10, position: 4 },
    ];
    const up = ratingChangeReason(boost, "mine");
    expect(updateRatings(boost).find((r) => r.horseId === "mine")!.delta).toBeGreaterThan(0);
    expect(up).toMatch(/^OR \+\d+(\.\d+)?: finished 1st of 4 in a race the handicapper expected it to finish back in the field\.$/);

    // Equal marks and a mid-field finish: the delta is 0 and the line says the mark holds.
    const level = [1, 2, 3, 4, 5].map((i) => ({ horseId: `h${i}`, or: 60, ratedRuns: 10, position: i }));
    expect(updateRatings(level).find((r) => r.horseId === "h3")!.delta).toBe(0);
    expect(ratingChangeReason(level, "h3")).toBe("OR unchanged: finished 3rd of 5 in a race the handicapper expected it to finish close in.");

    // A huge upset is held by the per-race cap, and the line admits it.
    const capped = ratingChangeReason(
      [
        { horseId: "mine", or: 0, ratedRuns: 0, position: 1 },
        { horseId: "a", or: 140, ratedRuns: 10, position: 2 },
      ],
      "mine",
    );
    expect(capped).toMatch(/— held by the per-race cap\.$/);

    // Nothing to explain: a one-runner field or a horse that wasn't in it.
    expect(ratingChangeReason([{ horseId: "solo", or: 50, ratedRuns: 1, position: 1 }], "solo")).toBe("");
    expect(ratingChangeReason(upset, "elsewhere")).toBe("");
  });
});

describe("eligibility", () => {
  const slot = (tier: RaceSlot["tier"], extra: Partial<RaceSlot> = {}): RaceSlot => ({
    id: "r", name: "r", kind: "regular", tier, season: 1, postTimeMs: T0 + DAY, entryCloseMs: T0 + DAY - ENTRY_CLOSE_BEFORE_MS, distanceM: 1600, surface: "turf",
    goingForecast: "good", weather: "clear", purse: 0, entryFee: 0, maxRunners: 12, handicap: false, division: null, ...extra,
  });
  it("juveniles: maiden/novice/quick/trial only", () => {
    const j = makeHorse("j", { starts: 2 });
    expect(entryBlock(j, slot("maiden"), T0)).toBeNull();
    expect(entryBlock(j, slot("hcp_0_55"), T0)).toBe("juvenile_class");
    expect(eligibleTiers(j, T0)).toEqual(expect.arrayContaining(["trial", "maiden", "novice", "quick"]));
  });
  it("rating bands, win limits, entry close, field size and the stable entry budget", () => {
    const p = { ...makeHorse("p", { starts: 12 }), rating: { or: 72, ratedRuns: 12, peakOr: 72 }, record: { starts: 12, wins: 3, places: 0, shows: 0, earnings: 0 } };
    expect(entryBlock(p, slot("hcp_50_75"), T0)).toBeNull();
    expect(entryBlock(p, slot("hcp_70_95"), T0)).toBeNull();
    expect(entryBlock(p, slot("hcp_0_55"), T0)).toBe("rating_too_high");
    expect(entryBlock(p, slot("g1"), T0)).toBe("rating_too_low");
    expect(entryBlock(p, slot("novice"), T0)).toBe("too_many_wins");
    expect(entryBlock(p, slot("hcp_50_75"), T0 + DAY)).toBe("entries_closed");
    expect(entryBlock(p, slot("hcp_50_75"), T0, 12)).toBe("field_full");
    expect(entryBlock(p, slot("hcp_50_75"), T0, 0, { entriesLeftToday: 0 })).toBe("stable_daily_limit");
    expect(stableEntriesLeft(10)).toBe(0);
    expect(stableEntriesLeft(10, 1)).toBe(5);
    expect(classBand(72)).toBe("hcp_70_95");
    expect(classBand(110)).toBe("g1");
    expect(TIER_RULES.trial.rated).toBe(false);
  });
});

import { ownerShareOk } from "./eligibility";
describe("matchmaking", () => {
  it("an owner can fill at most half a field", () => {
    expect(ownerShareOk(5, 12)).toBe(true);
    expect(ownerShareOk(6, 12)).toBe(false);
  });
});

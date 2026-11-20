/**
 * The debut rating (2026-11-20): a horse makes its debut on its real ability mark, not a flat 40.
 * Every debutant used to start on INITIAL_OR while a starter's real mark is about 31, so its first
 * results read "Rating 40 -> 37, down 3" (tools/season-harness firstRaces: mean -2.9 over the
 * first three starts on 40).
 */
import { describe, expect, it } from "vitest";
import { createStarterStable } from "./onboarding";
import { INITIAL_OR } from "./lifecycle";
import { abilityMark, debutRating, isDebutant, seatDebutant } from "./phenotype";
import { updateRatings } from "./ratings";
import { bandRating } from "./eligibility";
import { makeHorse, T0 } from "./test-helpers";

const starters = (n: number) => Array.from({ length: n }, (_, i) => createStarterStable({ ownerId: `o${i}`, seed: `debut-${i}`, nowMs: T0, season: 1 })).flat();

describe("the debut rating", () => {
  it("is the horse's real ability mark today", () => {
    for (const h of starters(20)) expect(debutRating(h)).toBe(abilityMark(h));
  });

  it("starters' marks sit below the old flat 40: that gap was the rating drop of every first result", () => {
    const marks = starters(200).map((h) => debutRating(h));
    const mean = marks.reduce((a, b) => a + b, 0) / marks.length;
    expect(mean).toBeGreaterThan(24);
    expect(mean).toBeLessThan(INITIAL_OR - 4);
  });

  it("seats a debutant's rating and peak; a horse that has run a rated race keeps its own", () => {
    const h = makeHorse("seat");
    expect(isDebutant(h)).toBe(true);
    const seated = seatDebutant(h);
    expect(seated.rating).toEqual({ or: abilityMark(h), ratedRuns: 0, peakOr: abilityMark(h) });
    expect(seatDebutant(seated)).toBe(seated);
    const raced = { ...h, rating: { or: 52, ratedRuns: 3, peakOr: 55 } };
    expect(isDebutant(raced)).toBe(false);
    expect(seatDebutant(raced)).toBe(raced);
  });

  it("level with a field of its own mark, a mid-field debut moves the rating by nothing (it lost points from 40)", () => {
    const h = seatDebutant(makeHorse("level"));
    const mark = h.rating.or;
    const field = (or: number) => [
      { horseId: "me", or, ratedRuns: 0, position: 4 },
      ...Array.from({ length: 6 }, (_, i) => ({ horseId: `c${i}`, or: mark, ratedRuns: 12, position: i < 3 ? i + 1 : i + 2 })),
    ];
    expect(updateRatings(field(mark)).find((c) => c.horseId === "me")!.delta).toBe(0);
    if (mark <= INITIAL_OR - 5) expect(updateRatings(field(INITIAL_OR)).find((c) => c.horseId === "me")!.delta).toBeLessThan(0);
  });

  it("keeps the bands honest: a seated debutant's band rating is its mark, never below its ability floor", () => {
    for (const h of starters(20)) {
      const s = seatDebutant(h);
      expect(bandRating(s.rating, abilityMark(s))).toBe(abilityMark(s));
    }
  });
});

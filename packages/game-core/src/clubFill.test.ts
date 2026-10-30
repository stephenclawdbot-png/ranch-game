import { describe, expect, it } from "vitest";
import {
  CLUB_ABOVE_MEDIAN_SPAN,
  CLUB_MARK_MAX,
  CLUB_MARK_TOLERANCE,
  CLUB_OPEN_BAND_SPAN,
  CLUB_SEASONED_STARTS,
  clubFitsRace,
  clubMarkOf,
  clubNominalRating,
  clubSeasonedState,
  clubStratum,
  clubTargets,
  clubWindow,
  liftGenome,
  medianRating,
  mintClubGenome,
} from "./clubFill";
import { abilityMark } from "./ability";
import { generateFoundationGenome, potentials } from "./genome";
import { maturityAt } from "./phenotype";
import { STAT_KEYS } from "./types";

describe("Club fill window", () => {
  it("banded races: the band's middle to its top", () => {
    expect(clubWindow({ kind: "banded", maxRating: 60 })).toEqual({ lo: 30, hi: 60 }); // maiden
    expect(clubWindow({ kind: "banded", maxRating: 70 })).toEqual({ lo: 35, hi: 70 }); // novice
    expect(clubWindow({ kind: "banded", minRating: 0, maxRating: 55 })).toEqual({ lo: 28, hi: 55 });
    expect(clubWindow({ kind: "banded", minRating: 50, maxRating: 75 })).toEqual({ lo: 63, hi: 75 });
    expect(clubWindow({ kind: "banded", minRating: 70, maxRating: 95 })).toEqual({ lo: 83, hi: 95 });
  });

  it("a floor with no ceiling: [floor, floor + span], capped at the highest mark a horse can have", () => {
    expect(clubWindow({ kind: "banded", minRating: 70 })).toEqual({ lo: 70, hi: 70 + CLUB_OPEN_BAND_SPAN });
    expect(clubWindow({ kind: "banded", minRating: 85 })).toEqual({ lo: 85, hi: CLUB_MARK_MAX });
    expect(clubWindow({ kind: "banded", minRating: 95 })).toEqual({ lo: 95, hi: CLUB_MARK_MAX });
  });

  it("open races: the players' median to median + span; nominal level with nobody entered", () => {
    expect(clubWindow({ kind: "open", playerRatings: [40, 52, 46] })).toEqual({ lo: 46, hi: 46 + CLUB_ABOVE_MEDIAN_SPAN });
    expect(clubWindow({ kind: "open", playerRatings: [40, 50] })).toEqual({ lo: 45, hi: 45 + CLUB_ABOVE_MEDIAN_SPAN });
    expect(clubWindow({ kind: "open", playerRatings: [], nominal: clubNominalRating("listed") })).toEqual({ lo: 85, hi: CLUB_MARK_MAX });
    // the Season Final keeps its floor
    expect(clubWindow({ kind: "open", minRating: 95, playerRatings: [96, 99] })).toEqual({ lo: 97, hi: CLUB_MARK_MAX });
    expect(clubWindow({ kind: "open", minRating: 95, playerRatings: [60] }).lo).toBe(95);
  });

  it("story races: the whole band", () => {
    expect(clubWindow({ kind: "story", minRating: 34, maxRating: 58 })).toEqual({ lo: 34, hi: 58 });
  });

  it("median", () => {
    expect(medianRating([])).toBeNull();
    expect(medianRating([5])).toBe(5);
    expect(medianRating([9, 1, 5])).toBe(5);
    expect(medianRating([1, 2])).toBe(1);
  });

  it("targets are spread across the window, one per slice, deterministic", () => {
    const w = { lo: 63, hi: 75 };
    const t = clubTargets(w, 5, "seed-a");
    expect(t).toEqual(clubTargets(w, 5, "seed-a"));
    t.forEach((x, i) => {
      const s = clubStratum(w, 5, i);
      expect(x).toBeGreaterThanOrEqual(s.lo);
      expect(x).toBeLessThanOrEqual(s.hi);
    });
    expect(t[0]!).toBeLessThan(t[4]!);
    // narrower than the field: every target still inside
    for (const x of clubTargets({ lo: 95, hi: 97 }, 8, "s")) expect(x >= 95 && x <= 97).toBe(true);
  });
});

describe("honest Club horses", () => {
  it("seasoned starts put every stat at its peak", () => {
    for (const type of ["early", "normal", "late"] as const) {
      for (const k of STAT_KEYS) expect(maturityAt(k, type, 19, CLUB_SEASONED_STARTS[type])).toBe(1000);
    }
  });

  it("lifting a genome moves every potential by the lift", () => {
    const g = generateFoundationGenome("lift-test", { season: 1, rarity: "common" });
    const p0 = potentials(g);
    const p1 = potentials(liftGenome(g, 100));
    for (const k of STAT_KEYS) expect(p1[k] - p0[k]).toBeGreaterThanOrEqual(p0[k] >= 900 ? 0 : 99);
  });

  it("the mint lands on the target mark (several targets, trip and surface fitted)", () => {
    for (const target of [30, 42, 55, 63, 70, 80, 88, 95]) {
      for (const [distanceM, surface] of [[1000, "turf"], [2000, "dirt"], [2800, "synthetic"]] as const) {
        const m = mintClubGenome({ seed: `race-${target}-${distanceM}`, index: 0, target, season: 12, distanceM, surface });
        expect(Math.abs(m.mark - target), `target ${target} at ${distanceM} ${surface}`).toBeLessThanOrEqual(CLUB_MARK_TOLERANCE);
        expect(m.fits).toBe(true);
        expect(clubFitsRace(m.genome, { distanceM, surface })).toBe(true);
        // the stored state's real ability is the mark
        expect(abilityMark(clubSeasonedState(m.genome))).toBe(m.mark);
        expect(clubMarkOf(m.genome)).toBe(m.mark);
      }
    }
  });

  it("is deterministic in the race seed", () => {
    const a = mintClubGenome({ seed: "det", index: 3, target: 72, season: 12, distanceM: 1600, surface: "turf" });
    const b = mintClubGenome({ seed: "det", index: 3, target: 72, season: 12, distanceM: 1600, surface: "turf" });
    expect(a).toEqual(b);
    expect(mintClubGenome({ seed: "det", index: 4, target: 72, season: 12, distanceM: 1600, surface: "turf" }).genome).not.toEqual(a.genome);
  });

  it("an out-of-reach target settles for the closest mark", () => {
    const m = mintClubGenome({ seed: "far", index: 0, target: 140, season: 1 });
    expect(m.mark).toBe(CLUB_MARK_MAX);
  });
});

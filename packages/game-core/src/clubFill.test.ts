import { describe, expect, it } from "vitest";
import {
  CLUB_ABOVE_MEDIAN_SPAN,
  CLUB_MARK_MAX,
  CLUB_MARK_TOLERANCE,
  CLUB_OWN_SURFACE_PERMILLE,
  CLUB_LIFT_OTHER_PERMILLE,
  clubOnOwnSurface,
  clubRaceDayLevel,
  clubRaceDayState,
  CLUB_BELOW_MEDIAN,
  CLUB_CLIPPED_SPAN,
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
import { generateFoundationGenome, potentials } from "./genome";
import { abilityMark, maturityAt } from "./phenotype";
import { conditionReport } from "./condition";
import { STAT_KEYS } from "./types";

describe("Club fill window", () => {
  const B = CLUB_BELOW_MEDIAN;
  const A = CLUB_ABOVE_MEDIAN_SPAN;

  it("every race centres on the entered players' median band rating P: [P - below, P + above]", () => {
    expect(clubWindow({ kind: "banded", maxRating: 60, playerRatings: [40, 44, 47] })).toEqual({ lo: 44 - B, hi: Math.min(60, 44 + A) }); // maiden
    expect(clubWindow({ kind: "banded", minRating: 0, maxRating: 55, playerRatings: [30, 38, 41, 50] })).toEqual({ lo: 39 - B, hi: Math.min(55, 39 + A) });
    expect(clubWindow({ kind: "open", playerRatings: [40, 52, 46] })).toEqual({ lo: 46 - B, hi: 46 + A });
    expect(clubWindow({ kind: "open", playerRatings: [40, 50] })).toEqual({ lo: 45 - B, hi: 45 + A });
  });

  it("clipped to the race's own band", () => {
    // near the top of a 50-75 handicap
    expect(clubWindow({ kind: "banded", minRating: 50, maxRating: 75, playerRatings: [70, 72, 74] })).toEqual({ lo: 72 - B, hi: 75 });
    // near its floor
    expect(clubWindow({ kind: "banded", minRating: 50, maxRating: 75, playerRatings: [50, 51] })).toEqual({ lo: 50, hi: 50 + A });
    // the Season Final keeps its floor
    expect(clubWindow({ kind: "open", minRating: 95, playerRatings: [96, 97] })).toEqual({ lo: CLUB_MARK_MAX, hi: CLUB_MARK_MAX }); // 95 is above the best mark a horse can have
  });

  it("a clip that empties the window: the band's top or bottom CLUB_CLIPPED_SPAN marks", () => {
    expect(clubWindow({ kind: "banded", minRating: 0, maxRating: 55, playerRatings: [70] })).toEqual({ lo: 55 - CLUB_CLIPPED_SPAN, hi: 55 });
    expect(clubWindow({ kind: "open", minRating: 95, playerRatings: [60] })).toEqual({ lo: CLUB_MARK_MAX, hi: CLUB_MARK_MAX });
    expect(clubWindow({ kind: "banded", minRating: 70, maxRating: 95, playerRatings: [40] })).toEqual({ lo: 70, hi: 70 + CLUB_CLIPPED_SPAN });
  });

  it("nobody entered: an open race's nominal level, a banded race's middle", () => {
    expect(clubWindow({ kind: "open", playerRatings: [], nominal: clubNominalRating("listed") })).toEqual({ lo: 85 - B, hi: Math.min(CLUB_MARK_MAX, 85 + A) });
    expect(clubWindow({ kind: "banded", minRating: 50, maxRating: 75 })).toEqual({ lo: 62 - B, hi: Math.min(75, 62 + A) });
    expect(clubWindow({ kind: "banded", minRating: 85 })).toEqual({ lo: 85, hi: Math.min(CLUB_MARK_MAX, 85 + A) });
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

  it("targets: one per slice, deterministic, half near P and a few clearly above it", () => {
    const w = { lo: 48, hi: 60 }; // P = 50
    const t = clubTargets(w, 6, "seed-a");
    expect(t).toEqual(clubTargets(w, 6, "seed-a"));
    t.forEach((x, i) => {
      const s = clubStratum(w, 6, i);
      expect(x).toBeGreaterThanOrEqual(s.lo);
      expect(x).toBeLessThanOrEqual(s.hi);
    });
    expect(t.filter((x) => x <= 52).length).toBeGreaterThanOrEqual(3);
    expect(t[5]!).toBeGreaterThanOrEqual(55);
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

  it("lifting a genome moves the ability potentials (speed, stamina, burst) by the lift, the others by CLUB_LIFT_OTHER_PERMILLE of it", () => {
    const g = generateFoundationGenome("lift-test", { season: 1, rarity: "common" });
    const p0 = potentials(g);
    const p1 = potentials(liftGenome(g, 100));
    for (const k of STAT_KEYS) {
      const want = k === "speed" || k === "stamina" || k === "burst" ? 100 : Math.trunc((100 * CLUB_LIFT_OTHER_PERMILLE) / 1000);
      expect(Math.abs(p1[k] - p0[k] - want), k).toBeLessThanOrEqual(1);
    }
  });

  it("the mint lands on the target mark (several targets, trip and surface fitted)", () => {
    for (const target of [30, 42, 55, 63, 70, 80, 88]) {
      for (const [distanceM, surface] of [[1000, "turf"], [2000, "dirt"], [2800, "synthetic"]] as const) {
        const m = mintClubGenome({ seed: `race-${target}-${distanceM}`, index: 0, target, season: 12, distanceM, surface });
        expect(Math.abs(m.mark - target), `target ${target} at ${distanceM} ${surface}`).toBeLessThanOrEqual(CLUB_MARK_TOLERANCE);
        expect(m.fits).toBe(true);
        expect(clubFitsRace(m.genome, { distanceM, surface })).toBe(true);
        // the stored state's real ability is the mark
        expect(abilityMark(clubSeasonedState(m.genome, { target }))).toBe(m.mark);
        expect(clubMarkOf(m.genome, target)).toBe(m.mark);
      }
    }
  });

  it("is deterministic in the race seed", () => {
    const a = mintClubGenome({ seed: "det", index: 3, target: 72, season: 12, distanceM: 1600, surface: "turf" });
    const b = mintClubGenome({ seed: "det", index: 3, target: 72, season: 12, distanceM: 1600, surface: "turf" });
    expect(a).toEqual(b);
    expect(mintClubGenome({ seed: "det", index: 4, target: 72, season: 12, distanceM: 1600, surface: "turf" }).genome).not.toEqual(a.genome);
  });

  it("a mark at the edge of the window never lands outside it", () => {
    for (let i = 0; i < 40; i++) {
      const w = { lo: 63 + (i % 5), hi: 63 + (i % 5) };
      const m = mintClubGenome({ seed: `edge-${i}`, index: i, target: w.lo, window: w, season: 12, distanceM: 1600, surface: "dirt" });
      expect(m.mark).toBe(w.lo);
    }
  });

  it("race day: a Club runner carries a typical player horse's condition for its mark, whatever it did before", () => {
    const m = mintClubGenome({ seed: "rd", index: 0, target: 40, season: 12 });
    const base = clubSeasonedState(m.genome, { target: 40 });
    const tired = { ...base, condition: { ...base.condition, fatigue: 900, fatigueAtMs: 0, fitness: 300, bond: 0 } };
    const level = clubRaceDayLevel(abilityMark(base));
    for (const st of [base, tired]) {
      const rd = clubRaceDayState(st, 5_000_000);
      expect(rd.condition).toMatchObject({ fitness: level.fitness, fatigue: level.fatigue, fatigueAtMs: 5_000_000, bond: level.bond, lastHardWorkMs: null });
      expect(rd.recentRuns).toEqual([]);
      expect(abilityMark(rd)).toBe(abilityMark(base)); // condition never changes the mark
    }
  });

  it("race day: the Club runner's condition multiplier is the harness players' median for its mark", () => {
    for (const [target, want] of [[32, 975], [40, 985], [50, 985]] as const) {
      const m = mintClubGenome({ seed: `cond-${target}`, index: 0, target, season: 12 });
      const rd = clubRaceDayState(clubSeasonedState(m.genome, { target }), 5_000_000);
      expect(Math.abs(conditionReport(rd, 5_000_000).multiplier - want), `mark ${target}`).toBeLessThanOrEqual(2);
    }
  });

  it("about CLUB_OWN_SURFACE_PERMILLE of Club runners prefer the race's surface; an off-surface mint prefers another", () => {
    let own = 0;
    for (let i = 0; i < 2000; i++) if (clubOnOwnSurface(`s${i >> 3}`, i & 7)) own++;
    expect(Math.abs(own / 2 - CLUB_OWN_SURFACE_PERMILLE)).toBeLessThan(40);
    const off = mintClubGenome({ seed: "off", index: 0, target: 45, season: 12, distanceM: 1600, surface: "turf", offSurface: true });
    expect(off.fits).toBe(true);
    expect(clubFitsRace(off.genome, { surface: "turf" })).toBe(false);
  });

  it("an out-of-reach target settles for the closest mark", () => {
    const m = mintClubGenome({ seed: "far", index: 0, target: 140, season: 1 });
    // trained like a typical player horse, the best a genome can do is within a couple of the table's top
    expect(m.mark).toBeGreaterThanOrEqual(CLUB_MARK_MAX - 2);
  });
});

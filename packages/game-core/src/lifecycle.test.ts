import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BREED_FROM_STARTS,
  CAREER_MAX_STARTS,
  CARE_TO_RACING,
  careBonus,
  displayAge,
  normaliseLocation,
  pensionHorse,
  raceBlock,
  recommendedFeed,
  recordCare,
  releaseToClub,
  retireFromRacing,
  settleIdle,
  sexLabel,
  stageOf,
} from "./lifecycle";
import { currentStats, maturityOf, revealedRanges, toSharedHorse } from "./phenotype";
import { appraise } from "./economy";
import { HorseStateSchema, STAT_KEYS, type HorseState } from "./types";
import { DAY, HOUR, SILKS, T0, makeHorse } from "./test-helpers";
import { PREGNANCY_MS } from "./lifecycle";
import { seedFrom } from "./rng";

describe("stages on the career clock", () => {
  it("foal → weanling → yearling → juvenile by care sessions (5 / 7 / 7)", () => {
    const at = (care: number) => stageOf(makeHorse("s", { care }));
    expect(at(0)).toBe("foal");
    expect(at(4)).toBe("foal");
    expect(at(5)).toBe("weanling");
    expect(at(11)).toBe("weanling");
    expect(at(12)).toBe("yearling");
    expect(at(18)).toBe("yearling");
    expect(at(CARE_TO_RACING)).toBe("juvenile");
  });
  it("juvenile 0–6, prime 7–28, veteran 29–40 starts; retired → stud → pasture", () => {
    const at = (starts: number) => stageOf(makeHorse("s", { starts }));
    expect(at(6)).toBe("juvenile");
    expect(at(7)).toBe("prime");
    expect(at(28)).toBe("prime");
    expect(at(29)).toBe("veteran");
    expect(at(40)).toBe("veteran");
    const retired = makeHorse("s", { starts: 12, retired: true });
    expect(stageOf(retired)).toBe("stud");
    expect(stageOf({ ...retired, breeding: { used: 4, bySeason: [] } })).toBe("pasture");
    expect(stageOf(pensionHorse(makeHorse("s")))).toBe("pasture");
  });
  it("display age and sex follow the career, never the calendar", () => {
    expect(displayAge(makeHorse("a", { care: 0 }))).toBe(0);
    expect(displayAge(makeHorse("a", { care: 14 }))).toBe(1);
    expect(displayAge(makeHorse("a", { starts: 0 }))).toBe(2);
    expect(displayAge(makeHorse("a", { starts: 40 }))).toBe(7);
    expect(sexLabel(makeHorse("a", { sex: "filly", starts: BREED_FROM_STARTS - 1 }))).toBe("filly");
    expect(sexLabel(makeHorse("a", { sex: "filly", starts: BREED_FROM_STARTS }))).toBe("mare");
    expect(sexLabel(makeHorse("a", { sex: "colt", retired: true }))).toBe("stallion");
  });
});

describe("care", () => {
  it("counts at most one session per horse per real day; missed days only pause", () => {
    let h = makeHorse("c", { care: 0 });
    const r1 = recordCare(h, "growth_mix", T0 + 10 * HOUR);
    expect(r1.counted).toBe(true);
    const r2 = recordCare(r1.state, "growth_mix", T0 + 20 * HOUR);
    expect(r2.counted).toBe(false);
    expect(r2.state).toBe(r1.state);
    // 30 days away, then come back: growth resumes from where it paused.
    const r3 = recordCare(r2.state, "growth_mix", T0 + 30 * DAY);
    expect(r3.counted).toBe(true);
    expect(r3.state.care.sessions).toBe(2);
    h = r3.state;
    expect(stageOf(h)).toBe("foal");
  });
  it("right feed raises care quality and the care bonus (≤ +5%)", () => {
    let h = makeHorse("q", { care: 0 });
    for (let d = 0; d < 10; d++) h = recordCare(h, recommendedFeed(h, T0 + d * DAY), T0 + d * DAY).state;
    expect(h.care.quality).toBeGreaterThan(900);
    expect(careBonus(h)).toBeLessThanOrEqual(50);
    expect(careBonus(h)).toBeGreaterThan(40);
  });
  it("19 daily sessions take a foal to racing age", () => {
    let h = makeHorse("g", { care: 0 });
    for (let d = 0; d < CARE_TO_RACING; d++) h = recordCare(h, "growth_mix", T0 + d * DAY).state;
    expect(stageOf(h)).toBe("juvenile");
  });
});

describe("inactivity never harms (property)", () => {
  const stateArb = fc.record({
    seed: fc.string({ minLength: 1 }),
    care: fc.integer({ min: 0, max: 30 }),
    starts: fc.integer({ min: 0, max: CAREER_MAX_STARTS }),
    retired: fc.boolean(),
    fatigue: fc.integer({ min: 0, max: 1000 }),
    injured: fc.boolean(),
    pregnant: fc.boolean(),
  });
  const build = (x: { seed: string; care: number; starts: number; retired: boolean; fatigue: number; injured: boolean; pregnant: boolean }): HorseState => {
    const h = makeHorse(x.seed, { care: x.care, starts: x.starts, retired: x.retired, sex: "filly" });
    return {
      ...h,
      condition: { ...h.condition, fatigue: x.fatigue, fatigueAtMs: T0, lastHardWorkMs: T0 },
      injury: x.injured ? { severity: "minor", atMs: T0, unitsRequired: 72, bonusUnits: 0, vetLevel: 0, source: "r" } : null,
      pregnancy: x.pregnant ? { sireId: "s", coveredAtMs: T0, dueAtMs: T0 + PREGNANCY_MS, coi: 0, foalSeed: seedFrom("f") } : null,
    };
  };

  it("settleIdle changes nothing but injury healing and pregnancy completion", () => {
    fc.assert(
      fc.property(stateArb, fc.integer({ min: 0, max: 400 * DAY }), (x, dt) => {
        const s = build(x);
        expect(HorseStateSchema.safeParse(s).success).toBe(true);
        const { state, events } = settleIdle(s, T0 + dt);
        const strip = (h: HorseState) => ({ ...h, injury: null });
        expect(strip(state)).toEqual(strip(s));
        if (!events.healed) expect(state.injury).toEqual(s.injury);
        expect(events.foalDue).toBe(s.pregnancy !== null && dt >= PREGNANCY_MS);
      }),
      { numRuns: 300 },
    );
  });

  it("no age, stage, maturity, potential, realisation or appraisal change from elapsed time alone", () => {
    fc.assert(
      fc.property(stateArb, fc.integer({ min: 0, max: 400 * DAY }), (x, dt) => {
        const s = build(x);
        const later = settleIdle(s, T0 + dt).state;
        expect(stageOf(later)).toBe(stageOf(s));
        expect(displayAge(later)).toBe(displayAge(s));
        for (const k of STAT_KEYS) expect(maturityOf(later, k)).toBe(maturityOf(s, k));
        expect(currentStats(later)).toEqual(currentStats(s));
        expect(revealedRanges(later)).toEqual(revealedRanges(s));
        expect(appraise(later)).toBe(appraise(s));
      }),
      { numRuns: 200 },
    );
  });

  it("a rested horse is never below its fresh baseline, however long the owner is away", () => {
    fc.assert(
      fc.property(stateArb, fc.integer({ min: 9 * DAY, max: 1000 * DAY }), (x, dt) => {
        const s = build({ ...x, injured: false });
        const fresh = { ...s, condition: { ...s.condition, fatigue: 0, lastHardWorkMs: null } };
        const a = toSharedHorse(s, T0 + dt, SILKS);
        const b = toSharedHorse(fresh, T0 + dt, SILKS);
        expect(a.stats).toEqual(b.stats);
      }),
      { numRuns: 100 },
    );
  });
});

describe("racing blocks, retirement, pension, release", () => {
  it("hard cap: 3 starts per horse per real day", () => {
    const h = makeHorse("r", { starts: 3 });
    const runs = [0, 1, 2].map((i) => ({ atMs: T0 + i * HOUR, position: 1, fieldSize: 8, raceId: `r${i}` }));
    expect(raceBlock({ ...h, recentRuns: runs.slice(0, 2) }, T0 + 3 * HOUR)).toBeNull();
    expect(raceBlock({ ...h, recentRuns: runs }, T0 + 3 * HOUR)).toBe("daily_limit");
    expect(raceBlock({ ...h, recentRuns: runs }, T0 + DAY + HOUR)).toBeNull();
  });
  it("blocks foals, retired, injured and in-foal horses", () => {
    expect(raceBlock(makeHorse("a", { care: 3 }), T0)).toBe("not_racing_age");
    expect(raceBlock(retireFromRacing(makeHorse("a"), "choice"), T0)).toBe("retired");
    const inj = { ...makeHorse("a"), injury: { severity: "minor" as const, atMs: T0, unitsRequired: 48, bonusUnits: 0, vetLevel: 0, source: "x" } };
    expect(raceBlock(inj, T0 + HOUR)).toBe("injured");
    expect(raceBlock(inj, T0 + 49 * HOUR)).toBeNull();
  });
  it("pension moves to the Legacy Farm (no stall); release hands the horse to the Club", () => {
    const p = pensionHorse(makeHorse("p"));
    expect(p.location).toBe("legacy_farm");
    expect(p.career.pastured).toBe(true);
    const spent = { ...retireFromRacing(makeHorse("s"), "max_starts"), breeding: { used: 4, bySeason: [] } };
    expect(normaliseLocation(spent).location).toBe("legacy_farm");
    const r = releaseToClub(makeHorse("c"));
    expect(r.location).toBe("club");
    expect(r.ownerId).toBe("club");
  });
});

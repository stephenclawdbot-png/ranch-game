import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { allowedWorkouts, nextPlannedWorkout, previewTraining, realisationGain, slotsFor, train, DEFAULT_PLAN, WORKOUTS } from "./training";
import { STAT_KEYS, WorkoutSchema, type Workout } from "./types";
import { DAY, HOUR, T0, makeHorse } from "./test-helpers";
import { weekStartMs, weekIndex } from "./time";

const MON = weekStartMs(weekIndex(T0) + 1) + 9 * HOUR;
const ctx = { nowMs: MON, trainerLevel: 0, vetLevel: 0, credits: 10_000 };

describe("training", () => {
  it("diminishing returns near the ceiling", () => {
    expect(realisationGain(600, 30)).toBeGreaterThan(realisationGain(900, 30));
    expect(realisationGain(1000, 30)).toBe(0);
    fc.assert(fc.property(fc.integer({ min: 600, max: 999 }), fc.integer({ min: 1, max: 40 }), (r, b) => {
      expect(r + realisationGain(r, b)).toBeLessThanOrEqual(1000);
    }));
  });

  it("3 sessions per week (4 with a Trainer), resets the next week; costs credits", () => {
    let h = makeHorse("t", { starts: 5 });
    for (let i = 0; i < 3; i++) {
      const r = train(h, "swimming", { ...ctx, nowMs: MON + i * DAY });
      expect(r.ok).toBe(true);
      expect(r.cost).toBe(WORKOUTS.swimming.cost);
      h = r.state;
    }
    expect(train(h, "swimming", { ...ctx, nowMs: MON + 3 * DAY }).block).toBe("week_full");
    expect(train(h, "swimming", { ...ctx, nowMs: MON + 3 * DAY, trainerLevel: 1 }).ok).toBe(true);
    expect(train(h, "swimming", { ...ctx, nowMs: MON + 7 * DAY }).ok).toBe(true);
    expect(slotsFor(1)).toBe(4);
    expect(train(makeHorse("p"), "speed_work", { ...ctx, credits: 10 }).block).toBe("insufficient_credits");
  });

  it("realisation never decreases and stays in 600..1000 for any workout sequence", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom<Workout>(...WorkoutSchema.options), { maxLength: 30 }), fc.string(), (plan, seed) => {
        let h = makeHorse(seed, { starts: 10 });
        plan.forEach((w, i) => {
          const before = h.training.realisation;
          const r = train(h, w, { ...ctx, nowMs: MON + i * 2 * DAY, trainerLevel: 1 });
          h = r.state;
          for (const k of STAT_KEYS) {
            expect(h.training.realisation[k]).toBeGreaterThanOrEqual(before[k]);
            expect(h.training.realisation[k]).toBeLessThanOrEqual(1000);
          }
          if (r.injured) expect(h.injury?.severity).toBe("minor");
        });
      }),
      { numRuns: 100 },
    );
  });

  it("overwork pays less and can cause only a minor injury", () => {
    let h = makeHorse("ow", { starts: 10 });
    h = { ...h, condition: { ...h.condition, fatigue: 1000, fatigueAtMs: MON } };
    const fresh = train(makeHorse("ow", { starts: 10 }), "speed_work", ctx);
    const tired = train(h, "speed_work", ctx);
    expect(tired.overworked).toBe(true);
    expect(tired.state.training.realisation.speed - 600).toBeLessThan(fresh.state.training.realisation.speed - 600);
    let injuries = 0;
    for (let i = 0; i < 400; i++) {
      const r = train(h, "speed_work", ctx, `inj${i}`);
      if (r.injured) {
        injuries++;
        expect(r.state.injury!.severity).toBe("minor");
        expect(r.state.injury!.unitsRequired).toBeLessThanOrEqual(96);
      }
    }
    expect(injuries).toBeGreaterThan(0);
  });

  it("foals can't train; yearlings only light work; plan picks the next slot", () => {
    expect(allowedWorkouts(makeHorse("f", { care: 2 }))).toEqual([]);
    expect(allowedWorkouts(makeHorse("y", { care: 13 })).sort()).toEqual(["gate_practice", "rest", "swimming"]);
    expect(train(makeHorse("y", { care: 13 }), "speed_work", ctx).block).toBe("not_light");
    expect(nextPlannedWorkout(DEFAULT_PLAN, makeHorse("n"), MON)).toBe("speed_work");
  });

  it("the preview is exactly what the session then does (gains, fatigue, overwork, cost)", () => {
    fc.assert(
      fc.property(fc.constantFrom<Workout>(...WorkoutSchema.options), fc.integer({ min: 0, max: 900 }), fc.string(), (w, fatigue, seed) => {
        const base = makeHorse(seed, { starts: 10 });
        const h = { ...base, condition: { ...base.condition, fatigue, fatigueAtMs: MON } };
        const p = previewTraining(h, w, ctx);
        const r = train(h, w, ctx, "fixed-seed");
        expect(p.block).toBe(r.ok ? null : r.block);
        if (!r.ok) return;
        for (const k of STAT_KEYS) expect(r.state.training.realisation[k] - h.training.realisation[k], `${w} ${k}`).toBe(p.gains[k] ?? 0);
        expect(r.state.condition.fatigue).toBe(p.fatigueAfter);
        expect(r.overworked).toBe(p.overworked);
        expect(r.cost).toBe(p.cost);
        if (p.injuryPermille === 0) expect(r.injured).toBe(false);
      }),
    );
  });
});

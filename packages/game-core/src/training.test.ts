import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { allowedWorkouts, nextPlannedWorkout, peakAfter, previewTraining, readyInHours, realisationGain, slotsFor, train, DEFAULT_PLAN, WORKOUTS } from "./training";
import { FATIGUE_RECOVERY_PER_HOUR, TIRED_THRESHOLD } from "./condition";
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

  it("each session's peak window and wait come from the fatigue it itself adds (fix 9)", () => {
    // readyInHours: 0 at or below the tired line, then whole hours of recovery above it.
    expect(readyInHours(0)).toBe(0);
    expect(readyInHours(TIRED_THRESHOLD)).toBe(0);
    expect(readyInHours(TIRED_THRESHOLD + 1)).toBe(1);
    expect(readyInHours(1000)).toBe(Math.ceil((1000 - TIRED_THRESHOLD) / FATIGUE_RECOVERY_PER_HOUR));

    // A fresh horse (no hard work behind it): the hard session sets up the standard 72-120h window.
    const h = makeHorse("pv", { starts: 10 });
    const speed = previewTraining(h, "speed_work", ctx);
    expect(speed.fatigueAfter).toBe(WORKOUTS.speed_work.fatigue);
    expect(speed.readyInH).toBe(0); // 260 permille never crosses the tired line
    expect(speed.peak).toEqual({ fromMs: MON + 72 * HOUR, toMs: MON + 120 * HOUR, setsUp: true });
    // Light work and rest set nothing up when there is nothing pending to keep.
    expect(previewTraining(h, "swimming", ctx).peak).toBeNull();
    expect(previewTraining(h, "rest", ctx).peak).toBeNull();

    // peakAfter directly: even at max fatigue the wait (59h) is shorter than the 72h the peak
    // takes to build, so the window itself never moves — readyInH is the separate honest number
    // for how long the horse is below par first.
    const worst = peakAfter(null, MON, true)!;
    expect(worst).toEqual({ fromMs: MON + 72 * HOUR, toMs: MON + 120 * HOUR, setsUp: true });
    expect(worst.fromMs).toBeLessThanOrEqual(worst.toMs);
    expect(readyInHours(1000) * HOUR).toBeLessThan(72 * HOUR);
    // Light work keeps a pending window (yesterday's hard work: peak still entirely to come).
    const yesterday = MON - 24 * HOUR;
    expect(peakAfter(yesterday, MON, false)).toEqual({ fromMs: yesterday + 72 * HOUR, toMs: yesterday + 120 * HOUR, setsUp: false });
    // Already inside the plateau: what remains starts now.
    expect(peakAfter(MON - 96 * HOUR, MON, false)).toEqual({ fromMs: MON, toMs: MON + 24 * HOUR, setsUp: false });
    // The plateau is over, or there never was one: nothing to keep.
    expect(peakAfter(MON - 130 * HOUR, MON, false)).toBeNull();
    expect(peakAfter(null, MON, false)).toBeNull();

    // From a tired horse the same hard session is honestly slower to be race-ready: the fatigue
    // it leaves is what you wait out, and that wait is what the board now shows per session.
    const tiredH = { ...h, condition: { ...h.condition, fatigue: 1000, fatigueAtMs: MON } };
    const tiredSpeed = previewTraining(tiredH, "speed_work", ctx);
    expect(tiredSpeed.fatigueAfter).toBe(1000);
    expect(tiredSpeed.readyInH).toBe(readyInHours(1000));
    expect(tiredSpeed.peak).toEqual({ fromMs: MON + 72 * HOUR, toMs: MON + 120 * HOUR, setsUp: true });
  });
});

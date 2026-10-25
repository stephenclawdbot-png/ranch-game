import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { conditionReport, fatigueAt, freshnessBonus, healingHours, hoursToHeal, injuryRisk, isHealed, morale, rollInjury, tiredPenalty, withFatigue, FRESHNESS_PEAK_BONUS } from "./condition";
import { DAY, HOUR, T0, makeHorse } from "./test-helpers";
import type { Going, RideIntensity } from "@thoroughbred/shared";
import { seedFrom } from "./rng";

const base = makeHorse("cond", { starts: 10 });
const ctx = { nowMs: T0, going: "good" as Going, distanceM: 1600, intensity: "normal" as RideIntensity, stage: "prime" as const };

describe("fatigue and freshness", () => {
  it("fatigue only recovers with time (monotone non-increasing)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 10 * DAY }), fc.integer({ min: 0, max: 10 * DAY }), (f, a, b) => {
        const s = { ...base, condition: { ...base.condition, fatigue: f, fatigueAtMs: T0 } };
        const [t1, t2] = a < b ? [a, b] : [b, a];
        expect(fatigueAt(s, T0 + t2)).toBeLessThanOrEqual(fatigueAt(s, T0 + t1));
        expect(fatigueAt(s, T0 + t1)).toBeLessThanOrEqual(f);
      }),
    );
  });
  it("freshness peaks 3–5 days after hard work", () => {
    expect(freshnessBonus(T0, T0 + DAY)).toBe(0);
    expect(freshnessBonus(T0, T0 + 3 * DAY)).toBe(FRESHNESS_PEAK_BONUS);
    expect(freshnessBonus(T0, T0 + 4 * DAY)).toBe(FRESHNESS_PEAK_BONUS);
    expect(freshnessBonus(T0, T0 + 5 * DAY)).toBe(FRESHNESS_PEAK_BONUS);
    expect(freshnessBonus(T0, T0 + 6 * DAY)).toBeLessThan(FRESHNESS_PEAK_BONUS);
    expect(freshnessBonus(T0, T0 + 9 * DAY)).toBe(0);
    expect(freshnessBonus(null, T0)).toBe(0);
  });
  it("racing tired costs performance; back-to-back runs dip form", () => {
    expect(tiredPenalty(200)).toBe(0);
    expect(tiredPenalty(1000)).toBeGreaterThan(tiredPenalty(600));
    const tired = withFatigue(base, 700, T0, true);
    expect(conditionReport(tired, T0 + HOUR).multiplier).toBeLessThan(conditionReport(base, T0 + HOUR).multiplier);
    expect(conditionReport(tired, T0 + 4 * DAY).multiplier).toBeGreaterThan(conditionReport(tired, T0 + HOUR).multiplier);
  });
  it("morale reflects recent results and bond", () => {
    const wins = { ...base, recentRuns: [1, 1, 2].map((p, i) => ({ atMs: T0 + i, position: p, fieldSize: 10, raceId: `w${i}` })) };
    const losses = { ...base, recentRuns: [9, 10, 8].map((p, i) => ({ atMs: T0 + i, position: p, fieldSize: 10, raceId: `l${i}` })) };
    expect(morale(wins)).toBeGreaterThan(morale(base));
    expect(morale(losses)).toBeLessThan(morale(base));
  });
});

describe("injury risk (shown before entry)", () => {
  it("rises with fatigue, frequency, going and an all-out ride; capped", () => {
    const r0 = injuryRisk(base, ctx).permille;
    expect(injuryRisk(withFatigue(base, 900, T0, true), ctx).permille).toBeGreaterThan(r0);
    expect(injuryRisk(base, { ...ctx, going: "heavy" }).permille).toBeGreaterThanOrEqual(r0);
    expect(injuryRisk(base, { ...ctx, intensity: "all_out" }).permille).toBeGreaterThan(r0);
    expect(injuryRisk(base, { ...ctx, intensity: "conservative" }).permille).toBeLessThanOrEqual(r0);
    const busy = { ...base, recentRuns: [0, 1].map((i) => ({ atMs: T0 - i * HOUR, position: 5, fieldSize: 8, raceId: `b${i}` })) };
    expect(injuryRisk(busy, ctx).permille).toBeGreaterThan(r0);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.constantFrom<Going>("firm", "good", "soft", "heavy"), fc.constantFrom<RideIntensity>("conservative", "normal", "all_out"), (f, going, intensity) => {
        const r = injuryRisk(withFatigue(base, f, T0, true), { ...ctx, going, intensity });
        expect(r.permille).toBeGreaterThanOrEqual(1);
        expect(r.permille).toBeLessThanOrEqual(80);
      }),
    );
  });
  it("rolls are deterministic, never fatal, and match the stated odds", () => {
    let hits = 0;
    for (let i = 0; i < 20000; i++) {
      const inj = rollInjury({ permille: 10, careerEndingShare: 30 }, seedFrom("roll", i), T0, 0, "r");
      if (inj) {
        hits++;
        expect(["minor", "moderate", "career_ending"]).toContain(inj.severity);
        expect(inj.unitsRequired).toBeGreaterThan(0);
      }
    }
    expect(hits).toBeGreaterThan(140);
    expect(hits).toBeLessThan(260);
    expect(rollInjury({ permille: 10, careerEndingShare: 30 }, "x", T0, 0, "r")).toEqual(rollInjury({ permille: 10, careerEndingShare: 30 }, "x", T0, 0, "r"));
  });
  it("healing progresses with real time, faster with a vet and care", () => {
    const inj = { severity: "minor" as const, atMs: T0, unitsRequired: 72, bonusUnits: 0, vetLevel: 0, source: "x" };
    expect(isHealed(inj, T0 + 71 * HOUR)).toBe(false);
    expect(isHealed(inj, T0 + 72 * HOUR)).toBe(true);
    expect(healingHours({ ...inj, vetLevel: 2 }, T0 + 48 * HOUR)).toBe(72);
    expect(hoursToHeal({ ...inj, bonusUnits: 24 }, T0)).toBe(48);
  });
});

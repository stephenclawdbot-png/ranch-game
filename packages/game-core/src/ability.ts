/**
 * Ability mark: the OR a horse of the horse's CURRENT running ability settles at.
 *
 * New horses start at OR 40 whatever their genes (lifecycle INITIAL_OR), so without a floor a
 * strong newcomer can farm the low handicap bands and the maidens until its rating catches up.
 * The mark is calibrated, not guessed: tools/balance/ability.report.ts runs a population of
 * horses with known abilities through rated races (the engine + updateRatings, handicap weights
 * and the card's bands) until the ORs settle, then fits the monotone table below. The report
 * output lives in tools/balance/out/ability.current.txt.
 */
import { OR_MAX, OR_MIN } from "./ratings";
import { clampInt } from "./rng";
import { preferredDistanceM } from "./genome";
import { currentStats } from "./phenotype";
import type { HorseState } from "./types";

/**
 * Trip-weighted blend of the current speed / stamina / burst (the stat scale: 650 = plain
 * horse). Stamina matters more the further the trip (25% at 1,000 m, 75% at 3,200 m), the
 * burst kick decides sprints (30% at 1,000 m, tailing off with distance).
 */
export function abilityScore(stats: { speed: number; stamina: number; burst: number }, tripM: number): number {
  const staminaW = clampInt(250 + ((tripM - 1000) * 500) / 2200, 250, 750);
  const burstW = clampInt(300 - ((tripM - 1000) * 1000) / 6000, 50, 300);
  const speedW = 1000 - staminaW - burstW;
  return clampInt((stats.speed * speedW + stats.stamina * staminaW + stats.burst * burstW) / 1000, 0, 1000);
}

/**
 * Monotone piecewise-linear ability score → settled OR, fitted by tools/balance/ability.report.ts
 * (knots as [score, or]; clamped flat outside the range). A ~10 OR spread per grade is what the
 * engine + updateRatings actually produce (one grade better wins ~49% of 8-runner races) once
 * 1 OR = 1 lb handicap weights equalise the bands; the starter-grade mode (~500) settles at the
 * OR 40 newcomers enter at.
 */
export const ABILITY_OR_TABLE: readonly (readonly [number, number])[] = [
  [300, 18],
  [350, 23],
  [400, 29],
  [450, 35],
  [500, 41],
  [550, 46],
  [600, 51],
  [650, 56],
  [700, 61],
  [750, 67],
  [800, 76],
  [850, 85],
  [900, 97],
];

/** The settled OR of an ability score (piecewise-linear in ABILITY_OR_TABLE, clamped at the ends). */
export function abilityOrOf(score: number): number {
  const t = ABILITY_OR_TABLE;
  if (score <= t[0]![0]) return t[0]![1];
  for (let i = 1; i < t.length; i++) {
    if (score <= t[i]![0]) {
      const [s0, o0] = t[i - 1]!;
      const [s1, o1] = t[i]!;
      return clampInt(o0 + ((o1 - o0) * (score - s0)) / (s1 - s0), OR_MIN, OR_MAX);
    }
  }
  return t[t.length - 1]![1];
}

/** The ability mark of a horse today: its current running ability at its best trip, on today's maturity. */
export function abilityMark(state: HorseState): number {
  return abilityOrOf(abilityScore(currentStats(state), preferredDistanceM(state.genome)));
}
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
  [300, 17],
  [350, 23],
  [400, 30],
  [450, 36],
  [500, 41],
  [550, 45],
  [600, 48],
  [650, 53],
  [700, 57],
  [750, 62],
  [800, 68],
  [850, 74],
  [900, 92],
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

// The horse-level mark (abilityMark: current stats at the best trip) lives in phenotype.ts, next
// to currentStats, so this file stays free of the phenotype (which uses it for handicap weights).

/**
 * The ability score whose mark is `or` (the inverse of ABILITY_OR_TABLE, piecewise linear, integer).
 * Beyond the table's ends it carries on along the end segments, so every OR has a score.
 */
export function abilityScoreOfOr(or: number): number {
  const t = ABILITY_OR_TABLE;
  let i = 1;
  while (i < t.length - 1 && or > t[i]![1]) i++;
  const [s0, o0] = t[i - 1]!;
  const [s1, o1] = t[i]!;
  return Math.trunc(s0 + ((s1 - s0) * (or - o0)) / (o1 - o0));
}

/**
 * Handicap weight in pounds on the OR scale (1 OR = 1 lb, as in real handicapping): what one lb
 * carried costs, in OR of ability. The weights a handicap assigns (ratings.handicapWeights) then
 * bring the field together exactly as far as their ratings set them apart.
 */
export const OR_PER_LB = 1;

/**
 * Ability-score points a horse whose score is `score` loses carrying `lb` extra pounds: the
 * score distance between its mark and the mark `lb` OR lower (so it costs the same OR wherever on
 * the scale the horse sits; the table is steeper in points at the bottom than the top).
 */
export function weightCostPoints(score: number, lb: number): number {
  if (lb <= 0) return 0;
  const or = abilityOrOf(score);
  return Math.max(0, abilityScoreOfOr(or) - abilityScoreOfOr(or - lb * OR_PER_LB));
}

/**
 * Racing stats carrying `lb` extra pounds: speed, stamina and burst each lose the weight's cost,
 * so the ability score at the horse's best trip falls by exactly that (weights are a blend that
 * sums to 1) and its mark by `lb` OR.
 */
export function carryWeight<S extends { speed: number; stamina: number; burst: number }>(stats: S, bestTripM: number, lb: number): S {
  const cost = weightCostPoints(abilityScore(stats, bestTripM), lb);
  if (cost === 0) return stats;
  return { ...stats, speed: stats.speed - cost, stamina: stats.stamina - cost, burst: stats.burst - cost };
}
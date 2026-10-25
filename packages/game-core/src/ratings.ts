/**
 * Official rating (OR, the handicapper's mark, 0..140) and handicap weights.
 *
 * OR update (Elo-like, bounded): each runner is scored against every other runner in the
 * field (1 for finishing ahead, 0 behind). Expected score uses a logistic curve where 25 OR
 * points = 10:1 odds. Delta = K × (actual − expected) / (n − 1), clamped per race.
 * Provisional horses (first 5 rated runs) move faster. The sum of deltas in a race is ~0,
 * so the system does not inflate.
 *
 * 10^(d/25) is computed from a table built by repeated multiplication (exact IEEE ops only),
 * so results are identical on every JS engine.
 */
import { clampInt } from "./rng";

export const OR_MIN = 0;
export const OR_MAX = 140;
/** OR points for 10:1 expected-score odds. */
export const OR_SCALE = 25;
export const K_PROVISIONAL = 14;
export const K_ESTABLISHED = 7;
export const PROVISIONAL_RUNS = 5;
export const MAX_GAIN_PER_RACE = 10;
export const MAX_LOSS_PER_RACE = 7;

const TEN_POW_STEP = 1.0964781961431851; // 10^(1/25)
const POW_TABLE: number[] = (() => {
  const t = [1];
  for (let i = 1; i <= OR_MAX; i++) t.push(t[i - 1]! * TEN_POW_STEP);
  return t;
})();

/** Expected score of a horse rated `a` against one rated `b` (0..1). */
export function expectedScore(a: number, b: number): number {
  const d = clampInt(b - a, -OR_MAX, OR_MAX);
  const p = d >= 0 ? POW_TABLE[d]! : 1 / POW_TABLE[-d]!;
  return 1 / (1 + p);
}

export interface RatedRunner {
  horseId: string;
  or: number;
  ratedRuns: number;
  /** Finishing position (1 = winner). Equal positions are dead heats. */
  position: number;
}

export interface RatingChange {
  horseId: string;
  before: number;
  after: number;
  delta: number;
}

/** New ORs after a race. Deterministic and order-independent. */
export function updateRatings(field: readonly RatedRunner[]): RatingChange[] {
  const n = field.length;
  if (n < 2) return field.map((r) => ({ horseId: r.horseId, before: r.or, after: r.or, delta: 0 }));
  return field.map((me) => {
    let actual = 0;
    let expected = 0;
    for (const other of field) {
      if (other.horseId === me.horseId) continue;
      actual += me.position < other.position ? 1 : me.position === other.position ? 0.5 : 0;
      expected += expectedScore(me.or, other.or);
    }
    const k = me.ratedRuns < PROVISIONAL_RUNS ? K_PROVISIONAL : K_ESTABLISHED;
    const raw = Math.round((k * (actual - expected) * 4) / (n - 1)) / 4;
    const delta = clampInt(raw, -MAX_LOSS_PER_RACE, MAX_GAIN_PER_RACE);
    const after = clampInt(me.or + delta, OR_MIN, OR_MAX);
    return { horseId: me.horseId, before: me.or, after, delta: after - me.or };
  });
}

// ---------------------------------------------------------------------------
// Handicap weights
// ---------------------------------------------------------------------------

/** Top weight (lb) and the floor; 1 OR point = 1 lb (UK convention). */
export const TOP_WEIGHT_LB = 140; // 10st 0lb
export const BOTTOM_WEIGHT_LB = 112; // 8st 0lb
export const LEVEL_WEIGHT_LB = 126; // 9st 0lb

export interface WeightAssignment {
  horseId: string;
  weightLb: number;
  /** lb above the lightest runner (feeds phenotype `extraWeightLb`). */
  extraLb: number;
}

/**
 * Handicap weights: the top-rated runner carries top weight; everyone else carries 1 lb less
 * per OR point below it, floored at the bottom weight. Non-handicaps run at level weights.
 */
export function handicapWeights(field: readonly { horseId: string; or: number }[], handicap: boolean): WeightAssignment[] {
  if (field.length === 0) return [];
  const top = Math.max(...field.map((f) => f.or));
  const raw = field.map((f) => ({ horseId: f.horseId, weightLb: handicap ? Math.max(BOTTOM_WEIGHT_LB, TOP_WEIGHT_LB - (top - f.or)) : LEVEL_WEIGHT_LB }));
  const min = Math.min(...raw.map((r) => r.weightLb));
  return raw.map((r) => ({ ...r, extraLb: r.weightLb - min }));
}

export function formatWeight(lb: number): string {
  return `${Math.floor(lb / 14)}st ${lb % 14}lb`;
}

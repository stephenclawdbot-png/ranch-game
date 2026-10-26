/**
 * Abstract race-outcome model (Thurstone): each runner's performance = ability + noise. The real
 * engine is far too slow for millions of simulated runs, so we calibrate one number, the noise
 * sigma (in form-guide rating points), to the engine's measured behaviour in docs/balance.md:
 *
 *   "+150 speed (650 -> 800) ~ 3.5x win odds" against nine equal horses (10% -> ~35%).
 *   Speed is ~60% of the form-guide rating, so +150 speed ~ +90 rating.
 *
 * Class fields are drawn from rating windows (docs/balance.md: class windows), modelled as a
 * field ability spread of FIELD_SD around the class mean.
 */
import { SimRng } from "./rng.ts";
import { PURSE_SPLIT } from "./constants.ts";

export const CALIBRATION = { edge: 90, targetWin: 0.35, fieldSize: 10 } as const;
export const FIELD_SD = 25;

let SIGMA = 0;

function simWin(rng: SimRng, edge: number, n: number, sigma: number, fieldSd: number, trials: number): number {
  let wins = 0;
  for (let t = 0; t < trials; t++) {
    const me = edge + sigma * rng.normal();
    let beaten = false;
    for (let i = 1; i < n; i++) {
      if (fieldSd * rng.normal() + sigma * rng.normal() > me) {
        beaten = true;
        break;
      }
    }
    if (!beaten) wins++;
  }
  return wins / trials;
}

/** Solves sigma by bisection (fixed seed, deterministic). */
export function calibrate(): number {
  if (SIGMA) return SIGMA;
  let lo = 20;
  let hi = 400;
  for (let it = 0; it < 22; it++) {
    const mid = (lo + hi) / 2;
    const w = simWin(new SimRng("calibrate"), CALIBRATION.edge, CALIBRATION.fieldSize, mid, FIELD_SD, 40_000);
    if (w > CALIBRATION.targetWin) lo = mid;
    else hi = mid;
  }
  SIGMA = Math.round((lo + hi) / 2);
  return SIGMA;
}

export function sigma(): number {
  return SIGMA || calibrate();
}

/** Finishing position (1-based) of a runner with `edge` over the class mean in an n-runner field. */
export function drawPosition(rng: SimRng, edge: number, n: number, fieldSd = FIELD_SD): number {
  const s = sigma();
  const me = edge + s * rng.normal();
  let pos = 1;
  for (let i = 1; i < n; i++) if (fieldSd * rng.normal() + s * rng.normal() > me) pos++;
  return pos;
}

const shareCache = new Map<string, number>();
/** Expected share of the purse (0..1) for a runner with `edge` in an n-runner field. */
export function expectedPurseShare(edge: number, n: number): number {
  const key = `${Math.round(edge)}|${n}`;
  const hit = shareCache.get(key);
  if (hit !== undefined) return hit;
  const rng = new SimRng(`share|${key}`);
  let total = 0;
  const trials = 20_000;
  for (let t = 0; t < trials; t++) {
    const p = drawPosition(rng, edge, n);
    total += PURSE_SPLIT[p - 1] ?? 0;
  }
  const v = total / trials;
  shareCache.set(key, v);
  return v;
}

const winCache = new Map<string, number>();
export function winProbability(edge: number, n: number, fieldSd = FIELD_SD): number {
  const key = `${Math.round(edge)}|${n}|${fieldSd}`;
  const hit = winCache.get(key);
  if (hit !== undefined) return hit;
  const v = simWin(new SimRng(`win|${key}`), edge, n, sigma(), fieldSd, 20_000);
  winCache.set(key, v);
  return v;
}

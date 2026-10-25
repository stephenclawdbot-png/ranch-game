/**
 * Gallop gait maths (pure, unit-tested). Units: horse-local centimetres,
 * x forward, y DOWN (screen convention), ground at y = 0.
 *
 * Transverse (4-beat) gallop on the right lead: left hind, right hind, left fore,
 * right fore, then a suspension phase. The stride phase is driven by distance
 * travelled, so a stance hoof moves backwards exactly at ground speed: no sliding.
 */

export type LegId = "FL" | "FR" | "HL" | "HR";

export const GALLOP = {
  /** Fraction of the stride each hoof is on the ground. */
  duty: 0.18,
  /** Footfall phase offsets (fraction of stride). */
  offsets: { HL: 0.0, HR: 0.13, FL: 0.34, FR: 0.48 } as Record<LegId, number>,
  /** Phase of peak suspension (body highest). */
  suspensionPeak: 0.83,
};

/** Stride length in metres for a speed in m/s (canter ~3.5 m, racing gallop ~7.3 m). */
export function strideLengthM(speedMs: number): number {
  return Math.min(7.6, Math.max(3.0, 2.2 + 0.32 * speedMs));
}

export const wrap01 = (p: number): number => p - Math.floor(p);

/** Local phase of one leg (0 = hoof strike). */
export function legPhase(stridePhase: number, leg: LegId): number {
  return wrap01(stridePhase - GALLOP.offsets[leg]);
}

/** Uniform Catmull-Rom through key values at u = 0, 1/(n-1), ... 1. */
function catmull(keys: readonly number[], u: number): number {
  const n = keys.length - 1;
  const f = Math.min(Math.max(u, 0), 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const t = f - i;
  const p0 = keys[Math.max(i - 1, 0)]!;
  const p1 = keys[i]!;
  const p2 = keys[i + 1]!;
  const p3 = keys[Math.min(i + 2, n)]!;
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export interface HoofTarget {
  /** Hoof ground-contact point x, relative to the leg pivot's neutral x (cm). */
  x: number;
  /** Hoof height above the ground (cm, >= 0). */
  lift: number;
  stance: boolean;
  /** Pastern flex 0 (planted) .. 1 (fully curled), drives the hoof flip. */
  flex: number;
  /** Shoulder / hip swing: pivot x offset (cm). */
  pivotDx: number;
}

/**
 * Hoof path for one leg. `sweepCm` = stride length * duty: the distance the body
 * travels while this hoof is planted.
 */
export function hoofTarget(kind: "fore" | "hind", phase: number, sweepCm: number, amount = 1): HoofTarget {
  const d = GALLOP.duty;
  const S = sweepCm;
  const swingAmp = (kind === "fore" ? 0.36 : 0.32) * S;
  if (phase < d) {
    const k = phase / d;
    // Planted: moves back linearly at ground speed; shoulder/hip swing carries part of it.
    const travel = 0.5 - k; // +0.5 .. -0.5
    return { x: S * travel, lift: 0, stance: true, flex: 0, pivotDx: (swingAmp * travel * 2) * 0.55 };
  }
  const u = (phase - d) / (1 - d);
  const xs = kind === "fore" ? [-0.5, -0.42, -0.02, 0.62, 0.5] : [-0.5, -0.48, -0.12, 0.52, 0.5];
  const hs = kind === "fore" ? [0, 46, 54, 26, 0] : [0, 30, 40, 22, 0];
  const lift = Math.max(0, catmull(hs, u)) * amount;
  const flexKeys = kind === "fore" ? [0, 1, 0.8, 0.05, 0] : [0, 0.7, 0.55, 0.05, 0];
  return {
    x: S * catmull(xs, u),
    lift,
    stance: false,
    flex: Math.min(1, Math.max(0, catmull(flexKeys, u))),
    pivotDx: -Math.cos(Math.PI * u) * swingAmp * 0.55,
  };
}

/** Body rise (cm, positive = up) and pitch (rad, positive = nose down) for a stride phase. */
export function bodyMotion(phase: number, amount = 1): { rise: number; pitch: number; neck: number } {
  const tau = Math.PI * 2;
  return {
    rise: 4.5 * amount * Math.cos(tau * (phase - GALLOP.suspensionPeak)),
    pitch: 0.035 * amount * Math.sin(tau * (phase - 0.22)),
    neck: 0.1 * amount * Math.sin(tau * (phase - 0.27)),
  };
}

export interface IkResult {
  /** Absolute angle of the upper bone (rad, 0 = +x, PI/2 = straight down). */
  upper: number;
  /** Absolute angle of the lower bone. */
  lower: number;
  kneeX: number;
  kneeY: number;
  /** Where the lower bone actually ends (equals the target when reachable). */
  endX: number;
  endY: number;
}

/**
 * Two-bone IK. bend = -1 bends the joint forward (+x, fore knee), +1 bends it back
 * (hind hock).
 */
export function solveTwoBone(
  px: number,
  py: number,
  tx: number,
  ty: number,
  a: number,
  b: number,
  bend: 1 | -1,
): IkResult {
  const dx = tx - px;
  const dy = ty - py;
  const dist = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(a - b) + 1e-3), a + b - 1e-3);
  const theta = Math.atan2(dy, dx);
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const alpha = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const upper = theta + bend * alpha;
  const kneeX = px + Math.cos(upper) * a;
  const kneeY = py + Math.sin(upper) * a;
  const ex = px + Math.cos(theta) * dist;
  const ey = py + Math.sin(theta) * dist;
  const lower = Math.atan2(ey - kneeY, ex - kneeX);
  return { upper, lower, kneeX, kneeY, endX: ex, endY: ey };
}

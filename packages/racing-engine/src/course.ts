/**
 * Course character (engine 1.3.0): what the shape of a racecourse does to a race. Only races
 * whose input carries a `course` profile use any of this; without one the engine runs exactly
 * as 1.2.0 / 1.1.0 did.
 *
 * The course is laid out backwards from the winning post: the home straight, then the last
 * bend, a straight as long as the home straight, the bend before it, and so on round the lap
 * (`bendsPerLap` equal bends share whatever the straights leave of the circumference). A race
 * of D metres starts D metres back from the post, so the bends it runs depend on its distance
 * and where that falls on the lap.
 *
 * Effects (each modest: a course tilts a race, it never decides it):
 *  - Bends: a horse racing wide covers extra ground round a bend, in proportion to the bend's
 *    tightness and how many lanes out it is. Every lap turns 360 degrees, so the ground lost per
 *    lane per bend does not depend on how long the bend is, only on its share of the lap.
 *  - Passing round a bend is harder: a horse stuck behind another tries to switch out less
 *    often while turning (the tighter the bend, the less), so the leaders keep their places.
 *  - Home straight: a long straight gives a kick room to build: a horse kicking down the home
 *    straight spends less energy for its speed there, a short straight more (the kick is paced
 *    for it). Closers, whose run is the longest, like long straights; handy horses short ones.
 *  - Gradient of the home straight: climbing it costs extra energy, and the horses know it
 *    (the kick is paced for the climb), so a horse short of stamina has to kick slower or
 *    fades; a slight downhill saves energy, which lets a speedy horse kick on a little longer.
 *  - Direction is cosmetic: no horse prefers a way round.
 *
 * Integer maths only.
 */
import type { RaceCourse } from "@thoroughbred/shared";

/** Ground lost per lane out (mm) round a half-turn (180 degrees) at tightness 1000 (scaled by tightness squared). */
export const BEND_LANE_LOSS_MM = 5000;
/** Home straight length (m) at which the kick is unchanged. */
export const STRAIGHT_REF_M = 500;
/** Kick drain saved on the home straight per 100 m of straight beyond STRAIGHT_REF_M, permille (more drain if shorter). */
export const STRAIGHT_EASE_PER_100M = 60;
/** Cap on that change, permille either way. */
export const STRAIGHT_EASE_MAX = 200;
/** Share (permille) of pass attempts given up round a bend at tightness 1000. */
export const BEND_PASS_CUT = 400;
/** Extra energy drain on the home straight per permille of rise, permille (negative downhill). */
export const GRADIENT_DRAIN = 25;
/** How much a horse's stamina changes its share of the gradient drain, permille per stamina point below 650. */
export const HILL_STAMINA_SPREAD = 5;
/** Bounds of that share, permille. */
export const HILL_SHARE_MIN = 100;
export const HILL_SHARE_MAX = 2500;
/** Floor on a horse's home-straight drain change, permille (the steepest allowed downhill plus a long straight). */
export const STRAIGHT_DRAIN_MIN = -800;

export interface Bend {
  /** Race position (mm from the start) where the bend begins and ends, clipped to the race. */
  fromMm: number;
  toMm: number;
  /** Full length of the bend, mm (the loss rate is spread over the whole bend). */
  lengthMm: number;
  /** Ground lost per 1000 milli-lanes (one lane) out over the whole bend, mm. */
  lossPerLaneMm: number;
}

export interface CourseLayout {
  /** Bends the race runs, in race order (earliest first). */
  bends: Bend[];
  /** Race position (mm) where the home straight begins. */
  straightFromMm: number;
  /** Kick drain saved on the home straight, permille (+ long straight, - short). */
  straightEase: number;
  /** Pass attempts given up round a bend, permille. */
  bendPassCut: number;
  /** Extra drain on the home straight, permille (+ uphill, - downhill). */
  gradientDrain: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Bends per lap and their lengths for a course (metres). */
export function bendGeometry(course: RaceCourse): { homeM: number; bendM: number; straightM: number } {
  const k = course.bendsPerLap;
  const C = course.circumferenceM;
  const homeM = Math.min(course.homeStraightM, Math.trunc(C / (k + 1)));
  // Other straights match the home straight; bends share what is left (at least a fifth of the lap).
  const bendTotal = Math.max(Math.trunc(C / 5), C - k * homeM);
  const bendM = Math.trunc(bendTotal / k);
  const straightM = k > 1 ? Math.trunc((C - homeM - bendM * k) / (k - 1)) : 0;
  return { homeM, bendM, straightM };
}

/** Lays the course out for a race of `distanceM` metres. */
export function courseLayout(course: RaceCourse, distanceM: number): CourseLayout {
  const L = distanceM * 1000;
  const k = course.bendsPerLap;
  const { homeM, bendM, straightM } = bendGeometry(course);
  const H = Math.min(homeM, distanceM);
  const lengthMm = bendM * 1000;
  // A lap turns 360 degrees: each bend is 2/k half-turns.
  // Tightness counts twice over (a tight bend is both sharper and harder to hold a wide line on), so
  // the loss is felt most on the tightest courses and barely on sweeping ones.
  const lossPerLaneMm = Math.trunc((BEND_LANE_LOSS_MM * course.bendTightness * course.bendTightness * 2) / (1_000_000 * k));
  const bends: Bend[] = [];
  // Walk back from the post: home straight, then bend, straight, bend ... lap after lap.
  let back = homeM * 1000;
  for (let guard = 0; back < L && guard < 64; guard++) {
    for (let b = 0; b < k && back < L; b++) {
      const end = back; // distance from the post where the bend ends (nearer the post)
      const start = back + lengthMm; // where it begins
      bends.push({ fromMm: Math.max(0, L - start), toMm: L - end, lengthMm, lossPerLaneMm });
      back = start + (b < k - 1 ? straightM * 1000 : homeM * 1000);
    }
  }
  bends.reverse();
  return {
    bends,
    straightFromMm: L - H * 1000,
    straightEase: clamp(Math.trunc(((homeM - STRAIGHT_REF_M) * STRAIGHT_EASE_PER_100M) / 100), -STRAIGHT_EASE_MAX, STRAIGHT_EASE_MAX),
    bendPassCut: Math.trunc((BEND_PASS_CUT * course.bendTightness) / 1000),
    gradientDrain: course.finishGradientPermille * GRADIENT_DRAIN,
  };
}

/**
 * A horse's drain change on the home straight, permille: the course's gradient drain scaled by
 * how short of stamina the horse is (650 = as listed). Uphill a stayer pays less and a sprinter
 * more; downhill the sprinter, whose tank is the one that runs dry, gains the most.
 */
export function hillDrainFor(layout: CourseLayout | null, stamina: number): number {
  if (!layout || layout.gradientDrain === 0) return 0;
  const share = clamp(1000 + (650 - stamina) * HILL_STAMINA_SPREAD, HILL_SHARE_MIN, HILL_SHARE_MAX);
  return Math.trunc((layout.gradientDrain * share) / 1000);
}

/**
 * A horse's drain change on the home straight, permille: its gradient drain, less the straight's
 * ease while it is kicking. Never below STRAIGHT_DRAIN_MIN: running still costs something.
 */
export function straightDrain(layout: CourseLayout, hillDrain: number, kicking: boolean): number {
  return Math.max(STRAIGHT_DRAIN_MIN, kicking ? hillDrain - layout.straightEase : hillDrain);
}

/**
 * Distance-equivalent energy cost (mm) of the last `remainingMm` of a race of L mm for a kicking
 * horse whose home-straight drain changes by `hillDrain` permille: what its kick paces itself
 * against.
 */
export function kickCostMm(layout: CourseLayout | null, hillDrain: number, remainingMm: number, L: number): number {
  if (!layout) return remainingMm;
  const change = straightDrain(layout, hillDrain, true);
  if (change === 0) return remainingMm;
  const straight = Math.min(remainingMm, L - layout.straightFromMm);
  return remainingMm + Math.trunc((straight * change) / 1000);
}

/** The bend a horse at race position `posMm` is rounding, or null on a straight. */
export function bendAt(layout: CourseLayout, posMm: number): Bend | null {
  for (const b of layout.bends) {
    if (posMm < b.fromMm) return null;
    if (posMm < b.toMm) return b;
  }
  return null;
}

/** The course profile's fields in a fixed order, for the hashed result of a 1.3.0 race. */
export function courseTuple(course: RaceCourse): (string | number)[] {
  return [course.id, course.direction, course.circumferenceM, course.homeStraightM, course.bendsPerLap, course.bendTightness, course.finishGradientPermille];
}

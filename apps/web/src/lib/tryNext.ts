/**
 * "Try next" on the Why card (experience review item 9): for each finding about a run (trip,
 * surface, going, riding plan against natural style, course character, pace and position,
 * fatigue and freshness at the off, the draw, weight carried), one concrete, honest suggestion.
 *
 * Rules-based and deterministic. Ranked by how much each plausibly mattered, as rating points on
 * the form-guide scale (the same `conditionRating` maths the fit grades use; condition effects
 * converted from their permille). At most three. Never certain ("may suit", "worth trying") and
 * built only from what the owner can see: the public stats and fit grades, the racecard (course,
 * gate, weights), the running positions, and their own horse's condition at the off.
 */
import * as gc from "@thoroughbred/game-core";
import type { Going, Horse, RunningStyle, Surface } from "@thoroughbred/shared";
import { conditionRating } from "./aptitude";
import type { RaceAnalysis } from "./raceAnalysis";
import { formatDistance } from "./format";

export interface TryNextInput {
  analysis: Pick<RaceAnalysis, "position" | "fieldSize" | "pace" | "runningLine" | "tactic">;
  horse: Pick<Horse, "sex" | "stats" | "style" | "preferredDistanceM" | "preferredSurface">;
  race: { distanceM: number; surface: Surface; going: Going };
  /** The racecourse (game-core courses.ts), or null for a course-less race. */
  course: Pick<gc.Course, "name" | "homeStraightM" | "bendTightness" | "finishGradientPermille"> | null;
  /** Starting gate (1 = rail); 0 when unknown. */
  gate: number;
  /** Handicap weight carried, lb, and the rest of the field's (null at level weights). */
  weightLb: number | null;
  fieldWeightsLb: number[];
  /** The owner's own horse at the off: fatigue (permille) and hours since its last hard work. */
  atOff: { fatigue: number; hoursSinceHardWork: number | null } | null;
}

export interface TryNextTip {
  id: "trip" | "surface" | "going" | "plan" | "course" | "pace" | "fatigue" | "freshness" | "draw" | "weight";
  text: string;
  /** How much it plausibly mattered, form-guide rating points (ranking only). */
  weight: number;
}

/** A fit loss under this many rating points is grade A ("keeps it all"): nothing to change. */
export const FIT_LOSS_MIN = 10;
/** Tips weighing less than this are left out (too small to be worth a change). */
export const TIP_MIN_WEIGHT = 5;
export const MAX_TIPS = 3;
/** Course character thresholds over game-core courses.ts (Saltmarsh's 800 m straight, Kestrel's 900 bends, Harrowgate's 35 permille climb). */
export const LONG_STRAIGHT_M = 700;
export const TIGHT_BENDS = 700;
export const STIFF_FINISH_PERMILLE = 20;
/** Weight above the field average worth mentioning, lb. */
export const WEIGHT_NOTE_LB = 5;
/** One permille of performance on the form-guide scale (a plain horse rates 650). */
const PERMILLE_POINTS = 0.65;

const STYLE: Record<RunningStyle, string> = { front: "front-runner", stalker: "stalker", closer: "closer" };
const RIDDEN: Record<RunningStyle, string> = { front: "ridden from the front", stalker: "ridden handy, just off the pace", closer: "held up for a late run" };

/** The freshness peak window in days after hard work, read from game-core's freshnessBonus curve. */
export function freshnessPeakDays(): { from: number; to: number; fadesByDays: number } {
  const hours: number[] = [];
  let last = 0;
  for (let h = 0; h <= 24 * 14; h++) {
    const b = gc.freshnessBonus(0, h * gc.MS_PER_HOUR);
    if (b === gc.FRESHNESS_PEAK_BONUS) hours.push(h);
    if (b > 0) last = h;
  }
  return { from: Math.round(hours[0]! / 24), to: Math.round(hours[hours.length - 1]! / 24), fadesByDays: Math.ceil((last + 1) / 24) };
}

/** "Saltmarsh's", "Kestrel Downs'" */
const poss = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

const days = (h: number) => {
  const d = Math.round(h / 24);
  return d <= 0 ? "the same day as" : d === 1 ? "1 day after" : `${d} days after`;
};

export function tryNext(i: TryNextInput): TryNextTip[] {
  const { analysis: a, horse, race, course } = i;
  if (a.position === 1) return []; // a win: nothing to try instead
  const p = gc.pronounsOf(horse.sex);
  const tips: TryNextTip[] = [];
  const ideal = { distanceM: horse.preferredDistanceM, surface: horse.preferredSurface, going: "good" as Going };
  const base = conditionRating(horse, horse.style, ideal);
  const n = a.fieldSize;
  const [q1, , q3] = a.runningLine;
  const finish = a.position;

  // Trip, surface, going: the fit grades' own losses.
  const tripLoss = base - conditionRating(horse, horse.style, { ...ideal, distanceM: race.distanceM });
  if (tripLoss > FIT_LOSS_MIN) {
    tips.push({
      id: "trip",
      weight: tripLoss,
      text:
        race.distanceM > horse.preferredDistanceM
          ? `${formatDistance(race.distanceM)} looked beyond ${p.her} best (${formatDistance(horse.preferredDistanceM)}): a shorter trip may suit.`
          : `${formatDistance(race.distanceM)} was sharp for ${p.her} (best ${formatDistance(horse.preferredDistanceM)}): worth trying further.`,
    });
  }
  const surfLoss = base - conditionRating(horse, horse.style, { ...ideal, surface: race.surface });
  if (surfLoss > FIT_LOSS_MIN) {
    tips.push({ id: "surface", weight: surfLoss, text: `${race.surface[0]!.toUpperCase()}${race.surface.slice(1)} isn't ${p.her} surface: ${horse.preferredSurface} may suit better.` });
  }
  const goingLoss = base - conditionRating(horse, horse.style, { ...ideal, going: race.going });
  if (goingLoss > FIT_LOSS_MIN) {
    const shoes = gc.RACE_EXTRAS.soft_shoes;
    tips.push({
      id: "going",
      weight: goingLoss,
      text: shoes.goings?.includes(race.going)
        ? `The ${race.going} ground cost ${p.her}: good going may suit, or ${shoes.label.toLowerCase()} are worth trying on a wet day.`
        : `The ${race.going} ground cost ${p.her}: good going may suit.`,
    });
  }

  // Riding plan against natural style (and the course's character, which may favour another).
  const favoured: RunningStyle[] | null = course
    ? course.homeStraightM >= LONG_STRAIGHT_M
      ? ["stalker", "closer"]
      : course.bendTightness >= TIGHT_BENDS
        ? ["front", "stalker"]
        : null
    : null;
  const planLoss = base - conditionRating(horse, a.tactic, ideal);
  const courseMismatch = favoured !== null && !favoured.includes(a.tactic);
  // (left out when the course favours the plan that was ridden over the natural style, or when the course tip says it better)
  const courseBacksPlan = favoured !== null && favoured.includes(a.tactic) && !favoured.includes(horse.style);
  if (a.tactic !== horse.style && planLoss > FIT_LOSS_MIN && !courseBacksPlan && !(courseMismatch && favoured!.includes(horse.style))) {
    tips.push({ id: "plan", weight: planLoss, text: `${RIDDEN[a.tactic][0]!.toUpperCase()}${RIDDEN[a.tactic].slice(1)}, but ${p.she}'s a natural ${STYLE[horse.style]}: ${p.her} own style may suit better.` });
  }
  if (course && favoured && courseMismatch) {
    const natural = favoured.includes(horse.style) ? ` (${p.her} natural style)` : "";
    const lost = Math.max(0, finish - (q3 ?? finish));
    const why = course.homeStraightM >= LONG_STRAIGHT_M ? `${poss(course.name)} long straight suits closers` : `${poss(course.name)} tight turns make it hard to come from behind`;
    tips.push({
      id: "course",
      weight: 12 + Math.min(10, lost * 2) + (natural ? 4 : 0),
      text: `${why}; ${p.she} was ${RIDDEN[a.tactic]}: ${favoured.map((s) => STYLE[s]).join(" or ")}${natural} is worth trying there.`,
    });
  } else if (course && course.finishGradientPermille >= STIFF_FINISH_PERMILLE && q3 !== undefined && finish > q3 && race.distanceM >= horse.preferredDistanceM) {
    tips.push({
      id: "course",
      weight: 10 + Math.min(10, (finish - q3) * 2),
      text: `${poss(course.name)} uphill finish is a stamina test and ${p.she} faded late: a shorter trip there, or a flatter track, may suit.`,
    });
  }

  // Pace and position.
  if (q1 !== undefined && q3 !== undefined) {
    const handy = q1 <= Math.max(2, Math.ceil(n / 4));
    const back = q1 > Math.ceil(n / 2);
    if (a.pace === "fast" && handy && a.tactic === "front" && finish - q3 >= 2) {
      tips.push({ id: "pace", weight: 8 + Math.min(12, (finish - q3) * 2), text: `They went fast and ${p.she} was up with it, then faded: sitting just off a hot pace (stalker) may help.` });
    } else if (a.pace === "slow" && back && a.tactic === "closer" && finish > 2) {
      tips.push({ id: "pace", weight: 8 + Math.min(12, finish - 1), text: `A slow pace with ${p.her} at the back left too much to do: a handier position (stalker) may help when the field looks short of front-runners.` });
    }
  }

  // Condition at the off (the owner's own horse only).
  if (i.atOff) {
    const pen = gc.tiredPenalty(i.atOff.fatigue);
    if (pen > 0) {
      tips.push({
        id: "fatigue",
        weight: pen * PERMILLE_POINTS,
        text: `${p.She} went in tired (fatigue ${i.atOff.fatigue} at the off): worth waiting until it is under ${gc.TIRED_THRESHOLD} before the next run.`,
      });
    }
    const h = i.atOff.hoursSinceHardWork;
    if (h !== null && h >= 0) {
      const bonus = gc.freshnessBonus(0, h * gc.MS_PER_HOUR);
      const peak = freshnessPeakDays();
      const missed = gc.FRESHNESS_PEAK_BONUS - bonus;
      if (missed > 0) {
        tips.push({
          id: "freshness",
          weight: missed * PERMILLE_POINTS,
          text:
            h < peak.from * 24
              ? `Ran ${days(h)} hard work: ${p.her} peak is ${peak.from}-${peak.to} days after, worth giving ${p.her} that long.`
              : `Ran ${days(h)} ${p.her} last hard work, past the ${peak.from}-${peak.to} day peak: worth timing a gallop for that window next time.`,
        });
      }
    }
  }

  // The draw on a tight track (luck, but worth knowing where it costs).
  if (course && course.bendTightness >= TIGHT_BENDS && i.gate > Math.ceil(n / 2) && n >= 8) {
    tips.push({
      id: "draw",
      weight: 4 + Math.min(6, i.gate - Math.ceil(n / 2)),
      text: `Drawn ${i.gate} of ${n} on ${poss(course.name)} tight bends, where low draws help: the draw is luck, but a galloping track takes it out of the equation.`,
    });
  }

  // Weight carried in a handicap.
  if (i.weightLb !== null && i.fieldWeightsLb.length > 0) {
    const avg = i.fieldWeightsLb.reduce((s, w) => s + w, 0) / i.fieldWeightsLb.length;
    const over = Math.round(i.weightLb - avg);
    if (over >= WEIGHT_NOTE_LB) {
      tips.push({ id: "weight", weight: over * 1.2, text: `Carried ${over} lb more than the field average (handicap weight follows the rating): a race at level weights may suit.` });
    }
  }

  const order: TryNextTip["id"][] = ["trip", "surface", "going", "plan", "course", "pace", "fatigue", "freshness", "draw", "weight"];
  return tips
    .filter((t) => t.weight >= TIP_MIN_WEIGHT)
    .sort((x, y) => y.weight - x.weight || order.indexOf(x.id) - order.indexOf(y.id))
    .slice(0, MAX_TIPS);
}

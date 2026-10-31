/**
 * Quick races (the "fast layer"): instant, unrated races a player can run in a two-minute visit.
 * The slow game (careers, three daily meetings, Saturday, breeding) stays the prestige layer;
 * these never touch it.
 *
 *   Match race       your racing horse against up to MATCH_FIELD_MAX - 1 other racing horses
 *                    (any stable's, each "a ghost of its current self"), on a course, trip and
 *                    going you choose, with a fresh random seed.
 *   Ghost race       your horse against the first GHOST_TOP home in a settled Live race, the
 *                    horses exactly as they locked in that race's field, on its course, trip and
 *                    going, with a fresh random seed.
 *   Daily challenge  one fixed puzzle a UTC day, the same for everyone: a Club horse, a field and
 *                    conditions published at 00:00 UTC (public, from the day number). The player
 *                    picks only the tactic, the riding intensity and a jockey grade. One attempt
 *                    per stable per day, all against the day's one seed, committed at publish and
 *                    revealed when the day is over.
 *
 * Rules shared by all three: unofficial. No rating, fatigue, injury, credits, ledger, form, records,
 * leagues, jockey stats or growth. Every runner rides on the current race model (LIVE_RACE_MODEL)
 * with a course profile, so a quick race runs like a Live race of today.
 *
 * Pure and deterministic (integer maths, seeded streams); the web layer passes the seed and calls
 * the engine.
 */
import { LIVE_RACE_MODEL, type Horse, type RaceConfig, type RaceInput, type RaceKit, type RunningStyle, type Silks, type Surface } from "@thoroughbred/shared";
import { COURSES, courseById, courseProfile, type CourseId } from "./courses";
import { clubRaceDayState, clubSeasonedState } from "./clubFill";
import { clubHorseName, clubRunner, meanStat } from "./field";
import { generateFoundationGenome, preferredDistanceM, preferredSurface } from "./genome";
import { withJockeyKit, type JockeyGrade, type JockeySkills } from "./jockeys";
import { raceSnapshot } from "./phenotype";
import { Rng, seedFrom } from "./rng";
import { DISTANCES, DIVISIONS } from "./seasons";
import { MS_PER_DAY } from "./time";
import type { HorseState } from "./types";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Match races one stable may run in a rolling day (the shared rate limiter). */
export const MATCH_RACES_PER_DAY = 10;
/** Ghost races one stable may run in a rolling day (the shared rate limiter). */
export const GHOST_RACES_PER_DAY = 10;
/** The rate limiter's window for both. */
export const QUICK_LIMIT_WINDOW_MS = MS_PER_DAY;
/** Runners in a match race, yours included (a one-on-one up to a field of four). */
export const MATCH_FIELD_MAX = 4;
/** Ghosts in a ghost race: the first this many home in the real race. */
export const GHOST_TOP = 3;
/** Ghost races are offered for settled Live races from the start of yesterday (UTC) on. */
export const GHOST_SOURCE_DAYS = 2;
/** Runners in the daily challenge, the Club horse included. */
export const DAILY_CHALLENGE_FIELD = 8;
/** Daily challenge points by finishing position (1st, 2nd ...); any other finish scores DAILY_POINTS_TAKING_PART. */
export const DAILY_POINTS: readonly number[] = [10, 7, 5, 3];
export const DAILY_POINTS_TAKING_PART = 1;
/** The daily challenge badge: the best this share (permille) of the day's attempts (at least the leader). */
export const DAILY_TOP_SHARE_PERMILLE = 100;
/**
 * The daily challenge's weight question: the Club horse carries DAILY_TOP_WEIGHT_LB, less its
 * rider's claim (lower grades claim more, as apprentices do in a handicap). A better rider costs
 * weight, so the grade is a real choice rather than "always A".
 */
export const DAILY_TOP_WEIGHT_LB = 4;
export const DAILY_RIDER_CLAIM_LB: Readonly<Record<JockeyGrade, number>> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

/** lb the daily challenge horse carries with a rider of this grade. */
export function dailyWeightLb(grade: JockeyGrade): number {
  return Math.max(0, DAILY_TOP_WEIGHT_LB - DAILY_RIDER_CLAIM_LB[grade]);
}

/** Every runner without a choice rides with a typical Club freelancer of this grade. */
export const QUICK_DEFAULT_GRADE: JockeyGrade = "C";

/**
 * A typical Club freelancer of each grade: every skill at the middle of the grade's band (the same
 * riders as a what-if's "an A-grade rider").
 */
export const QUICK_RIDER_SKILLS: Readonly<Record<JockeyGrade, JockeySkills>> = {
  A: { gate: 850, pace: 850, finish: 850, handling: 850 },
  B: { gate: 675, pace: 675, finish: 675, handling: 675 },
  C: { gate: 525, pace: 525, finish: 525, handling: 525 },
  D: { gate: 375, pace: 375, finish: 375, handling: 375 },
  E: { gate: 200, pace: 200, finish: 200, handling: 200 },
};

export type QuickMode = "match" | "ghost" | "daily";
export type QuickGoing = RaceConfig["going"];
export type QuickWeather = RaceConfig["weather"];
export type QuickIntensity = "conservative" | "normal" | "all_out";

export const QUICK_GOINGS: readonly QuickGoing[] = ["firm", "good", "soft", "heavy"];
export const QUICK_TRIPS: readonly number[] = DIVISIONS.flatMap((d) => DISTANCES[d]);

/** The sky that goes with a going (rain on heavy, never on firm). */
export const QUICK_GOING_WEATHER: Readonly<Record<QuickGoing, QuickWeather>> = { firm: "clear", good: "clear", soft: "overcast", heavy: "rain" };

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export interface QuickConditions {
  courseId: CourseId;
  distanceM: number;
  surface: Surface;
  going: QuickGoing;
}

/** Why a chosen set of conditions can't be raced (null when it can). The all-weather is always good going. */
export function quickConditionsError(c: QuickConditions): string | null {
  const course = COURSES.find((x) => x.id === c.courseId);
  if (!course) return "pick one of the courses";
  if (!course.surfaces.includes(c.surface)) return `${course.name} doesn't race on ${c.surface}`;
  if (!QUICK_TRIPS.includes(c.distanceM)) return "pick one of the race trips";
  if (!QUICK_GOINGS.includes(c.going)) return "pick a going";
  if (c.surface === "synthetic" && c.going !== "good") return "the all-weather always rides good";
  return null;
}

/** The race config of a quick race (no purse; the class is only a label). */
export function quickRaceConfig(id: string, name: string, c: QuickConditions, postTimeMs: number, weather: QuickWeather = QUICK_GOING_WEATHER[c.going]): RaceConfig {
  return { id, name, distanceM: c.distanceM, surface: c.surface, weather, going: c.going, raceClass: "handicap", postTimeMs, purse: 0 };
}

/** A rider kit of a grade (QUICK_RIDER_SKILLS), on top of any other kit. */
export function quickRiderKit(grade: JockeyGrade, kit?: RaceKit): RaceKit {
  return withJockeyKit(kit, QUICK_RIDER_SKILLS[grade]);
}

/** Gates 1..n in an order drawn from the race seed (the engine's luck is per gate, so the draw is part of the luck). */
export function drawGates(seed: string, n: number): number[] {
  const rng = new Rng(seedFrom("quick-gates", seed));
  const gates = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [gates[i], gates[j]] = [gates[j]!, gates[i]!];
  }
  return gates;
}

export interface QuickRunner {
  horse: Horse;
  tactic: RunningStyle;
  kit?: RaceKit;
}

/**
 * The engine input of a match or ghost race: the runners on gates drawn from the seed, the
 * course's profile and the current race model. Runner order is kept (gates are drawn per index).
 */
export function quickRaceInput(o: { id: string; name: string; conditions: QuickConditions; runners: readonly QuickRunner[]; seed: string; postTimeMs: number }): RaceInput {
  const gates = drawGates(o.seed, o.runners.length);
  return {
    race: quickRaceConfig(o.id, o.name, o.conditions, o.postTimeMs),
    course: courseProfile(courseById(o.conditions.courseId)),
    model: LIVE_RACE_MODEL,
    entries: o.runners.map((r, i) => ({ gate: gates[i]!, tactic: r.tactic, horse: r.horse, ...(r.kit ? { kit: r.kit } : {}) })),
    seed: o.seed,
  };
}

// ---------------------------------------------------------------------------
// The daily challenge
// ---------------------------------------------------------------------------

export interface DailyRival {
  gate: number;
  tactic: RunningStyle;
  horse: Horse;
}

export interface DailyChallengeSpec {
  /** UTC day number. */
  day: number;
  name: string;
  conditions: QuickConditions & { weather: QuickWeather };
  /** The day's Club horse, everybody's ride. */
  horse: HorseState;
  /** Its gate. */
  gate: number;
  rivals: DailyRival[];
  opensAtMs: number;
  closesAtMs: number;
}

export interface DailyChoice {
  tactic: RunningStyle;
  intensity: QuickIntensity;
  grade: JockeyGrade;
}

/** The Club's colours on the daily challenge horse (navy and gold, the house silks). */
export const DAILY_CHALLENGE_SILKS: Silks = { pattern: "hoops", primary: "#16224d", secondary: "#e2b33c", cap: "#e2b33c" };

const RIVAL_STYLES: readonly RunningStyle[] = ["front", "front", "stalker", "stalker", "stalker", "closer", "closer"];

/** The id of the day's Club horse in the race (its replay and leaderboard key). */
export function dailyHorseId(day: number): string {
  return `challenge-${day}`;
}

/**
 * The day's puzzle, identical for every player and public from 00:00 UTC (it holds no luck: the
 * race seed is separate and secret until the day is over). A Club horse of a middling mark, a trip
 * near its best (or a step off it), its own surface three days in four, a course that races on it,
 * a going for the day, and seven Club rivals of about its strength (a little below to a little
 * above), each with its own style, riding with a C-grade freelancer. The Club horse carries
 * DAILY_TOP_WEIGHT_LB less its rider's claim, so a better rider costs weight. The best plan wins
 * about a day in three and makes the first three most days; the luck is the day's.
 */
export function dailyChallengeSpec(day: number): DailyChallengeSpec {
  const rng = new Rng(seedFrom("daily-challenge", day));
  const id = dailyHorseId(day);
  const genome = generateFoundationGenome(seedFrom("daily-challenge-horse", day), { season: 1, rarity: rng.pick(["uncommon", "rare", "rare", "epic"] as const) });
  const opensAtMs = day * MS_PER_DAY;
  const name = clubHorseName(rng);
  const horse = clubRaceDayState(clubSeasonedState(genome, { id, name, sex: rng.chance(500) ? "colt" : "filly", target: rng.range(45, 75) }), opensAtMs);
  // The trip: the nearest race trip to its best, or a step either side (a question of stamina or pace).
  const best = preferredDistanceM(genome);
  const near = [...QUICK_TRIPS].sort((a, b) => Math.abs(a - best) - Math.abs(b - best) || a - b)[0]!;
  const i = QUICK_TRIPS.indexOf(near);
  const step = rng.pick([-1, 0, 0, 1]);
  const distanceM = QUICK_TRIPS[Math.max(0, Math.min(QUICK_TRIPS.length - 1, i + step))]!;
  const own = preferredSurface(genome);
  const surface: Surface = rng.chance(750) ? own : rng.pick((["turf", "dirt", "synthetic"] as const).filter((s) => s !== own));
  const course = rng.pick(COURSES.filter((c) => c.surfaces.includes(surface)));
  const going: QuickGoing = surface === "synthetic" ? "good" : rng.pick(["firm", "good", "good", "good", "soft", "soft", "heavy"] as const);
  const weather = going === "good" && rng.chance(250) ? "overcast" : QUICK_GOING_WEATHER[going];
  const conditions = { courseId: course.id, distanceM, surface, going, weather };
  // The rivals: about the horse's strength on the day (its snapshot ridden normally, carrying a C-grade rider's weight).
  const strength = meanStat(raceSnapshot(horse, { nowMs: opensAtMs, silks: DAILY_CHALLENGE_SILKS, race: { going, fieldSize: DAILY_CHALLENGE_FIELD, bigCrowd: false, surface, distanceM }, plan: { tactic: "stalker", intensity: "normal" }, extraWeightLb: dailyWeightLb(QUICK_DEFAULT_GRADE) }).horse);
  const gates = drawGates(seedFrom("daily-challenge-gates", day), DAILY_CHALLENGE_FIELD);
  const rivals: DailyRival[] = RIVAL_STYLES.map((style, k) => ({
    gate: gates[k + 1]!,
    tactic: style,
    horse: clubRunner(seedFrom("daily-challenge-rivals", day), { id: `challenge-${day}-${k}`, strength: strength + rng.range(-45, 35), distanceM, surface, style }),
  }));
  return { day, name: "Daily Challenge", conditions, horse, gate: gates[0]!, rivals, opensAtMs, closesAtMs: opensAtMs + MS_PER_DAY };
}

/** The day's Club horse as it runs with a choice (intensity folds into its stats, as in any race). */
export function dailyChallengeHorse(spec: DailyChallengeSpec, choice: Pick<DailyChoice, "tactic" | "intensity"> & { grade?: JockeyGrade }): Horse {
  const c = spec.conditions;
  return raceSnapshot(spec.horse, {
    nowMs: spec.opensAtMs,
    silks: DAILY_CHALLENGE_SILKS,
    race: { going: c.going, fieldSize: DAILY_CHALLENGE_FIELD, bigCrowd: false, surface: c.surface, distanceM: c.distanceM },
    plan: { tactic: choice.tactic, intensity: choice.intensity },
    ...(dailyWeightLb(choice.grade ?? "A") > 0 ? { extraWeightLb: dailyWeightLb(choice.grade ?? "A") } : {}),
  }).horse;
}

/** The engine input of one attempt: the fixed field, the player's three choices, the day's seed. */
export function dailyChallengeInput(spec: DailyChallengeSpec, choice: DailyChoice, seed: string): RaceInput {
  const c = spec.conditions;
  return {
    race: quickRaceConfig(`daily-challenge-${spec.day}`, spec.name, c, spec.opensAtMs, c.weather),
    course: courseProfile(courseById(c.courseId)),
    model: LIVE_RACE_MODEL,
    entries: [
      { gate: spec.gate, tactic: choice.tactic, horse: dailyChallengeHorse(spec, choice), kit: quickRiderKit(choice.grade) },
      ...spec.rivals.map((r) => ({ gate: r.gate, tactic: r.tactic, horse: r.horse, kit: quickRiderKit(QUICK_DEFAULT_GRADE) })),
    ].sort((a, b) => a.gate - b.gate),
    seed,
  };
}

/** Points for a finishing position. */
export function dailyPoints(position: number): number {
  return DAILY_POINTS[position - 1] ?? DAILY_POINTS_TAKING_PART;
}

export interface DailyAttempt {
  key: string;
  position: number;
  finishTimeUs: number;
  atMs: number;
}

export interface DailyStanding extends DailyAttempt {
  rank: number;
  /** Among the best DAILY_TOP_SHARE_PERMILLE of the day's attempts (always the leader). */
  top: boolean;
  points: number;
}

/** How many of a day's `entrants` attempts earn the badge (the best tenth, at least the leader). */
export function dailyTopCut(entrants: number): number {
  return entrants <= 0 ? 0 : Math.max(1, Math.floor((entrants * DAILY_TOP_SHARE_PERMILLE) / 1000));
}

/** The day's leaderboard: by finishing position, then time, then who went first. */
export function rankDaily(attempts: readonly DailyAttempt[]): DailyStanding[] {
  const sorted = [...attempts].sort((a, b) => a.position - b.position || a.finishTimeUs - b.finishTimeUs || a.atMs - b.atMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const cut = dailyTopCut(sorted.length);
  return sorted.map((a, i) => ({ ...a, rank: i + 1, top: i < cut, points: dailyPoints(a.position) }));
}

/**
 * Days in a row with an attempt (UTC day numbers): the run ending today, or yesterday while today's
 * isn't done yet (a streak is never lost before the day is over), and the best run ever.
 */
export function dailyStreak(days: readonly number[], today: number): { current: number; best: number } {
  const set = new Set(days);
  const sorted = [...set].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && sorted[i] === sorted[i - 1]! + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  let current = 0;
  for (let d = set.has(today) ? today : today - 1; set.has(d); d--) current++;
  return { current, best };
}

/** A head-to-head tally from finishing positions: wins of `a` over `b` and of `b` over `a`. */
export function matchTally(races: readonly { a: number; b: number }[]): { a: number; b: number; meetings: number } {
  let a = 0;
  let b = 0;
  for (const r of races) {
    if (r.a < r.b) a++;
    else if (r.b < r.a) b++;
  }
  return { a, b, meetings: races.length };
}

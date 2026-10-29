/**
 * Life cycle on the career clock (§4a + amendments).
 *
 *   foal ──5 care──▶ weanling ──+7──▶ yearling ──+7──▶ juvenile (racing age)
 *   juvenile 0–6 starts ▶ prime 7–28 ▶ veteran 29–40 ▶ racing retirement (40, or by choice)
 *   ▶ stud (while breedings remain) ▶ pasture / Legend on the Legacy Farm (permanent; a fatal race injury also ends here, in memoriam)
 *
 * Nothing here advances from elapsed time alone. `settleIdle` (the only time-driven step)
 * changes nothing but injury healing and pregnancy completion.
 */
import type { Sex, Silks } from "@thoroughbred/shared";
import {
  type Binding,
  type GameStage,
  type Genome,
  type HorseLocation,
  type HorseState,
  type RetireReason,
  STAT_KEYS,
  type StatRecord,
} from "./types";
import { dayIndex, MS_PER_HOUR } from "./time";
import { CARE_HEAL_BONUS_H, fatigueAt, isHealed } from "./condition";
import { clampInt } from "./rng";

export const CARE_TO_WEAN = 5;
export const CARE_TO_YEARLING = 12;
export const CARE_TO_RACING = 19;

export const CAREER_MAX_STARTS = 40;
export const JUVENILE_MAX_STARTS = 6;
export const PRIME_MAX_STARTS = 28;
/** Racing horses may breed from this many starts; retired horses any time. */
export const BREED_FROM_STARTS = 25;
/** Hard cap on starts per horse per real day. */
export const MAX_STARTS_PER_DAY = 3;
/**
 * Live races per horse per day (beta, 2026-10-29). The season harness showed grinders running
 * horses ~2 times a day and burning 40-start careers in about 2.5 weeks; the economy model
 * assumed 1-1.5 starts a day. One Live start a day makes a career last a season or more, makes
 * rest and rotation real, and makes a bigger string of horses worth having. Story races still
 * share the all-races cap above.
 */
export const MAX_LIVE_STARTS_PER_DAY = 1;
export const BREEDINGS_LIFETIME = 4;
export const PREGNANCY_MS = 24 * MS_PER_HOUR;
/** Initial official rating on a horse's first start. */
export const INITIAL_OR = 40;

export function isRacingAge(state: Pick<HorseState, "care">): boolean {
  return state.care.sessions >= CARE_TO_RACING;
}

/** Stage from career activity only. */
export function stageOf(state: Pick<HorseState, "care" | "career" | "breeding">): GameStage {
  if (state.career.pastured) return "pasture";
  const c = state.care.sessions;
  if (c < CARE_TO_WEAN) return "foal";
  if (c < CARE_TO_YEARLING) return "weanling";
  if (c < CARE_TO_RACING) return "yearling";
  if (state.career.racingRetired) return state.breeding.used < BREEDINGS_LIFETIME ? "stud" : "pasture";
  const s = state.career.starts;
  if (s <= JUVENILE_MAX_STARTS) return "juvenile";
  if (s <= PRIME_MAX_STARTS) return "prime";
  return "veteran";
}

/** Maps the game stage onto the shared contract's LifeStage. */
export function sharedLifeStage(stage: GameStage): "foal" | "development" | "prime" | "veteran" | "retired" {
  switch (stage) {
    case "foal":
      return "foal";
    case "weanling":
    case "yearling":
    case "juvenile":
      return "development";
    case "prime":
      return "prime";
    case "veteran":
      return "veteran";
    default:
      return "retired";
  }
}

/** Display age (shared `Horse.age`) derived from the career clock, never from the calendar. */
export function displayAge(state: Pick<HorseState, "care" | "career">): number {
  const c = state.care.sessions;
  if (c < CARE_TO_YEARLING) return 0;
  if (c < CARE_TO_RACING) return 1;
  const s = state.career.starts;
  if (s <= JUVENILE_MAX_STARTS) return 2;
  if (s <= 14) return 3;
  if (s <= 21) return 4;
  if (s <= PRIME_MAX_STARTS) return 5;
  if (s <= 34) return 6;
  return 7;
}

export function isMale(sex: Sex): boolean {
  return sex === "colt" || sex === "stallion" || sex === "gelding";
}
export function isFemale(sex: Sex): boolean {
  return sex === "filly" || sex === "mare";
}

/** Colt/filly become stallion/mare once breeding-eligible. Geldings stay geldings. */
export function sexLabel(state: Pick<HorseState, "sex" | "career" | "care">): Sex {
  if (state.sex === "gelding") return "gelding";
  const grown = state.career.racingRetired !== null || state.career.starts >= BREED_FROM_STARTS;
  if (isFemale(state.sex)) return grown ? "mare" : "filly";
  return grown ? "stallion" : "colt";
}

export interface NewHorseInput {
  id: string;
  name: string;
  sex: "colt" | "filly";
  ownerId: string;
  sireId: string | null;
  damId: string | null;
  generation: number;
  genome: Genome;
  bornAtMs: number;
  bornSeason: number;
  location?: HorseLocation;
  binding?: Binding;
  /** Starters arrive at racing age (19 care sessions already done). */
  careSessions?: number;
}

export function createHorseState(input: NewHorseInput): HorseState {
  const realisation = {} as StatRecord<number>;
  for (const k of STAT_KEYS) realisation[k] = 600;
  return {
    id: input.id,
    name: input.name,
    sex: input.sex,
    ownerId: input.ownerId,
    sireId: input.sireId,
    damId: input.damId,
    generation: input.generation,
    genome: input.genome,
    location: input.location ?? "stable",
    binding: input.binding ?? "free",
    bornAtMs: input.bornAtMs,
    bornSeason: input.bornSeason,
    care: { sessions: clampInt(input.careSessions ?? 0, 0, 1_000_000), lastCareDay: null, quality: 600 },
    condition: { fitness: 500, fatigue: 0, fatigueAtMs: input.bornAtMs, lastHardWorkMs: null, bond: 0 },
    training: { realisation: realisation as HorseState["training"]["realisation"], week: 0, sessionsThisWeek: 0 },
    career: { starts: 0, racingRetired: null, pastured: false, insured: false },
    injury: null,
    rating: { or: INITIAL_OR, ratedRuns: 0, peakOr: INITIAL_OR },
    record: { starts: 0, wins: 0, places: 0, shows: 0, earnings: 0 },
    recentRuns: [],
    breeding: { used: 0, bySeason: [] },
    pregnancy: null,
    reveal: { scanned: false, quirks: [] },
  };
}

// ---------------------------------------------------------------------------
// Care
// ---------------------------------------------------------------------------

export const FEEDS = ["growth_mix", "performance", "recovery", "maintenance"] as const;
export type Feed = (typeof FEEDS)[number];

/** The right feed for the horse right now (growing -> growth mix; tired or injured -> recovery; racing -> performance). */
export function recommendedFeed(state: HorseState, nowMs: number): Feed {
  const stage = stageOf(state);
  if (stage === "foal" || stage === "weanling" || stage === "yearling") return "growth_mix";
  if (state.injury || fatigueAt(state, nowMs) > 400) return "recovery";
  if (stage === "stud" || stage === "pasture") return "maintenance";
  return "performance";
}

/** Quality of a care session (permille): right feed 1000, maintenance 650 as a safe default, else 450. */
export function careQualityFor(state: HorseState, feed: Feed, nowMs: number): number {
  const want = recommendedFeed(state, nowMs);
  if (feed === want) return 1000;
  if (feed === "maintenance") return 650;
  return 450;
}

/** Care bonus added to training realisation, permille (≤ 50 = +5% of potential realised). */
export function careBonus(state: Pick<HorseState, "care">): number {
  return Math.floor((state.care.quality * 50) / 1000);
}

export interface CareResult {
  state: HorseState;
  /** False when a session was already counted for this horse today. */
  counted: boolean;
  stageBefore: GameStage;
  stageAfter: GameStage;
}

/** One care session (feed, groom, turnout). At most one counted per horse per real day. */
export function recordCare(state: HorseState, feed: Feed, nowMs: number, tzOffsetMin = 0): CareResult {
  const day = dayIndex(nowMs, tzOffsetMin);
  const stageBefore = stageOf(state);
  if (state.care.lastCareDay !== null && state.care.lastCareDay >= day) {
    return { state, counted: false, stageBefore, stageAfter: stageBefore };
  }
  const q = careQualityFor(state, feed, nowMs);
  const next: HorseState = {
    ...state,
    care: { sessions: state.care.sessions + 1, lastCareDay: day, quality: Math.round((state.care.quality * 3 + q) / 4) },
    condition: { ...state.condition, bond: Math.min(1000, state.condition.bond + 6) },
    injury: state.injury ? { ...state.injury, bonusUnits: state.injury.bonusUnits + CARE_HEAL_BONUS_H } : null,
  };
  return { state: next, counted: true, stageBefore, stageAfter: stageOf(next) };
}

// ---------------------------------------------------------------------------
// Retirement, pension, release
// ---------------------------------------------------------------------------

export function retireFromRacing(state: HorseState, reason: RetireReason): HorseState {
  if (state.career.racingRetired) return state;
  return { ...state, career: { ...state.career, racingRetired: { reason, atStarts: state.career.starts } } };
}

/** Owner pensions the horse: permanent Legend state on the Legacy Farm (no stall). */
export function pensionHorse(state: HorseState): HorseState {
  const retired = retireFromRacing(state, "choice");
  return { ...retired, location: "legacy_farm", career: { ...retired.career, pastured: true } };
}

/** Keep `location` consistent with the stage: pasture lives on the Legacy Farm. */
export function normaliseLocation(state: HorseState): HorseState {
  if (stageOf(state) === "pasture" && state.location !== "legacy_farm" && state.location !== "club") {
    return { ...state, location: "legacy_farm", career: { ...state.career, pastured: true } };
  }
  return state;
}

/** Credits paid to the owner for releasing a horse to the Club. */
export const RELEASE_TO_CLUB_CREDITS = 50;

export function releaseToClub(state: HorseState, clubOwnerId = "club"): HorseState {
  return { ...state, ownerId: clubOwnerId, location: "club" };
}

// ---------------------------------------------------------------------------
// Idle settlement: the only time-driven state change (healing + pregnancy completion)
// ---------------------------------------------------------------------------

export interface IdleEvents {
  healed: boolean;
  foalDue: boolean;
}

/**
 * Apply elapsed real time. Only two things can change: an injury heals (cleared), and a
 * pregnancy that is due is reported (the caller then runs breeding.deliverFoal).
 * Fatigue recovery is derived on read (condition.fatigueAt), so it needs no write.
 */
export function settleIdle(state: HorseState, nowMs: number): { state: HorseState; events: IdleEvents } {
  let next = state;
  let healed = false;
  if (state.injury && isHealed(state.injury, nowMs)) {
    next = { ...next, injury: null };
    healed = true;
  }
  const foalDue = state.pregnancy !== null && nowMs >= state.pregnancy.dueAtMs;
  return { state: next, events: { healed, foalDue } };
}

/** Starts today (real day) from the recent-run log. */
export function startsToday(state: Pick<HorseState, "recentRuns">, nowMs: number): number {
  const d = dayIndex(nowMs);
  return state.recentRuns.filter((r) => dayIndex(r.atMs) === d).length;
}

export type RaceBlock =
  | "not_racing_age"
  | "retired"
  | "injured"
  | "daily_limit"
  | "in_foal"
  | "career_complete";

/** Why a horse cannot race right now (null = it can). */
export function raceBlock(state: HorseState, nowMs: number): RaceBlock | null {
  if (!isRacingAge(state)) return "not_racing_age";
  if (state.career.pastured || state.career.racingRetired) return "retired";
  if (state.career.starts >= CAREER_MAX_STARTS) return "career_complete";
  if (state.injury && !isHealed(state.injury, nowMs)) return "injured";
  if (state.pregnancy) return "in_foal";
  if (startsToday(state, nowMs) >= MAX_STARTS_PER_DAY) return "daily_limit";
  return null;
}

/** Owner's silks are applied at snapshot time; re-exported for convenience in callers. */
export type { Silks };

/**
 * Race classes and eligibility.
 *
 * Maiden → Novice → Handicap bands (0–55, 50–75, 70–95) → Listed → Graded (G3, G2, G1).
 * Juveniles (0–6 starts) run in trials, maidens, novices, quick races and the Daily Cup.
 * Overlapping handicap bands let a horse on the boundary choose.
 */
import type { RaceClass } from "@thoroughbred/shared";
import type { HorseState, RaceSlot, RaceTier } from "./types";
import { CARE_TO_YEARLING, raceBlock, stageOf } from "./lifecycle";

export interface TierRule {
  /** Shared contract class (what the engine / viewer see). */
  raceClass: RaceClass;
  minOr: number;
  maxOr: number;
  /** Max wins to enter (maiden 0, novice 2). */
  maxWins: number | null;
  juvenileOk: boolean;
  /** Only juveniles (career starts 0–6). */
  juvenileOnly: boolean;
  /** Counts as a career start and is rated. */
  rated: boolean;
  label: string;
}

export const TIER_RULES: Record<RaceTier, TierRule> = {
  trial: { raceClass: "maiden", minOr: 0, maxOr: 140, maxWins: null, juvenileOk: true, juvenileOnly: true, rated: false, label: "Trial" },
  maiden: { raceClass: "maiden", minOr: 0, maxOr: 140, maxWins: 0, juvenileOk: true, juvenileOnly: false, rated: true, label: "Maiden" },
  novice: { raceClass: "novice", minOr: 0, maxOr: 140, maxWins: 2, juvenileOk: true, juvenileOnly: false, rated: true, label: "Novice" },
  hcp_0_55: { raceClass: "handicap", minOr: 0, maxOr: 55, maxWins: null, juvenileOk: false, juvenileOnly: false, rated: true, label: "Handicap (0-55)" },
  hcp_50_75: { raceClass: "handicap", minOr: 50, maxOr: 75, maxWins: null, juvenileOk: false, juvenileOnly: false, rated: true, label: "Handicap (50-75)" },
  hcp_70_95: { raceClass: "handicap", minOr: 70, maxOr: 95, maxWins: null, juvenileOk: false, juvenileOnly: false, rated: true, label: "Handicap (70-95)" },
  listed: { raceClass: "listed", minOr: 88, maxOr: 140, maxWins: null, juvenileOk: false, juvenileOnly: false, rated: true, label: "Listed" },
  g3: { raceClass: "graded", minOr: 95, maxOr: 140, maxWins: null, juvenileOk: false, juvenileOnly: false, rated: true, label: "Group 3" },
  g2: { raceClass: "graded", minOr: 102, maxOr: 140, maxWins: null, juvenileOk: false, juvenileOnly: false, rated: true, label: "Group 2" },
  g1: { raceClass: "graded", minOr: 108, maxOr: 140, maxWins: null, juvenileOk: false, juvenileOnly: false, rated: true, label: "Group 1" },
  quick: { raceClass: "novice", minOr: 0, maxOr: 140, maxWins: null, juvenileOk: true, juvenileOnly: false, rated: true, label: "Quick race" },
  daily_cup: { raceClass: "listed", minOr: 0, maxOr: 140, maxWins: null, juvenileOk: true, juvenileOnly: false, rated: false, label: "Daily Cup" },
};

export const TIER_ORDER: readonly RaceTier[] = ["trial", "maiden", "novice", "quick", "hcp_0_55", "hcp_50_75", "hcp_70_95", "listed", "g3", "g2", "g1"];

/** The handicap band (or better) a horse with this OR belongs in. */
export function classBand(or: number): RaceTier {
  if (or >= 108) return "g1";
  if (or >= 102) return "g2";
  if (or >= 95) return "g3";
  if (or >= 88) return "listed";
  if (or >= 70) return "hcp_70_95";
  if (or >= 50) return "hcp_50_75";
  return "hcp_0_55";
}

export type EligibilityBlock =
  | "not_racing_age"
  | "retired"
  | "injured"
  | "daily_limit"
  | "in_foal"
  | "career_complete"
  | "rating_too_low"
  | "rating_too_high"
  | "too_many_wins"
  | "juvenile_class"
  | "not_juvenile"
  | "entries_closed"
  | "field_full"
  | "stable_daily_limit";

/**
 * Optional per-stable daily entry budget (proposal under discussion: 10 entries/day, daily
 * reset, refills for credits; the Daily Cup is free). Pass `entriesLeftToday` to enforce it;
 * leave it undefined for no budget.
 */
export interface StableEntryContext {
  entriesLeftToday?: number;
}

export const STABLE_DAILY_ENTRIES = 10;

/** Entries left today for a stable: base budget + refills bought − entries used (never negative). */
export function stableEntriesLeft(usedToday: number, refillsBought = 0, refillSize = 5): number {
  return Math.max(0, STABLE_DAILY_ENTRIES + refillsBought * refillSize - usedToday);
}

/** Whether a horse may enter a race slot now. Returns null when eligible. */
export function entryBlock(state: HorseState, slot: RaceSlot, nowMs: number, entriesSoFar = 0, stable: StableEntryContext = {}): EligibilityBlock | null {
  if (nowMs >= slot.entryCloseMs) return "entries_closed";
  if (entriesSoFar >= slot.maxRunners) return "field_full";
  if (stable.entriesLeftToday !== undefined && stable.entriesLeftToday <= 0 && slot.tier !== "daily_cup") return "stable_daily_limit";
  const rule = TIER_RULES[slot.tier];
  const stage = stageOf(state);
  if (slot.tier === "trial") {
    // Yearlings (light work) and juveniles may trial; trials never count as starts.
    if (state.care.sessions < CARE_TO_YEARLING) return "not_racing_age";
    if (stage !== "yearling" && stage !== "juvenile") return "not_juvenile";
    if (state.injury) return "injured";
    return null;
  }
  const b = raceBlock(state, nowMs);
  if (b) return b;
  if (rule.juvenileOnly && stage !== "juvenile") return "not_juvenile";
  if (stage === "juvenile" && !rule.juvenileOk) return "juvenile_class";
  if (rule.maxWins !== null && state.record.wins > rule.maxWins) return "too_many_wins";
  if (state.rating.or < rule.minOr) return "rating_too_low";
  if (state.rating.or > rule.maxOr) return "rating_too_high";
  return null;
}

/** Tiers a horse could enter today (ignoring slot timing). */
export function eligibleTiers(state: HorseState, nowMs: number): RaceTier[] {
  const fake = (tier: RaceTier): RaceSlot => ({
    id: "probe",
    name: "probe",
    kind: "regular",
    tier,
    season: 1,
    postTimeMs: nowMs + 120_000,
    entryCloseMs: nowMs + 60_000,
    distanceM: 1600,
    surface: "turf",
    goingForecast: "good",
    weather: "clear",
    purse: 0,
    entryFee: 0,
    maxRunners: 12,
    handicap: false,
    division: null,
  });
  return TIER_ORDER.filter((t) => entryBlock(state, fake(t), nowMs) === null);
}

/**
 * Matchmaking (§4d): one owner may not make up more than half of a field. Returns true when
 * one more entry from this owner is allowed.
 */
export function ownerShareOk(ownerEntriesInRace: number, maxRunners: number): boolean {
  return ownerEntriesInRace + 1 <= Math.floor(maxRunners / 2);
}

/**
 * Economy (Phase 1: Stable Credits only, never cashable). Configurable faucet/sink constants,
 * stall capacity and facilities, appraisal and market rules (§8, §4b).
 *
 * No time-based fees: there is no upkeep (§4a). Capacity is limited by stall slots; every cost comes
 * from an activity the player chose (training, entries, vet, breeding, packs, scans, upgrades).
 */
import type { HorseState, RaceTier } from "./types";
import { STAT_KEYS } from "./types";
import { WORKOUTS } from "./training";
import { BREEDINGS_LIFETIME, stageOf } from "./lifecycle";
import { revealedRanges } from "./phenotype";
import { overallOf } from "./genome";
import { BREEDING_BASE_FEE } from "./breeding";
import { PADDOCK_PACK_PRICE } from "./packs";
import { MS_PER_DAY } from "./time";
import { ENTRY_REFILL_COST } from "./entries";

// ---------------------------------------------------------------------------
// Faucets
// ---------------------------------------------------------------------------

/** Purse per tier (credits), split 55/20/12/7/4/2 by the engine's splitPurse. */
export const PURSE_BY_TIER: Record<RaceTier, number> = {
  trial: 0,
  maiden: 600,
  novice: 750,
  quick: 240,
  hcp_0_55: 800,
  hcp_50_75: 1100,
  hcp_70_95: 1500,
  listed: 2600,
  g3: 4000,
  g2: 6000,
  g1: 10_000,
  daily_cup: 0,
};
export const WEEKEND_FEATURE_PURSE = 20_000;
export const SEASON_FINAL_PURSE = 30_000;

/** Entry fees (sinks) for the top classes. */
export const ENTRY_FEE_BY_TIER: Record<RaceTier, number> = {
  trial: 0,
  maiden: 0,
  novice: 0,
  quick: 0,
  hcp_0_55: 0,
  hcp_50_75: 0,
  hcp_70_95: 0,
  listed: 120,
  g3: 200,
  g2: 320,
  g1: 500,
  daily_cup: 0,
};

/** Three daily goals; credits per completed goal. Goals never "break" a streak. */
export const DAILY_GOAL_CREDITS = 60;
export const DAILY_GOALS_PER_DAY = 3;
/** Daily Cup participation credits (ranked rewards are cosmetic + cup points). */
export const DAILY_CUP_CREDITS = 80;
export const STARTER_GRANT = 3000;

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

export const VET_TREATMENT_COST = 150;
export const PEDIGREE_SCAN_COST = 400;
/** Insurance: premium = 5% of appraisal, payout on a career-ending injury = 60% of appraisal. */
export const INSURANCE_PREMIUM_PERMILLE = 50;
export const INSURANCE_PAYOUT_PERMILLE = 600;
export const MARKET_FEE_PERMILLE = 50;
export const LISTING_FLOOR_PERMILLE = 700;
/** Ceiling: a listing price may never exceed 3x the appraisal (AUDIT §6 anti credit-transfer). */
export const LISTING_CEILING_PERMILLE = 3000;
/** A horse bought on the market can't be relisted for this long after the trade (AUDIT §6). */
export const RESALE_LOCK_MS = 3 * MS_PER_DAY;

export const BASE_STALLS = 6;
export const MAX_STALLS = 24;
/** Cost of stall number n (7..24): 2000 + 400 * (n - 7). */
export function stallCost(n: number): number {
  return 2000 + 400 * Math.max(0, n - 7);
}
export const FACILITY_COSTS = {
  trainer: [6000, 15_000],
  vet: [3000, 8000, 16_000],
} as const;

export interface Facilities {
  stalls: number;
  trainerLevel: number;
  vetLevel: number;
}
export const START_FACILITIES: Facilities = { stalls: BASE_STALLS, trainerLevel: 0, vetLevel: 0 };

/** Horses that occupy a stall: everything in the stable (nursery, Legacy Farm, Club don't). */
export function stallsUsed(horses: readonly Pick<HorseState, "location">[]): number {
  return horses.filter((h) => h.location === "stable").length;
}

export function stallsFree(horses: readonly Pick<HorseState, "location">[], f: Facilities): number {
  return Math.max(0, Math.min(MAX_STALLS, f.stalls) - stallsUsed(horses));
}

/** Nursery foals move into a stall as soon as one frees up (oldest first). */
export function promoteFromNursery(horses: readonly HorseState[], f: Facilities): HorseState[] {
  let free = stallsFree(horses, f);
  const order = horses
    .map((h, i) => [h, i] as const)
    .filter(([h]) => h.location === "nursery")
    .sort((a, b) => a[0].bornAtMs - b[0].bornAtMs || a[1] - b[1]);
  const move = new Set<number>();
  for (const [, i] of order) {
    if (free <= 0) break;
    move.add(i);
    free--;
  }
  return horses.map((h, i) => (move.has(i) ? { ...h, location: "stable" } : h));
}

// ---------------------------------------------------------------------------
// Appraisal and market rules
// ---------------------------------------------------------------------------

/**
 * Appraised value (credits). Uses only what the market can see: revealed potential ranges
 * (midpoints), record, stage and remaining breedings — never the hidden genotype.
 */
export function appraise(state: HorseState): number {
  const r = revealedRanges(state);
  const mid = {} as Record<(typeof STAT_KEYS)[number], number>;
  for (const k of STAT_KEYS) mid[k] = Math.round((r[k].lo + r[k].hi) / 2);
  const ov = overallOf(mid);
  const x = Math.max(0, ov - 300);
  let value = 400 + Math.floor((x * x) / 12);
  const stage = stageOf(state);
  const stageFactor: Record<string, number> = { foal: 700, weanling: 750, yearling: 850, juvenile: 1000, prime: 1000, veteran: 750, stud: 600, pasture: 100 };
  value = Math.floor((value * (stageFactor[stage] ?? 1000)) / 1000);
  const left = BREEDINGS_LIFETIME - state.breeding.used;
  value += left * 150 + state.record.wins * 120 + Math.floor(state.record.earnings / 10) + state.rating.peakOr * 15;
  return Math.max(100, value);
}

export function listingFloor(state: HorseState): number {
  return Math.ceil((appraise(state) * LISTING_FLOOR_PERMILLE) / 1000);
}

export function listingCeiling(state: HorseState): number {
  return Math.floor((appraise(state) * LISTING_CEILING_PERMILLE) / 1000);
}

export interface SellerAccount {
  createdAtMs: number;
  racesRun: number;
  emailVerified: boolean;
}

export const SELLER_MIN_AGE_DAYS = 7;
export const SELLER_MIN_RACES = 20;

export type ListBlock =
  | "account_too_new"
  | "not_enough_races"
  | "email_unverified"
  | "club_bred"
  | "bound_until_5_starts"
  | "not_in_stable"
  | "entered_in_race"
  | "in_foal"
  | "below_floor"
  | "above_ceiling"
  | "locked";

/** Seller requirements (§4b). Operators can tune them (the database layer reads env config). */
export interface SellerPolicy {
  minAgeDays: number;
  minRaces: number;
  requireVerifiedEmail: boolean;
}

export const DEFAULT_SELLER_POLICY: SellerPolicy = { minAgeDays: SELLER_MIN_AGE_DAYS, minRaces: SELLER_MIN_RACES, requireVerifiedEmail: true };

export function listBlock(
  state: HorseState,
  seller: SellerAccount,
  price: number,
  nowMs: number,
  flags: { enteredInRace: boolean; locked: boolean },
  policy: SellerPolicy = DEFAULT_SELLER_POLICY,
): ListBlock | null {
  if (nowMs - seller.createdAtMs < policy.minAgeDays * MS_PER_DAY) return "account_too_new";
  if (seller.racesRun < policy.minRaces) return "not_enough_races";
  if (policy.requireVerifiedEmail && !seller.emailVerified) return "email_unverified";
  if (state.binding === "club_bred") return "club_bred";
  if (state.binding === "until_5_starts" && state.record.starts < 5) return "bound_until_5_starts";
  if (state.location !== "stable" && state.location !== "nursery") return "not_in_stable";
  if (flags.enteredInRace) return "entered_in_race";
  if (state.pregnancy) return "in_foal";
  if (flags.locked) return "locked";
  if (price < listingFloor(state)) return "below_floor";
  if (price > listingCeiling(state)) return "above_ceiling";
  return null;
}

/** Linked-account rules hook: device / fingerprint / IP-pattern / wallet links between accounts. */
export interface AccountLinks {
  /** Pairs of account ids flagged as linked (order-insensitive). */
  linked: readonly (readonly [string, string])[];
}

export function areLinked(a: string, b: string, links: AccountLinks): boolean {
  return links.linked.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

export type TradeBlock = "self_trade" | "linked_accounts";

/** Trades between linked accounts are blocked (and leaderboard results reviewed elsewhere). */
export function tradeBlock(sellerId: string, buyerId: string, links: AccountLinks): TradeBlock | null {
  if (sellerId === buyerId) return "self_trade";
  if (areLinked(sellerId, buyerId, links)) return "linked_accounts";
  return null;
}

export function marketFee(price: number): number {
  return Math.floor((price * MARKET_FEE_PERMILLE) / 1000);
}

export function insurancePremium(state: HorseState): number {
  return Math.ceil((appraise(state) * INSURANCE_PREMIUM_PERMILLE) / 1000);
}

export function insurancePayout(state: HorseState): number {
  return Math.floor((appraise(state) * INSURANCE_PAYOUT_PERMILLE) / 1000);
}

// ---------------------------------------------------------------------------
// Story mode rewards (§4e): full reward on the first win of a story race, minimal on replays,
// and a credit cap per chapter so story races can't be farmed.
// ---------------------------------------------------------------------------

export const STORY_CHAPTERS = ["club", "county", "national", "classics"] as const;
export type StoryChapter = (typeof STORY_CHAPTERS)[number];
export const STORY_FIRST_WIN_REWARD: Record<StoryChapter, number> = { club: 400, county: 700, national: 1100, classics: 1800 };
/** Any replay / non-first-win finish pays this. */
export const STORY_REPLAY_REWARD = 20;
/** Lifetime credits a chapter can pay out (first wins + replays). */
export const STORY_CHAPTER_CAP: Record<StoryChapter, number> = { club: 4000, county: 7000, national: 11_000, classics: 18_000 };

export interface StoryRewardInput {
  chapter: StoryChapter;
  won: boolean;
  /** This story race was already won before. */
  alreadyWon: boolean;
  /** Credits already paid out by this chapter. */
  chapterEarned: number;
}

/** Credits for a story race result, after the first-win rule and the chapter cap. */
export function storyReward(i: StoryRewardInput): number {
  const raw = i.won && !i.alreadyWon ? STORY_FIRST_WIN_REWARD[i.chapter] : STORY_REPLAY_REWARD;
  return Math.max(0, Math.min(raw, STORY_CHAPTER_CAP[i.chapter] - i.chapterEarned));
}

// ---------------------------------------------------------------------------
// Weekly flow model for an "active player" (the balance target: spend ≈ earn)
// ---------------------------------------------------------------------------

export interface ActivityProfile {
  /** Live (shared card) rated starts per week, by tier. Limited by stable entries (~10–15/day). */
  startsByTier: Partial<Record<RaceTier, number>>;
  /** Average field size (the purse is split over the top 6; average prize = purse / field). */
  fieldSize: number;
  /** Story first wins per week (and their chapter), plus replays. */
  storyFirstWinsPerWeek: number;
  storyChapter: StoryChapter;
  storyReplaysPerWeek: number;
  dailyGoalsPerWeek: number;
  dailyCupsPerWeek: number;
  trainingSessionsPerWeek: number;
  vetTreatmentsPerWeek: number;
  coveringsPerWeek: number;
  /** Average stud fee paid per outside covering. */
  avgStudFee: number;
  paddockBuysPerWeek: number;
  scansPerWeek: number;
  entryRefillsPerWeek: number;
  insurancePerWeek: number;
  /** Facility / stall / entry-tier spend amortised per week. */
  facilitySpendPerWeek: number;
}

export interface WeeklyFlow {
  faucets: Record<string, number>;
  sinks: Record<string, number>;
  earned: number;
  spent: number;
  /** spent / earned, permille. Target ≈ 1000 (±150). */
  ratioPermille: number;
  /** Live entries the profile needs per day (cost 2 for graded). */
  entriesPerDay: number;
}

const GRADED: readonly RaceTier[] = ["g1", "g2", "g3"];

/** Expected weekly credits in/out for a profile. Prize expectation uses the full-purse split. */
export function weeklyFlow(p: ActivityProfile): WeeklyFlow {
  let purses = 0;
  let entry = 0;
  let entries = 0;
  for (const [tier, n] of Object.entries(p.startsByTier) as [RaceTier, number][]) {
    const paid = Math.min(6, p.fieldSize);
    const share = [55, 20, 12, 7, 4, 2].slice(0, paid).reduce((a, b) => a + b, 0) / 100;
    purses += (n * PURSE_BY_TIER[tier] * share) / p.fieldSize;
    entry += n * ENTRY_FEE_BY_TIER[tier];
    entries += n * (GRADED.includes(tier) ? 2 : 1);
  }
  const avgSession = Math.round((WORKOUTS.speed_work.cost + WORKOUTS.stamina_gallops.cost + WORKOUTS.race_prep.cost + WORKOUTS.swimming.cost + WORKOUTS.gate_practice.cost) / 5);
  const faucets = {
    purses: Math.round(purses),
    story: Math.round(p.storyFirstWinsPerWeek * STORY_FIRST_WIN_REWARD[p.storyChapter] + p.storyReplaysPerWeek * STORY_REPLAY_REWARD),
    dailyGoals: p.dailyGoalsPerWeek * DAILY_GOAL_CREDITS,
    dailyCup: p.dailyCupsPerWeek * DAILY_CUP_CREDITS,
  };
  const sinks = {
    training: Math.round(p.trainingSessionsPerWeek * avgSession),
    entryFees: entry,
    vet: Math.round(p.vetTreatmentsPerWeek * VET_TREATMENT_COST),
    breeding: Math.round(p.coveringsPerWeek * (BREEDING_BASE_FEE + p.avgStudFee)),
    packs: Math.round(p.paddockBuysPerWeek * PADDOCK_PACK_PRICE),
    scans: Math.round(p.scansPerWeek * PEDIGREE_SCAN_COST),
    entryRefills: Math.round(p.entryRefillsPerWeek * ENTRY_REFILL_COST),
    insurance: Math.round(p.insurancePerWeek * 300),
    facilities: p.facilitySpendPerWeek,
  };
  const earned = Object.values(faucets).reduce((a, b) => a + b, 0);
  const spent = Object.values(sinks).reduce((a, b) => a + b, 0);
  return { faucets, sinks, earned, spent, ratioPermille: earned > 0 ? Math.round((spent * 1000) / earned) : 0, entriesPerDay: Math.round((entries / 7) * 10) / 10 };
}

/**
 * Reference "active player" (≈ 45 min/day): ~11 Live entries a day (inside the 10/day + bank +
 * one refill budget), a story first win a week, all daily goals and the Daily Cup, a full
 * training plan for ~6 horses, a covering most weeks, 2 bought paddock packs, a scan, the odd
 * refill and steady facility saving.
 */
export const ACTIVE_PLAYER: ActivityProfile = {
  startsByTier: { maiden: 8, novice: 10, quick: 12, hcp_0_55: 20, hcp_50_75: 15, hcp_70_95: 6, listed: 2, g3: 2 },
  fieldSize: 10,
  storyFirstWinsPerWeek: 1,
  storyChapter: "county",
  storyReplaysPerWeek: 10,
  dailyGoalsPerWeek: 21,
  dailyCupsPerWeek: 7,
  trainingSessionsPerWeek: 18,
  vetTreatmentsPerWeek: 0.5,
  coveringsPerWeek: 0.75,
  avgStudFee: 800,
  paddockBuysPerWeek: 2,
  scansPerWeek: 1,
  entryRefillsPerWeek: 3,
  insurancePerWeek: 1,
  facilitySpendPerWeek: 2500,
};

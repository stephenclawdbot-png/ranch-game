/**
 * Stable entries — the Live racing budget (§4f).
 *
 *   - +10 entries per local day (granted lazily on first activity after local midnight,
 *     idempotent per stable and local date; missed days still grant, up to the bank cap);
 *   - unused entries roll over up to a bank cap of 20 — no penalty for missing a day;
 *   - cost: 1 per Live race, 2 for Feature and Graded races; Story races and the Daily Cup free;
 *   - one +5 refill per local day for credits, only while the bank is below 5;
 *   - facility tiers: +1 daily allowance (to 15) and +2 bank cap (to 30) per tier.
 *
 * The bank never goes negative; every change returns a new state (store it transactionally).
 */
import type { RaceKind, RaceTier } from "./types";
import { dayIndex } from "./time";

export const ENTRY_DAILY_BASE = 10;
export const ENTRY_BANK_BASE = 20;
export const ENTRY_DAILY_MAX = 15;
export const ENTRY_BANK_MAX = 30;
export const ENTRY_FACILITY_TIERS = 5;
export const ENTRY_REFILL_AMOUNT = 5;
export const ENTRY_REFILL_BELOW = 5;
export const ENTRY_REFILL_COST = 250;
/** Credits per facility tier (tier n costs ENTRY_TIER_COST[n-1]). */
export const ENTRY_TIER_COST = [4000, 7000, 11_000, 16_000, 22_000] as const;

export interface EntryBank {
  balance: number;
  /** Last local date (day index) the allowance was granted for; null before the first grant. */
  lastGrantDay: number | null;
  /** Local date of the last refill; null if never. */
  lastRefillDay: number | null;
  /** Entries facility tier 0..5. */
  tier: number;
}

export const NEW_ENTRY_BANK: EntryBank = { balance: 0, lastGrantDay: null, lastRefillDay: null, tier: 0 };

export function dailyAllowance(tier: number): number {
  return Math.min(ENTRY_DAILY_MAX, ENTRY_DAILY_BASE + Math.max(0, Math.min(ENTRY_FACILITY_TIERS, tier)));
}

export function bankCap(tier: number): number {
  return Math.min(ENTRY_BANK_MAX, ENTRY_BANK_BASE + 2 * Math.max(0, Math.min(ENTRY_FACILITY_TIERS, tier)));
}

/** Player's local date (day index) for a timestamp and their captured timezone offset. */
export function localDate(nowMs: number, tzOffsetMin: number): number {
  return dayIndex(nowMs, tzOffsetMin);
}

/**
 * Grant the allowance for `localDay` (and any missed days since the last grant), capped at the
 * bank cap. Idempotent: calling it again for the same or an earlier day changes nothing.
 * The first ever grant gives one day's allowance.
 */
export function grantFor(bank: EntryBank, localDay: number): EntryBank {
  if (bank.lastGrantDay !== null && localDay <= bank.lastGrantDay) return bank;
  const days = bank.lastGrantDay === null ? 1 : localDay - bank.lastGrantDay;
  const cap = bankCap(bank.tier);
  const balance = Math.max(bank.balance, Math.min(cap, bank.balance + days * dailyAllowance(bank.tier)));
  return { ...bank, balance, lastGrantDay: localDay };
}

/** Entries a race costs. Story races and the Daily Cup are free. */
export function entryCost(race: { tier: RaceTier; kind: RaceKind } | "story"): number {
  if (race === "story") return 0;
  if (race.kind === "daily_cup" || race.tier === "daily_cup" || race.tier === "trial") return 0;
  if (race.kind === "weekend_feature" || race.kind === "season_final" || race.tier === "g1" || race.tier === "g2" || race.tier === "g3") return 2;
  return 1;
}

/** Spend entries for a race; null when the bank cannot cover it (never goes negative). */
export function spendEntries(bank: EntryBank, cost: number): EntryBank | null {
  if (cost < 0) throw new Error("cost must be >= 0");
  if (bank.balance < cost) return null;
  return { ...bank, balance: bank.balance - cost };
}

/** Refund an abandoned race's entries (never above the cap). Scratching yourself forfeits. */
export function refundEntries(bank: EntryBank, cost: number): EntryBank {
  return { ...bank, balance: Math.min(Math.max(bankCap(bank.tier), bank.balance), bank.balance + cost) };
}

export function canRefill(bank: EntryBank, localDay: number): boolean {
  return bank.balance < ENTRY_REFILL_BELOW && bank.lastRefillDay !== localDay;
}

/** Buy the daily refill (+5). Returns null when not allowed. Charge ENTRY_REFILL_COST credits. */
export function refill(bank: EntryBank, localDay: number): EntryBank | null {
  if (!canRefill(bank, localDay)) return null;
  return { ...bank, balance: bank.balance + ENTRY_REFILL_AMOUNT, lastRefillDay: localDay };
}

/** Timezone changes allowed at most once every 30 days. */
export const TZ_CHANGE_MIN_DAYS = 30;
export function canChangeTimezone(lastChangeMs: number | null, nowMs: number): boolean {
  return lastChangeMs === null || nowMs - lastChangeMs >= TZ_CHANGE_MIN_DAYS * 86_400_000;
}

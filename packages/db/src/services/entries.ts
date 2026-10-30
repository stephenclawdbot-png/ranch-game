/**
 * Stable entries: the Live-racing budget (game-design §4f).
 *
 * - +allowance (10) at the player's LOCAL midnight, granted lazily on the first activity
 *   of each local date. The grant row is unique per (stable, local date), so concurrent
 *   requests or instances can never grant twice; there is no cron. Days away still count
 *   (allowance x days, up to the cap), so being away costs nothing (same rule as
 *   game-core `grantFor`).
 * - Unused entries roll over up to the bank cap (20).
 * - Live race 1, feature/graded 2, Story and Daily Cup 0; consumed at entry, refunded only
 *   when a race is abandoned (unique per race + horse), forfeited on scratch.
 * - One credit refill (+5) per local date, only while the bank is below 5.
 * - Facility tiers: +1 allowance per tier (max 15), cap +2 per tier (max 30).
 * - The bank never goes negative (CHECK) and every change writes an entry_movements row
 *   in the same transaction.
 */
import { and, desc, eq } from "drizzle-orm";
import { DomainError } from "../errors";
import { accounts, entryMovements, stables, type StableRow } from "../schema";
import { RULES } from "../rules";
import { dayNumber, entryBankOf, gc } from "../gameCore";
import type { Db, Executor } from "../types";
import { lockStableOf } from "./accounts";
import { spendCreditsTx } from "./ledger";
import { audit, runTx } from "./tx";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date ("YYYY-MM-DD") at instant `now` in IANA timezone `tz` (DST-correct). */
export function localDate(tz: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The account's IANA timezone (its local day for entries, care and the sponsor list). */
export async function timezoneOf(ex: Executor, accountId: string): Promise<string> {
  const [a] = await ex.select({ tz: accounts.timezone }).from(accounts).where(eq(accounts.id, accountId));
  return a?.tz ?? "UTC";
}

async function move(
  ex: Executor,
  stable: StableRow,
  m: { kind: "daily" | "refill" | "race" | "refund" | "adjustment"; delta: number; localDate?: string; raceId?: string; horseId?: string },
): Promise<number | null> {
  const balanceAfter = stable.entryBalance + m.delta;
  if (balanceAfter < 0) throw new DomainError("INSUFFICIENT_ENTRIES", "not enough stable entries", { balance: stable.entryBalance, needed: -m.delta });
  const inserted = await ex
    .insert(entryMovements)
    .values({
      stableId: stable.id,
      kind: m.kind,
      delta: m.delta,
      balanceAfter,
      localDate: m.localDate ?? null,
      raceId: m.raceId ?? null,
      horseId: m.horseId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: entryMovements.id });
  if (!inserted[0]) return null; // grant / refund already applied
  await ex.update(stables).set({ entryBalance: balanceAfter }).where(eq(stables.id, stable.id));
  stable.entryBalance = balanceAfter;
  return balanceAfter;
}

/**
 * Grants today's allowance if this is the first activity of the player's local date.
 * `stable` must be row-locked by the caller; it is updated in place.
 */
export async function ensureDailyEntries(ex: Executor, stable: StableRow, now: Date): Promise<{ granted: number; localDate: string }> {
  const day = localDate(await timezoneOf(ex, stable.accountId), now);
  const [last] = await ex
    .select({ d: entryMovements.localDate })
    .from(entryMovements)
    .where(and(eq(entryMovements.stableId, stable.id), eq(entryMovements.kind, "daily")))
    .orderBy(desc(entryMovements.localDate))
    .limit(1);
  // game-core grantFor: one day's allowance on the first grant, then allowance x days since
  // the last grant (missed days are not lost), capped; never for the same or an earlier
  // local date (a timezone change can move the date backwards).
  const bank = entryBankOf(stable, last?.d ? dayNumber(last.d) : null, null);
  const next = gc.grantFor(bank, dayNumber(day));
  if (next === bank) return { granted: 0, localDate: day };
  const before = stable.entryBalance;
  // Even a zero-delta grant is recorded, so the date counts as granted.
  const after = await move(ex, stable, { kind: "daily", delta: next.balance - before, localDate: day });
  return { granted: after === null ? 0 : after - before, localDate: day };
}

/** Consumes `cost` entries for a race entry (caller holds the stable lock). */
export async function consumeEntries(ex: Executor, stable: StableRow, cost: number, raceId: string, horseId: string): Promise<void> {
  if (cost <= 0) return;
  await move(ex, stable, { kind: "race", delta: -cost, raceId, horseId });
}

/** Refunds an abandoned race's entries (idempotent per race + horse). */
export async function refundEntries(ex: Executor, stableId: string, cost: number, raceId: string, horseId: string): Promise<void> {
  if (cost <= 0) return;
  const [stable] = await ex.select().from(stables).where(eq(stables.id, stableId)).for("update");
  if (!stable) return;
  // game-core refundEntries: never above the cap (unless already above it).
  const next = gc.refundEntries(entryBankOf(stable, null, null), cost);
  if (next.balance > stable.entryBalance) await move(ex, stable, { kind: "refund", delta: next.balance - stable.entryBalance, raceId, horseId });
}

export interface EntryBank {
  balance: number;
  allowance: number;
  cap: number;
  localDate: string;
  timezone: string;
  grantedNow: number;
  refillAvailable: boolean;
}

async function refillUsed(ex: Executor, stableId: string, day: string): Promise<boolean> {
  const [r] = await ex
    .select({ id: entryMovements.id })
    .from(entryMovements)
    .where(and(eq(entryMovements.stableId, stableId), eq(entryMovements.kind, "refill"), eq(entryMovements.localDate, day)));
  return !!r;
}

/** The bank as the UI shows it. Counts as activity: grants today's allowance if due. */
export async function getEntryBank(db: Db, input: { accountId: string; now: Date }): Promise<EntryBank> {
  return runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    const g = await ensureDailyEntries(tx, stable, input.now);
    return {
      balance: stable.entryBalance,
      allowance: stable.entryAllowance,
      cap: stable.entryCap,
      localDate: g.localDate,
      timezone: await timezoneOf(tx, input.accountId),
      grantedNow: g.granted,
      refillAvailable: stable.entryBalance < RULES.entryRefillBelow && !(await refillUsed(tx, stable.id, g.localDate)),
    };
  });
}

/** +5 entries for credits; once per local date and only while the bank is below 5. */
export async function refillEntries(db: Db, input: { accountId: string; now: Date }): Promise<{ balance: number }> {
  return runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    const { localDate: day } = await ensureDailyEntries(tx, stable, input.now);
    const bank = entryBankOf(stable, null, (await refillUsed(tx, stable.id, day)) ? dayNumber(day) : null);
    const next = gc.refill(bank, dayNumber(day));
    if (!next) {
      throw new DomainError(
        "ENTRY_REFILL_UNAVAILABLE",
        bank.lastRefillDay !== null ? "one refill per day" : `refills are only available below ${RULES.entryRefillBelow} entries`,
      );
    }
    await spendCreditsTx(tx, {
      accountId: input.accountId,
      amount: RULES.entryRefillPrice,
      idempotencyKey: `entry-refill:${stable.id}:${day}`,
      kind: "entry_refill",
    });
    const after = await move(tx, stable, { kind: "refill", delta: next.balance - stable.entryBalance, localDate: day });
    if (after === null) throw new DomainError("ENTRY_REFILL_UNAVAILABLE", "one refill per day");
    return { balance: after };
  });
}

/** Facility tier for entries: allowance 10 + tier (max 15), cap 20 + 2 x tier (max 30). */
export async function upgradeEntryTier(db: Db, input: { accountId: string; tier: number; cost: number; idempotencyKey: string }): Promise<StableRow> {
  if (!Number.isInteger(input.tier) || input.tier < 0 || input.tier > gc.ENTRY_FACILITY_TIERS) throw new DomainError("INVALID_INPUT", "tier must be 0-5");
  return runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    if (input.cost > 0) await spendCreditsTx(tx, { accountId: input.accountId, amount: input.cost, idempotencyKey: input.idempotencyKey, kind: "facility" });
    const [s] = await tx
      .update(stables)
      .set({
        entryAllowance: gc.dailyAllowance(input.tier),
        entryCap: gc.bankCap(input.tier),
      })
      .where(eq(stables.id, stable.id))
      .returning();
    return s!;
  });
}

/** Changes the account timezone (validated; at most once per 30 days, counted from signup). */
export async function setTimezone(db: Db, input: { accountId: string; timezone: string; now: Date }): Promise<void> {
  if (!isValidTimezone(input.timezone)) throw new DomainError("INVALID_INPUT", "unknown timezone");
  await runTx(db, async (tx) => {
    const [a] = await tx.select().from(accounts).where(eq(accounts.id, input.accountId)).for("update");
    if (!a) throw new DomainError("NOT_FOUND", "account not found");
    if (a.timezone === input.timezone) return;
    const since = a.timezoneChangedAt ?? a.createdAt;
    if (!gc.canChangeTimezone(since.getTime(), input.now.getTime())) {
      throw new DomainError("TIMEZONE_LOCKED", "the timezone can change once every 30 days", { nextChangeAt: new Date(since.getTime() + RULES.timezoneChangeMs) });
    }
    await tx.update(accounts).set({ timezone: input.timezone, timezoneChangedAt: input.now }).where(eq(accounts.id, a.id));
    await audit(tx, { actor: a.id, action: "account.timezone", entityType: "account", entityId: a.id, data: { from: a.timezone, to: input.timezone } });
  });
}

export async function entryHistory(ex: Executor, stableId: string, limit = 50) {
  return ex.select().from(entryMovements).where(eq(entryMovements.stableId, stableId)).orderBy(desc(entryMovements.createdAt)).limit(limit);
}

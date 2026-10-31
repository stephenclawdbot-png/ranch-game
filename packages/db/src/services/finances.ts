/**
 * The stable's finances (read-only): every posting on the stable's player ledger, grouped
 * into readable categories for a period (this week / last week / this season / all time),
 * the weekly net over the season, and a per-horse earned-vs-cost sheet ("is this horse
 * paying for itself?").
 *
 * Nothing here posts to the ledger. Sources of truth:
 * - the postings themselves, grouped by transaction `kind` (KIND_CATEGORIES maps every kind
 *   to exactly one income and one spend category; finances.test.ts fails if a kind is added
 *   without a mapping);
 * - a posting's horse: `meta.horseId` where the transaction has one (sales, lease fees and
 *   shares, claims), the horse id embedded in the idempotency key where the transaction has
 *   no meta (training, entry fees, race-day extras, vet, scans, insurance, release payouts —
 *   the same key vocabulary upkeep.ts parses), and the owning domain row where the key is
 *   caller-supplied (purses via race entries, packs, breedings, claim escrows);
 * - the upkeep inbox note, which is written in the same transaction as the charge and holds
 *   the exact per-horse breakdown of it.
 *
 * Postings with no horse at all (daily goals, the Cup, story rewards, facilities, fees,
 * sponsorship) are counted in the summary only; the page says so in a footnote rather than
 * guessing a horse for them.
 */
import { eq, inArray, or, sql } from "drizzle-orm";
import { utcWeekStart } from "../crypto";
import { gc } from "../gameCore";
import { seasonBounds, seasonNumberAt } from "../rules";
import { horses, stables } from "../schema";
import type { Db } from "../types";
import { rowsOf } from "./tx";

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export type FinancePeriod = "this_week" | "last_week" | "season" | "all_time";
export const FINANCE_PERIODS: readonly FinancePeriod[] = ["this_week", "last_week", "season", "all_time"];

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Period bounds, UTC. `from` is null only for all time; `to` is exclusive. */
export function financePeriodBounds(period: FinancePeriod, now: Date): { from: Date | null; to: Date } {
  const weekStart = new Date(`${utcWeekStart(now)}T00:00:00.000Z`).getTime();
  switch (period) {
    case "this_week":
      return { from: new Date(weekStart), to: new Date(weekStart + WEEK_MS) };
    case "last_week":
      return { from: new Date(weekStart - WEEK_MS), to: new Date(weekStart) };
    case "season": {
      const b = seasonBounds(seasonNumberAt(now));
      return { from: b.startsAt, to: b.endsAt };
    }
    case "all_time":
      return { from: null, to: new Date(now.getTime() + 1) };
  }
}

// ---------------------------------------------------------------------------
// Categories: every ledger transaction kind maps to exactly one income and one spend
// category. Keep the two sides separate because a few kinds flow both ways (a market sale
// is a purchase for the buyer and a sale for the seller; a breeding fee is paid by the
// mare's owner and earned by the stallion's).
// ---------------------------------------------------------------------------

export type FinanceCategory =
  | "prize" // Prize money
  | "sales" // Sales (horses sold, horses claimed away from you)
  | "stud_earned" // Stud fees earned
  | "leasing" // Lease income and lease fees paid
  | "goals_cup" // Daily goals and the Daily Cup
  | "story" // Story, gifts and other income
  | "training" // Training and care (sessions, vet, scans, insurance premiums)
  | "upkeep" // Weekly upkeep
  | "entry_fees" // Entry fees (and their refunds)
  | "race_day" // Race-day extras and jockeys (and their refunds)
  | "stud_paid" // Stud fees paid (breedings, USDG covering holds and releases)
  | "purchases" // Purchases: market, Club lots, packs, claims (and claim refunds)
  | "facilities" // Facilities and stalls
  | "fees" // Fees burned: race sponsorship, entry refills
  | "other"; // Kinds not in KIND_CATEGORIES yet: kept visible, never silently dropped

export interface KindCategory {
  income: FinanceCategory;
  spend: FinanceCategory;
}

const k = (income: FinanceCategory, spend: FinanceCategory): KindCategory => ({ income, spend });

/** The one place a ledger transaction kind is classified. Tests scan the services for new kinds. */
export const KIND_CATEGORIES: Record<string, KindCategory> = {
  purse: k("prize", "other"),
  market_sale: k("sales", "purchases"),
  club_sale: k("sales", "purchases"),
  claim_sale: k("sales", "purchases"),
  claim_escrow: k("purchases", "purchases"),
  claim_refund: k("purchases", "purchases"),
  breeding_fee: k("stud_earned", "stud_paid"),
  breeding_fee_hold: k("stud_paid", "stud_paid"),
  breeding_fee_release: k("stud_paid", "stud_paid"),
  lease_fee: k("leasing", "leasing"),
  lease_share: k("leasing", "other"),
  entry_fee: k("entry_fees", "entry_fees"),
  entry_fee_refund: k("entry_fees", "entry_fees"),
  race_extras: k("race_day", "race_day"),
  race_extras_refund: k("race_day", "race_day"),
  jockey_fee: k("race_day", "race_day"),
  jockey_fee_refund: k("race_day", "race_day"),
  jockey_signing: k("race_day", "race_day"),
  training: k("other", "training"),
  vet: k("other", "training"),
  pedigree_scan: k("other", "training"),
  insurance_premium: k("other", "training"),
  insurance_payout: k("story", "other"),
  upkeep: k("other", "upkeep"),
  daily_goal: k("goals_cup", "other"),
  daily_cup: k("goals_cup", "other"),
  story_reward: k("story", "other"),
  referral_reward: k("story", "other"),
  starter_grant: k("story", "other"),
  adjustment: k("story", "other"),
  pack: k("other", "purchases"),
  facility: k("other", "facilities"),
  stall_slot: k("other", "facilities"),
  entry_refill: k("fees", "fees"),
  race_sponsorship: k("fees", "fees"),
  race_sponsorship_refund: k("fees", "fees"),
};

/** Unmapped kinds stay visible instead of vanishing from a player's finances. */
const FALLBACK_CATEGORY: KindCategory = { income: "other", spend: "other" };

export function kindCategory(kind: string): KindCategory {
  return KIND_CATEGORIES[kind] ?? FALLBACK_CATEGORY;
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface CategoryLine {
  category: FinanceCategory;
  income: number;
  spend: number;
}

/** One bar of the season chart: the net of a UTC week (Monday, "YYYY-MM-DD"). */
export interface WeeklyNet {
  weekStart: string;
  net: number;
}

export interface HorseFinances {
  horseId: string;
  name: string;
  /** Display registration number, e.g. "G2-04571". */
  regNo: string;
  /** In the stable's stalls right now (owned, or held on lease). */
  owned: boolean;
  /** Starts the stable made with this horse in the period. */
  starts: number;
  earned: number;
  cost: number;
  net: number;
  /** Total cost / starts, or null when the horse made no start in the period. */
  costPerStart: number | null;
  earnedPurses: number;
  earnedSales: number;
  earnedStud: number;
  earnedLease: number;
  earnedOther: number;
  costTraining: number;
  costUpkeep: number;
  costEntry: number;
  costRaceDay: number;
  costPurchase: number;
  costStud: number;
  costLease: number;
}

export interface StableFinances {
  period: FinancePeriod;
  /** Inclusive start (null = all time) and exclusive end, UTC. */
  from: Date | null;
  to: Date;
  balanceAtStart: number;
  /** The balance at `to` (the current balance for open-ended periods). */
  balanceAtEnd: number;
  income: number;
  spend: number;
  net: number;
  /** Non-zero categories in canonical order. */
  categories: CategoryLine[];
  /** The current season's weekly net, zero-filled, up to the current week. */
  weekly: WeeklyNet[];
  horses: HorseFinances[];
  /** Net of postings with no horse attached (summary-only; the page footnotes it). */
  unattributed: number;
}

/** Canonical display order of the categories (income first, then spending). */
export const FINANCE_CATEGORY_ORDER: readonly FinanceCategory[] = [
  "prize",
  "sales",
  "stud_earned",
  "leasing",
  "goals_cup",
  "story",
  "training",
  "upkeep",
  "entry_fees",
  "race_day",
  "stud_paid",
  "purchases",
  "facilities",
  "fees",
  "other",
];

// ---------------------------------------------------------------------------
// Query row shapes
// ---------------------------------------------------------------------------

interface KindRow {
  kind: string;
  income: number;
  spend: number;
}

interface BalanceRow {
  balance: number;
  before_from: number;
  before_to: number;
}

interface HorseKindRow {
  horse_id: string;
  kind: string;
  income: number;
  spend: number;
}

interface PurseRow {
  horse_id: string;
  amount: number;
}

interface BreedingRow {
  sire_id: string;
  dam_id: string;
  amount: number;
}

interface SpendRow {
  horse_id: string;
  spend: number;
}

interface UpkeepNote {
  data: { due: number; charged: number; horses: { id: string; cost: number }[] } | null;
}

interface StartRow {
  horse_id: string;
  starts: number;
}

/** `from` may be null (all time): the range test is null-tolerant in one query. */
const afterFrom = (from: Date | null) => sql`(${from}::timestamptz is null or p.created_at >= ${from})`;

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export async function stableFinances(db: Db, input: { stableId: string; period: FinancePeriod; now: Date }): Promise<StableFinances> {
  const [stable] = await db.select({ accountId: stables.accountId }).from(stables).where(eq(stables.id, input.stableId));
  if (!stable) throw new Error(`stable ${input.stableId} not found`);
  const { accountId } = stable;
  const { from, to } = financePeriodBounds(input.period, input.now);

  // The player's ledger account, as a sub-select: every query below filters the same way.
  const player = sql`(select a.id from ledger_accounts a where a.kind = 'player' and a.owner_account_id = ${accountId})`;

  // 1. Categories: postings grouped by transaction kind.
  const kindRows = rowsOf<KindRow>(
    await db.execute(sql`
      select t.kind as kind,
             sum(case when p.amount > 0 then p.amount else 0 end)::int as income,
             sum(case when p.amount < 0 then -p.amount else 0 end)::int as spend
        from ledger_postings p
        join ledger_transactions t on t.id = p.transaction_id
       where p.ledger_account_id = ${player}
         and ${afterFrom(from)} and p.created_at < ${to}
       group by t.kind`),
  );

  // 2. Balances: the account starts at zero, so the sums of its postings are its balances.
  const [bal] = rowsOf<BalanceRow>(
    await db.execute(sql`
      select coalesce(sum(p.amount), 0)::int as balance,
             coalesce(sum(case when p.created_at < ${from} then p.amount else 0 end), 0)::int as before_from,
             coalesce(sum(case when p.created_at < ${to} then p.amount else 0 end), 0)::int as before_to
        from ledger_postings p
       where p.ledger_account_id = ${player}`),
  );
  const balanceAtStart = from ? Number(bal?.before_from ?? 0) : 0;
  const balanceAtEnd = Number(bal?.before_to ?? 0);

  // 3. Weekly net over the current season (the chart).
  const season = seasonBounds(seasonNumberAt(input.now));
  const weekRows = rowsOf<{ week: string; net: number }>(
    await db.execute(sql`
      select to_char(date_trunc('week', p.created_at), 'YYYY-MM-DD') as week, sum(p.amount)::int as net
        from ledger_postings p
       where p.ledger_account_id = ${player}
         and p.created_at >= ${season.startsAt} and p.created_at < ${season.endsAt}
       group by 1`),
  );
  const byWeek = new Map(weekRows.map((r) => [r.week, Number(r.net)]));
  const weekly: WeeklyNet[] = [];
  for (let at = season.startsAt.getTime(); at < Math.min(season.endsAt.getTime(), input.now.getTime() + 1); at += WEEK_MS) {
    const weekStart = new Date(at).toISOString().slice(0, 10);
    weekly.push({ weekStart, net: byWeek.get(weekStart) ?? 0 });
  }

  // 4. Postings whose horse is in the transaction itself (meta) or in the idempotency key.
  const horseKindRows = rowsOf<HorseKindRow>(
    await db.execute(sql`
      select
        case
          when t.kind in ('training', 'vet', 'pedigree_scan', 'insurance_premium', 'insurance_payout') then split_part(t.idempotency_key, ':', 2)
          when t.kind = 'adjustment' and t.idempotency_key like 'release:%' then split_part(t.idempotency_key, ':', 2)
          when t.kind in ('entry_fee', 'race_extras', 'jockey_fee', 'entry_fee_refund') then split_part(t.idempotency_key, ':', 3)
          when t.kind in ('race_extras_refund', 'jockey_fee_refund') then split_part(t.idempotency_key, ':', 4)
          else coalesce(t.meta->>'horseId', '')
        end as horse_id,
        t.kind as kind,
        sum(case when p.amount > 0 then p.amount else 0 end)::int as income,
        sum(case when p.amount < 0 then -p.amount else 0 end)::int as spend
       from ledger_postings p
       join ledger_transactions t on t.id = p.transaction_id
      where p.ledger_account_id = ${player}
        and ${afterFrom(from)} and p.created_at < ${to}
        and t.kind in ('training', 'vet', 'pedigree_scan', 'insurance_premium', 'insurance_payout', 'adjustment',
                       'entry_fee', 'race_extras', 'jockey_fee', 'entry_fee_refund', 'race_extras_refund', 'jockey_fee_refund',
                       'lease_fee', 'lease_share', 'market_sale', 'club_sale', 'claim_sale', 'claim_refund')
      group by 1, 2`),
  );

  // 5. Purses: the purse transaction names the race; the stable's placed entries in it name the
  //    horses and each one's exact share (a horse racing on lease is paid by its lease_share).
  const purseRows = rowsOf<PurseRow>(
    await db.execute(sql`
      select e.horse_id as horse_id, sum(e.prize)::int as amount
        from ledger_postings p
        join ledger_transactions t on t.id = p.transaction_id and t.kind = 'purse'
        join race_entries e on e.race_id = (t.meta->>'raceId')::uuid and e.stable_id = ${input.stableId} and e.prize > 0
       where p.ledger_account_id = ${player} and p.amount > 0
         and ${afterFrom(from)} and p.created_at < ${to}
       group by e.horse_id`),
  );

  // 6. Breedings: the event row links the transaction to sire and dam.
  const breedingRows = rowsOf<BreedingRow>(
    await db.execute(sql`
      select b.sire_id as sire_id, b.dam_id as dam_id, p.amount::int as amount
        from breeding_events b
        join ledger_transactions t on t.id = b.ledger_transaction_id
        join ledger_postings p on p.transaction_id = t.id
       where p.ledger_account_id = ${player}
         and ${afterFrom(from)} and p.created_at < ${to}`),
  );

  // 7. Packs: the pull links the purchase to the horse it produced.
  const packRows = rowsOf<SpendRow>(
    await db.execute(sql`
      select pu.horse_id as horse_id, sum(-p.amount)::int as spend
        from pack_pulls pu
        join ledger_transactions t on t.id = pu.ledger_transaction_id
        join ledger_postings p on p.transaction_id = t.id
       where p.ledger_account_id = ${player}
         and ${afterFrom(from)} and p.created_at < ${to}
       group by pu.horse_id`),
  );

  // 8. Claim escrows: the claim links the held price to the horse.
  const claimRows = rowsOf<SpendRow>(
    await db.execute(sql`
      select c.horse_id as horse_id, sum(-p.amount)::int as spend
        from race_claims c
        join ledger_transactions t on t.id = c.escrow_transaction_id
        join ledger_postings p on p.transaction_id = t.id
       where p.ledger_account_id = ${player}
         and ${afterFrom(from)} and p.created_at < ${to}
       group by c.horse_id`),
  );

  // 9. Upkeep: the charge's own breakdown (written with the posting) says which horses it was
  //    for. A partially waived charge is split across those horses in proportion.
  const upkeepRows = rowsOf<UpkeepNote>(
    await db.execute(sql`
      select i.data as data
        from inbox_items i
       where i.account_id = ${accountId} and i.kind = 'upkeep'
         and (${from}::timestamptz is null or i.created_at >= ${from}) and i.created_at < ${to}`),
  );

  // 10. Starts this period (for cost per start).
  const startRows = rowsOf<StartRow>(
    await db.execute(sql`
      select e.horse_id as horse_id, count(*)::int as starts
        from race_entries e
        join races r on r.id = e.race_id
       where e.stable_id = ${input.stableId} and e.status = 'entered' and r.status <> 'cancelled'
         and r.post_time >= ${from ?? new Date(0)} and r.post_time < ${to}
       group by e.horse_id`),
  );

  // -----------------------------------------------------------------------
  // Fold the rows into per-horse sheets.
  // -----------------------------------------------------------------------
  interface Buckets {
    earnedPurses: number;
    earnedSales: number;
    earnedStud: number;
    earnedLease: number;
    earnedOther: number;
    costTraining: number;
    costUpkeep: number;
    costEntry: number;
    costRaceDay: number;
    costPurchase: number;
    costStud: number;
    costLease: number;
  }
  const emptyBuckets = (): Buckets => ({
    earnedPurses: 0,
    earnedSales: 0,
    earnedStud: 0,
    earnedLease: 0,
    earnedOther: 0,
    costTraining: 0,
    costUpkeep: 0,
    costEntry: 0,
    costRaceDay: 0,
    costPurchase: 0,
    costStud: 0,
    costLease: 0,
  });
  const sheets = new Map<string, Buckets>();
  const sheet = (horseId: string): Buckets => {
    let s = sheets.get(horseId);
    if (!s) sheets.set(horseId, (s = emptyBuckets()));
    return s;
  };

  for (const r of horseKindRows) {
    if (!r.horse_id) continue;
    const s = sheet(r.horse_id);
    const spend = Number(r.spend);
    const income = Number(r.income);
    switch (r.kind) {
      case "training":
      case "vet":
      case "pedigree_scan":
      case "insurance_premium":
        s.costTraining += spend;
        break;
      case "insurance_payout":
      case "adjustment":
        s.earnedOther += income;
        break;
      case "entry_fee":
      case "entry_fee_refund":
        s.costEntry += spend - income;
        break;
      case "race_extras":
      case "jockey_fee":
      case "race_extras_refund":
      case "jockey_fee_refund":
        s.costRaceDay += spend - income;
        break;
      case "lease_fee":
        s.earnedLease += income;
        s.costLease += spend;
        break;
      case "lease_share":
        s.earnedLease += income;
        break;
      case "market_sale":
      case "club_sale":
      case "claim_sale":
        s.earnedSales += income;
        s.costPurchase += spend;
        break;
      case "claim_refund":
        s.costPurchase -= income;
        break;
    }
  }
  for (const r of purseRows) sheet(r.horse_id).earnedPurses += Number(r.amount);
  for (const r of packRows) sheet(r.horse_id).costPurchase += Number(r.spend);
  for (const r of claimRows) sheet(r.horse_id).costPurchase += Number(r.spend);
  for (const r of breedingRows) {
    const amount = Number(r.amount);
    if (amount > 0) sheet(r.sire_id).earnedStud += amount;
    else sheet(r.dam_id).costStud += -amount;
  }
  for (const note of upkeepRows) {
    const d = note.data;
    if (!d || !Array.isArray(d.horses) || d.charged <= 0) continue;
    for (const [horseId, cost] of splitUpkeep(d.charged, d.due, d.horses)) sheet(horseId).costUpkeep += cost;
  }
  const startsBy = new Map(startRows.map((r) => [r.horse_id, Number(r.starts)]));

  // -----------------------------------------------------------------------
  // Assemble the result.
  // -----------------------------------------------------------------------
  const categories = new Map<FinanceCategory, CategoryLine>();
  let income = 0;
  let spend = 0;
  for (const r of kindRows) {
    const c = kindCategory(r.kind);
    const incomeOf = Number(r.income);
    const spendOf = Number(r.spend);
    // A kind maps to an income AND a spend category, but only the side it actually moved
    // earns a row — a zero side must not conjure an empty category line on the page.
    if (incomeOf > 0) {
      const line = categories.get(c.income) ?? { category: c.income, income: 0, spend: 0 };
      line.income += incomeOf;
      categories.set(c.income, line);
    }
    if (spendOf > 0) {
      const s = categories.get(c.spend) ?? { category: c.spend, income: 0, spend: 0 };
      s.spend += spendOf;
      categories.set(c.spend, s);
    }
    income += incomeOf;
    spend += spendOf;
  }

  const involved = [...sheets.keys()].filter((id) => /^[0-9a-f-]{36}$/.test(id));
  const rows = await db
    .select({
      id: horses.id,
      name: horses.name,
      generation: horses.generation,
      regNo: horses.regNo,
      owner: horses.ownerStableId,
      lessee: horses.lesseeStableId,
    })
    .from(horses)
    .where(
      involved.length
        ? or(eq(horses.ownerStableId, input.stableId), eq(horses.lesseeStableId, input.stableId), inArray(horses.id, involved))
        : or(eq(horses.ownerStableId, input.stableId), eq(horses.lesseeStableId, input.stableId)),
    );

  const horseFinances: HorseFinances[] = rows.map((h) => {
    const s = sheets.get(h.id) ?? emptyBuckets();
    const earned = s.earnedPurses + s.earnedSales + s.earnedStud + s.earnedLease + s.earnedOther;
    const cost = s.costTraining + s.costUpkeep + s.costEntry + s.costRaceDay + s.costPurchase + s.costStud + s.costLease;
    const starts = startsBy.get(h.id) ?? 0;
    return {
      horseId: h.id,
      name: h.name,
      regNo: gc.registrationNumber(h.generation, h.regNo),
      owned: h.owner === input.stableId || h.lessee === input.stableId,
      starts,
      earned,
      cost,
      net: earned - cost,
      costPerStart: starts > 0 ? Math.round(cost / starts) : null,
      ...s,
    };
  });
  horseFinances.sort((a, b) => b.net - a.net || b.earned - a.earned || a.name.localeCompare(b.name));

  return {
    period: input.period,
    from,
    to,
    balanceAtStart,
    balanceAtEnd,
    income,
    spend,
    net: income - spend,
    categories: FINANCE_CATEGORY_ORDER.filter((c) => categories.has(c)).map((c) => categories.get(c)!),
    weekly,
    horses: horseFinances,
    unattributed: income - spend - horseFinances.reduce((s, h) => s + h.net, 0),
  };
}

/**
 * Splits a weekly upkeep charge across the horses it was for. When the charge was paid in
 * full the split is the note's own costs; a waived part is shared in proportion
 * (largest-remainder, so the parts always add up to what was actually charged).
 */
function splitUpkeep(charged: number, due: number, horses: { id: string; cost: number }[]): [string, number][] {
  if (!horses.length) return [];
  if (charged >= due) return horses.map((h) => [h.id, h.cost] as [string, number]);
  // share_i = cost_i * charged / due, never above cost_i because charged <= due.
  const shares = horses.map((h) => (h.cost * charged) / Math.max(1, due));
  const parts = shares.map(Math.floor);
  let left = charged - parts.reduce((a, b) => a + b, 0);
  const byFraction = shares
    .map((s, i) => [s - Math.floor(s), i] as const)
    .sort((a, b) => b[0] - a[0])
    .filter(([, i]) => parts[i]! < horses[i]!.cost);
  for (const [, i] of byFraction) {
    if (left <= 0) break;
    parts[i] = parts[i]! + 1;
    left -= 1;
  }
  return horses.map((h, i) => [h.id, parts[i]!] as [string, number]);
}
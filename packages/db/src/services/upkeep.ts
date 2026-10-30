/**
 * Weekly upkeep (game-core UPKEEP_*): once a week ends, each stable pays for the horses it used
 * that week: a Live or Story start, a paid training session, or a covering. Horses left alone
 * cost nothing, so a player who is away pays nothing. The charge never takes a balance below
 * zero (the rest is waived). One charge per stable per week (ledger idempotency key and an
 * inbox note with the breakdown). Runs lazily from the views and from the maintenance cron.
 *
 * Leases (leasing.ts): upkeep is paid by the stable that used the horse. Starts count for the
 * entering stable, paid training for the stable that paid for it, so during a lease the lessee
 * pays; a stable pays for a horse it still keeps, or held on lease during that week.
 */
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { utcWeekStart } from "../crypto";
import { gc } from "../gameCore";
import { horseLeases, horses, inboxItems, stables } from "../schema";
import type { Db, Executor } from "../types";
import { weekBounds } from "./leagues";
import { getBalance, spendCreditsTx } from "./ledger";
import { rowsOf, runTx } from "./tx";

export interface UpkeepCharge {
  stableId: string;
  weekStart: string;
  horses: number;
  due: number;
  charged: number;
}

/** Horses each stable used in [from, to): starts, paid training sessions, coverings. */
async function usedHorses(db: Db, from: Date, to: Date): Promise<Map<string, Set<string>>> {
  const rows = rowsOf<{ stable_id: string; horse_id: string }>(
    await db.execute(sql`
      select e.stable_id, e.horse_id
        from race_entries e join races r on r.id = e.race_id
       where e.stable_id is not null and e.status = 'entered' and r.status <> 'cancelled'
         and r.post_time >= ${from} and r.post_time < ${to}
      union
      select s.id as stable_id, h.id as horse_id
        from ledger_transactions t
        join horses h on h.id::text = split_part(t.idempotency_key, ':', 2)
        join ledger_postings p on p.transaction_id = t.id and p.amount < 0
        join ledger_accounts a on a.id = p.ledger_account_id and a.kind = 'player'
        join stables s on s.account_id = a.owner_account_id
       where t.kind = 'training' and t.idempotency_key like 'training:%'
         and t.created_at >= ${from} and t.created_at < ${to}
      union
      select b.sire_owner_stable_id as stable_id, b.sire_id as horse_id from breeding_events b
       where b.sire_owner_stable_id is not null and b.created_at >= ${from} and b.created_at < ${to}
      union
      select b.dam_owner_stable_id as stable_id, b.dam_id as horse_id from breeding_events b
       where b.dam_owner_stable_id is not null and b.created_at >= ${from} and b.created_at < ${to}`),
  );
  const by = new Map<string, Set<string>>();
  for (const r of rows) by.set(r.stable_id, (by.get(r.stable_id) ?? new Set()).add(r.horse_id));
  return by;
}

/**
 * Charges upkeep for every finished week not charged yet, up to `weeks` weeks back (default 2).
 * Idempotent: the ledger key `upkeep:<stableId>:<weekStart>` and the inbox dedupe key make a
 * rerun a no-op. Returns the charges made in this call.
 */
export async function settleUpkeep(db: Db, now: Date, opts: { weeks?: number; stableId?: string } = {}): Promise<UpkeepCharge[]> {
  const out: UpkeepCharge[] = [];
  const current = weekBounds(utcWeekStart(now)).from;
  for (let w = opts.weeks ?? 2; w >= 1; w--) {
    const from = new Date(current.getTime() - w * 7 * 86_400_000);
    const to = new Date(from.getTime() + 7 * 86_400_000);
    const weekStart = from.toISOString().slice(0, 10);
    if (weekStart < gc.UPKEEP_FIRST_WEEK) continue; // before upkeep existed: never charged
    const used = await usedHorses(db, from, to);
    for (const [stableId, ids] of used) {
      if (opts.stableId && opts.stableId !== stableId) continue;
      const charge = await runTx(db, async (tx) => {
        const [stable] = await tx.select().from(stables).where(eq(stables.id, stableId));
        if (!stable) return null;
        const key = `upkeep:${stableId}:${weekStart}`;
        const [done] = await tx.select({ id: inboxItems.id }).from(inboxItems).where(and(eq(inboxItems.accountId, stable.accountId), eq(inboxItems.dedupeKey, key)));
        if (done) return null;
        const rows = await tx
          .select({ id: horses.id, name: horses.name, careerStatus: horses.careerStatus, owner: horses.ownerStableId, lessee: horses.lesseeStableId })
          .from(horses)
          .where(inArray(horses.id, [...ids]));
        // only horses this stable still owns or keeps pay (a horse sold since is the buyer's from
        // now on); an owner pays for a horse it used before leasing it out, a lessee for a horse it
        // held on lease that week
        const leasedIn = await leasedDuring(tx, stableId, from, to);
        const paying = rows.filter((h) => (ownsOrKeeps(h, stableId) || leasedIn.has(h.id)) && gc.upkeepFor(h.careerStatus) > 0);
        const due = paying.reduce((s, h) => s + gc.upkeepFor(h.careerStatus), 0);
        const charged = Math.min(due, Math.max(0, await getBalance(tx, stable.accountId)));
        if (charged > 0) await spendCreditsTx(tx, { accountId: stable.accountId, amount: charged, idempotencyKey: key, kind: "upkeep", memo: `Weekly upkeep, ${paying.length} horses` });
        await tx
          .insert(inboxItems)
          .values({
            accountId: stable.accountId,
            kind: "upkeep",
            dedupeKey: key,
            title: due === 0 ? `No upkeep this week` : charged < due ? `Weekly upkeep: ${charged} of ${due} cr (the rest waived)` : `Weekly upkeep: ${due} cr for ${paying.length} ${paying.length === 1 ? "horse" : "horses"}`,
            data: { weekStart, due, charged, horses: paying.map((h) => ({ id: h.id, name: h.name, cost: gc.upkeepFor(h.careerStatus) })) },
            createdAt: now,
          })
          .onConflictDoNothing();
        return { stableId, weekStart, horses: paying.length, due, charged } satisfies UpkeepCharge;
      });
      if (charge) out.push(charge);
    }
  }
  return out;
}

/** What this stable's upkeep would be for the current week so far (shown on This week). */
export async function upkeepThisWeek(db: Db, stableId: string, now: Date): Promise<{ horses: number; due: number }> {
  const from = weekBounds(utcWeekStart(now)).from;
  if (from.toISOString().slice(0, 10) < gc.UPKEEP_FIRST_WEEK) return { horses: 0, due: 0 };
  const used = (await usedHorses(db, from, now)).get(stableId) ?? new Set<string>();
  if (!used.size) return { horses: 0, due: 0 };
  const leasedIn = await leasedDuring(db, stableId, from, now);
  const rows = (
    await db.select({ id: horses.id, careerStatus: horses.careerStatus, owner: horses.ownerStableId, lessee: horses.lesseeStableId }).from(horses).where(inArray(horses.id, [...used]))
  ).filter((h) => ownsOrKeeps(h, stableId) || leasedIn.has(h.id));
  return { horses: rows.filter((h) => gc.upkeepFor(h.careerStatus) > 0).length, due: rows.reduce((s, h) => s + gc.upkeepFor(h.careerStatus), 0) };
}


/** The stable owns this horse (at home or away on lease) or holds it on lease now. */
function ownsOrKeeps(h: { owner: string | null; lessee: string | null }, stableId: string): boolean {
  return h.owner === stableId || h.lessee === stableId;
}

/** Horses this stable held on lease at some point in [from, to). */
async function leasedDuring(ex: Executor, stableId: string, from: Date, to: Date): Promise<Set<string>> {
  const rows = await ex
    .select({ horseId: horseLeases.horseId })
    .from(horseLeases)
    .where(and(eq(horseLeases.lesseeStableId, stableId), lt(horseLeases.startsAt, to), or(isNull(horseLeases.endedAt), gte(horseLeases.endedAt, from))));
  return new Set(rows.map((r) => r.horseId));
}

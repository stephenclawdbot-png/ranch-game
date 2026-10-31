/**
 * Beta health for the admin dashboard: the live counterparts of the season harness's metrics
 * (tools/season-harness). Credits earned and spent by ledger kind (player-account postings, so
 * player-to-player transfers show on both sides), horses in vs out, and this week's
 * competitive loop (Feature Qualifier, Weekend Feature and Plate participation).
 */
import { sql } from "drizzle-orm";
import { utcWeekStart } from "../crypto";
import type { Executor } from "../types";
import { weekBounds } from "./leagues";
import { leaseMetrics, type LeaseMetrics } from "./leasing";
import { rowsOf } from "./tx";
import { toteCreditsHealth } from "./tote";

export interface EconomyHealth {
  fromDay: string;
  /** Per ledger kind, credits that went into / out of player balances in the window. */
  byKind: { kind: string; earned: number; spent: number }[];
  earned: number;
  spent: number;
  /** spent per 100 earned (starting grants excluded). Healthy beta range ~85-115. */
  spentPer100: number | null;
  /** All player balances now. */
  playerBalances: number;
  horses: { born: number; bornByOrigin: Record<string, number>; retired: number; legacyFarm: number; died: number };
  week: { weekStart: string; qualifierStables: number; featureStables: number; plateStables: number; liveStables: number };
  /** Horse leasing: leases in force, started this week vs market sales this week, purse shares paid. */
  leases: LeaseMetrics;
  /** Claiming races in the window: races run, horses entered, claims lodged, horses claimed, credits paid for them. */
  claiming: { racesRun: number; horsesEntered: number; claimsLodged: number; horsesClaimed: number; creditsMoved: number };
  /** The tote in credits over the window: the house take ("Tote house take", a sink: credits leave circulation), pool volume, bettors and races settled. */
  tote: { houseTake: number; volume: number; bettors: number; races: number };
}

export async function economyHealth(ex: Executor, input: { now: Date; days?: number }): Promise<EconomyHealth> {
  const days = Math.max(1, Math.min(90, input.days ?? 7));
  const from = new Date(input.now.getTime() - days * 86_400_000);
  const byKind = rowsOf<{ kind: string; earned: string | number; spent: string | number }>(
    await ex.execute(sql`
      select t.kind,
             coalesce(sum(case when p.amount > 0 then p.amount else 0 end), 0) as earned,
             coalesce(sum(case when p.amount < 0 then -p.amount else 0 end), 0) as spent
        from ledger_postings p
        join ledger_transactions t on t.id = p.transaction_id
        join ledger_accounts a on a.id = p.ledger_account_id
       where a.kind = 'player' and a.currency = 'CR' and p.created_at >= ${from}
       group by t.kind
       order by t.kind`),
  ).map((r) => ({ kind: r.kind, earned: Number(r.earned), spent: Number(r.spent) }));
  const earned = byKind.reduce((s, r) => s + r.earned, 0);
  const spent = byKind.reduce((s, r) => s + r.spent, 0);
  const grants = byKind.filter((r) => /starter|grant|signup/.test(r.kind)).reduce((s, r) => s + r.earned, 0);
  const [bal] = rowsOf<{ total: string | number }>(
    await ex.execute(sql`select coalesce(sum(p.amount), 0) as total from ledger_postings p join ledger_accounts a on a.id = p.ledger_account_id where a.kind = 'player' and a.currency = 'CR'`),
  );
  const born = rowsOf<{ origin: string; n: number }>(
    await ex.execute(sql`select origin::text as origin, count(*)::int as n from horses where created_at >= ${from} and owner_stable_id is not null group by origin`),
  );
  const [out] = rowsOf<{ retired: number; legacy: number; died: number }>(
    await ex.execute(sql`
      select count(*) filter (where retired_at >= ${from})::int as retired,
             count(*) filter (where pastured_at >= ${from})::int as legacy,
             count(*) filter (where (dynamics->>'diedAtMs') is not null and pastured_at >= ${from})::int as died
        from horses where owner_stable_id is not null`),
  );
  const weekStart = utcWeekStart(input.now);
  const wk = weekBounds(weekStart);
  const [loop] = rowsOf<{ q: number; f: number; p: number; live: number }>(
    await ex.execute(sql`
      select count(distinct e.stable_id) filter (where r.conditions->'calendar'->>'kind' = 'feature_qualifier')::int as q,
             count(distinct e.stable_id) filter (where r.conditions->'calendar'->>'kind' = 'weekend_feature')::int as f,
             count(distinct e.stable_id) filter (where r.conditions->'calendar'->>'kind' = 'weekend_plate')::int as p,
             count(distinct e.stable_id) filter (where r.kind in ('scheduled','feature','final'))::int as live
        from race_entries e join races r on r.id = e.race_id
       where e.stable_id is not null and e.status = 'entered' and r.post_time >= ${wk.from} and r.post_time < ${wk.to}`),
  );
  const bornByOrigin = Object.fromEntries(born.map((b) => [b.origin, Number(b.n)]));
  return {
    fromDay: from.toISOString().slice(0, 10),
    byKind,
    earned,
    spent,
    spentPer100: earned - grants > 0 ? Math.round((spent * 100) / (earned - grants)) : null,
    playerBalances: Number(bal?.total ?? 0),
    horses: { born: born.reduce((s, b) => s + Number(b.n), 0), bornByOrigin, retired: Number(out?.retired ?? 0), legacyFarm: Number(out?.legacy ?? 0), died: Number(out?.died ?? 0) },
    week: { weekStart, qualifierStables: Number(loop?.q ?? 0), featureStables: Number(loop?.f ?? 0), plateStables: Number(loop?.p ?? 0), liveStables: Number(loop?.live ?? 0) },
    leases: await leaseMetrics(ex, input.now),
    claiming: await claimingMetrics(ex, from),
    tote: await toteCreditsHealth(ex, from),
  };
}

/** Claiming races settled since `from`, their claim-priced runners, claims lodged and horses claimed (with the credits paid). */
async function claimingMetrics(ex: Executor, from: Date): Promise<EconomyHealth["claiming"]> {
  const [r] = rowsOf<{ races: number; entered: number }>(
    await ex.execute(sql`
      select count(distinct r.id)::int as races, count(e.id)::int as entered
        from races r join race_entries e on e.race_id = r.id and e.claim_price is not null and e.status = 'entered'
       where r.status = 'settled' and r.settled_at >= ${from}`),
  );
  const [c] = rowsOf<{ lodged: number; claimed: number; moved: number | string }>(
    await ex.execute(sql`
      select count(*)::int as lodged,
             count(*) filter (where status = 'claimed')::int as claimed,
             coalesce(sum(price) filter (where status = 'claimed'), 0) as moved
        from race_claims where created_at >= ${from}`),
  );
  return { racesRun: Number(r?.races ?? 0), horsesEntered: Number(r?.entered ?? 0), claimsLodged: Number(c?.lodged ?? 0), horsesClaimed: Number(c?.claimed ?? 0), creditsMoved: Number(c?.moved ?? 0) };
}

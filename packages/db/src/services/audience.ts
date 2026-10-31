/**
 * Players by audience (admin): crypto players (an account with a linked or signed-in wallet:
 * `accounts.wallet_address`, or a wallet identity signal from any past link) against everyone
 * else. Aggregated in SQL, driven by the per-account indexes (race_entries by stable, care_log,
 * daily_cup_entries and account_play_days by account, ledger_postings by ledger account).
 *
 * Definitions (UTC days):
 *   - activity: a Live/Story/Cup race entry, a care session, a training plan saved, a Daily Cup
 *     run, a recorded play day (the login/play-day row) or any credits spent that day;
 *   - day-N return: of the accounts created in the window whose day N is over, the share with
 *     any activity on the Nth day after the signup day;
 *   - an active day: an (account, day) with activity in the window; credits spent per active
 *     day is the median over those account-days (0 when nothing was spent); races entered per
 *     active day is the mean;
 *   - USDG activity (crypto players): USDG registrations, listings, bids and orders created in
 *     the window, plus premium pack orders; orders split by chain (testnet T-USDG / mainnet).
 */
import { sql } from "drizzle-orm";
import type { Executor } from "../types";
import { rowsOf } from "./tx";

const DAY_MS = 86_400_000;
/** Robinhood Chain testnet: orders there are T-USDG. */
const TESTNET_CHAIN_ID = 46630;

export type AudienceKey = "crypto" | "other";

export interface AudienceGroup {
  key: AudienceKey;
  /** All accounts in the group (not just the window). */
  accounts: number;
  newPerDay: { day: string; n: number }[];
  day1: { eligible: number; returned: number; pct: number | null };
  day7: { eligible: number; returned: number; pct: number | null };
  activeDays: number;
  medianSpentPerActiveDay: number | null;
  racesPerActiveDay: number | null;
  /** Crypto players only (null for the others). */
  usdg: { actions: number; testnetOrders: number; mainnetOrders: number } | null;
}

export interface AudienceMetrics {
  fromDay: string;
  toDay: string;
  groups: AudienceGroup[];
}

const pct = (r: number, e: number) => (e > 0 ? Math.round((r * 1000) / e) / 10 : null);

export async function audienceMetrics(ex: Executor, input: { now: Date; days?: number }): Promise<AudienceMetrics> {
  const days = Math.max(1, Math.min(90, Math.floor(input.days ?? 14)));
  const today = Math.floor(input.now.getTime() / DAY_MS) * DAY_MS;
  const fromMs = today - (days - 1) * DAY_MS;
  const from = new Date(fromMs).toISOString();
  const fromDay = from.slice(0, 10);
  const todayDay = new Date(today).toISOString().slice(0, 10);
  const until = input.now.toISOString();

  const acc = sql`
    acc as (
      select a.id, (a.created_at at time zone 'UTC')::date as d0, a.created_at,
             (a.wallet_address is not null or exists (select 1 from account_links l where l.account_id = a.id and l.kind = 'wallet')) as crypto
        from accounts a where not a.is_system
    )`;
  const act = sql`
    spent as (
      select la.owner_account_id as account_id, (p.created_at at time zone 'UTC')::date as day, sum(-p.amount)::bigint as cr
        from ledger_accounts la join ledger_postings p on p.ledger_account_id = la.id
       where la.kind = 'player' and p.amount < 0 and p.created_at >= ${from} and p.created_at <= ${until}
       group by 1, 2
    ),
    rc as (
      select s.account_id, (e.created_at at time zone 'UTC')::date as day, count(*)::int as n
        from stables s join race_entries e on e.stable_id = s.id
       where e.created_at >= ${from} and e.created_at <= ${until}
       group by 1, 2
    ),
    act as (
      select account_id, day from rc
      union select account_id, day::date from care_log where day >= ${fromDay} and day <= ${todayDay}
      union select created_by, (created_at at time zone 'UTC')::date from training_plans where created_at >= ${from} and created_at <= ${until}
      union select account_id, day::date from daily_cup_entries where day >= ${fromDay} and day <= ${todayDay}
      union select account_id, day::date from account_play_days where day >= ${fromDay} and day <= ${todayDay}
      union select account_id, day from spent
    )`;

  const totals = rowsOf<{ crypto: boolean; n: number }>(await ex.execute(sql`with ${acc} select crypto, count(*)::int as n from acc group by crypto`));
  const signups = rowsOf<{ crypto: boolean; day: string; n: number }>(
    await ex.execute(sql`with ${acc} select crypto, to_char(d0, 'YYYY-MM-DD') as day, count(*)::int as n from acc where created_at >= ${from} and created_at <= ${until} group by 1, 2 order by 2`),
  );
  const retention = rowsOf<{ crypto: boolean; e1: number; r1: number; e7: number; r7: number }>(
    await ex.execute(sql`
      with ${acc}, ${act}
      select c.crypto,
             count(*) filter (where c.d0 + 1 < ${todayDay}::date)::int as e1,
             count(*) filter (where c.d0 + 1 < ${todayDay}::date and exists (select 1 from act where act.account_id = c.id and act.day = c.d0 + 1))::int as r1,
             count(*) filter (where c.d0 + 7 < ${todayDay}::date)::int as e7,
             count(*) filter (where c.d0 + 7 < ${todayDay}::date and exists (select 1 from act where act.account_id = c.id and act.day = c.d0 + 7))::int as r7
        from acc c where c.created_at >= ${from} and c.created_at <= ${until}
       group by c.crypto`),
  );
  const perDay = rowsOf<{ crypto: boolean; n: number; median: number | string | null; races: number | string | null }>(
    await ex.execute(sql`
      with ${acc}, ${act}, ad as (select distinct account_id, day from act)
      select c.crypto, count(*)::int as n,
             percentile_cont(0.5) within group (order by coalesce(spent.cr, 0)) as median,
             avg(coalesce(rc.n, 0)) as races
        from ad join acc c on c.id = ad.account_id
        left join spent on spent.account_id = ad.account_id and spent.day = ad.day
        left join rc on rc.account_id = ad.account_id and rc.day = ad.day
       group by c.crypto`),
  );
  const [usdg] = rowsOf<{ actions: number; testnet: number; mainnet: number }>(
    await ex.execute(sql`
      with ${acc}, cr as (select id from acc where crypto),
      ord as (
        select chain_id from usdg_orders where created_at >= ${from} and created_at <= ${until} and account_id in (select id from cr)
        union all select chain_id from chain_orders where created_at >= ${from} and created_at <= ${until} and account_id in (select id from cr)
      )
      select ((select count(*) from ord)
              + (select count(*) from usdg_registrations where created_at >= ${from} and created_at <= ${until} and account_id in (select id from cr))
              + (select count(*) from usdg_listings where created_at >= ${from} and created_at <= ${until} and seller_account_id in (select id from cr))
              + (select count(*) from usdg_bids where created_at >= ${from} and created_at <= ${until} and account_id in (select id from cr)))::int as actions,
             (select count(*) from ord where chain_id = ${TESTNET_CHAIN_ID})::int as testnet,
             (select count(*) from ord where chain_id <> ${TESTNET_CHAIN_ID})::int as mainnet`),
  );

  const groups = (["crypto", "other"] as const).map((key): AudienceGroup => {
    const is = (r: { crypto: boolean }) => (key === "crypto") === Boolean(r.crypto);
    const ret = retention.find(is);
    const pd = perDay.find(is);
    const e1 = Number(ret?.e1 ?? 0);
    const r1 = Number(ret?.r1 ?? 0);
    const e7 = Number(ret?.e7 ?? 0);
    const r7 = Number(ret?.r7 ?? 0);
    const n = Number(pd?.n ?? 0);
    return {
      key,
      accounts: Number(totals.find(is)?.n ?? 0),
      newPerDay: signups.filter(is).map((s) => ({ day: s.day, n: Number(s.n) })),
      day1: { eligible: e1, returned: r1, pct: pct(r1, e1) },
      day7: { eligible: e7, returned: r7, pct: pct(r7, e7) },
      activeDays: n,
      medianSpentPerActiveDay: n ? Math.round(Number(pd!.median ?? 0)) : null,
      racesPerActiveDay: n ? Math.round(Number(pd!.races ?? 0) * 100) / 100 : null,
      usdg: key === "crypto" ? { actions: Number(usdg?.actions ?? 0), testnetOrders: Number(usdg?.testnet ?? 0), mainnetOrders: Number(usdg?.mainnet ?? 0) } : null,
    };
  });
  return { fromDay, toDay: todayDay, groups };
}

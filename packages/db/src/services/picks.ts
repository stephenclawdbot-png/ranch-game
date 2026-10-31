/**
 * Pick the winner (game-core picks.ts): one pick per stable per Live card race, from the
 * declared field, changeable until the off. Points only: nothing is staked, nothing is paid,
 * and points can never be exchanged for anything.
 *
 * Window: entries close only 30 s before the off (RULES.entriesCloseBeforePostMs), too short to
 * pick from the final field alone, so picks open with the card (the declared field: the
 * players' runners, the Club runners join at the lock) and close at the off. A pick on a runner
 * that doesn't run (scratched, or the race is called off) is void.
 *
 * No spoilers: picks are scored lazily (scorePicks), only once the race is settled and its
 * broadcast is over (news.ts resultPublicAt). Until then a pick reads "open", whatever the
 * server knows.
 */
import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import * as gc from "@thoroughbred/game-core";
import { DomainError } from "../errors";
import { horses, racePicks, raceEntries, raceResults, races, stables, type RacePickRow } from "../schema";
import type { Db, Executor } from "../types";
import { stableOf } from "./accounts";
import { completeStableStepTx } from "./guide";
import { LIVE_RACE_KINDS } from "./leagues";
import { resultPublicAt } from "./news";
import { rowsOf, runTx } from "./tx";

const isLive = (kind: string) => (LIVE_RACE_KINDS as readonly string[]).includes(kind);

/** Picks a runner to win (or changes the pick) until the off. */
export async function makePick(db: Db, input: { accountId: string; raceId: string; horseId: string; now: Date }): Promise<RacePickRow> {
  return runTx(db, async (tx) => {
    const stable = await stableOf(tx, input.accountId);
    const [race] = await tx.select({ id: races.id, kind: races.kind, status: races.status, postTime: races.postTime }).from(races).where(eq(races.id, input.raceId));
    if (!race) throw new DomainError("NOT_FOUND", "race not found");
    if (!isLive(race.kind)) throw new DomainError("NOT_ELIGIBLE", "Picks are for Live card races.");
    if (!gc.pickWindowOpen({ status: race.status, postTimeMs: race.postTime.getTime() }, input.now.getTime())) throw new DomainError("RACE_CLOSED", "Picks closed at the off.");
    const [runner] = await tx
      .select({ id: raceEntries.id })
      .from(raceEntries)
      .where(and(eq(raceEntries.raceId, race.id), eq(raceEntries.horseId, input.horseId), eq(raceEntries.status, "entered")));
    if (!runner) throw new DomainError("INVALID_INPUT", "That horse isn't declared for this race.");
    const [row] = await tx
      .insert(racePicks)
      .values({ raceId: race.id, stableId: stable.id, horseId: input.horseId, postTime: race.postTime, createdAt: input.now, updatedAt: input.now })
      .onConflictDoUpdate({ target: [racePicks.raceId, racePicks.stableId], set: { horseId: input.horseId, updatedAt: input.now }, where: sql`${racePicks.outcome} = 'open'` })
      .returning();
    if (!row) throw new DomainError("RACE_CLOSED", "Picks closed at the off.");
    await completeStableStepTx(tx, { accountId: input.accountId, step: "pick", now: input.now });
    return row;
  });
}

/**
 * Scores open picks whose race is over: void when the race was called off or the runner didn't
 * run; otherwise won/lost with game-core scorePick on the final field. Only once the result is
 * public. Idempotent (a pick is scored once: `outcome = 'open'` guard). Returns picks scored.
 */
export async function scorePicks(db: Db, input: { now: Date; raceIds?: string[]; limit?: number }): Promise<number> {
  const due = rowsOf<{ race_id: string }>(
    await db.execute(sql`
      select distinct p.race_id from race_picks p
       where p.outcome = 'open' and p.post_time <= ${input.now.toISOString()}
         ${input.raceIds?.length ? sql`and p.race_id in (${sql.join(input.raceIds.map((id) => sql`${id}`), sql`, `)})` : sql``}
       limit ${input.limit ?? 200}`),
  ).map((r) => r.race_id);
  if (!due.length) return 0;
  const raceRows = await db.select({ id: races.id, status: races.status, postTime: races.postTime, settledAt: races.settledAt }).from(races).where(inArray(races.id, due));
  const results = await db.select({ raceId: raceResults.raceId, result: raceResults.result }).from(raceResults).where(inArray(raceResults.raceId, due));
  const resultOf = new Map(results.map((r) => [r.raceId, r.result]));
  const ready = raceRows.filter((r) => r.status === "cancelled" || (r.status === "settled" && resultPublicAt(r, resultOf.get(r.id), r.settledAt) <= input.now));
  if (!ready.length) return 0;
  const runners = await db
    .select({ raceId: raceEntries.raceId, horseId: raceEntries.horseId, rating: raceEntries.ratingBefore, position: raceEntries.finishPosition })
    .from(raceEntries)
    .where(and(inArray(raceEntries.raceId, ready.map((r) => r.id)), eq(raceEntries.status, "entered")));
  let scored = 0;
  for (const race of ready) {
    const field = runners.filter((r) => r.raceId === race.id && (race.status !== "settled" || r.position !== null));
    const winners = field.filter((r) => r.position === 1).map((r) => r.horseId);
    const ran = race.status === "settled";
    await runTx(db, async (tx) => {
      const open = await tx.select({ id: racePicks.id, horseId: racePicks.horseId }).from(racePicks).where(and(eq(racePicks.raceId, race.id), eq(racePicks.outcome, "open")));
      for (const p of open) {
        const s = gc.scorePick({ horseId: p.horseId, field, winners, ran });
        const res = await tx
          .update(racePicks)
          .set({ outcome: s.outcome, points: s.points, rank: s.rank, fieldSize: s.fieldSize, scoredAt: input.now })
          .where(and(eq(racePicks.id, p.id), eq(racePicks.outcome, "open")))
          .returning({ id: racePicks.id });
        scored += res.length;
      }
    });
  }
  return scored;
}

export interface PickRunnerView {
  horseId: string;
  horseName: string;
  stableName: string;
  /** Rank by rating in the declared field (1 = top-rated) and the points a winning pick would score now. */
  rank: number;
  pointsIfWins: number;
}

export interface RacePickView {
  raceId: string;
  open: boolean;
  closesAtMs: number;
  /** How many stables have picked (no per-runner counts). */
  picks: number;
  runners: PickRunnerView[];
  mine: { horseId: string; horseName: string; outcome: gc.PickOutcome | "open"; points: number } | null;
}

/** The race page's Pick block. Never reveals an outcome before the result is public (scoring waits for it). */
export async function racePickView(db: Db, input: { raceId: string; stableId: string | null; now: Date }): Promise<RacePickView | null> {
  const [race] = await db.select({ id: races.id, kind: races.kind, status: races.status, postTime: races.postTime }).from(races).where(eq(races.id, input.raceId));
  if (!race || !isLive(race.kind)) return null;
  if (input.now >= race.postTime) await scorePicks(db, { now: input.now, raceIds: [race.id] });
  const field = await db
    .select({ horseId: raceEntries.horseId, rating: raceEntries.ratingBefore, horseName: horses.name, stableName: stables.name })
    .from(raceEntries)
    .innerJoin(horses, eq(horses.id, raceEntries.horseId))
    .leftJoin(stables, eq(stables.id, raceEntries.stableId))
    .where(and(eq(raceEntries.raceId, race.id), eq(raceEntries.status, "entered")));
  const ranks = gc.ratingRanks(field);
  const [count] = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from race_picks where race_id = ${race.id}`));
  let mine: RacePickView["mine"] = null;
  if (input.stableId) {
    const [p] = await db
      .select({ horseId: racePicks.horseId, outcome: racePicks.outcome, points: racePicks.points, horseName: horses.name })
      .from(racePicks)
      .innerJoin(horses, eq(horses.id, racePicks.horseId))
      .where(and(eq(racePicks.raceId, race.id), eq(racePicks.stableId, input.stableId)));
    if (p) mine = { horseId: p.horseId, horseName: p.horseName ?? "A runner", outcome: p.outcome as gc.PickOutcome | "open", points: p.points };
  }
  return {
    raceId: race.id,
    open: gc.pickWindowOpen({ status: race.status, postTimeMs: race.postTime.getTime() }, input.now.getTime()),
    closesAtMs: race.postTime.getTime(),
    picks: Number(count?.n ?? 0),
    runners: field
      .map((r) => ({ horseId: r.horseId, horseName: r.horseName ?? "A runner", stableName: r.stableName ?? "The Club", rank: ranks.get(r.horseId)!, pointsIfWins: gc.pickPoints(ranks.get(r.horseId)!, field.length) }))
      .sort((a, b) => a.rank - b.rank || a.horseName.localeCompare(b.horseName)),
    mine,
  };
}

export interface TipsterTableRow extends gc.TipsterRow {
  stableName: string;
}

const weekRange = (weekStartMs: number) => ({ from: new Date(weekStartMs), to: new Date(weekStartMs + gc.WEEK_MS) });

/** The weekly tipster table (Monday 00:00 UTC to the next Monday, by race post time), scored picks only. */
export async function tipsterWeek(db: Db, input: { now: Date; weekStartMs?: number; limit?: number }): Promise<{ weekStartMs: number; rows: TipsterTableRow[] }> {
  await scorePicks(db, { now: input.now });
  const weekStartMs = input.weekStartMs ?? gc.tipsterWeekStartMs(input.now.getTime());
  const { from, to } = weekRange(weekStartMs);
  const totals = rowsOf<{ stable_id: string; name: string; points: number; wins: number; picks: number }>(
    await db.execute(sql`
      select p.stable_id, s.name, sum(p.points)::int as points,
             count(*) filter (where p.outcome = 'won')::int as wins,
             count(*)::int as picks
        from race_picks p join stables s on s.id = p.stable_id
       where p.post_time >= ${from.toISOString()} and p.post_time < ${to.toISOString()} and p.outcome in ('won','lost')
       group by p.stable_id, s.name`),
  );
  const nameOf = new Map(totals.map((t) => [t.stable_id, t.name]));
  const rows = gc
    .rankTipsters(totals.map((t) => ({ stableId: t.stable_id, points: Number(t.points), wins: Number(t.wins), picks: Number(t.picks) })))
    .slice(0, input.limit ?? gc.TIPSTER_TABLE_SHOWN)
    .map((r) => ({ ...r, stableName: nameOf.get(r.stableId) ?? "A stable" }));
  return { weekStartMs, rows };
}

/** Best single weeks ever (one row per stable: its best week). */
export async function tipsterAllTime(ex: Executor, input: { limit?: number } = {}): Promise<{ stableId: string; stableName: string; points: number; weekStartMs: number }[]> {
  const rows = rowsOf<{ stable_id: string; name: string; points: number; week: string }>(
    await ex.execute(sql`
      with weekly as (
        select p.stable_id, date_trunc('week', p.post_time at time zone 'UTC') as week, sum(p.points)::int as points
          from race_picks p where p.outcome = 'won' group by 1, 2
      ), best as (
        select distinct on (stable_id) stable_id, week, points from weekly order by stable_id, points desc, week asc
      )
      select b.stable_id, s.name, b.points, to_char(b.week, 'YYYY-MM-DD') as week from best b join stables s on s.id = b.stable_id
       order by b.points desc, b.week asc limit ${input.limit ?? 10}`),
  );
  return rows.map((r) => ({ stableId: r.stable_id, stableName: r.name, points: Number(r.points), weekStartMs: Date.parse(`${r.week}T00:00:00Z`) }));
}

export interface TipsterProfile {
  week: { points: number; wins: number; picks: number; position: number | null };
  bestWeek: number;
  allTimePoints: number;
  streak: { current: number; best: number };
  /** Completed weeks finished in the top TIPSTER_BADGE_TOP with points. */
  badges: number;
}

/** Your tipster line: this week, best week, runs of winners and weekly badges (scored picks only). */
export async function tipsterProfile(db: Db, input: { stableId: string; now: Date }): Promise<TipsterProfile> {
  const week = await tipsterWeek(db, { now: input.now, limit: 100_000 });
  const me = week.rows.find((r) => r.stableId === input.stableId);
  const outcomes = (
    await db
      .select({ outcome: racePicks.outcome })
      .from(racePicks)
      .where(and(eq(racePicks.stableId, input.stableId), sql`${racePicks.outcome} <> 'open'`))
      .orderBy(racePicks.postTime)
  ).map((r) => r.outcome as gc.PickOutcome);
  const [agg] = rowsOf<{ best: number | null; total: number | null; badges: number }>(
    await db.execute(sql`
      with weekly as (
        select p.stable_id, date_trunc('week', p.post_time at time zone 'UTC') as week,
               sum(p.points)::int as points, count(*) filter (where p.outcome = 'won')::int as wins, count(*)::int as picks
          from race_picks p
         where p.outcome in ('won','lost') and p.post_time < ${new Date(week.weekStartMs).toISOString()}
         group by 1, 2
      ), ranked as (
        select stable_id, points, rank() over (partition by week order by points desc, wins desc, picks asc) as pos from weekly
      ), mine as (
        select p.points from race_picks p where p.stable_id = ${input.stableId} and p.outcome = 'won'
      )
      select (select max(w.points) from weekly w where w.stable_id = ${input.stableId}) as best,
             (select sum(points) from mine)::int as total,
             (select count(*) from ranked r where r.stable_id = ${input.stableId} and r.points > 0 and r.pos <= ${gc.TIPSTER_BADGE_TOP})::int as badges`),
  );
  return {
    week: { points: me?.points ?? 0, wins: me?.wins ?? 0, picks: me?.picks ?? 0, position: me ? me.position : null },
    bestWeek: Math.max(Number(agg?.best ?? 0), me?.points ?? 0),
    allTimePoints: Number(agg?.total ?? 0),
    streak: gc.pickStreaks(outcomes),
    badges: Number(agg?.badges ?? 0),
  };
}

export interface TodaysPickRace {
  raceId: string;
  name: string;
  postTimeMs: number;
  runners: number;
  mine: { horseName: string } | null;
}

/** Home's "Today's picks": the next Live races still open for picks, with your pick if any, and your latest scored picks. */
export async function todaysPicks(db: Db, input: { stableId: string; now: Date; limit?: number }): Promise<{ upcoming: TodaysPickRace[]; recent: { raceId: string; raceName: string; horseName: string; outcome: gc.PickOutcome; points: number }[] }> {
  await scorePicks(db, { now: input.now });
  const upcoming = rowsOf<{ id: string; name: string; post_time: string | Date; runners: number; pick: string | null }>(
    await db.execute(sql`
      select r.id, r.name, r.post_time,
             (select count(*) from race_entries e where e.race_id = r.id and e.status = 'entered')::int as runners,
             (select h.name from race_picks p join horses h on h.id = p.horse_id where p.race_id = r.id and p.stable_id = ${input.stableId}) as pick
        from races r
       where r.kind in ('scheduled','feature','final') and r.status in ('open','locked')
         and r.post_time > ${input.now.toISOString()}
         and exists (select 1 from race_entries e where e.race_id = r.id and e.status = 'entered')
       order by r.post_time asc limit ${input.limit ?? 3}`),
  );
  const recent = await db
    .select({ raceId: racePicks.raceId, raceName: races.name, horseName: horses.name, outcome: racePicks.outcome, points: racePicks.points })
    .from(racePicks)
    .innerJoin(races, eq(races.id, racePicks.raceId))
    .innerJoin(horses, eq(horses.id, racePicks.horseId))
    .where(and(eq(racePicks.stableId, input.stableId), inArray(racePicks.outcome, ["won", "lost", "void"]), gte(racePicks.postTime, new Date(input.now.getTime() - 86_400_000)), lte(racePicks.postTime, input.now)))
    .orderBy(sql`${racePicks.postTime} desc`)
    .limit(3);
  return {
    upcoming: upcoming.map((r) => ({ raceId: r.id, name: r.name, postTimeMs: new Date(r.post_time).getTime(), runners: Number(r.runners), mine: r.pick ? { horseName: r.pick } : null })),
    recent: recent.map((r) => ({ raceId: r.raceId, raceName: r.raceName, horseName: r.horseName ?? "A runner", outcome: r.outcome as gc.PickOutcome, points: r.points })),
  };
}

/** Weeks (start ms) with any scored pick before `beforeMs`, newest first (the table's "last week" link). */
export async function tipsterWeeks(ex: Executor, input: { beforeMs: number; limit?: number }): Promise<number[]> {
  const rows = await ex
    .select({ week: sql<string>`to_char(date_trunc('week', ${racePicks.postTime} at time zone 'UTC'), 'YYYY-MM-DD')` })
    .from(racePicks)
    .where(and(lt(racePicks.postTime, new Date(input.beforeMs)), inArray(racePicks.outcome, ["won", "lost"])))
    .groupBy(sql`1`)
    .orderBy(sql`1 desc`)
    .limit(input.limit ?? 8);
  return rows.map((r) => Date.parse(`${r.week}T00:00:00Z`));
}

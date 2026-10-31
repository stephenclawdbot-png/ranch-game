/**
 * Rivals and head-to-head records (experience review item 5), from settled Live races whose
 * result is public (news.ts resultPublicAt: never before the broadcast is over). game-core
 * rivals.ts does the counting; this file loads the meetings in two queries (no N+1).
 *
 * Club runners have no owner and are never anyone's rival.
 */
import { inArray, sql } from "drizzle-orm";
import { raceResults, stables } from "../schema";
import { gc } from "../gameCore";
import type { Executor } from "../types";
import { resultPublicAt } from "./news";
import { rowsOf } from "./tx";

const LIVE = sql.raw(`('scheduled','feature','final')`);
const DAY_MS = 86_400_000;

interface MeetingQuery {
  /** Only races since this time. */
  since?: Date | null;
  /** Only races up to and including this post time. */
  until?: Date | null;
  /** Only races where this other stable also ran. */
  withStable?: string | null;
  /** Only these races. */
  raceIds?: string[] | null;
  limit?: number;
}

/** The stable's settled Live races (public results only), with every finisher, newest first. */
export async function meetingsOf(ex: Executor, stableId: string, now: Date, q: MeetingQuery = {}): Promise<gc.RaceMeeting[]> {
  const rows = rowsOf<{ race_id: string; race_name: string; post_time: string | Date; settled_at: string | Date | null; horse_id: string; horse_name: string | null; stable_id: string | null; stable_name: string | null; position: number }>(
    await ex.execute(sql`
      with mine as (
        select r.id, r.name, r.post_time, r.settled_at from races r
         where r.kind in ${LIVE} and r.status = 'settled'
           and exists (select 1 from race_entries e where e.race_id = r.id and e.stable_id = ${stableId} and e.status = 'entered')
           ${q.withStable ? sql`and exists (select 1 from race_entries o where o.race_id = r.id and o.stable_id = ${q.withStable} and o.status = 'entered')` : sql``}
           ${q.since ? sql`and r.post_time >= ${q.since.toISOString()}` : sql``}
           ${q.until ? sql`and r.post_time <= ${q.until.toISOString()}` : sql``}
           ${q.raceIds?.length ? sql`and r.id in (${sql.join(q.raceIds.map((id) => sql`${id}`), sql`, `)})` : sql``}
           and r.post_time <= ${now.toISOString()}
         order by r.post_time desc limit ${q.limit ?? 300}
      )
      select m.id as race_id, m.name as race_name, m.post_time, m.settled_at, e.horse_id, h.name as horse_name, e.stable_id, s.name as stable_name, e.finish_position as position
        from mine m join race_entries e on e.race_id = m.id
        left join horses h on h.id = e.horse_id
        left join stables s on s.id = e.stable_id
       where e.finish_position is not null and e.status = 'entered'`),
  );
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.race_id))];
  const results = await ex.select({ raceId: raceResults.raceId, result: raceResults.result }).from(raceResults).where(inArray(raceResults.raceId, ids));
  const resultOf = new Map(results.map((r) => [r.raceId, r.result]));
  const by = new Map<string, gc.RaceMeeting>();
  for (const r of rows) {
    const result = resultOf.get(r.race_id);
    const postTime = new Date(r.post_time);
    // no spoilers: a race counts once its broadcast is over
    if (resultPublicAt({ postTime }, result, r.settled_at ? new Date(r.settled_at) : null) > now) continue;
    const margins = new Map((((result as { finishOrder?: { horseId: string; marginMm: number }[] } | null)?.finishOrder) ?? []).map((f) => [f.horseId, f.marginMm]));
    const m = by.get(r.race_id) ?? { raceId: r.race_id, raceName: r.race_name, atMs: postTime.getTime(), runners: [] };
    m.runners.push({ horseId: r.horse_id, horseName: r.horse_name ?? "A runner", stableId: r.stable_id, stableName: r.stable_id ? (r.stable_name ?? "A stable") : "The Club", position: Number(r.position), marginMm: margins.get(r.horse_id) ?? 0 });
    by.set(r.race_id, m);
  }
  return [...by.values()].sort((a, b) => b.atMs - a.atMs);
}

export interface RivalSummary extends gc.StableH2H {
  silks: unknown;
}

export interface RivalsView {
  rivals: RivalSummary[];
  nemesis: gc.Nemesis | null;
  /** Horse-vs-horse records against the rivals' horses (most meetings first). */
  pairs: gc.HorseH2H[];
}

/** Rival stables over the last RIVAL_WINDOW_DAYS, the nemesis, and the horse pairs behind them. */
export async function rivalsView(ex: Executor, stableId: string, now: Date, opts: { limit?: number } = {}): Promise<RivalsView> {
  const meetings = await meetingsOf(ex, stableId, now, { since: new Date(now.getTime() - gc.RIVAL_WINDOW_DAYS * DAY_MS) });
  const ranked = gc.rankRivals(gc.stableHeadToHead(meetings, stableId)).slice(0, opts.limit ?? gc.RIVALS_SHOWN);
  const pairs = gc.horseHeadToHead(meetings, stableId);
  const silks = ranked.length ? await ex.select({ id: stables.id, silks: stables.silks }).from(stables).where(inArray(stables.id, ranked.map((r) => r.stableId))) : [];
  const silksOf = new Map(silks.map((s) => [s.id, s.silks]));
  const rivalIds = new Set(ranked.map((r) => r.stableId));
  return {
    rivals: ranked.map((r) => ({ ...r, silks: silksOf.get(r.stableId) ?? null })),
    nemesis: gc.findNemesis(pairs),
    pairs: pairs.filter((p) => rivalIds.has(p.theirStableId)).sort((a, b) => b.meetings - a.meetings || b.close - a.close),
  };
}

/** Your record against one stable (all public meetings), with the horse pairs. */
export async function recordAgainst(ex: Executor, stableId: string, otherId: string, now: Date): Promise<{ record: gc.StableH2H | null; pairs: gc.HorseH2H[] }> {
  if (stableId === otherId) return { record: null, pairs: [] };
  const meetings = await meetingsOf(ex, stableId, now, { withStable: otherId });
  const record = gc.stableHeadToHead(meetings, stableId).find((r) => r.stableId === otherId) ?? null;
  const pairs = gc.horseHeadToHead(meetings, stableId)
    .filter((p) => p.theirStableId === otherId)
    .sort((a, b) => b.meetings - a.meetings || b.close - a.close);
  return { record, pairs };
}

/**
 * Post-race lines for the viewer's stable in one race ("You beat Thistle Mead's Copper Comet for
 * the first time in 4 meetings"). Empty until the race's result is public.
 */
export async function raceRivalLinesFor(ex: Executor, stableId: string, raceId: string, now: Date): Promise<string[]> {
  const [race] = await meetingsOf(ex, stableId, now, { raceIds: [raceId], limit: 1 });
  if (!race) return [];
  const others = [...new Set(race.runners.filter((r) => r.stableId && r.stableId !== stableId).map((r) => r.stableId!))];
  if (!others.length) return [];
  // every earlier public meeting with the stables in this race (the history of these pairs)
  const history = await meetingsOf(ex, stableId, now, { until: new Date(race.atMs), limit: 500 });
  const relevant = history.filter((m) => m.runners.some((r) => r.stableId && others.includes(r.stableId)));
  const view = await rivalsView(ex, stableId, now);
  return gc.raceRivalLines(relevant, raceId, stableId, { rivalIds: new Set(view.rivals.map((r) => r.stableId)), nemesisId: view.nemesis?.horseId ?? null });
}

/** For the racecard: the viewer's rival stables and nemesis horse (ids only). */
export async function rivalTags(ex: Executor, stableId: string, now: Date): Promise<{ rivalStableIds: string[]; nemesisHorseId: string | null }> {
  const v = await rivalsView(ex, stableId, now);
  return { rivalStableIds: v.rivals.map((r) => r.stableId), nemesisHorseId: v.nemesis?.horseId ?? null };
}

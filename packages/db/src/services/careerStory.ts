/**
 * The career story's reads (game-core careerStory.ts writes the lines). Public: everything here
 * is what the racecourse saw (results, margins, official ratings, race injuries, quirks a race
 * showed, the Hall of Fame, retirement, foals' wins); nothing private (no finances, training,
 * care or vet treatments).
 *
 * One fixed query set per horse, run together, whatever the career's length (no N+1):
 *   1. its settled career races (Story races left out) with every finisher in each;
 *   2. its injuries and quirks from races (horse_log);
 *   3. its Hall of Fame inductions;
 *   4. its foals' wins.
 * Only small pieces of each result jsonb are selected.
 *
 * No spoilers: a race counts once its broadcast is over (news.ts resultPublicAt). While one of
 * the horse's races is settled but still being broadcast, retirement and death (which that race
 * may have caused) wait too.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { hallOfFame, horseLog, type HorseRow } from "../schema";
import { gc } from "../gameCore";
import type { Executor } from "../types";
import { resultPublicAt } from "./news";
import { rowsOf } from "./tx";

type Ts = string | Date;
const toDate = (v: Ts): Date => (v instanceof Date ? v : new Date(v));

/** True once the race's broadcast is over (the last finisher's time is enough for resultPublicAt). */
function isPublic(postTime: Ts, settledAt: Ts | null, lastUs: unknown, now: Date): boolean {
  const last = typeof lastUs === "number" ? lastUs : typeof lastUs === "string" ? Number(lastUs) : 0;
  return resultPublicAt({ postTime: toDate(postTime) }, { finishOrder: [{ finishTimeUs: last }] }, settledAt ? toDate(settledAt) : null) <= now;
}

/** "Sea Lavender: Champion" -> "Champion". */
function honourOf(title: string, name: string): string {
  return title.startsWith(`${name}: `) ? title.slice(name.length + 2) : title;
}

/** The game-core input for a horse's career story, as of `now`. */
export async function careerStoryInput(ex: Executor, horse: HorseRow, now: Date): Promise<gc.CareerStoryInput> {
  const [runRows, logRows, honourRows, foalRows] = await Promise.all([
    ex.execute(sql`
      with mine as (
        select r.id, r.name, r.kind::text as kind, r.race_class, r.purse, r.post_time, r.settled_at,
               coalesce((rr.result->>'photoFinish')::boolean, false) as photo,
               (select f->>'marginLabel' from jsonb_array_elements(coalesce(rr.result->'finishOrder', '[]'::jsonb)) f where (f->>'position')::int = 2 limit 1) as won_by,
               (select max((f->>'finishTimeUs')::bigint) from jsonb_array_elements(coalesce(rr.result->'finishOrder', '[]'::jsonb)) f) as last_us
          from race_entries me
          join races r on r.id = me.race_id
          join race_results rr on rr.race_id = r.id
         where me.horse_id = ${horse.id} and me.status = 'entered' and me.finish_position is not null
           and r.status = 'settled' and r.kind <> 'quick'
      )
      select m.id as race_id, m.name as race_name, m.kind, m.race_class, m.purse, m.post_time, m.settled_at, m.photo, m.won_by, m.last_us,
             e.horse_id, h.name as horse_name, h.sex, e.stable_id, e.finish_position as position, e.rating_before, e.rating_after
        from mine m
        join race_entries e on e.race_id = m.id and e.status = 'entered' and e.finish_position is not null
        left join horses h on h.id = e.horse_id
       order by m.post_time, m.id, e.finish_position`),
    ex
      .select({ kind: horseLog.kind, raceId: horseLog.raceId, at: horseLog.at, data: horseLog.data })
      .from(horseLog)
      .where(and(eq(horseLog.horseId, horse.id), inArray(horseLog.kind, ["injury", "quirk"]))),
    ex.select({ key: hallOfFame.entryKey, title: hallOfFame.title, at: hallOfFame.inductedAt }).from(hallOfFame).where(eq(hallOfFame.horseId, horse.id)),
    ex.execute(sql`
      select c.id as foal_id, c.name as foal_name, c.sex as foal_sex, r.id as race_id, r.name as race_name, r.kind::text as kind, r.race_class, r.purse, r.post_time, r.settled_at,
             (select max((f->>'finishTimeUs')::bigint) from jsonb_array_elements(coalesce(rr.result->'finishOrder', '[]'::jsonb)) f) as last_us
        from horses c
        join race_entries e on e.horse_id = c.id and e.status = 'entered' and e.finish_position = 1
        join races r on r.id = e.race_id and r.status = 'settled' and r.kind <> 'quick'
        join race_results rr on rr.race_id = r.id
       where c.sire_id = ${horse.id} or c.dam_id = ${horse.id}
       order by r.post_time`),
  ]);

  type RunRow = {
    race_id: string;
    race_name: string;
    kind: string;
    race_class: string;
    purse: number | string;
    post_time: Ts;
    settled_at: Ts | null;
    photo: boolean;
    won_by: string | null;
    last_us: unknown;
    horse_id: string;
    horse_name: string | null;
    sex: string | null;
    stable_id: string | null;
    position: number | string;
    rating_before: number | string;
    rating_after: number | string | null;
  };
  const runs = new Map<string, gc.StoryRun>();
  /** Settled but still being broadcast: the earliest such post time. */
  let pendingFromMs: number | null = null;
  for (const r of rowsOf<RunRow>(runRows)) {
    const postMs = toDate(r.post_time).getTime();
    if (!isPublic(r.post_time, r.settled_at, r.last_us, now)) {
      pendingFromMs = pendingFromMs === null ? postMs : Math.min(pendingFromMs, postMs);
      continue;
    }
    let run = runs.get(r.race_id);
    if (!run) {
      run = { raceId: r.race_id, raceName: r.race_name, atMs: postMs, kind: r.kind, raceClass: r.race_class, purse: Number(r.purse), photoFinish: !!r.photo, wonBy: r.won_by, ratingAfter: null, runners: [] };
      runs.set(r.race_id, run);
    }
    run.runners.push({ horseId: r.horse_id, name: r.horse_name ?? "A runner", sex: r.sex ?? "male", stableId: r.stable_id, position: Number(r.position), ratingBefore: Number(r.rating_before ?? 0) });
    if (r.horse_id === horse.id) run.ratingAfter = r.rating_after === null ? null : Number(r.rating_after);
  }

  const injuries: gc.StoryInjury[] = [];
  const quirks: gc.StoryQuirk[] = [];
  for (const l of logRows) {
    if (!l.raceId || !runs.has(l.raceId)) continue;
    const d = (l.data ?? {}) as { severity?: unknown; injuryKind?: unknown; quirks?: unknown };
    if (l.kind === "injury") injuries.push({ raceId: l.raceId, atMs: l.at.getTime(), severity: typeof d.severity === "string" ? d.severity : "minor", kind: typeof d.injuryKind === "string" ? d.injuryKind : null });
    else quirks.push({ raceId: l.raceId, atMs: l.at.getTime(), quirks: Array.isArray(d.quirks) ? d.quirks.filter((q): q is string => typeof q === "string") : [] });
  }

  type FoalRow = { foal_id: string; foal_name: string; foal_sex: string; race_id: string; race_name: string; kind: string; race_class: string; purse: number | string; post_time: Ts; settled_at: Ts | null; last_us: unknown };
  const foalWins: gc.StoryFoalWin[] = rowsOf<FoalRow>(foalRows)
    .filter((f) => isPublic(f.post_time, f.settled_at, f.last_us, now))
    .map((f) => ({ foalId: f.foal_id, foalName: f.foal_name, foalSex: f.foal_sex, raceId: f.race_id, raceName: f.race_name, atMs: toDate(f.post_time).getTime(), kind: f.kind, raceClass: f.race_class, purse: Number(f.purse) }));

  // retirement and death may come from a race still on air: they wait for its broadcast
  const shown = (ms: number | null): number | null => (ms === null || (pendingFromMs !== null && ms >= pendingFromMs) ? null : ms);
  const dyn = (horse.dynamics ?? {}) as { diedAtMs?: unknown; diedAtRaceId?: unknown };
  const diedAtMs = shown(typeof dyn.diedAtMs === "number" ? dyn.diedAtMs : null);
  const retiredAtMs = shown(horse.retiredAt?.getTime() ?? null);
  return {
    horse: {
      id: horse.id,
      name: horse.name,
      sex: horse.sex,
      gelded: horse.gelded,
      careerStatus: retiredAtMs === null ? "racing" : horse.careerStatus,
      retirementReason: retiredAtMs === null ? null : horse.retirementReason,
      retiredAtMs,
      pasturedAtMs: retiredAtMs === null ? null : shown(horse.pasturedAt?.getTime() ?? null),
      diedAtMs,
      diedAtRaceId: diedAtMs !== null && typeof dyn.diedAtRaceId === "string" ? dyn.diedAtRaceId : null,
    },
    runs: [...runs.values()],
    injuries,
    quirks,
    honours: honourRows.map((h) => ({ key: h.key, atMs: h.at.getTime(), honour: honourOf(h.title, horse.name) })),
    foalWins,
  };
}

/** The horse's career story (game-core careerStory), oldest first, highlights marked. */
export async function careerStoryOf(ex: Executor, horse: HorseRow, now: Date): Promise<gc.StoryEntry[]> {
  return gc.careerStory(await careerStoryInput(ex, horse, now));
}

/**
 * Hall of Fame and status (§9): record times, champion horses, famous bloodlines, permanent
 * inductions (game-core `hallOfFameReasons`), achievements (game-core `ACHIEVEMENTS`) and
 * rivalries (game-core `detectRivalries`). Everything is derived from settled races and
 * stored rows; inductions and achievements are idempotent inserts (unique keys).
 *
 * "Live" here means the shared card (scheduled, feature and final races): records and
 * honours are only won against other stables, never in solo Story races.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { achievements, hallOfFame, horses, stables } from "../schema";
import { gc, genomeOf, isGenome, toHorseState } from "../gameCore";
import type { Db, Executor } from "../types";
import { awardAchievement, induct } from "./competition";
import { rowsOf } from "./tx";
import { stableStepsDone } from "./guide";
import { hallNewsTx } from "./news";

const LIVE = sql.raw(`('scheduled','feature','final')`);

export interface RecordTime {
  surface: string;
  distanceM: number;
  timeUs: number;
  horseId: string;
  horseName: string;
  /** Null for a Club (house) horse. */
  ownerStableId: string | null;
  stableName: string | null;
  raceId: string;
  raceName: string;
  postTime: Date;
}

/** The fastest winning time for every surface and trip run on the Live card. */
export async function recordTimes(ex: Executor): Promise<RecordTime[]> {
  const rows = rowsOf<{ surface: string; distance_m: number; time_us: string | number; horse_id: string; race_id: string; race_name: string; post_time: string | Date }>(
    await ex.execute(sql`
      select distinct on (surface, distance_m) * from (
        select ra.conditions->>'surface' as surface, (ra.conditions->>'distanceM')::int as distance_m,
               (rr.result->'finishOrder'->0->>'finishTimeUs')::bigint as time_us,
               rr.result->'finishOrder'->0->>'horseId' as horse_id,
               ra.id as race_id, ra.name as race_name, ra.post_time
          from race_results rr join races ra on ra.id = rr.race_id
         where ra.kind in ${LIVE} and ra.status = 'settled'
           and rr.result->'finishOrder'->0->>'finishTimeUs' is not null
           and ra.conditions->>'distanceM' is not null
      ) t
      order by surface, distance_m, time_us asc, post_time asc`),
  );
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.horse_id))].filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const hs = ids.length
    ? await ex.select({ id: horses.id, name: horses.name, owner: horses.ownerStableId, stableName: stables.name }).from(horses).leftJoin(stables, eq(stables.id, horses.ownerStableId)).where(inArray(horses.id, ids))
    : [];
  const by = new Map(hs.map((h) => [h.id, h]));
  return rows
    .map((r) => {
      const h = by.get(r.horse_id);
      return {
        surface: r.surface,
        distanceM: Number(r.distance_m),
        timeUs: Number(r.time_us),
        horseId: r.horse_id,
        horseName: h?.name ?? "Unknown",
        ownerStableId: h?.owner ?? null,
        stableName: h?.stableName ?? null,
        raceId: r.race_id,
        raceName: r.race_name,
        postTime: new Date(r.post_time),
      };
    })
    .sort((a, b) => (a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : a.distanceM - b.distanceM));
}

export interface ChampionHorse {
  horseId: string;
  name: string;
  ownerStableId: string | null;
  stableName: string | null;
  liveWins: number;
  liveRuns: number;
  gradedWins: number;
  earnings: number;
  rating: number;
  careerStatus: string;
}

/** Player-owned (or once player-owned) horses with the most Live wins. */
export async function championHorses(ex: Executor, limit = 10): Promise<ChampionHorse[]> {
  const rows = rowsOf<{ horse_id: string; wins: number; runs: number; graded: number }>(
    await ex.execute(sql`
      select e.horse_id, count(*) filter (where e.finish_position = 1)::int as wins, count(*)::int as runs,
             count(*) filter (where e.finish_position = 1 and r.race_class in ('graded','listed'))::int as graded
        from race_entries e join races r on r.id = e.race_id
       where r.kind in ${LIVE} and r.status = 'settled' and e.is_house = false and e.finish_position is not null
       group by e.horse_id
      having count(*) filter (where e.finish_position = 1) > 0
       order by wins desc, graded desc, runs asc
       limit ${limit}`),
  );
  if (!rows.length) return [];
  const hs = await ex
    .select({ id: horses.id, name: horses.name, owner: horses.ownerStableId, stableName: stables.name, earnings: horses.earnings, rating: horses.rating, careerStatus: horses.careerStatus })
    .from(horses)
    .leftJoin(stables, eq(stables.id, horses.ownerStableId))
    .where(inArray(horses.id, rows.map((r) => r.horse_id)));
  const by = new Map(hs.map((h) => [h.id, h]));
  return rows.flatMap((r) => {
    const h = by.get(r.horse_id);
    if (!h) return [];
    return [{ horseId: h.id, name: h.name, ownerStableId: h.owner, stableName: h.stableName, liveWins: Number(r.wins), liveRuns: Number(r.runs), gradedWins: Number(r.graded), earnings: Number(h.earnings), rating: h.rating, careerStatus: h.careerStatus }];
  });
}

export interface Bloodline {
  horseId: string;
  name: string;
  sex: string;
  stableName: string | null;
  offspring: number;
  winners: number;
  wins: number;
}

/** Sires and dams whose offspring have won the most races (all racing, Story included). */
export async function famousBloodlines(ex: Executor, limit = 8): Promise<Bloodline[]> {
  const rows = rowsOf<{ id: string; name: string; sex: string; stable_name: string | null; offspring: number; winners: number; wins: number }>(
    await ex.execute(sql`
      select p.id, p.name, p.sex, s.name as stable_name, count(distinct c.id)::int as offspring,
             count(distinct c.id) filter (where c.wins > 0)::int as winners, coalesce(sum(c.wins), 0)::int as wins
        from horses c join horses p on (p.id = c.sire_id or p.id = c.dam_id)
        left join stables s on s.id = p.owner_stable_id
       group by p.id, p.name, p.sex, s.name
      having coalesce(sum(c.wins), 0) > 0
       order by wins desc, winners desc, offspring desc
       limit ${limit}`),
  );
  return rows.map((r) => ({ horseId: r.id, name: r.name, sex: r.sex, stableName: r.stable_name, offspring: Number(r.offspring), winners: Number(r.winners), wins: Number(r.wins) }));
}

export async function hallEntries(ex: Executor, limit = 40) {
  return ex
    .select({ entry: hallOfFame, horseName: horses.name, stableName: stables.name })
    .from(hallOfFame)
    .leftJoin(horses, eq(horses.id, hallOfFame.horseId))
    .leftJoin(stables, eq(stables.id, horses.ownerStableId))
    .orderBy(desc(hallOfFame.inductedAt))
    .limit(limit);
}

const REASON_TITLE: Record<gc.HallOfFameReason, string> = {
  champion: "Champion",
  season_winner: "Season winner",
  record_time: "Record holder",
  great_racehorse: "Great racehorse",
  foundation_sire: "Foundation sire",
  foundation_mare: "Foundation mare",
  elite_genetics: "Elite genetics",
};

/**
 * Inducts every horse that meets a Hall of Fame criterion (permanent, idempotent per horse
 * and reason). Candidates: horses with Live wins, a Season Final or Feature win, or a record.
 */
export async function inductHallOfFame(db: Db, now: Date): Promise<number> {
  const records = await recordTimes(db);
  const recordCount = new Map<string, number>();
  for (const r of records) recordCount.set(r.horseId, (recordCount.get(r.horseId) ?? 0) + 1);
  const honours = rowsOf<{ horse_id: string; graded: number; finals: number; features: number; g1: number }>(
    await db.execute(sql`
      select e.horse_id,
             count(*) filter (where r.race_class = 'graded')::int as graded,
             count(*) filter (where r.kind = 'final')::int as finals,
             count(*) filter (where r.kind = 'feature')::int as features,
             count(*) filter (where (r.kind = 'final' or r.conditions->'calendar'->>'kind' = 'weekend_feature'))::int as g1
        from race_entries e join races r on r.id = e.race_id
       where r.kind in ${LIVE} and r.status = 'settled' and e.is_house = false and e.finish_position = 1
       group by e.horse_id`),
  );
  const offspring = rowsOf<{ parent: string; n: number }>(
    await db.execute(sql`
      select p.id as parent, count(distinct c.id)::int as n
        from horses c join horses p on (p.id = c.sire_id or p.id = c.dam_id)
        join race_entries e on e.horse_id = c.id and e.finish_position = 1
        join races r on r.id = e.race_id and r.race_class = 'graded' and r.status = 'settled'
       group by p.id`),
  );
  const off = new Map(offspring.map((o) => [o.parent, Number(o.n)]));
  const hon = new Map(honours.map((h) => [h.horse_id, h]));
  const ids = [...new Set([...hon.keys(), ...recordCount.keys(), ...off.keys()])].slice(0, 200);
  if (!ids.length) return 0;
  const rows = await db.select().from(horses).where(and(inArray(horses.id, ids), sql`${horses.origin} <> 'house'`));
  let added = 0;
  for (const row of rows) {
    if (!isGenome(row.genome)) continue;
    const state = toHorseState(row);
    const h = hon.get(row.id);
    const reasons = gc.hallOfFameReasons(state, {
      g1Wins: Number(h?.g1 ?? 0),
      gradedWins: Number(h?.graded ?? 0),
      seasonFinalWins: Number(h?.finals ?? 0),
      weekendFeatureWins: Number(h?.features ?? 0),
      recordTimes: recordCount.get(row.id) ?? 0,
      gradedWinnerOffspring: off.get(row.id) ?? 0,
    });
    const [owner] = row.ownerStableId ? await db.select({ accountId: stables.accountId }).from(stables).where(eq(stables.id, row.ownerStableId)) : [];
    for (const reason of reasons) {
      if (
        await induct(db, {
          entryKey: `horse:${row.id}:${reason}`,
          category: reason,
          title: `${row.name}: ${REASON_TITLE[reason]}`,
          horseId: row.id,
          accountId: owner?.accountId,
          data: { at: now.toISOString(), wins: row.wins, starts: row.starts },
        })
      ) {
        added++;
        await hallNewsTx(db, { entryKey: `horse:${row.id}:${reason}`, horseId: row.id, honour: REASON_TITLE[reason], now });
      }
    }
  }
  return added;
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

/** game-core OwnerStats for an account, from its rows. */
export async function ownerStats(ex: Executor, accountId: string): Promise<gc.OwnerStats> {
  const [stable] = await ex.select().from(stables).where(eq(stables.accountId, accountId));
  if (!stable) throw new Error("no stable");
  const [races] = rowsOf<{ races: number; wins: number; graded: number; g1: number; photo: number; finals: number }>(
    await ex.execute(sql`
      select count(*)::int as races,
             count(*) filter (where e.finish_position = 1)::int as wins,
             count(*) filter (where e.finish_position = 1 and r.race_class = 'graded' and r.kind in ${LIVE})::int as graded,
             count(*) filter (where e.finish_position = 1 and (r.kind = 'final' or r.conditions->'calendar'->>'kind' = 'weekend_feature'))::int as g1,
             count(*) filter (where e.finish_position = 1 and (rr.result->>'photoFinish')::boolean)::int as photo,
             count(*) filter (where e.finish_position = 1 and r.kind = 'final')::int as finals
        from race_entries e join races r on r.id = e.race_id left join race_results rr on rr.race_id = r.id
       where e.stable_id = ${stable.id} and r.status = 'settled' and e.finish_position is not null`),
  );
  const bred = await ex.select({ genome: horses.genome }).from(horses).where(and(eq(horses.ownerStableId, stable.id), eq(horses.origin, "bred")));
  let best = -1;
  const grades = ["E", "D", "C", "B", "A", "S"] as const;
  for (const b of bred) {
    const g = genomeOf(b.genome);
    if (g) best = Math.max(best, grades.indexOf(gc.gradeOf(gc.overallPotential(g))));
  }
  const [cup] = rowsOf<{ runs: number; top10: number }>(
    await ex.execute(sql`
      select count(*)::int as runs, count(*) filter (where pct <= 100)::int as top10 from (
        select d.account_id, case when n <= 1 then 0 else ((rk - 1) * 1000) / (n - 1) end as pct from (
          select account_id, day, rank() over (partition by day order by finish_time_us asc, finish_position asc, created_at asc) as rk,
                 count(*) over (partition by day) as n
            from daily_cup_entries where day in (select day from daily_cup_entries where account_id = ${accountId})
        ) d where d.account_id = ${accountId}
      ) t`),
  );
  const [promos] = rowsOf<{ n: number }>(await ex.execute(sql`select count(*)::int as n from league_members where account_id = ${accountId} and movement = 1`));
  const [hof] = rowsOf<{ n: number }>(
    await ex.execute(sql`select count(*)::int as n from hall_of_fame h left join horses x on x.id = h.horse_id where h.account_id = ${accountId} or x.owner_stable_id = ${stable.id}`),
  );
  const [care] = rowsOf<{ n: number }>(await ex.execute(sql`select count(distinct day)::int as n from care_log where account_id = ${accountId}`));
  return {
    races: Number(races?.races ?? 0),
    wins: Number(races?.wins ?? 0),
    gradedWins: Number(races?.graded ?? 0),
    g1Wins: Number(races?.g1 ?? 0),
    photoFinishWins: Number(races?.photo ?? 0),
    foalsBred: bred.length,
    bestBredGrade: best >= 0 ? grades[best]! : null,
    cupTop10: Number(cup?.top10 ?? 0),
    cupRuns: Number(cup?.runs ?? 0),
    leaguePromotions: Number(promos?.n ?? 0),
    seasonFinalWins: Number(races?.finals ?? 0),
    hallOfFame: Number(hof?.n ?? 0),
    careDays: Number(care?.n ?? 0),
    stableSteps: await stableStepsDone(ex, accountId),
  };
}

/** Awards every achievement the account now qualifies for (idempotent). Returns the new ones. */
export async function syncAchievements(db: Db, accountId: string): Promise<string[]> {
  const stats = await ownerStats(db, accountId);
  const have = new Set((await db.select({ code: achievements.code }).from(achievements).where(eq(achievements.accountId, accountId))).map((r) => r.code));
  const out: string[] = [];
  for (const a of gc.unlockedAchievements(stats, have)) if (await awardAchievement(db, { accountId, code: a.id, data: { stats } })) out.push(a.id);
  return out;
}

export async function listAchievements(ex: Executor, accountId: string) {
  return ex.select().from(achievements).where(eq(achievements.accountId, accountId)).orderBy(desc(achievements.earnedAt));
}

// ---------------------------------------------------------------------------
// Rivalries
// ---------------------------------------------------------------------------

/** game-core RaceFinishLite for the stable's recent Live races (owners = stable ids; house = "club"). */
export async function recentFinishes(ex: Executor, stableId: string, limit = 120): Promise<gc.RaceFinishLite[]> {
  const rows = rowsOf<{ race_id: string; post_time: string | Date; stable_id: string | null; horse_id: string; position: number; result: unknown }>(
    await ex.execute(sql`
      with mine as (
        select r.id, r.post_time from races r join race_entries e on e.race_id = r.id
         where e.stable_id = ${stableId} and r.kind in ${LIVE} and r.status = 'settled'
         order by r.post_time desc limit ${limit}
      )
      select m.id as race_id, m.post_time, e.stable_id, e.horse_id, e.finish_position as position, rr.result
        from mine m join race_entries e on e.race_id = m.id join race_results rr on rr.race_id = m.id
       where e.finish_position is not null`),
  );
  const by = new Map<string, gc.RaceFinishLite>();
  for (const r of rows) {
    const margins = new Map((((r.result as { finishOrder?: { horseId: string; marginMm: number }[] } | null)?.finishOrder) ?? []).map((f) => [f.horseId, f.marginMm]));
    const race = by.get(r.race_id) ?? { raceId: r.race_id, atMs: new Date(r.post_time).getTime(), finishers: [] };
    race.finishers.push({ ownerId: r.stable_id ?? "club", position: Number(r.position), marginMm: margins.get(r.horse_id) ?? 0 });
    by.set(r.race_id, race);
  }
  return [...by.values()];
}

export interface RivalView {
  stableId: string;
  stableName: string;
  silks: unknown;
  closeFinishes: number;
  /** Close finishes the viewer's stable came out on top. */
  yourWins: number;
  lastAtMs: number;
}

/** Rival stables: repeat close finishes (adjacent, within a length) against the given stable. */
export async function rivalsOf(ex: Executor, stableId: string): Promise<RivalView[]> {
  const rivalries = gc.detectRivalries(await recentFinishes(ex, stableId)).filter((r) => r.owners.includes(stableId));
  if (!rivalries.length) return [];
  const others = rivalries.map((r) => (r.owners[0] === stableId ? r.owners[1] : r.owners[0]));
  const names = await ex.select({ id: stables.id, name: stables.name, silks: stables.silks }).from(stables).where(inArray(stables.id, others));
  const by = new Map(names.map((n) => [n.id, n]));
  return rivalries.map((r, i) => {
    const other = others[i]!;
    const mineFirst = r.owners[0] === stableId;
    return {
      stableId: other,
      stableName: by.get(other)?.name ?? "A stable",
      silks: by.get(other)?.silks ?? null,
      closeFinishes: r.closeFinishes,
      yourWins: mineFirst ? r.aWins : r.closeFinishes - r.aWins,
      lastAtMs: r.lastAtMs,
    };
  });
}

/**
 * Weekly owner leagues (§9) on top of the league tables: groups of up to 30 owners per tier,
 * points from the week's settled Live races (game-core `racePoints` + `tierBonus`, capped per
 * week), promotion and relegation when the week is over (game-core `settleLeague`: owners
 * who didn't race are never relegated).
 *
 * Points are derived from the settled race entries, never accumulated separately, so they
 * can't drift: the current week is computed on read; a finished week is settled once
 * (idempotent: members with a final rank are left alone) and its points are frozen in
 * `league_members`.
 *
 * Membership is lazy: an owner joins the week's league when they enter a Live race or open
 * the league page (`ensureLeagueMembership`). Their tier is last league's tier + movement.
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { utcWeekStart } from "../crypto";
import { inboxItems, leagueMembers, leagues, raceEntries, races, stables } from "../schema";
import { gc } from "../gameCore";
import { seasonBounds } from "../rules";
import type { Db, Executor } from "../types";
import { joinWeeklyLeague } from "./competition";
import { runTx } from "./tx";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const LIVE_RACE_KINDS = ["scheduled", "feature", "final"] as const;

export function weekBounds(weekStart: string): { from: Date; to: Date } {
  const from = new Date(`${weekStart}T00:00:00.000Z`);
  return { from, to: new Date(from.getTime() + WEEK_MS) };
}

export interface LiveRun {
  accountId: string;
  raceId: string;
  position: number;
  fieldSize: number;
  raceClass: string;
  kind: string;
  postTime: Date;
  /** A Group 1: the Weekend Feature or a Season Final (the hourly Features are Listed / Group 3). */
  group1?: boolean;
}

/** SQL: is this race (alias "races") a Group 1, i.e. a Season Final or the Weekend Feature. */
export const GROUP1_RACE_SQL = sql`("races"."kind" = 'final' or "races"."conditions"->'calendar'->>'kind' = 'weekend_feature')`;

/** Settled Live runs in [from, to), optionally only for some accounts. */
export async function liveRunsBetween(ex: Executor, input: { from: Date; to: Date; accountIds?: string[] }): Promise<LiveRun[]> {
  if (input.accountIds && !input.accountIds.length) return [];
  const rows = await ex
    .select({
      accountId: stables.accountId,
      raceId: races.id,
      position: raceEntries.finishPosition,
      raceClass: races.raceClass,
      kind: races.kind,
      postTime: races.postTime,
      group1: sql<boolean>`${GROUP1_RACE_SQL}`,
      fieldSize: sql<number>`(select count(*)::int from race_entries x where x.race_id = "races"."id" and x.status = 'entered')`,
    })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .innerJoin(stables, eq(stables.id, raceEntries.stableId))
    .where(
      and(
        eq(races.status, "settled"),
        inArray(races.kind, [...LIVE_RACE_KINDS]),
        gte(races.postTime, input.from),
        lt(races.postTime, input.to),
        isNotNull(raceEntries.finishPosition),
        eq(raceEntries.status, "entered"),
        input.accountIds ? inArray(stables.accountId, input.accountIds) : sql`true`,
      ),
    );
  return rows.map((r) => ({ ...r, position: r.position ?? 99, fieldSize: Number(r.fieldSize) }));
}

type PointsRun = Pick<LiveRun, "position" | "fieldSize" | "raceClass"> & { group1?: boolean };

function bonusTier(run: PointsRun): string {
  if (run.group1) return "g1";
  return run.raceClass === "graded" ? "g3" : run.raceClass === "listed" ? "listed" : "";
}

export interface WeekScore {
  points: number;
  wins: number;
  bestFinish: number;
  runs: number;
}

/** Points of one Live run (start point + placing + tier bonus), before the weekly cap. */
export function runPoints(run: PointsRun): number {
  return gc.racePoints(run.position, run.fieldSize, gc.tierBonus(bonusTier(run), run.position));
}

/** League points of one owner's runs in one week (capped). */
export function weekScore(runs: readonly PointsRun[]): WeekScore {
  let points = 0;
  let wins = 0;
  let best = 0;
  // only the best BEST_RUNS_COUNTED runs score: extra entries help little, a bad race never hurts
  const scored = runs.map(runPoints).sort((a, b) => b - a).slice(0, gc.BEST_RUNS_COUNTED);
  for (const p of scored) points += p;
  for (const r of runs) {
    if (r.position === 1) wins++;
    best = best === 0 ? r.position : Math.min(best, r.position);
  }
  return { points: Math.min(gc.WEEKLY_RACE_POINTS_CAP, points), wins, bestFinish: best, runs: runs.length };
}

function scoresByAccount(runs: LiveRun[]): Map<string, WeekScore> {
  const by = new Map<string, LiveRun[]>();
  for (const r of runs) by.set(r.accountId, [...(by.get(r.accountId) ?? []), r]);
  return new Map([...by].map(([a, rs]) => [a, weekScore(rs)]));
}

const tierName = (tier: number) => gc.LEAGUE_TIERS[Math.max(0, Math.min(gc.LEAGUE_TIERS.length - 1, tier - 1))]!;

const ordinalOf = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/** Settles every finished week league (idempotent). Returns the number of members settled. */
export async function settleLeagueWeeks(db: Db, now: Date, opts: { accountId?: string } = {}): Promise<number> {
  const current = utcWeekStart(now);
  const due = await db
    .selectDistinct({ leagueId: leagueMembers.leagueId })
    .from(leagueMembers)
    .where(and(lt(leagueMembers.weekStart, current), isNull(leagueMembers.finalRank), opts.accountId ? eq(leagueMembers.accountId, opts.accountId) : sql`true`))
    .limit(50);
  let settled = 0;
  for (const { leagueId } of due) {
    settled += await runTx(db, async (tx) => {
      const [league] = await tx.select().from(leagues).where(eq(leagues.id, leagueId)).for("update");
      if (!league) return 0;
      const members = await tx.select().from(leagueMembers).where(eq(leagueMembers.leagueId, leagueId));
      if (!members.length || members.every((m) => m.finalRank !== null)) return 0;
      const { from, to } = weekBounds(league.weekStart);
      const scores = scoresByAccount(await liveRunsBetween(tx, { from, to, accountIds: members.map((m) => m.accountId) }));
      const gcLeague = {
        id: league.id,
        week: 0,
        tier: tierName(league.tier),
        members: members.map((m) => {
          const s = scores.get(m.accountId);
          return { ownerId: m.accountId, points: s?.points ?? 0, wins: s?.wins ?? 0, bestFinish: s?.bestFinish ?? 0 };
        }),
      };
      const moves = gc.settleLeague(gcLeague);
      for (const mv of moves) {
        const s = scores.get(mv.ownerId);
        await tx
          .update(leagueMembers)
          .set({ points: s?.points ?? 0, finalRank: mv.rank, movement: mv.outcome === "promoted" ? 1 : mv.outcome === "relegated" ? -1 : 0 })
          .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.accountId, mv.ownerId)));
        // Sunday recap (beta loop): where the week ended, the move, and the real gap to the line.
        if (s && s.runs > 0) {
          const tierLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
          const lineRank = gc.PROMOTE;
          const line = [...moves].sort((a, b) => a.rank - b.rank)[lineRank - 1];
          const linePoints = line ? (scores.get(line.ownerId)?.points ?? 0) : 0;
          const gap = mv.outcome === "promoted" ? 0 : Math.max(0, linePoints - s.points + 1);
          const title =
            mv.outcome === "promoted"
              ? `Week recap: ${ordinalOf(mv.rank)} in ${tierLabel(mv.from)}, promoted to ${tierLabel(mv.to)}`
              : mv.outcome === "relegated"
                ? `Week recap: ${ordinalOf(mv.rank)} in ${tierLabel(mv.from)}, down to ${tierLabel(mv.to)}`
                : `Week recap: ${ordinalOf(mv.rank)} in ${tierLabel(mv.from)}${gap > 0 ? `, ${gap} points from promotion` : ""}`;
          await tx
            .insert(inboxItems)
            .values({
              accountId: mv.ownerId,
              kind: "week_recap",
              dedupeKey: `week-recap:${league.weekStart}`,
              title,
              data: { weekStart: league.weekStart, rank: mv.rank, of: moves.length, points: s.points, wins: s.wins, runs: s.runs, outcome: mv.outcome, from: mv.from, to: mv.to, gapToPromotion: gap },
              createdAt: now,
            })
            .onConflictDoNothing();
        }
      }
      return moves.length;
    });
  }
  return settled;
}

/** The tier an owner plays at this week: their last settled league's tier + movement (1 = bronze). */
export async function nextTier(ex: Executor, accountId: string, beforeWeek: string): Promise<number> {
  const [last] = await ex
    .select({ tier: leagues.tier, movement: leagueMembers.movement })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
    .where(and(eq(leagueMembers.accountId, accountId), lt(leagueMembers.weekStart, beforeWeek)))
    .orderBy(sql`${leagueMembers.weekStart} desc`)
    .limit(1);
  if (!last) return 1;
  return Math.max(1, Math.min(gc.LEAGUE_TIERS.length, last.tier + (last.movement ?? 0)));
}

/** Joins this week's league at the right tier (idempotent). Settles the owner's finished weeks first. */
export async function ensureLeagueMembership(db: Db, input: { accountId: string; now: Date }) {
  const week = utcWeekStart(input.now);
  const [mine] = await db.select().from(leagueMembers).where(and(eq(leagueMembers.accountId, input.accountId), eq(leagueMembers.weekStart, week)));
  if (mine) return mine;
  await settleLeagueWeeks(db, input.now, { accountId: input.accountId });
  const tier = await nextTier(db, input.accountId, week);
  return joinWeeklyLeague(db, { accountId: input.accountId, weekStart: week, tier, now: input.now });
}

export interface LeagueRow {
  accountId: string;
  stableName: string;
  silks: unknown;
  /** The stable's photo, if it has one (game-core stablePhotoUrl; null = silks show). */
  photoUrl: string | null;
  points: number;
  wins: number;
  bestFinish: number;
  runs: number;
  finalRank: number | null;
  movement: number | null;
}

export interface LeagueTable {
  leagueId: string;
  weekStart: string;
  tier: number;
  tierName: string;
  /** Group number among this week's leagues of the tier (1-based). */
  group: number;
  capacity: number;
  settled: boolean;
  rows: LeagueRow[];
}

/** A league's table, best first (current week computed live; settled weeks frozen). */
export async function leagueTable(ex: Executor, leagueId: string): Promise<LeagueTable | null> {
  const [league] = await ex.select().from(leagues).where(eq(leagues.id, leagueId));
  if (!league) return null;
  const members = await ex
    .select({ m: leagueMembers, stableName: stables.name, silks: stables.silks, stableId: stables.id, photoHash: stables.photoHash })
    .from(leagueMembers)
    .innerJoin(stables, eq(stables.accountId, leagueMembers.accountId))
    .where(eq(leagueMembers.leagueId, leagueId));
  const settled = members.length > 0 && members.every((x) => x.m.finalRank !== null);
  const { from, to } = weekBounds(league.weekStart);
  const scores = scoresByAccount(await liveRunsBetween(ex, { from, to, accountIds: members.map((x) => x.m.accountId) }));
  const rows: LeagueRow[] = members.map(({ m, stableName, silks, stableId, photoHash }) => {
    const s = scores.get(m.accountId);
    return { accountId: m.accountId, stableName, silks, photoUrl: gc.stablePhotoUrl(stableId, photoHash), points: settled ? m.points : (s?.points ?? 0), wins: s?.wins ?? 0, bestFinish: s?.bestFinish ?? 0, runs: s?.runs ?? 0, finalRank: m.finalRank, movement: m.movement };
  });
  const order = gc.standings({ id: league.id, week: 0, tier: tierName(league.tier), members: rows.map((r) => ({ ownerId: r.accountId, points: r.points, wins: r.wins, bestFinish: r.bestFinish })) });
  const pos = new Map(order.map((m, i) => [m.ownerId, i]));
  rows.sort((a, b) => (settled ? (a.finalRank ?? 99) - (b.finalRank ?? 99) : pos.get(a.accountId)! - pos.get(b.accountId)!));
  const siblings = await ex
    .select({ id: leagues.id })
    .from(leagues)
    .where(and(eq(leagues.weekStart, league.weekStart), eq(leagues.tier, league.tier)))
    .orderBy(asc(leagues.createdAt), asc(leagues.id));
  return {
    leagueId: league.id,
    weekStart: league.weekStart,
    tier: league.tier,
    tierName: tierName(league.tier),
    group: Math.max(1, siblings.findIndex((s) => s.id === league.id) + 1),
    capacity: league.capacity,
    settled,
    rows,
  };
}

/** The account's league for the week containing `at` (null if they haven't joined). */
export async function leagueOf(ex: Executor, accountId: string, at: Date): Promise<LeagueTable | null> {
  const [mine] = await ex.select().from(leagueMembers).where(and(eq(leagueMembers.accountId, accountId), eq(leagueMembers.weekStart, utcWeekStart(at))));
  return mine ? leagueTable(ex, mine.leagueId) : null;
}

/** Past weeks' results for an account, newest first. */
export async function leagueHistory(ex: Executor, accountId: string, limit = 8) {
  return ex
    .select({ weekStart: leagueMembers.weekStart, tier: leagues.tier, points: leagueMembers.points, finalRank: leagueMembers.finalRank, movement: leagueMembers.movement })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
    .where(and(eq(leagueMembers.accountId, accountId), isNotNull(leagueMembers.finalRank)))
    .orderBy(sql`${leagueMembers.weekStart} desc`)
    .limit(limit);
}

export interface SeasonStanding {
  accountId: string;
  stableName: string;
  silks: unknown;
  /** The stable's photo, if it has one (game-core stablePhotoUrl; null = silks show). */
  photoUrl: string | null;
  points: number;
  wins: number;
  runs: number;
  rank: number;
}

/**
 * Season standings: the sum of each owner's weekly (capped) league points over the season's
 * weeks, best first. `limit` rows plus the given account's own row.
 */
export async function seasonStandings(ex: Executor, input: { season: number; now: Date; limit?: number; accountId?: string | null }): Promise<{ season: number; startsAt: Date; endsAt: Date; rows: SeasonStanding[]; mine: SeasonStanding | null; owners: number }> {
  const { startsAt, endsAt } = seasonBounds(input.season);
  const to = new Date(Math.min(endsAt.getTime(), input.now.getTime() + 1));
  const runs = await liveRunsBetween(ex, { from: startsAt, to });
  const byOwnerWeek = new Map<string, Map<string, LiveRun[]>>();
  for (const r of runs) {
    const w = utcWeekStart(r.postTime);
    const m = byOwnerWeek.get(r.accountId) ?? new Map<string, LiveRun[]>();
    m.set(w, [...(m.get(w) ?? []), r]);
    byOwnerWeek.set(r.accountId, m);
  }
  const totals = [...byOwnerWeek].map(([accountId, weeks]) => {
    let points = 0;
    let wins = 0;
    let n = 0;
    for (const rs of weeks.values()) {
      const s = weekScore(rs);
      points += s.points;
      wins += s.wins;
      n += s.runs;
    }
    return { accountId, points, wins, runs: n };
  });
  totals.sort((a, b) => b.points - a.points || b.wins - a.wins || (a.accountId < b.accountId ? -1 : 1));
  const keep = totals.slice(0, input.limit ?? 20);
  const mineIdx = input.accountId ? totals.findIndex((t) => t.accountId === input.accountId) : -1;
  const ids = [...new Set([...keep.map((k) => k.accountId), ...(mineIdx >= 0 ? [totals[mineIdx]!.accountId] : [])])];
  const names = ids.length ? await ex.select({ accountId: stables.accountId, name: stables.name, silks: stables.silks, stableId: stables.id, photoHash: stables.photoHash }).from(stables).where(inArray(stables.accountId, ids)) : [];
  const nameOf = new Map(names.map((n) => [n.accountId, n]));
  const row = (t: (typeof totals)[number], i: number): SeasonStanding => {
    const stable = nameOf.get(t.accountId);
    return { ...t, stableName: stable?.name ?? "A stable", silks: stable?.silks ?? null, photoUrl: stable ? gc.stablePhotoUrl(stable.stableId, stable.photoHash) : null, rank: i + 1 };
  };
  return {
    season: input.season,
    startsAt,
    endsAt,
    rows: keep.map(row),
    mine: mineIdx >= 0 ? row(totals[mineIdx]!, mineIdx) : null,
    owners: totals.length,
  };
}


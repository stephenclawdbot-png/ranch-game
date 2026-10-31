/**
 * Quick races (the `quick_races` and `match_race_runners` tables): instant, unofficial match races,
 * ghost races and daily challenge attempts. The web layer (apps/web server/quickRaces.ts) builds
 * the race and runs the engine; this module only stores what ran.
 *
 * Unofficial by construction: this module writes its own rows, the beaten challenger's opponent
 * owner a quiet inbox line (one per owner per UTC day, batched), and the daily challenge's seed
 * secret (economy_config, like the Daily Cup's). It never touches horses, entries, results,
 * ratings, form, the ledger, leagues, jockeys or records, and none of those read these tables.
 */
import { and, asc, desc, eq, ilike, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { newSeed, utcDay } from "../crypto";
import { DomainError } from "../errors";
import { economyConfig, horses, inboxItems, matchRaceRunners, quickRaces, stables, type HorseRow, type QuickRaceRow } from "../schema";
import type { Db, Executor, Tx } from "../types";
import { rowsOf, runTx } from "./tx";

export type QuickRaceMode = "match" | "ghost" | "daily";

/** inbox_items.kind of the daily "your horse beat a challenger" line. */
export const MATCH_NOTE_KIND = "match_note";
/** Wins listed in one day's note (the title still counts them all). */
const MATCH_NOTE_LINES_MAX = 20;

export interface QuickRaceInsert {
  mode: QuickRaceMode;
  accountId: string;
  stableId: string;
  horseId?: string | null;
  sourceRaceId?: string | null;
  /** Daily challenge: YYYY-MM-DD (UTC). */
  challengeDay?: string | null;
  engineVersion: string;
  input: unknown;
  summary: unknown;
  position: number;
  finishTimeUs: number;
  points?: number;
  now: Date;
}

export interface MatchRunnerInsert {
  horseId: string;
  horseName: string;
  /** The horse's stable (null for a Club horse). */
  stableId: string | null;
  challenger: boolean;
  position: number;
}

export interface MatchNoteLine {
  winnerId: string;
  winner: string;
  challengerId: string;
  challenger: string;
  quickRaceId: string;
}

/**
 * Stores one quick race. A daily challenge attempt is one per (stable, day): a second one is
 * refused (RACE_LIMIT) and nothing is written. A match race also stores its runners and tells each
 * other owner whose horse finished ahead of the challenger (one inbox line per owner per UTC day).
 */
export async function saveQuickRace(db: Db, row: QuickRaceInsert, runners: readonly MatchRunnerInsert[] = []): Promise<QuickRaceRow> {
  return runTx(db, async (tx) => {
    const [saved] = await tx
      .insert(quickRaces)
      .values({
        mode: row.mode,
        accountId: row.accountId,
        stableId: row.stableId,
        horseId: row.horseId ?? null,
        sourceRaceId: row.sourceRaceId ?? null,
        challengeDay: row.challengeDay ?? null,
        engineVersion: row.engineVersion,
        input: row.input,
        summary: row.summary,
        position: row.position,
        finishTimeUs: row.finishTimeUs,
        points: row.points ?? 0,
        createdAt: row.now,
      })
      .onConflictDoNothing({ target: [quickRaces.stableId, quickRaces.challengeDay] })
      .returning();
    if (!saved) throw new DomainError("RACE_LIMIT", "you've had today's attempt: the next challenge is published at 00:00 UTC");
    if (row.mode === "match" && runners.length) {
      await tx.insert(matchRaceRunners).values(
        runners.map((r) => ({ quickRaceId: saved.id, horseId: r.horseId, stableId: r.stableId, challenger: r.challenger, position: r.position, createdAt: row.now })),
      );
      const challenger = runners.find((r) => r.challenger);
      if (challenger) {
        for (const r of runners) {
          if (r.challenger || !r.stableId || r.stableId === row.stableId || r.position >= challenger.position) continue;
          await noteMatchWinTx(tx, {
            ownerStableId: r.stableId,
            now: row.now,
            line: { winnerId: r.horseId, winner: r.horseName, challengerId: challenger.horseId, challenger: challenger.horseName, quickRaceId: saved.id },
          });
        }
      }
    }
    return saved;
  });
}

/** The day's batched note to an owner whose horse beat a challenger: "Copper Comet beat Paper Moon in a match race". */
async function noteMatchWinTx(tx: Tx, input: { ownerStableId: string; now: Date; line: MatchNoteLine }): Promise<void> {
  const [owner] = await tx.select({ accountId: stables.accountId }).from(stables).where(eq(stables.id, input.ownerStableId));
  if (!owner) return;
  const dedupeKey = `match-note:${utcDay(input.now)}`;
  const [existing] = await tx
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, owner.accountId), eq(inboxItems.dedupeKey, dedupeKey)))
    .for("update");
  const prev = (existing?.data ?? {}) as { lines?: MatchNoteLine[]; wins?: number };
  const wins = (prev.wins ?? 0) + 1;
  const lines = [input.line, ...(prev.lines ?? [])].slice(0, MATCH_NOTE_LINES_MAX);
  const title = matchNoteTitle(input.line, wins);
  const data = { lines, wins };
  if (existing) {
    await tx.update(inboxItems).set({ title, data, readAt: null, createdAt: input.now }).where(eq(inboxItems.id, existing.id));
  } else {
    await tx.insert(inboxItems).values({ accountId: owner.accountId, kind: MATCH_NOTE_KIND, dedupeKey, title, data, horseId: input.line.winnerId, createdAt: input.now });
  }
}

/** The note's one line: the latest win, and how many more today. */
export function matchNoteTitle(latest: Pick<MatchNoteLine, "winner" | "challenger">, wins: number): string {
  const more = wins - 1;
  return `${latest.winner} beat ${latest.challenger} in a match race${more > 0 ? ` (and ${more} more match ${more === 1 ? "win" : "wins"} today)` : ""}`;
}

/** The latest match notes of an account (newest first). */
export async function listMatchNotes(ex: Executor, accountId: string, limit = 3) {
  return ex
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, MATCH_NOTE_KIND)))
    .orderBy(desc(inboxItems.createdAt))
    .limit(limit);
}

export async function getQuickRace(ex: Executor, id: string): Promise<QuickRaceRow | null> {
  const [row] = await ex.select().from(quickRaces).where(eq(quickRaces.id, id));
  return row ?? null;
}

/** A stable's quick races, newest first. */
export async function listQuickRaces(ex: Executor, stableId: string, limit = 20, mode?: QuickRaceMode): Promise<QuickRaceRow[]> {
  return ex
    .select()
    .from(quickRaces)
    .where(mode ? and(eq(quickRaces.stableId, stableId), eq(quickRaces.mode, mode)) : eq(quickRaces.stableId, stableId))
    .orderBy(desc(quickRaces.createdAt))
    .limit(limit);
}

/** The stable's daily challenge attempt on a day (YYYY-MM-DD), or null. */
export async function dailyAttemptOf(ex: Executor, stableId: string, day: string): Promise<QuickRaceRow | null> {
  const [row] = await ex.select().from(quickRaces).where(and(eq(quickRaces.stableId, stableId), eq(quickRaces.challengeDay, day)));
  return row ?? null;
}

export interface DailyBoardRow {
  id: string;
  stableId: string;
  stableName: string;
  silks: unknown;
  photoHash: string | null;
  position: number;
  finishTimeUs: number;
  points: number;
  summary: unknown;
  createdAt: Date;
}

/** A day's attempts with their stables, best first (position, then time, then who went first). */
export async function dailyBoard(ex: Executor, day: string, limit = 5000): Promise<DailyBoardRow[]> {
  return ex
    .select({
      id: quickRaces.id,
      stableId: quickRaces.stableId,
      stableName: stables.name,
      silks: stables.silks,
      photoHash: stables.photoHash,
      position: quickRaces.position,
      finishTimeUs: quickRaces.finishTimeUs,
      points: quickRaces.points,
      summary: quickRaces.summary,
      createdAt: quickRaces.createdAt,
    })
    .from(quickRaces)
    .innerJoin(stables, eq(stables.id, quickRaces.stableId))
    .where(and(eq(quickRaces.mode, "daily"), eq(quickRaces.challengeDay, day)))
    .orderBy(asc(quickRaces.position), asc(quickRaces.finishTimeUs), asc(quickRaces.createdAt))
    .limit(limit);
}

/** A stable's daily challenge history (newest first): day, position, points. */
export async function dailyHistory(ex: Executor, stableId: string, limit = 400) {
  return ex
    .select({ id: quickRaces.id, day: quickRaces.challengeDay, position: quickRaces.position, points: quickRaces.points, summary: quickRaces.summary })
    .from(quickRaces)
    .where(and(eq(quickRaces.stableId, stableId), eq(quickRaces.mode, "daily")))
    .orderBy(desc(quickRaces.challengeDay))
    .limit(limit);
}

export interface MatchRecordLine {
  opponentId: string;
  opponentName: string;
  opponentStableId: string | null;
  /** Meetings this horse finished ahead of / behind the opponent. */
  won: number;
  lost: number;
  meetings: number;
  lastAt: Date;
}

/** A horse's match race head-to-heads, per opponent (most recent meeting first). Separate from official H2H. */
export async function matchRecordOf(ex: Executor, horseId: string, limit = 400): Promise<MatchRecordLine[]> {
  const them = alias(matchRaceRunners, "them");
  const rows = await ex
    .select({
      opponentId: them.horseId,
      opponentName: horses.name,
      opponentStableId: horses.ownerStableId,
      mine: matchRaceRunners.position,
      theirs: them.position,
      at: matchRaceRunners.createdAt,
    })
    .from(matchRaceRunners)
    .innerJoin(them, and(eq(them.quickRaceId, matchRaceRunners.quickRaceId), ne(them.horseId, matchRaceRunners.horseId)))
    .innerJoin(horses, eq(horses.id, them.horseId))
    .where(eq(matchRaceRunners.horseId, horseId))
    .orderBy(desc(matchRaceRunners.createdAt))
    .limit(limit);
  const by = new Map<string, MatchRecordLine>();
  for (const r of rows) {
    const line = by.get(r.opponentId) ?? { opponentId: r.opponentId, opponentName: r.opponentName, opponentStableId: r.opponentStableId, won: 0, lost: 0, meetings: 0, lastAt: r.at };
    line.meetings++;
    if (r.mine < r.theirs) line.won++;
    else if (r.theirs < r.mine) line.lost++;
    by.set(r.opponentId, line);
  }
  return [...by.values()];
}

/** Match races a horse has run (any side), for the horse page's tally. */
export async function matchRunsOf(ex: Executor, horseIds: readonly string[]): Promise<Map<string, number>> {
  if (horseIds.length === 0) return new Map();
  const rows = await ex
    .select({ horseId: matchRaceRunners.horseId, n: sql<number>`count(*)::int` })
    .from(matchRaceRunners)
    .where(inArray(matchRaceRunners.horseId, [...horseIds]))
    .groupBy(matchRaceRunners.horseId);
  return new Map(rows.map((r) => [r.horseId, Number(r.n)]));
}

const CHALLENGE_SECRET_KEY = (day: number) => `daily-challenge-secret:${day}`;

/**
 * The daily challenge seed of a UTC day number: drawn (crypto) the first time the day is asked for
 * and kept, so every attempt that day meets the same luck. Its commitment is published with the
 * puzzle; the seed itself is only shown once the day is over.
 */
export async function dailyChallengeSeed(ex: Executor, day: number): Promise<string> {
  await ex
    .insert(economyConfig)
    .values({ key: CHALLENGE_SECRET_KEY(day), value: { seed: newSeed() }, description: "Daily challenge seed (revealed after the day closes)" })
    .onConflictDoNothing();
  const [row] = await ex.select().from(economyConfig).where(eq(economyConfig.key, CHALLENGE_SECRET_KEY(day)));
  const seed = (row?.value as { seed?: unknown } | undefined)?.seed;
  if (typeof seed !== "string") throw new DomainError("NOT_FOUND", "daily challenge seed missing");
  return seed;
}

// ---------------------------------------------------------------------------
// Match race opponents
// ---------------------------------------------------------------------------

export interface KeptHorse {
  horse: HorseRow;
  /** The stable it stands in (the lessee while on lease, else the owner). */
  stableId: string;
  stableName: string;
  silks: unknown;
}

/** SQL: the stable a horse stands in. */
const keeper = sql<string>`coalesce(${horses.lesseeStableId}, ${horses.ownerStableId})`;

/** Racing horses with the stable they stand in (missing ids and stable-less horses are left out). */
export async function keptHorses(ex: Executor, ids: readonly string[]): Promise<KeptHorse[]> {
  if (ids.length === 0) return [];
  const rows = await ex
    .select({ horse: horses, stableId: stables.id, stableName: stables.name, silks: stables.silks })
    .from(horses)
    .innerJoin(stables, eq(stables.id, keeper))
    .where(inArray(horses.id, [...ids]));
  return rows;
}

/**
 * Other stables' racing horses whose name contains `q` (case-insensitive), for the match race
 * search: the stable's own horses are left out, and so are horses no stable keeps (the Club's).
 */
export async function searchMatchOpponents(ex: Executor, input: { q: string; excludeStableId: string; limit?: number }): Promise<KeptHorse[]> {
  const q = input.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  if (q.length < 2) return [];
  return ex
    .select({ horse: horses, stableId: stables.id, stableName: stables.name, silks: stables.silks })
    .from(horses)
    .innerJoin(stables, eq(stables.id, keeper))
    .where(
      and(
        eq(horses.careerStatus, "racing"),
        isNotNull(horses.ownerStableId),
        ne(keeper, input.excludeStableId),
        or(ilike(horses.name, `%${q}%`), ilike(stables.name, `%${q}%`)),
      ),
    )
    .orderBy(asc(horses.name))
    .limit(input.limit ?? 12);
}

// ---------------------------------------------------------------------------
// Daily challenge standings over time
// ---------------------------------------------------------------------------

export interface DailyStandingLine {
  day: string;
  rank: number;
  entrants: number;
  position: number;
  points: number;
}

/** A stable's rank on each day it tried the daily challenge (newest first), ranked as dailyBoard orders. */
export async function dailyStandingsOf(ex: Executor, stableId: string, limit = 400): Promise<DailyStandingLine[]> {
  const res = await ex.execute(sql`
    select day, rank, entrants, position, points from (
      select challenge_day::text as day, stable_id, position, points,
        row_number() over (partition by challenge_day order by position asc, finish_time_us asc, created_at asc, stable_id asc)::int as rank,
        count(*) over (partition by challenge_day)::int as entrants
      from quick_races
      where mode = 'daily' and challenge_day in (select challenge_day from quick_races where stable_id = ${stableId} and mode = 'daily')
    ) t
    where stable_id = ${stableId}
    order by day desc
    limit ${limit}`);
  const rows = rowsOf<{ day: string; rank: number; entrants: number; position: number; points: number }>(res);
  return rows.map((r) => ({ day: String(r.day), rank: Number(r.rank), entrants: Number(r.entrants), position: Number(r.position), points: Number(r.points) }));
}

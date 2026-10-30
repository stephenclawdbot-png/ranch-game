/**
 * Competitions & status: seasons (competition calendar only), Daily Cup, weekly leagues,
 * achievements, Hall of Fame, economy config.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { utcDay } from "../crypto";
import { DomainError } from "../errors";
import { achievements, dailyCupEntries, economyConfig, hallOfFame, leagueMembers, leagues, seasons } from "../schema";
import { RULES, seasonBounds, seasonNumberAt } from "../rules";
import type { Db, Executor } from "../types";
import { recordPlayDay } from "./accounts";
import { lockKeptHorse } from "./horses";
import { assertLeaseInForceTx } from "./leasing";
import { horseSnapshot } from "./races";
import { audit, runTx } from "./tx";

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

/** The competition season containing `now` (created on demand). */
export async function ensureSeason(ex: Executor, now: Date) {
  const number = seasonNumberAt(now);
  const { startsAt, endsAt } = seasonBounds(number);
  await ex.insert(seasons).values({ number, startsAt, endsAt, status: "active" }).onConflictDoNothing();
  const [s] = await ex.select().from(seasons).where(eq(seasons.number, number));
  return s!;
}

// ---------------------------------------------------------------------------
// Daily Cup: one run per player per UTC day (unique index), any one eligible horse.
// ---------------------------------------------------------------------------

export interface CupRun {
  finishPosition: number;
  finishTimeUs: number;
  points: number;
  result?: unknown;
}

export interface DailyCupInput {
  accountId: string;
  horseId: string;
  now: Date;
  raceId?: string | null;
  /**
   * Simulates the run against the day's fixed field (server-side, deterministic). Called
   * inside the transaction with the horse's immutable snapshot.
   */
  run(snapshot: Record<string, unknown>): CupRun | Promise<CupRun>;
}

export async function enterDailyCup(db: Db, input: DailyCupInput) {
  return runTx(db, async (tx) => {
    const day = utcDay(input.now);
    const [existing] = await tx
      .select({ id: dailyCupEntries.id })
      .from(dailyCupEntries)
      .where(and(eq(dailyCupEntries.accountId, input.accountId), eq(dailyCupEntries.day, day)));
    if (existing) throw new DomainError("DAILY_CUP_ALREADY_ENTERED", "one Cup Run per day");
    const { horse, leased } = await lockKeptHorse(tx, input.accountId, input.horseId);
    if (leased) await assertLeaseInForceTx(tx, horse.id, input.now);
    if (horse.careerStatus !== "racing") throw new DomainError("HORSE_RETIRED", "retired horses cannot run");
    if (horse.careSessions < RULES.careToRacing) throw new DomainError("HORSE_NOT_OF_AGE", "not yet of racing age");
    if (horse.injuredUntil && horse.injuredUntil > input.now) throw new DomainError("HORSE_INJURED", "recovering from injury");
    const snapshot = horseSnapshot(horse);
    const run = await input.run(snapshot);
    const [row] = await tx
      .insert(dailyCupEntries)
      .values({
        day,
        accountId: input.accountId,
        horseId: horse.id,
        raceId: input.raceId ?? null,
        snapshot,
        finishPosition: run.finishPosition,
        finishTimeUs: run.finishTimeUs,
        points: run.points,
        result: run.result ?? null,
        createdAt: input.now,
      })
      .returning();
    await recordPlayDay(tx, input.accountId, input.now);
    await audit(tx, { actor: input.accountId, action: "daily_cup.enter", entityType: "daily_cup_entry", entityId: row!.id, data: { day, points: run.points } });
    return row!;
  });
}

export async function dailyCupBoard(ex: Executor, day: string, limit = 100) {
  return ex
    .select()
    .from(dailyCupEntries)
    .where(eq(dailyCupEntries.day, day))
    .orderBy(desc(dailyCupEntries.points), asc(dailyCupEntries.finishTimeUs), asc(dailyCupEntries.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Leagues: weekly, up to 30 owners; one league per owner per week (unique index).
// ---------------------------------------------------------------------------

export async function joinWeeklyLeague(db: Db, input: { accountId: string; weekStart: string; tier?: number; now: Date }) {
  return runTx(db, async (tx) => {
    const [mine] = await tx
      .select()
      .from(leagueMembers)
      .where(and(eq(leagueMembers.accountId, input.accountId), eq(leagueMembers.weekStart, input.weekStart)));
    if (mine) return mine;
    const tier = input.tier ?? 1;
    // Lock candidate leagues of this week/tier so capacity cannot be exceeded.
    const candidates = await tx
      .select()
      .from(leagues)
      .where(and(eq(leagues.weekStart, input.weekStart), eq(leagues.tier, tier)))
      .orderBy(asc(leagues.createdAt))
      .for("update");
    let target: (typeof candidates)[number] | undefined;
    for (const l of candidates) {
      const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(leagueMembers).where(eq(leagueMembers.leagueId, l.id));
      if (Number(c!.n) < l.capacity) {
        target = l;
        break;
      }
    }
    if (!target) {
      [target] = await tx
        .insert(leagues)
        .values({ seasonNumber: seasonNumberAt(input.now), weekStart: input.weekStart, tier, name: `Tier ${tier} · ${input.weekStart} · #${candidates.length + 1}` })
        .returning();
    }
    const [m] = await tx.insert(leagueMembers).values({ leagueId: target!.id, accountId: input.accountId, weekStart: input.weekStart }).returning();
    return m!;
  });
}

export async function addLeaguePoints(ex: Executor, input: { accountId: string; weekStart: string; points: number }): Promise<void> {
  await ex
    .update(leagueMembers)
    .set({ points: sql`${leagueMembers.points} + ${input.points}` })
    .where(and(eq(leagueMembers.accountId, input.accountId), eq(leagueMembers.weekStart, input.weekStart)));
}

// ---------------------------------------------------------------------------
// Achievements & Hall of Fame (idempotent inserts)
// ---------------------------------------------------------------------------

export async function awardAchievement(ex: Executor, input: { accountId: string; code: string; horseId?: string; data?: unknown }): Promise<boolean> {
  const rows = await ex
    .insert(achievements)
    .values({ accountId: input.accountId, code: input.code, horseId: input.horseId ?? null, data: input.data ?? null })
    .onConflictDoNothing()
    .returning({ id: achievements.id });
  return rows.length > 0;
}

export async function induct(
  ex: Executor,
  input: { entryKey: string; category: string; title: string; horseId?: string; accountId?: string; seasonNumber?: number; data?: unknown },
): Promise<boolean> {
  const rows = await ex
    .insert(hallOfFame)
    .values({
      entryKey: input.entryKey,
      category: input.category,
      title: input.title,
      horseId: input.horseId ?? null,
      accountId: input.accountId ?? null,
      seasonNumber: input.seasonNumber ?? null,
      data: input.data ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: hallOfFame.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Economy config (tunable numbers; code defaults in RULES)
// ---------------------------------------------------------------------------

export async function getConfig<T>(ex: Executor, key: string, fallback: T): Promise<T> {
  const [row] = await ex.select().from(economyConfig).where(eq(economyConfig.key, key));
  return row ? (row.value as T) : fallback;
}

export async function setConfig(ex: Executor, key: string, value: unknown, description?: string): Promise<void> {
  await ex
    .insert(economyConfig)
    .values({ key, value, description: description ?? null })
    .onConflictDoUpdate({ target: economyConfig.key, set: { value, updatedAt: new Date(), ...(description ? { description } : {}) } });
}

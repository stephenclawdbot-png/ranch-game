/**
 * Daily Cup (§6): one seeded fixed field per UTC day, one Cup Run per player per day with any
 * racing horse. Free (no stable entries), not a career start, unrated, and the horse is left
 * untouched. Ranked by finish time against the same field (a time trial).
 *
 * - The day's secret is created once, at random, on first use (`economy_config`
 *   `daily-cup-secret:<day>`): game-core `dailyCupDay(secret, day)` derives the seed, field and
 *   conditions from it. Its commitment is public all day; the seed is revealed after close.
 * - `runCupEntry` is one transaction: the unique (account, day) index, the horse checks, the
 *   run (simulated by the caller against the locked row), the entry row and the participation
 *   credits (ledger, idempotent per account and day).
 */
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { newSeed, utcDay } from "../crypto";
import { DomainError } from "../errors";
import { dailyCupEntries, economyConfig, horses, stables, type HorseRow } from "../schema";
import { RULES } from "../rules";
import { gc } from "../gameCore";
import type { Db, Executor } from "../types";
import { recordPlayDay } from "./accounts";
import { completeGoal } from "./dailyGoals";
import { lockKeptHorse } from "./horses";
import { grantCreditsTx } from "./ledger";
import { horseSnapshot } from "./races";
import { audit, runTx } from "./tx";

const SECRET_KEY = (day: number) => `daily-cup-secret:${day}`;

/** The day's Cup secret (created on first use; identical for every caller). */
export async function cupDaySecret(ex: Executor, day: number): Promise<string> {
  await ex
    .insert(economyConfig)
    .values({ key: SECRET_KEY(day), value: { secret: newSeed() }, description: "Daily Cup seed secret (revealed after the day closes)" })
    .onConflictDoNothing();
  const [row] = await ex.select().from(economyConfig).where(eq(economyConfig.key, SECRET_KEY(day)));
  const secret = (row?.value as { secret?: unknown } | undefined)?.secret;
  if (typeof secret !== "string") throw new DomainError("NOT_FOUND", "daily cup secret missing");
  return secret;
}

export interface CupRunOutcome {
  finishPosition: number;
  finishTimeUs: number;
  /** Stored as the entry's `result` (e.g. the entrant's engine snapshot and tactic, to replay it). */
  result: unknown;
}

export interface CupEntryInput {
  accountId: string;
  horseId: string;
  now: Date;
  /** Participation credits (game-core CUP_PARTICIPATION_CREDITS); 0 for none. */
  credits: number;
  /** Simulates the run against today's fixed field, with the locked horse row. */
  run(horse: HorseRow): CupRunOutcome | Promise<CupRunOutcome>;
}

export async function runCupEntry(db: Db, input: CupEntryInput) {
  return runTx(db, async (tx) => {
    const day = utcDay(input.now);
    const [existing] = await tx
      .select({ id: dailyCupEntries.id })
      .from(dailyCupEntries)
      .where(and(eq(dailyCupEntries.accountId, input.accountId), eq(dailyCupEntries.day, day)));
    if (existing) throw new DomainError("DAILY_CUP_ALREADY_ENTERED", "you've already had today's Cup Run");
    const { horse } = await lockKeptHorse(tx, input.accountId, input.horseId);
    if (horse.careerStatus !== "racing") throw new DomainError("HORSE_RETIRED", "retired horses don't run in the Cup");
    if (horse.careSessions < RULES.careToRacing) throw new DomainError("HORSE_NOT_OF_AGE", "not yet of racing age");
    if (horse.injuredUntil && horse.injuredUntil > input.now) throw new DomainError("HORSE_INJURED", "recovering from injury");
    const run = await input.run(horse);
    const [row] = await tx
      .insert(dailyCupEntries)
      .values({
        day,
        accountId: input.accountId,
        horseId: horse.id,
        snapshot: horseSnapshot(horse),
        finishPosition: run.finishPosition,
        finishTimeUs: run.finishTimeUs,
        points: 0,
        result: run.result ?? null,
        createdAt: input.now,
      })
      .returning();
    if (input.credits > 0) {
      await grantCreditsTx(tx, { accountId: input.accountId, amount: input.credits, idempotencyKey: `daily-cup:${day}:${input.accountId}`, kind: "daily_cup", memo: "Daily Cup participation" });
    }
    // Today's "run the Daily Cup" goal (a no-op once it has already paid today).
    await completeGoal(tx, { accountId: input.accountId, goal: "cup", now: input.now });
    await recordPlayDay(tx, input.accountId, input.now);
    await audit(tx, { actor: input.accountId, action: "daily_cup.run", entityType: "daily_cup_entry", entityId: row!.id, data: { day, horseId: horse.id, position: run.finishPosition } });
    return row!;
  });
}

/**
 * Cup points depend on the whole day's field (game-core rankCup percentiles), so they are
 * settled once the UTC day is over: every finished day whose entries still hold 0 points gets
 * its standings computed and written (idempotent; cupPoints are always >= 1). Feeds the Prize
 * Pool's Cup term and season Cup totals.
 */
export async function settleCupDays(db: Db, now: Date, limit = 7): Promise<number> {
  const today = utcDay(now);
  const days = await db
    .selectDistinct({ day: dailyCupEntries.day })
    .from(dailyCupEntries)
    .where(and(lt(dailyCupEntries.day, today), eq(dailyCupEntries.points, 0)))
    .limit(limit);
  let settled = 0;
  for (const { day } of days) {
    settled += await runTx(db, async (tx) => {
      const rows = await tx.select().from(dailyCupEntries).where(eq(dailyCupEntries.day, day)).for("update");
      const standings = gc.rankCup(
        rows.map((r) => ({ ownerId: r.accountId, horseId: r.horseId, finishTimeUs: Number(r.finishTimeUs), position: r.finishPosition ?? 99, enteredAtMs: r.createdAt.getTime() })),
      );
      for (const st of standings) {
        await tx.update(dailyCupEntries).set({ points: st.cupPoints }).where(and(eq(dailyCupEntries.day, day), eq(dailyCupEntries.accountId, st.ownerId)));
      }
      return standings.length;
    });
  }
  return settled;
}

export interface CupBoardRow {
  id: string;
  accountId: string;
  horseId: string;
  horseName: string;
  stableName: string;
  silks: unknown;
  finishPosition: number;
  finishTimeUs: number;
  createdAt: Date;
}

/** Every run of a day (UTC "YYYY-MM-DD"), fastest first. */
export async function cupDayEntries(ex: Executor, day: string, limit = 5000): Promise<CupBoardRow[]> {
  const rows = await ex
    .select({
      id: dailyCupEntries.id,
      accountId: dailyCupEntries.accountId,
      horseId: dailyCupEntries.horseId,
      horseName: horses.name,
      stableName: stables.name,
      silks: stables.silks,
      finishPosition: dailyCupEntries.finishPosition,
      finishTimeUs: dailyCupEntries.finishTimeUs,
      createdAt: dailyCupEntries.createdAt,
    })
    .from(dailyCupEntries)
    .innerJoin(horses, eq(horses.id, dailyCupEntries.horseId))
    .innerJoin(stables, eq(stables.accountId, dailyCupEntries.accountId))
    .where(eq(dailyCupEntries.day, day))
    .orderBy(asc(dailyCupEntries.finishTimeUs), asc(dailyCupEntries.finishPosition), asc(dailyCupEntries.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, finishPosition: r.finishPosition ?? 99, finishTimeUs: Number(r.finishTimeUs ?? 0) }));
}

export async function cupEntryById(ex: Executor, id: string) {
  const [row] = await ex.select().from(dailyCupEntries).where(eq(dailyCupEntries.id, id));
  return row ?? null;
}

/** The account's runs, newest first. */
export async function cupRunsOf(ex: Executor, accountId: string, limit = 30) {
  return ex.select().from(dailyCupEntries).where(eq(dailyCupEntries.accountId, accountId)).orderBy(desc(dailyCupEntries.day)).limit(limit);
}

/** Number of runs on a day (for "n stables ran today"). */
export async function cupDayCount(ex: Executor, day: string): Promise<number> {
  const [r] = await ex.select({ n: sql<number>`count(*)::int` }).from(dailyCupEntries).where(eq(dailyCupEntries.day, day));
  return Number(r?.n ?? 0);
}

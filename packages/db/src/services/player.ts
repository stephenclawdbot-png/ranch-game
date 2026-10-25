/**
 * Player-facing reads and small writes the web app needs: the inbox, race history (per
 * horse and per stable), Story-mode rewards (§4e) and the stable profile.
 */
import { and, asc, desc, eq, gte, isNotNull, isNull, like, lte, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import { inboxItems, raceEntries, races, stables, type StableRow } from "../schema";
import { gc } from "../gameCore";
import type { Db, Executor } from "../types";
import { lockStableOf } from "./accounts";
import { playerLedgerAccountId, post, systemAccountId } from "./ledger";
import { audit, rowsOf, runTx } from "./tx";
import { publicRace, type PublicRace } from "./races";

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export async function listInbox(ex: Executor, accountId: string, limit = 20) {
  return ex.select().from(inboxItems).where(eq(inboxItems.accountId, accountId)).orderBy(desc(inboxItems.createdAt)).limit(limit);
}

/** Marks the account's inbox items for a race as read (idempotent). Returns how many changed. */
export async function markInboxRead(ex: Executor, input: { accountId: string; raceId: string; now: Date }): Promise<number> {
  const rows = await ex
    .update(inboxItems)
    .set({ readAt: input.now })
    .where(and(eq(inboxItems.accountId, input.accountId), eq(inboxItems.raceId, input.raceId), isNull(inboxItems.readAt)))
    .returning({ id: inboxItems.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Race history
// ---------------------------------------------------------------------------

const runColumns = {
  raceId: races.id,
  raceName: races.name,
  kind: races.kind,
  raceClass: races.raceClass,
  conditions: races.conditions,
  postTime: races.postTime,
  horseId: raceEntries.horseId,
  stableId: raceEntries.stableId,
  tactic: raceEntries.tactic,
  position: raceEntries.finishPosition,
  prize: raceEntries.prize,
  ratingBefore: raceEntries.ratingBefore,
  ratingAfter: raceEntries.ratingAfter,
  fieldSize: sql<number>`(select count(*)::int from race_entries x where x.race_id = "races"."id" and x.status = 'entered')`,
};

/** Settled runs of one horse, newest first. */
export async function listHorseRuns(ex: Executor, horseId: string, limit = 20) {
  return ex
    .select(runColumns)
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.horseId, horseId), eq(races.status, "settled"), isNotNull(raceEntries.finishPosition)))
    .orderBy(desc(races.postTime))
    .limit(limit);
}

/** Settled runs of a stable's horses, newest first. */
export async function listStableRuns(ex: Executor, stableId: string, limit = 20) {
  return ex
    .select(runColumns)
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.stableId, stableId), eq(races.status, "settled"), isNotNull(raceEntries.finishPosition)))
    .orderBy(desc(races.postTime))
    .limit(limit);
}

/** A stable's entries in one race (any status), for the race page "your runner" view. */
export async function stableEntriesInRace(ex: Executor, stableId: string, raceId: string) {
  return ex
    .select()
    .from(raceEntries)
    .where(and(eq(raceEntries.stableId, stableId), eq(raceEntries.raceId, raceId), eq(raceEntries.status, "entered")));
}

// ---------------------------------------------------------------------------
// Story rewards (§4e): full reward on the first win of a story race, minimal on replays,
// capped per chapter (game-core storyReward). One grant per race (idempotent).
// ---------------------------------------------------------------------------

export interface StoryRewardInput {
  accountId: string;
  raceId: string;
  /** Identifies "the same story race" for the first-win rule (e.g. "club:maiden:1200"). */
  storyKey: string;
  chapter: gc.StoryChapter;
  won: boolean;
}

export interface StoryRewardResult {
  amount: number;
  firstWin: boolean;
  /** True when this race's reward had already been decided (a repeat call). */
  duplicate: boolean;
}

/**
 * Grants the Story reward for a settled story race. Serialised per account (stable row
 * lock), so concurrent settlements can never exceed the chapter cap.
 */
export async function grantStoryReward(db: Db, input: StoryRewardInput): Promise<StoryRewardResult> {
  return runTx(db, async (tx) => {
    await lockStableOf(tx, input.accountId);
    const key = `story:${input.raceId}`;
    const prior = rowsOf<{ amount: number; first: boolean }>(
      await tx.execute(sql`select coalesce((meta->>'amount')::int, 0) as amount, coalesce((meta->>'firstWin')::boolean, false) as first
                             from ledger_transactions where idempotency_key = ${key}`),
    );
    if (prior[0]) return { amount: Number(prior[0].amount), firstWin: !!prior[0].first, duplicate: true };
    const stats = rowsOf<{ earned: number; won: boolean }>(
      await tx.execute(sql`select coalesce(sum((meta->>'amount')::int), 0)::int as earned,
                                  coalesce(bool_or((meta->>'won')::boolean and meta->>'storyKey' = ${input.storyKey}), false) as won
                             from ledger_transactions
                            where kind = 'story_reward' and meta->>'accountId' = ${input.accountId} and meta->>'chapter' = ${input.chapter}`),
    )[0] ?? { earned: 0, won: false };
    const amount = gc.storyReward({ chapter: input.chapter, won: input.won, alreadyWon: !!stats.won, chapterEarned: Number(stats.earned) });
    const firstWin = input.won && !stats.won;
    const meta = { accountId: input.accountId, raceId: input.raceId, storyKey: input.storyKey, chapter: input.chapter, won: input.won, firstWin, amount };
    if (amount > 0) {
      const player = await playerLedgerAccountId(tx, input.accountId);
      const mint = await systemAccountId(tx, "mint");
      await post(tx, {
        idempotencyKey: key,
        kind: "story_reward",
        meta,
        postings: [
          { ledgerAccountId: mint, amount: -amount },
          { ledgerAccountId: player, amount },
        ],
      });
    }
    // A zero reward (chapter cap reached) posts nothing; recomputing it later gives 0 again.
    return { amount, firstWin, duplicate: false };
  });
}

/** The Story reward decided for a race (null until settled). */
export async function storyRewardFor(ex: Executor, raceId: string): Promise<{ amount: number; firstWin: boolean } | null> {
  const rows = rowsOf<{ amount: number; first: boolean }>(
    await ex.execute(sql`select coalesce((meta->>'amount')::int, 0) as amount, coalesce((meta->>'firstWin')::boolean, false) as first
                           from ledger_transactions where idempotency_key = ${`story:${raceId}`}`),
  );
  return rows[0] ? { amount: Number(rows[0].amount), firstWin: !!rows[0].first } : null;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function updateStableProfile(db: Db, input: { accountId: string; name?: string; silks?: unknown }): Promise<void> {
  const name = input.name?.trim();
  if (name !== undefined && (name.length < 1 || name.length > 40)) throw new DomainError("INVALID_INPUT", "stable name must be 1-40 characters");
  await runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    await tx
      .update(stables)
      .set({ ...(name !== undefined ? { name } : {}), ...(input.silks !== undefined ? { silks: input.silks } : {}) })
      .where(eq(stables.id, stable.id));
    await audit(tx, { actor: input.accountId, action: "stable.profile", entityType: "stable", entityId: stable.id, data: { name: name ?? null } });
  });
}

export async function getStable(ex: Executor, stableId: string): Promise<StableRow | null> {
  const [s] = await ex.select().from(stables).where(eq(stables.id, stableId));
  return s ?? null;
}

export interface CardRace extends PublicRace {
  /** Active entries so far (the full field once locked). */
  entered: number;
  /** Active entries of `stableId` (0 without one). */
  mine: number;
}

/** Live-card races (slot races) with post time in [from, to], oldest first, with entry counts. */
export async function listCardRaces(ex: Executor, input: { from: Date; to: Date; stableId?: string | null }): Promise<CardRace[]> {
  const stableId = input.stableId ?? null;
  const rows = await ex
    .select({
      race: races,
      entered: sql<number>`(select count(*)::int from race_entries e where e.race_id = "races"."id" and e.status = 'entered')`,
      mine: stableId
        ? sql<number>`(select count(*)::int from race_entries e where e.race_id = "races"."id" and e.status = 'entered' and e.stable_id = ${stableId})`
        : sql<number>`0`,
    })
    .from(races)
    .where(and(like(races.slotKey, "live:%"), gte(races.postTime, input.from), lte(races.postTime, input.to)))
    .orderBy(asc(races.postTime));
  return rows.map((r) => ({ ...publicRace(r.race), entered: Number(r.entered), mine: Number(r.mine) }));
}

/**
 * Player-facing reads and small writes the web app needs: the inbox, race history (per
 * horse and per stable), Story-mode rewards (§4e) and the stable profile.
 */
import { and, asc, desc, eq, gte, isNotNull, isNull, like, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import { horses, inboxItems, raceEntries, raceResults, races, stables, type StableRow } from "../schema";
import { gc } from "../gameCore";
import type { Db, Executor } from "../types";
import { lockStableOf } from "./accounts";
import { playerLedgerAccountId, post, systemAccountId } from "./ledger";
import { audit, rowsOf, runTx } from "./tx";
import { publicRace, type PublicRace } from "./races";
import { LIVE_SLOT_KEY_LIKE } from "./card";
import { formColumns, resultJoin } from "./formBook";
import { MOMENT_KIND } from "./moments";
import { MATCH_NOTE_KIND } from "./quickRaces";

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export async function listInbox(ex: Executor, accountId: string, limit = 20) {
  // moments and match race notes have their own lists (listMoments, listMatchNotes) and must not crowd race results out of this one
  return ex
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, accountId), notInArray(inboxItems.kind, [MOMENT_KIND, MATCH_NOTE_KIND])))
    .orderBy(desc(inboxItems.createdAt))
    .limit(limit);
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

/** Last `limit` finishing positions before `before` (newest first): the racecard's form figures. */
export async function horseFormFigures(ex: Executor, horseId: string, before: Date, limit = 3): Promise<number[]> {
  const rows = await ex
    .select({ position: raceEntries.finishPosition })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.horseId, horseId), eq(races.status, "settled"), isNotNull(raceEntries.finishPosition), lt(races.postTime, before)))
    .orderBy(desc(races.postTime))
    .limit(limit);
  return rows.map((r) => r.position!);
}

/** A stable's first-to-third finishes (the Trophy Room), newest first. */
export async function listStablePlacings(ex: Executor, stableId: string, limit = 500) {
  return ex
    .select(runColumns)
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.stableId, stableId), eq(races.status, "settled"), isNotNull(raceEntries.finishPosition), lte(raceEntries.finishPosition, 3)))
    .orderBy(desc(races.postTime))
    .limit(limit);
}

/** A stable's most successful horses (any career status), most wins first. */
export async function topHorsesOf(ex: Executor, stableId: string, limit = 3) {
  return ex.select().from(horses).where(eq(horses.ownerStableId, stableId)).orderBy(desc(horses.wins), desc(horses.earnings)).limit(limit);
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

/** Filters for a stable's full race history (/me/races). */
export interface StableRunQuery {
  stableId: string;
  /** One horse only (null: every horse in the stable). */
  horseId?: string | null;
  /** all (default) | live (every shared-card kind) | story (kind 'quick'). */
  kind?: "all" | "live" | "story";
  /** Winners only (position 1). */
  winsOnly?: boolean;
}

function runWhere(q: StableRunQuery) {
  const where = [eq(raceEntries.stableId, q.stableId), eq(races.status, "settled"), isNotNull(raceEntries.finishPosition)];
  if (q.horseId) where.push(eq(raceEntries.horseId, q.horseId));
  if (q.kind === "story") where.push(eq(races.kind, "quick"));
  else if (q.kind === "live") where.push(ne(races.kind, "quick"));
  if (q.winsOnly) where.push(eq(raceEntries.finishPosition, 1));
  return where;
}

/** The full form line of each run (formBook.ts) plus the horse's name. */
const historyColumns = { ...formColumns, horseName: horses.name };

/**
 * One page of a stable's settled runs, newest first (ties broken by race then horse id,
 * so the cursor is a strict total order). The cursor is the `postTimeMs:raceId:horseId`
 * of the last row served; `nextCursor` resumes right after it (null on the last page).
 */
export async function pageStableRuns(ex: Executor, q: StableRunQuery, cursor: string | null, limit = 30) {
  const where = runWhere(q);
  const parts = cursor?.split(":");
  if (parts && parts.length === 3 && /^\d+$/.test(parts[0]!) && parts.every((p) => p.length > 0)) {
    const at = new Date(Number(parts[0]));
    where.push(or(lt(races.postTime, at), and(eq(races.postTime, at), lt(raceEntries.raceId, parts[1]!)), and(eq(races.postTime, at), eq(raceEntries.raceId, parts[1]!), lt(raceEntries.horseId, parts[2]!)))!);
  }
  const rows = await ex
    .select(historyColumns)
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .innerJoin(horses, eq(horses.id, raceEntries.horseId))
    .leftJoin(raceResults, resultJoin)
    .where(and(...where))
    .orderBy(desc(races.postTime), desc(raceEntries.raceId), desc(raceEntries.horseId))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > limit && last ? `${last.postTime.getTime()}:${last.raceId}:${last.horseId}` : null };
}

export interface StableRunSummary {
  runs: number;
  wins: number;
  /** Placed without winning: 2nd or 3rd. */
  places: number;
  credits: number;
}

/** Totals for the same filter the history page lists. */
export async function stableRunSummary(ex: Executor, q: StableRunQuery): Promise<StableRunSummary> {
  const [row] = await ex
    .select({
      runs: sql<number>`count(*)::int`,
      wins: sql<number>`(count(*) filter (where ${raceEntries.finishPosition} = 1))::int`,
      places: sql<number>`(count(*) filter (where ${raceEntries.finishPosition} between 2 and 3))::int`,
      credits: sql<number>`coalesce(sum(${raceEntries.prize}), 0)::int`,
    })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(...runWhere(q)));
  return { runs: Number(row?.runs ?? 0), wins: Number(row?.wins ?? 0), places: Number(row?.places ?? 0), credits: Number(row?.credits ?? 0) };
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
  /** Player stables with an active entry (Club runners don't count): "N stables entered". */
  stables: number;
}

/** Live-card races (slot races) with post time in [from, to], oldest first, with entry counts. */
export async function listCardRaces(ex: Executor, input: { from: Date; to: Date; stableId?: string | null }): Promise<CardRace[]> {
  const stableId = input.stableId ?? null;
  const rows = await ex
    .select({
      race: races,
      entered: sql<number>`(select count(*)::int from race_entries e where e.race_id = "races"."id" and e.status = 'entered')`,
      stables: sql<number>`(select count(distinct e.stable_id)::int from race_entries e where e.race_id = "races"."id" and e.status = 'entered' and e.stable_id is not null)`,
      mine: stableId
        ? sql<number>`(select count(*)::int from race_entries e where e.race_id = "races"."id" and e.status = 'entered' and e.stable_id = ${stableId})`
        : sql<number>`0`,
    })
    .from(races)
    .where(and(like(races.slotKey, LIVE_SLOT_KEY_LIKE), gte(races.postTime, input.from), lte(races.postTime, input.to)))
    .orderBy(asc(races.postTime), asc(races.slotKey)); // slotKey: sisters right after their original
  return rows.map((r) => ({ ...publicRace(r.race), entered: Number(r.entered), mine: Number(r.mine), stables: Number(r.stables) }));
}

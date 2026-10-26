/**
 * Story mode progress (§4e): which chapter races a stable has won and its licence level.
 *
 * - A first win of a chapter race is an achievement row `story-win:<raceKey>` (unique per
 *   account), so recording is idempotent and needs no extra table.
 * - The licence lives in `stables.licence_level` (1 = Club licence for every new stable) and
 *   only ever goes up: game-core `licenceAfter` decides it from the wins, under the stable lock.
 * - Completing a chapter also records `story-chapter:<id>` (the title / cosmetic unlock).
 *
 * Credits for story races are granted separately by `grantStoryReward` (capped per chapter).
 */
import { and, eq, like, sql } from "drizzle-orm";
import { achievements, stables } from "../schema";
import { gc } from "../gameCore";
import type { Db, Executor } from "../types";
import { lockStableOf } from "./accounts";
import { audit, rowsOf, runTx } from "./tx";

export const STORY_WIN_PREFIX = "story-win:";

export interface StoryState {
  licenceLevel: number;
  /** Story race keys won at least once. */
  wonKeys: string[];
}

export async function storyState(ex: Executor, accountId: string): Promise<StoryState> {
  const [stable] = await ex.select({ licenceLevel: stables.licenceLevel }).from(stables).where(eq(stables.accountId, accountId));
  const rows = await ex
    .select({ code: achievements.code })
    .from(achievements)
    .where(and(eq(achievements.accountId, accountId), like(achievements.code, `${STORY_WIN_PREFIX}%`)));
  return { licenceLevel: Math.max(1, stable?.licenceLevel ?? 1), wonKeys: rows.map((r) => r.code.slice(STORY_WIN_PREFIX.length)) };
}

export interface StoryResultInput {
  accountId: string;
  raceId: string;
  /** game-core story race key (e.g. "club-3"). */
  raceKey: string;
  won: boolean;
  now: Date;
}

export interface StoryResultOutcome {
  /** First win of this story race. */
  newWin: boolean;
  licenceBefore: number;
  licenceAfter: number;
  /** Chapters completed by this result. */
  chaptersCompleted: string[];
}

/**
 * Records a settled chapter race for the account (idempotent: a race key is won once; the
 * licence never goes down). Serialised per account by the stable row lock.
 */
export async function recordStoryResult(db: Db, input: StoryResultInput): Promise<StoryResultOutcome> {
  const def = gc.storyRaceByKey(input.raceKey);
  return runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    const before = Math.max(1, stable.licenceLevel);
    if (!def || !input.won) return { newWin: false, licenceBefore: before, licenceAfter: before, chaptersCompleted: [] };
    const state = await storyState(tx, input.accountId);
    // A race in a chapter the stable has no licence for doesn't count (can't normally happen).
    const chapter = gc.chapterDef(def.chapter);
    if (before < chapter.licenceRequired) return { newWin: false, licenceBefore: before, licenceAfter: before, chaptersCompleted: [] };
    const inserted = await tx
      .insert(achievements)
      .values({ accountId: input.accountId, code: `${STORY_WIN_PREFIX}${def.key}`, data: { raceId: input.raceId, at: input.now.toISOString() }, earnedAt: input.now })
      .onConflictDoNothing()
      .returning({ id: achievements.id });
    const won = new Set([...state.wonKeys, def.key]);
    const beforeProgress = gc.storyProgress(before, new Set(state.wonKeys));
    const after = Math.max(before, gc.licenceAfter(before, won));
    const afterProgress = gc.storyProgress(after, won);
    const completed = afterProgress.filter((p, i) => p.complete && !beforeProgress[i]!.complete).map((p) => p.chapter.id);
    for (const c of completed) {
      await tx.insert(achievements).values({ accountId: input.accountId, code: `story-chapter:${c}`, data: { raceId: input.raceId }, earnedAt: input.now }).onConflictDoNothing();
    }
    if (after > before) {
      await tx.update(stables).set({ licenceLevel: after }).where(eq(stables.id, stable.id));
      await audit(tx, { actor: input.accountId, action: "story.licence", entityType: "stable", entityId: stable.id, data: { from: before, to: after, raceKey: def.key } });
    }
    return { newWin: inserted.length > 0, licenceBefore: before, licenceAfter: after, chaptersCompleted: completed };
  });
}

export interface StoryFinish {
  raceId: string;
  postTime: Date;
  conditions: unknown;
  horseId: string;
  /** Null for house (rival) runners. */
  stableId: string | null;
  position: number;
}

/** Every finisher of the stable's most recent settled Story races (for rival head-to-heads). */
export async function storyRaceFinishes(ex: Executor, stableId: string, limit = 60): Promise<StoryFinish[]> {
  const rows = rowsOf<{ race_id: string; post_time: string | Date; conditions: unknown; horse_id: string; stable_id: string | null; position: number }>(
    await ex.execute(sql`
      with mine as (
        select r.id, r.post_time, r.conditions from races r join race_entries e on e.race_id = r.id
         where e.stable_id = ${stableId} and r.kind = 'quick' and r.status = 'settled'
         order by r.post_time desc limit ${limit}
      )
      select m.id as race_id, m.post_time, m.conditions, e.horse_id, e.stable_id, e.finish_position as position
        from mine m join race_entries e on e.race_id = m.id
       where e.finish_position is not null and e.status = 'entered'`),
  );
  return rows.map((r) => ({ raceId: r.race_id, postTime: new Date(r.post_time), conditions: r.conditions, horseId: r.horse_id, stableId: r.stable_id, position: Number(r.position) }));
}

/** Story credits earned per chapter (for the "x of cap" meter). */
export async function storyChapterEarnings(ex: Executor, accountId: string): Promise<Record<string, number>> {
  const rows = rowsOf<{ chapter: string; earned: number }>(
    await ex.execute(sql`select meta->>'chapter' as chapter, coalesce(sum((meta->>'amount')::int), 0)::int as earned
                           from ledger_transactions where kind = 'story_reward' and meta->>'accountId' = ${accountId}
                          group by meta->>'chapter'`),
  );
  return Object.fromEntries(rows.map((r) => [r.chapter, Number(r.earned)]));
}

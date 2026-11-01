/**
 * Coming back to the yard, for Home and the race page (GET /api/engage): "Tomorrow at your yard"
 * (game-core tomorrowHooks over packages/db tomorrowFacts), this week's table across every
 * stable (League points, packages/db weekBoardOf) and the Saturday Feature card from Thursday.
 * Everything comes from records and the rules' own calendar; nothing is invented, and the
 * viewer's unwatched races stay out of the table and the Feature's qualifiers.
 */
import * as gc from "@thoroughbred/game-core";
import { saturdayFeatureOf, tomorrowFacts, weekBoardOf, type Db, type WeekBoardView as DbBoard } from "@thoroughbred/db";
import type { EngageView, SaturdayFeatureCardView, TomorrowLineView, WeekBoardRowView, WeekBoardView } from "@/lib/engageTypes";
import type { Session } from "./session";
import { storyView } from "./story";

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`engage ${label}`, err);
    return fallback;
  }
}

/** The Story chapter's next race (the Home tile's rule), or null when every chapter is done. */
async function storyNext(db: Db, session: Session, now: Date): Promise<{ chapter: number; raceName: string } | null> {
  const story = await storyView(db, session, now);
  const ch = story.chapters.find((c) => c.id === story.current) ?? story.chapters.find((c) => c.current) ?? null;
  const race = ch?.races.find((r) => r.key === story.suggested && !r.won) ?? ch?.races.find((r) => !r.won) ?? null;
  return ch && race ? { chapter: ch.number, raceName: race.name } : null;
}

/** "Tomorrow at your yard": what will be new tomorrow, from state only. */
export async function tomorrowLines(db: Db, session: Session, now: Date): Promise<TomorrowLineView[]> {
  const story = await safe("story", () => storyNext(db, session, now), null);
  return gc.tomorrowHooks(await tomorrowFacts(db, { accountId: session.accountId, stableId: session.stable.id, now, story }));
}

function boardView(b: DbBoard, viewer: string | null): WeekBoardView {
  const row = (r: gc.BoardRow): WeekBoardRowView => ({ rank: r.rank, tied: r.tied, stableName: r.stableName, points: r.points, wins: r.wins, runs: r.runs, move: r.move, isNew: r.isNew, mine: r.accountId === viewer });
  return { top: b.top.map(row), mine: b.mine ? row(b.mine) : null, stables: b.stables, endsAtMs: b.endsAtMs, sinceMs: b.sinceMs };
}

/** This week's table (top `limit` and your place). */
export async function weekBoard(db: Db, session: Session | null, now: Date, limit = 10): Promise<WeekBoardView> {
  return boardView(await weekBoardOf(db, { now, accountId: session?.accountId ?? null, limit }), session?.accountId ?? null);
}

/** The Saturday Feature card: from Thursday 00:00 UTC until a few hours after the off, else null. */
export async function featureCard(db: Db, session: Session | null, now: Date): Promise<SaturdayFeatureCardView | null> {
  if (gc.utcWeekday(now.getTime()) < 3) return null; // Monday to Wednesday: no card yet
  const f = await saturdayFeatureOf(db, { now, stableId: session?.stable.id ?? null, accountId: session?.accountId ?? null });
  return f && gc.featureCardShows(now.getTime(), f.postTimeMs) ? f : null;
}

export async function engageView(db: Db, session: Session | null, now: Date): Promise<EngageView> {
  const empty: WeekBoardView = { top: [], mine: null, stables: 0, endsAtMs: now.getTime(), sinceMs: null };
  return {
    serverNowMs: now.getTime(),
    tomorrow: session ? await safe("tomorrow", () => tomorrowLines(db, session, now), []) : [],
    board: await safe("board", () => weekBoard(db, session, now), empty),
    feature: await safe("feature", () => featureCard(db, session, now), null),
  };
}

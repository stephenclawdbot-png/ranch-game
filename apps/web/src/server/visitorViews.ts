/**
 * What a visitor (a request without a stable) sees of the public pages, served from shared
 * copies (visitorCache.ts) so that visitors, link previews and crawlers never reach the
 * database on an ordinary hit. A signed-in player never gets these: their pages are computed
 * per request, as before.
 *
 * No spoilers: every copy is built by the same code as the live view (game.ts), which only ever
 * includes a result once that race's broadcast is over. A copy served later is older than the
 * present, never ahead of it; the clock-dependent parts ("next race", "live now") are re-derived
 * from post times at request time and never invent an outcome.
 */
import type { RaceCard } from "@/lib/types";
import { visitorListsAt, type VisitorRaceLists } from "@/lib/visitorLists";
import { hallView, leagueView } from "./competition";
import { weekBoard } from "./engage";
import { raceCard, raceList, replayStartFor, settleIfDue } from "./game";
import { tipsters, type TipstersView } from "./picks";
import { newsFeed, publicStable } from "./social";
import { VISITOR_KEEP_S, visitorCached } from "./visitorCache";

// ---------------------------------------------------------------------------
// The race card and the results list
// ---------------------------------------------------------------------------

/** The whole published card (a day ahead) and the latest results, built for nobody. */
const raceListsCopy = visitorCached("race-lists-v1", async (database, now) => {
  const lists = await raceList(database, now, null, { upcoming: 120, recent: 12 });
  return { generatedAtMs: now.getTime(), ...lists };
});

/** The race card and results for a visitor (no database on an ordinary hit). */
export async function visitorRaceLists(now: Date): Promise<VisitorRaceLists> {
  return visitorListsAt(await raceListsCopy(), now.getTime());
}

// ---------------------------------------------------------------------------
// A race page
// ---------------------------------------------------------------------------

class NotFinishedYet extends Error {
  constructor(readonly card: RaceCard) {
    super("race not finished");
    this.name = "NotFinishedYet";
  }
}

/**
 * A finished race's card never changes: one copy, kept (a week at a time). Only a race whose broadcast is over
 * (card.status "finished", decided by game.ts on the broadcast clock) is ever stored, and it is
 * settled first, so a visitor's hit never leaves a result unpaid behind a cached page.
 */
const finishedCardCopy = visitorCached(
  "race-card-finished-v1",
  async (database, now, id: string) => {
    const card = await raceCard(database, id, now, null);
    if (card.status !== "finished") throw new NotFinishedYet(card);
    await settleIfDue(database, id, now);
    return card;
  },
  VISITOR_KEEP_S,
);

/** The race card for a visitor: the kept copy once the race is over, else computed now (a race about to run or running is live data). */
export async function visitorRaceCard(id: string): Promise<RaceCard> {
  try {
    return await finishedCardCopy(id);
  } catch (err) {
    if (err instanceof NotFinishedYet) return err.card;
    throw err;
  }
}

/** Where a shared replay link starts (`?at=`), for a finished race: derived from the result, so it never changes either. */
export const visitorReplayStart = visitorCached("race-replay-start-v1", async (database, now, id: string, at: string) => (await replayStartFor(database, id, at, now)) ?? null, VISITOR_KEEP_S);

// ---------------------------------------------------------------------------
// Other public pages
// ---------------------------------------------------------------------------

export const visitorHall = visitorCached("hall-v1", (database, now) => hallView(database, null, now));
export const visitorLeague = visitorCached("league-v1", async (database, now) => ({ view: await leagueView(database, null, now), board: await weekBoard(database, null, now, 100).catch(() => null) }));
/** The first page of the public news ("All"); older pages and "My stable" are computed per request. */
export const visitorNews = visitorCached("news-v1", (database, now) => newsFeed(database, null, "all", now, null));
export const visitorTipsters = visitorCached("tipsters-v1", (database, now): Promise<TipstersView> => tipsters(database, null, now));
export const visitorStable = visitorCached("stable-v1", (database, now, id: string) => publicStable(database, id, null, now));

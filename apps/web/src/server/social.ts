/**
 * Rivals, the racing news and the campaign planner for the web app (experience review items 5
 * and 8). Reads go through packages/db rivals.ts / news.ts / planner.ts, which only ever count
 * races whose broadcast is over; news items are written where they happen, never on page view.
 */
import * as gc from "@thoroughbred/game-core";
import {
  addTarget,
  getRace,
  getStable,
  listNews,
  listStableHorses,
  planView,
  raceRivalLinesFor,
  recordAgainst,
  removeTarget,
  raceResultPublicAt,
  rivalsView,
  targetCandidates,
  type Db,
} from "@thoroughbred/db";
import type { HomeSocialView, HorsePairView, NewsItemView, PlanCandidate, PlanView, PublicStableView, RivalView } from "@/lib/socialTypes";
import { RaceNotFoundError, TooEarlyError } from "./errors";
import { parseSilks } from "./horseView";
import type { Session } from "./session";

/** News items on Home. */
export const HOME_NEWS_ITEMS = 5;
/** Horse pairs shown per rival. */
const PAIRS_SHOWN = 3;

const pairView = (p: gc.HorseH2H): HorsePairView => ({ mineId: p.mineId, mineName: p.mineName, theirId: p.theirId, theirName: p.theirName, meetings: p.meetings, ahead: p.ahead, behind: p.behind, close: p.close, last: p.last });
const newsView = (n: { id: string; kind: string; headline: string; href: string; atMs: number }): NewsItemView => ({ id: n.id, kind: n.kind, headline: n.headline, href: n.href, atMs: n.atMs });

/** Rivals panel + nemesis + the last few news items: three reads, no per-row queries. */
export async function homeSocial(db: Db, session: Session, now: Date): Promise<HomeSocialView> {
  const [v, news] = await Promise.all([rivalsView(db, session.stable.id, now), listNews(db, { now, limit: HOME_NEWS_ITEMS })]);
  const rivals: RivalView[] = v.rivals.map((r) => ({
    stableId: r.stableId,
    stableName: r.stableName,
    silks: r.silks ? parseSilks(r.silks) : null,
    meetings: r.meetings,
    ahead: r.ahead,
    behind: r.behind,
    close: r.close,
    last: r.last,
    pairs: v.pairs.filter((p) => p.theirStableId === r.stableId).slice(0, PAIRS_SHOWN).map(pairView),
  }));
  return { rivals, nemesis: v.nemesis, news: news.map(newsView) };
}

/** The /news feed: everything public, or "My stable" (your horses, jockeys and rivals). */
export async function newsFeed(db: Db, session: Session | null, tab: "all" | "mine", now: Date, beforeMs?: number | null): Promise<NewsItemView[]> {
  if (tab === "mine") {
    if (!session) return [];
    const v = await rivalsView(db, session.stable.id, now, { limit: 10 });
    return (await listNews(db, { now, limit: 50, beforeMs, stableIds: [session.stable.id, ...v.rivals.map((r) => r.stableId)] })).map(newsView);
  }
  return (await listNews(db, { now, limit: 50, beforeMs })).map(newsView);
}

/** A stable's public page: its racing string, its news, and the viewer's record against it. */
export async function publicStable(db: Db, id: string, session: Session | null, now: Date): Promise<PublicStableView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const s = await getStable(db, id);
  if (!s) return null;
  const horses = (await listStableHorses(db, s.id)).filter((h) => h.careerStatus === "racing" && h.starts > 0).sort((a, b) => b.rating - a.rating).slice(0, 12);
  const mine = session?.stable.id === s.id;
  let record: PublicStableView["record"] = null;
  if (session && !mine) {
    const [r, rv] = await Promise.all([recordAgainst(db, session.stable.id, s.id, now), rivalsView(db, session.stable.id, now, { limit: 10 })]);
    if (r.record) record = { meetings: r.record.meetings, ahead: r.record.ahead, behind: r.record.behind, close: r.record.close, last: r.record.last, pairs: r.pairs.slice(0, 6).map(pairView), rival: rv.rivals.some((x) => x.stableId === s.id) };
  }
  const news = await listNews(db, { now, limit: 8, stableIds: [s.id] });
  return {
    id: s.id,
    name: s.name,
    silks: parseSilks(s.silks),
    photoUrl: gc.stablePhotoUrl(s.id, s.photoHash),
    createdAtMs: s.createdAt.getTime(),
    horses: horses.map((h) => ({ id: h.id, name: h.name, rating: h.rating, starts: h.starts, wins: h.wins, places: h.places, shows: h.shows })),
    record,
    mine,
    news: news.map(newsView),
  };
}

/**
 * The viewer's rival lines for a race ("You beat ... for the first time in 4 meetings"). 425
 * until the race is settled and its broadcast is over: the lines are about the result.
 */
export async function raceRivalLines(db: Db, session: Session, raceId: string, now: Date): Promise<string[]> {
  const race = await getRace(db, raceId);
  if (!race) throw new RaceNotFoundError(raceId);
  if (race.status !== "settled") throw new TooEarlyError(race.postTime.getTime(), now >= race.postTime ? "live" : "upcoming");
  const publicAt = await raceResultPublicAt(db, raceId);
  if (!publicAt || publicAt > now) throw new TooEarlyError(race.postTime.getTime(), "live");
  return raceRivalLinesFor(db, session.stable.id, raceId, now);
}

// ---------------------------------------------------------------------------
// Campaign planner
// ---------------------------------------------------------------------------

export async function stablePlan(db: Db, session: Session, now: Date, horseId?: string | null): Promise<PlanView> {
  const v = await planView(db, { stableId: session.stable.id, horseId: horseId ?? null, now });
  return {
    targets: v.targets.map((t) => ({
      id: t.id,
      horseId: t.horseId,
      horseName: t.horseName,
      raceId: t.raceId,
      name: t.name,
      raceClass: t.raceClass,
      postTimeMs: t.postTimeMs,
      calendar: t.calendar,
      entry: t.entry,
      entered: t.entered,
      eligibility: t.eligibility,
      freshness: { phase: t.freshness.phase, text: t.freshness.text, peakFromMs: t.freshness.peakFromMs, peakToMs: t.freshness.peakToMs },
      clashes: t.clashes,
    })),
    removed: v.removed.map((r) => ({ id: r.id, horseId: r.horseId, horseName: r.horseName, name: r.name, postTimeMs: r.postTimeMs, note: r.note })),
    max: gc.MAX_TARGETS_PER_HORSE,
  };
}

export async function planCandidates(db: Db, session: Session, horseId: string, now: Date): Promise<PlanCandidate[]> {
  return targetCandidates(db, { stableId: session.stable.id, horseId, now });
}

export async function pinTarget(db: Db, session: Session, input: { horseId: string; raceId?: string | null; slotIndex?: number | null }, now: Date) {
  const row = await addTarget(db, { accountId: session.accountId, horseId: input.horseId, raceId: input.raceId ?? null, slotIndex: input.slotIndex ?? null, now });
  return { id: row.id };
}

export async function unpinTarget(db: Db, session: Session, targetId: string, now: Date): Promise<void> {
  await removeTarget(db, { accountId: session.accountId, targetId, now });
}

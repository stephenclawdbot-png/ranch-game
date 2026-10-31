/**
 * The racing news (experience review item 5): a public feed of short items written from facts
 * (game-core news.ts says what; this file decides when, and stores each item once).
 *
 *   settleRace          → Feature / Final winners, a first win at Listed level or above, photo
 *                         finishes in big races, record purses, a claimed horse, an apprentice
 *                         riding out the claim
 *   buyListing          → notable sales (public price)
 *   jockey events       → retirement announced, retired
 *   inductHallOfFame    → Hall of Fame entries
 *   runMaintenance      → season champions and League tier champions once a season is over
 *
 * Idempotent by dedupe key (unique). No spoilers: an item about a race carries `publicAt` = the
 * end of its broadcast (resultPublicAt), and the feed only lists items whose time has come.
 * Improver steps are not news: the step shows only on the owner's career page, never publicly.
 */
import { and, desc, eq, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { BROADCAST_DELAY_S } from "@thoroughbred/shared";
import { horses, jockeyRides, jockeys, leagueMembers, leagues, newsItems, raceClaims, raceEntries, races, stables, type NewsItemRow, type RaceEntryRow, type RaceRow } from "../schema";
import { gc } from "../gameCore";
import { seasonBounds, seasonNumberAt } from "../rules";
import { utcWeekStart } from "../crypto";
import type { Db, Executor } from "../types";
import { seasonStandings } from "./leagues";

/** The broadcast's grace after the last finisher (apps/web live.ts FINAL_MARGIN_MS) plus a little slack. */
const RESULT_GRACE_MS = 750 + 2_000;
const LIVE_KINDS = ["scheduled", "feature", "final"] as const;
/** Purses below this are never "record" news (the first few races of a new world). */
const RECORD_PURSE_MIN = 10_000;

/**
 * When a race's result becomes public: the broadcast starts BROADCAST_DELAY_S after the off and
 * runs until the last finisher crosses the line (the result's latest finish time), plus the
 * grace. Never before the settlement itself.
 */
export function resultPublicAt(race: Pick<RaceRow, "postTime">, result: unknown, settledAt?: Date | null): Date {
  const order = (result as { finishOrder?: { finishTimeUs?: number }[] } | null)?.finishOrder ?? [];
  const lastUs = order.reduce((m, f) => Math.max(m, typeof f.finishTimeUs === "number" ? f.finishTimeUs : 0), 0);
  const ms = race.postTime.getTime() + BROADCAST_DELAY_S * 1000 + Math.ceil(lastUs / 1000) + RESULT_GRACE_MS;
  return new Date(Math.max(ms, settledAt?.getTime() ?? 0));
}

export interface NewsInput {
  dedupeKey: string;
  kind: gc.NewsKind;
  facts: gc.NewsFacts;
  href: string;
  publicAt: Date;
  raceId?: string | null;
  horseId?: string | null;
  jockeyId?: string | null;
  stableIds?: (string | null | undefined)[];
}

/** Stores one item (no-op when its dedupe key exists). Returns true when it was new. */
export async function putNews(ex: Executor, n: NewsInput): Promise<boolean> {
  const rows = await ex
    .insert(newsItems)
    .values({
      dedupeKey: n.dedupeKey,
      kind: n.kind,
      headline: gc.newsHeadline(n.kind, n.facts, n.dedupeKey),
      href: n.href,
      publicAt: n.publicAt,
      raceId: n.raceId ?? null,
      horseId: n.horseId ?? null,
      jockeyId: n.jockeyId ?? null,
      stableIds: [...new Set((n.stableIds ?? []).filter((s): s is string => !!s))],
      data: n.facts as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning({ id: newsItems.id });
  return rows.length > 0;
}

const trackOf = (race: Pick<RaceRow, "conditions">) => ((race.conditions ?? {}) as { track?: string }).track;
const nameOf = (e: Pick<RaceEntryRow, "snapshot">) => {
  const n = (e.snapshot as { name?: unknown } | null)?.name;
  return typeof n === "string" ? n : "A runner";
};

async function stableNames(ex: Executor, ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = await ex.select({ id: stables.id, name: stables.name }).from(stables).where(inArray(stables.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * News from a race just settled (called inside settleRace, after the jockeys and claims).
 * `positions` = horse id → finishing position.
 */
export async function raceNewsTx(ex: Executor, race: RaceRow, entries: readonly RaceEntryRow[], positions: ReadonlyMap<string, number>, result: unknown, prizes: Record<string, number>, now: Date): Promise<number> {
  if (!(LIVE_KINDS as readonly string[]).includes(race.kind)) return 0;
  const publicAt = resultPublicAt(race, result, now);
  const ordered = [...entries].sort((a, b) => (positions.get(a.horseId) ?? 99) - (positions.get(b.horseId) ?? 99));
  const winner = ordered[0];
  if (!winner || positions.get(winner.horseId) !== 1) return 0;
  const second = ordered[1];
  const names = await stableNames(ex, entries.map((e) => e.stableId));
  const stableOf = (e: RaceEntryRow) => (e.stableId ? (names.get(e.stableId) ?? "A stable") : "the Club");
  const track = trackOf(race);
  const base = { race: race.name, track, horse: nameOf(winner), stable: stableOf(winner) };
  const href = `/race/${race.id}`;
  let n = 0;
  const put = async (x: Omit<NewsInput, "publicAt" | "raceId">) => {
    if (await putNews(ex, { ...x, publicAt, raceId: race.id })) n++;
  };

  const feature = race.kind === "feature" || race.kind === "final";
  if (feature) await put({ dedupeKey: `feature-win:${race.id}`, kind: "feature_win", facts: base, href, horseId: winner.horseId, stableIds: [winner.stableId] });
  // A first win at Listed level or above (a Feature win already says it).
  if (!feature && winner.stableId && gc.isListedOrAbove(race.raceClass)) {
    const [earlier] = await ex
      .select({ id: raceEntries.id })
      .from(raceEntries)
      .innerJoin(races, eq(races.id, raceEntries.raceId))
      .where(and(eq(raceEntries.horseId, winner.horseId), eq(raceEntries.finishPosition, 1), inArray(races.raceClass, ["listed", "graded"]), eq(races.status, "settled"), sql`${races.id} <> ${race.id}`))
      .limit(1);
    if (!earlier) await put({ dedupeKey: `first-big-win:${winner.horseId}`, kind: "first_big_win", facts: { ...base, level: gc.levelLabel(race.raceClass) }, href, horseId: winner.horseId, stableIds: [winner.stableId] });
  }
  // A photo-finish in a big race.
  const order = (result as { finishOrder?: { horseId: string; marginLabel?: string; marginMm?: number }[]; photoFinish?: boolean } | null) ?? null;
  const runnerUp = order?.finishOrder?.[1];
  const tight = !!runnerUp && (order?.photoFinish === true || ["nose", "short head", "head"].includes(runnerUp.marginLabel ?? ""));
  if (second && tight && (feature || gc.isListedOrAbove(race.raceClass))) {
    await put({
      dedupeKey: `photo:${race.id}`,
      kind: "photo_finish",
      facts: { ...base, other: nameOf(second), otherStable: stableOf(second), margin: gc.marginWords(runnerUp.marginLabel ?? "nose") },
      href,
      horseId: winner.horseId,
      stableIds: [winner.stableId, second.stableId],
    });
  }
  // A record purse: the richest race settled so far.
  if (race.purse >= RECORD_PURSE_MIN) {
    const [prev] = await ex
      .select({ max: sql<number | null>`max(${races.purse})` })
      .from(races)
      .where(and(eq(races.status, "settled"), inArray(races.kind, [...LIVE_KINDS]), sql`${races.id} <> ${race.id}`, lt(races.postTime, race.postTime)));
    const before = Number(prev?.max ?? 0);
    if (before > 0 && race.purse > before) await put({ dedupeKey: `record-purse:${race.id}`, kind: "record_purse", facts: { ...base, amount: prizes[winner.horseId] ?? 0 }, href, horseId: winner.horseId, stableIds: [winner.stableId] });
  }
  // Claims settled with the race (public: the claim price and the new stable).
  const claimed = await ex.select().from(raceClaims).where(and(eq(raceClaims.raceId, race.id), eq(raceClaims.status, "claimed")));
  if (claimed.length) {
    const cn = await stableNames(ex, claimed.flatMap((c) => [c.claimantStableId, c.ownerStableId]));
    for (const c of claimed) {
      const e = entries.find((x) => x.horseId === c.horseId);
      await put({
        dedupeKey: `claim:${c.id}`,
        kind: "claim",
        facts: { race: race.name, track, horse: e ? nameOf(e) : "A runner", stable: cn.get(c.claimantStableId) ?? "A stable", otherStable: cn.get(c.ownerStableId) ?? "A stable", amount: c.price },
        href: `/horse/${c.horseId}`,
        horseId: c.horseId,
        stableIds: [c.claimantStableId, c.ownerStableId],
      });
    }
  }
  // The winning apprentice rides out the claim.
  const [ride] = await ex
    .select({ jockeyId: jockeyRides.jockeyId, name: jockeys.name, wins: jockeys.wins, rides: jockeys.rides, stableId: jockeys.stableId })
    .from(jockeyRides)
    .innerJoin(jockeys, eq(jockeys.id, jockeyRides.jockeyId))
    .where(and(eq(jockeyRides.raceId, race.id), eq(jockeyRides.horseId, winner.horseId)));
  if (ride && gc.apprenticeClaimLb(ride.wins - 1) > 0 && gc.apprenticeClaimLb(ride.wins) === 0) {
    await put({ dedupeKey: `claim-out:${ride.jockeyId}`, kind: "jockey_claim_out", facts: { jockey: ride.name, wins: ride.wins, race: race.name }, href: `/jockeys/${ride.jockeyId}`, jockeyId: ride.jockeyId, stableIds: [ride.stableId] });
  }
  return n;
}

/** A sale on the market (the price is public). Notable = at least this many credits. */
export const NOTABLE_SALE_CREDITS = 2_000;

export async function saleNewsTx(ex: Executor, input: { tradeId: string; horseId: string; horseName: string; price: number; buyerStableId: string; sellerStableId: string | null; now: Date }): Promise<boolean> {
  if (input.price < NOTABLE_SALE_CREDITS) return false;
  const names = await stableNames(ex, [input.buyerStableId, input.sellerStableId]);
  return putNews(ex, {
    dedupeKey: `sale:${input.tradeId}`,
    kind: "sale",
    facts: { horse: input.horseName, stable: names.get(input.buyerStableId) ?? "A stable", otherStable: input.sellerStableId ? (names.get(input.sellerStableId) ?? "A stable") : "the Club", amount: input.price },
    href: `/horse/${input.horseId}`,
    publicAt: input.now,
    horseId: input.horseId,
    stableIds: [input.buyerStableId, input.sellerStableId],
  });
}

/** A jockey's career news (jockeys.ts events): retirement announced, retired. */
export async function jockeyEventNewsTx(ex: Executor, e: { key: string; jockeyId: string; kind: string; stableId: string | null; at: Date }): Promise<boolean> {
  if (e.kind !== "retirement_announced" && e.kind !== "retired") return false;
  const [j] = await ex.select({ name: jockeys.name, wins: jockeys.wins, rides: jockeys.rides }).from(jockeys).where(eq(jockeys.id, e.jockeyId));
  if (!j) return false;
  return putNews(ex, {
    dedupeKey: `jockey:${e.key}`,
    kind: e.kind === "retired" ? "jockey_retired" : "jockey_retirement_announced",
    facts: { jockey: j.name, wins: j.wins, rides: j.rides },
    href: `/jockeys/${e.jockeyId}`,
    publicAt: e.at,
    jockeyId: e.jockeyId,
    stableIds: [e.stableId],
  });
}

/** A Hall of Fame entry for a horse; public once the horse's latest race result is. */
export async function hallNewsTx(ex: Executor, input: { entryKey: string; horseId: string; honour: string; now: Date }): Promise<boolean> {
  const [h] = await ex.select({ name: horses.name, stableId: horses.ownerStableId }).from(horses).where(eq(horses.id, input.horseId));
  if (!h) return false;
  const [last] = await ex
    .select({ postTime: races.postTime, settledAt: races.settledAt, result: sql<unknown>`(select result from race_results where race_id = ${races.id})` })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.horseId, input.horseId), eq(races.status, "settled")))
    .orderBy(desc(races.postTime))
    .limit(1);
  const publicAt = last ? new Date(Math.max(input.now.getTime(), resultPublicAt(last, last.result, last.settledAt).getTime())) : input.now;
  const names = await stableNames(ex, [h.stableId]);
  return putNews(ex, {
    dedupeKey: `hall:${input.entryKey}`,
    kind: "hall_of_fame",
    facts: { horse: h.name, stable: h.stableId ? (names.get(h.stableId) ?? "A stable") : "the Club", honour: input.honour },
    href: `/horse/${input.horseId}`,
    publicAt,
    horseId: input.horseId,
    stableIds: [h.stableId],
  });
}

/**
 * Season-end news (maintenance): once a season is over, its overall champion (season standings)
 * and the winner of each League table in its last week. Idempotent; cheap when already done.
 */
export async function seasonNewsSweep(db: Db, now: Date): Promise<number> {
  const season = seasonNumberAt(now) - 1;
  if (season < 1) return 0;
  const [done] = await db.select({ id: newsItems.id }).from(newsItems).where(eq(newsItems.dedupeKey, `season-done:${season}`));
  if (done) return 0;
  const { endsAt } = seasonBounds(season);
  const lastWeek = utcWeekStart(new Date(endsAt.getTime() - 1));
  // wait for the last week's League tables to settle
  const [open] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leagueMembers)
    .where(and(eq(leagueMembers.weekStart, lastWeek), sql`${leagueMembers.finalRank} is null`));
  if (Number(open?.n ?? 0) > 0) return 0;
  let n = 0;
  const st = await seasonStandings(db, { season, now: endsAt, limit: 1 });
  const top = st.rows[0];
  if (top && top.points > 0) {
    const [s] = await db.select({ id: stables.id }).from(stables).where(eq(stables.accountId, top.accountId));
    if (await putNews(db, { dedupeKey: `season-champion:${season}`, kind: "season_champion", facts: { stable: top.stableName, season, points: top.points }, href: s ? `/stables/${s.id}` : "/league", publicAt: now, stableIds: [s?.id] })) n++;
  }
  const winners = await db
    .select({ leagueId: leagues.id, tier: leagues.tier, accountId: leagueMembers.accountId, points: leagueMembers.points, stableId: stables.id, stableName: stables.name })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
    .innerJoin(stables, eq(stables.accountId, leagueMembers.accountId))
    .where(and(eq(leagueMembers.weekStart, lastWeek), eq(leagueMembers.finalRank, 1), isNotNull(leagueMembers.points), sql`${leagueMembers.points} > 0`));
  for (const w of winners) {
    const tier = gc.tierLabel(gc.LEAGUE_TIERS[Math.max(0, Math.min(gc.LEAGUE_TIERS.length - 1, w.tier - 1))]!);
    if (await putNews(db, { dedupeKey: `league-champion:${w.leagueId}`, kind: "league_champion", facts: { stable: w.stableName, tier, season, points: w.points ?? 0 }, href: `/stables/${w.stableId}`, publicAt: now, stableIds: [w.stableId] })) n++;
  }
  await db.insert(newsItems).values({ dedupeKey: `season-done:${season}`, kind: "marker", headline: "", href: "", publicAt: new Date(0), data: { season } }).onConflictDoNothing();
  return n;
}

export interface NewsView {
  id: string;
  kind: string;
  headline: string;
  href: string;
  atMs: number;
  raceId: string | null;
  horseId: string | null;
  jockeyId: string | null;
}

const view = (r: NewsItemRow): NewsView => ({ id: r.id, kind: r.kind, headline: r.headline, href: r.href, atMs: r.publicAt.getTime(), raceId: r.raceId, horseId: r.horseId, jockeyId: r.jockeyId });

/**
 * The feed, newest first: only items whose time has come (`publicAt <= now`). `stableIds`
 * narrows it to items involving those stables ("My stable": yours and your rivals').
 */
export async function listNews(ex: Executor, input: { now: Date; limit?: number; stableIds?: string[] | null; beforeMs?: number | null }): Promise<NewsView[]> {
  const conds = [lte(newsItems.publicAt, input.now), sql`${newsItems.kind} <> 'marker'`];
  if (input.beforeMs) conds.push(lt(newsItems.publicAt, new Date(input.beforeMs)));
  if (input.stableIds) {
    if (!input.stableIds.length) return [];
    conds.push(sql`${newsItems.stableIds} && ${sql.raw(`ARRAY[${input.stableIds.map((s) => `'${s.replace(/[^0-9a-f-]/gi, "")}'`).join(",")}]::uuid[]`)}`);
  }
  const rows = await ex
    .select()
    .from(newsItems)
    .where(and(...conds))
    .orderBy(desc(newsItems.publicAt), desc(newsItems.createdAt))
    .limit(Math.max(1, Math.min(100, input.limit ?? 30)));
  return rows.map(view);
}

/** When a settled race's result became (or becomes) public; null when it isn't settled. */
export async function raceResultPublicAt(ex: Executor, raceId: string): Promise<Date | null> {
  const [r] = await ex
    .select({ postTime: races.postTime, settledAt: races.settledAt, status: races.status, result: sql<unknown>`(select result from race_results where race_id = ${races.id})` })
    .from(races)
    .where(eq(races.id, raceId));
  if (!r || r.status !== "settled") return null;
  return resultPublicAt(r, r.result, r.settledAt);
}

/**
 * Coming back to the yard: the facts behind "While you were away", "Tomorrow at your yard", the
 * week's table across every stable and the Saturday Feature card. Everything is read from records
 * (inbox items, race entries, horses, pregnancies, news, the feature calendar); game-core
 * engagement.ts orders and words it, so nothing here is invented.
 *
 * No spoilers: a result counts only once its broadcast is over (resultPublicAt), and a race the
 * viewer still has to watch is left out of every line and of the table they see (its points, a
 * rating move, an injury from it, a rival's win in it, a Qualifier place in it).
 */
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { accounts, inboxItems, horses, newsItems, pregnancies, raceEntries, raceResults, races, stables } from "../schema";
import { gc } from "../gameCore";
import { RULES, seasonNumberAt } from "../rules";
import { utcWeekStart } from "../crypto";
import type { Executor } from "../types";
import { listStableHorses } from "./horses";
import { LIVE_RACE_KINDS, liveRunsBetween, weekBounds, weekScore, type LiveRun } from "./leagues";
import { localDate, timezoneOf } from "./entries";
import { resultPublicAt } from "./news";
import { declaredRivalsOf, rivalTags } from "./rivals";
import { GIFT_FOAL_DEDUPE } from "./onboarding";
import { creditsSince } from "./creditNotes";

const DAY = gc.MS_PER_DAY;
const SEASON_CLOCK = { epochMs: RULES.seasonEpochMs };
/** A calendar race's slot start (its published post time; the calendar's own time is 90 s into the slot). */
const slotStart = (ms: number) => Math.floor((ms - RULES.seasonEpochMs) / RULES.slotMs) * RULES.slotMs + RULES.seasonEpochMs;
/** Unwatched results older than this are not "waiting" any more (the race list still has them). */
const RESULT_WAIT_MS = 7 * DAY;
/** News kinds that count as a rival's notable win. */
const RIVAL_WIN_KINDS = ["feature_win", "first_big_win"];
/** Runs count on the week's table once the broadcast is surely over (the longest trip plus the delay and grace). */
export const BOARD_PUBLIC_LAG_MS = 10 * 60_000;

/** Races whose result this account still has to watch (unread race_result items). */
export async function unwatchedRaceIds(ex: Executor, accountId: string): Promise<Set<string>> {
  const rows = await ex
    .select({ raceId: inboxItems.raceId })
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, "race_result"), isNull(inboxItems.readAt), isNotNull(inboxItems.raceId)));
  return new Set(rows.map((r) => r.raceId!));
}

// ---------------------------------------------------------------------------
// While you were away
// ---------------------------------------------------------------------------

/** The facts for game-core `awaySummary`, from records since `from` (the last visit before this one). */
export async function awayFacts(ex: Executor, input: { accountId: string; stableId: string; from: Date; now: Date }): Promise<gc.AwayFacts> {
  const { accountId, stableId, from, now } = input;
  const nowMs = now.getTime();
  const fromMs = from.getTime();

  // Results waiting: unread race_result items whose broadcast is over.
  const waiting = await ex
    .select({ raceId: races.id, kind: races.kind, postTime: races.postTime, settledAt: races.settledAt, result: raceResults.result, horseName: horses.name, createdAt: inboxItems.createdAt })
    .from(inboxItems)
    .innerJoin(races, eq(races.id, inboxItems.raceId))
    .leftJoin(raceResults, eq(raceResults.raceId, races.id))
    .leftJoin(horses, eq(horses.id, inboxItems.horseId))
    .where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, "race_result"), isNull(inboxItems.readAt), gte(inboxItems.createdAt, new Date(nowMs - RESULT_WAIT_MS))))
    .orderBy(desc(races.postTime));
  const unwatched = waiting.filter((w) => resultPublicAt(w, w.result, w.settledAt).getTime() <= nowMs);
  const hidden = await unwatchedRaceIds(ex, accountId);
  const seen = new Set<string>();
  const unwatchedFacts = unwatched.filter((u) => !seen.has(u.raceId) && seen.add(u.raceId)).map((u) => ({ raceId: u.raceId, horseName: u.horseName ?? null, live: (LIVE_RACE_KINDS as readonly string[]).includes(u.kind) }));

  // Horses that ran in a race still to watch say nothing else today (an injury or a mark from it).
  const runsSince = await ex
    .select({ raceId: races.id, horseId: raceEntries.horseId, horseName: horses.name, postTime: races.postTime, ratingBefore: raceEntries.ratingBefore, ratingAfter: raceEntries.ratingAfter, status: races.status })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .innerJoin(horses, eq(horses.id, raceEntries.horseId))
    .where(and(eq(raceEntries.stableId, stableId), eq(raceEntries.status, "entered"), gt(races.postTime, from), lte(races.postTime, now)))
    .orderBy(asc(races.postTime));
  const quiet = new Set(runsSince.filter((r) => hidden.has(r.raceId) || r.status !== "settled").map((r) => r.horseId));

  // Today's Live races (the player's local day) that haven't gone off.
  const tz = await timezoneOf(ex, accountId);
  const today = localDate(tz, now);
  const upcoming = await ex
    .select({ raceId: races.id, raceName: races.name, postTime: races.postTime, horseName: horses.name })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .innerJoin(horses, eq(horses.id, raceEntries.horseId))
    .where(and(eq(raceEntries.stableId, stableId), eq(raceEntries.status, "entered"), inArray(races.kind, [...LIVE_RACE_KINDS]), inArray(races.status, ["open", "locked"]), gt(races.postTime, now), lt(races.postTime, new Date(nowMs + DAY))))
    .orderBy(asc(races.postTime));
  const liveToday = upcoming.filter((u) => localDate(tz, u.postTime) === today).map((u) => ({ raceId: u.raceId, horseName: u.horseName, raceName: u.raceName, postTimeMs: u.postTime.getTime() }));

  const kept = await listStableHorses(ex, stableId);
  // Foals born since the last visit (bred or the Club's gift).
  const foalsBorn = kept
    .filter((h) => (h.origin === "bred" || h.origin === "gift") && h.bornAt.getTime() > fromMs && h.bornAt.getTime() <= nowMs)
    .map((h) => ({ horseId: h.id, name: h.name, gift: h.origin === "gift" }));
  // Mares past their due time, waiting to foal.
  const due = await ex
    .select({ damName: horses.name })
    .from(pregnancies)
    .innerJoin(horses, eq(horses.id, pregnancies.damId))
    .where(and(eq(pregnancies.status, "carrying"), lte(pregnancies.dueAt, now), eq(horses.ownerStableId, stableId)))
    .orderBy(asc(pregnancies.dueAt));
  const racing = kept.filter((h) => h.careerStatus === "racing" && !quiet.has(h.id));
  const recovered = racing.filter((h) => h.injuredUntil && h.injuredUntil.getTime() > fromMs && h.injuredUntil.getTime() <= nowMs).map((h) => ({ horseId: h.id, name: h.name }));
  const fresh = racing
    .filter((h) => h.fatigueAt && !(h.injuredUntil && h.injuredUntil.getTime() > nowMs) && gc.freshSince({ fatigue: h.fatigue, fatigueAtMs: h.fatigueAt.getTime() }, fromMs, nowMs))
    .map((h) => ({ horseId: h.id, name: h.name }));

  // Rating moves from races already watched (first mark before → last mark after, per horse).
  const moves = new Map<string, { horseId: string; name: string; from: number; to: number }>();
  for (const r of runsSince) {
    if (quiet.has(r.horseId) || r.ratingAfter === null) continue;
    const m = moves.get(r.horseId);
    moves.set(r.horseId, { horseId: r.horseId, name: r.horseName, from: m?.from ?? r.ratingBefore, to: r.ratingAfter });
  }
  const ratings = [...moves.values()].filter((m) => m.from !== m.to);

  const notes = await ex
    .select({ title: inboxItems.title, data: inboxItems.data, horseId: inboxItems.horseId })
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, "training_ready"), gt(inboxItems.createdAt, from), lte(inboxItems.createdAt, now)))
    .orderBy(desc(inboxItems.createdAt))
    .limit(1);
  const training = notes.map((n) => ({ title: n.title, href: (n.data as { href?: string } | null)?.href ?? (n.horseId ? `/horse/${n.horseId}` : "/stable") }));

  // A rival's notable win since the last visit (public news only; never a race you haven't watched).
  let rivalWins: gc.AwayFacts["rivalWins"] = [];
  const rivalIds = [...new Set([...(await rivalTags(ex, stableId, now)).rivalStableIds, ...(await declaredRivalsOf(ex, stableId)).map((d) => d.stableId)])].filter((id) => id !== stableId);
  if (rivalIds.length) {
    const news = await ex
      .select({ headline: newsItems.headline, href: newsItems.href, raceId: newsItems.raceId, stableIds: newsItems.stableIds })
      .from(newsItems)
      .where(and(inArray(newsItems.kind, RIVAL_WIN_KINDS), gt(newsItems.publicAt, from), lte(newsItems.publicAt, now), sql`${newsItems.stableIds} && ${sql.raw(`ARRAY[${rivalIds.map((s) => `'${s.replace(/[^0-9a-f-]/gi, "")}'`).join(",")}]::uuid[]`)}`))
      .orderBy(desc(newsItems.publicAt))
      .limit(5);
    rivalWins = news.filter((n) => !(n.raceId && hidden.has(n.raceId)) && !(n.stableIds ?? []).includes(stableId)).slice(0, 1).map((n) => ({ headline: n.headline, href: n.href }));
  }

  const moved = await creditsSince(ex, { accountId, from, now, hideRaceIds: hidden });
  const credits = moved.net !== 0 ? { net: moved.net, prizes: moved.prizes, refunds: moved.refunds } : null;

  return { unwatched: unwatchedFacts, liveToday, foalsBorn, foalsDue: due.map((d) => ({ damName: d.damName })), recovered, fresh, training, ratings, rivalWins, credits };
}

// ---------------------------------------------------------------------------
// Tomorrow at your yard
// ---------------------------------------------------------------------------

/** The next local midnight after `now` in IANA zone `tz` (DST-correct, to the minute). */
export function nextLocalMidnight(tz: string, now: Date): Date {
  const today = localDate(tz, now);
  let lo = now.getTime();
  let hi = lo + 26 * gc.MS_PER_HOUR;
  if (localDate(tz, new Date(hi)) === today) return new Date(hi);
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (localDate(tz, new Date(mid)) === today) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

/** The facts for game-core `tomorrowHooks`, from state (the Story line comes from the web's Story view). */
export async function tomorrowFacts(ex: Executor, input: { accountId: string; stableId: string; now: Date; story?: { chapter: number; raceName: string } | null }): Promise<gc.TomorrowFacts> {
  const { accountId, stableId, now } = input;
  const nowMs = now.getTime();
  const [acc] = await ex.select({ createdAt: accounts.createdAt, tz: accounts.timezone }).from(accounts).where(eq(accounts.id, accountId));
  const [gift] = await ex.select({ id: inboxItems.id }).from(inboxItems).where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.dedupeKey, GIFT_FOAL_DEDUPE)));
  const giftFoalAtMs = acc ? gc.giftFoalTomorrowAt(acc.createdAt.getTime(), nowMs, !!gift) : null;

  const [pending] = await ex
    .select({ n: sql<number>`count(distinct ${races.id})::int` })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.stableId, stableId), eq(raceEntries.status, "entered"), inArray(races.kind, [...LIVE_RACE_KINDS]), inArray(races.status, ["open", "locked"]), gt(races.postTime, now)));

  const season = seasonNumberAt(now);
  const calendar = gc.tomorrowCalendar(
    nowMs,
    [...gc.featureCalendar(SEASON_CLOCK, season), ...gc.featureCalendar(SEASON_CLOCK, season + 1)].map((r) => ({ kind: r.kind, postTimeMs: slotStart(r.postTimeMs) })),
  );

  const racing = (await listStableHorses(ex, stableId)).filter((h) => h.careerStatus === "racing");
  const fresh: { name: string; at: number }[] = [];
  const heal: { name: string; at: number }[] = [];
  for (const h of racing) {
    const injured = h.injuredUntil && h.injuredUntil.getTime() > nowMs;
    if (injured) {
      if (h.injuredUntil!.getTime() <= nowMs + DAY) heal.push({ name: h.name, at: h.injuredUntil!.getTime() });
      continue;
    }
    const at = h.fatigueAt ? gc.freshAgainAt({ fatigue: h.fatigue, fatigueAtMs: h.fatigueAt.getTime() }, nowMs) : null;
    if (at !== null) fresh.push({ name: h.name, at });
  }
  const soon = (xs: { name: string; at: number }[]) => (xs.length ? { names: [...xs].sort((a, b) => a.at - b.at).map((x) => x.name), atMs: Math.min(...xs.map((x) => x.at)) } : null);

  const tomorrow = Math.floor(nowMs / DAY) + 1;
  const rot = tomorrow >= gc.CUP_ROTATION_FROM_DAY ? gc.cupRotation(tomorrow, SEASON_CLOCK) : null;

  const [stable] = await ex.select({ balance: stables.entryBalance, allowance: stables.entryAllowance, cap: stables.entryCap }).from(stables).where(eq(stables.id, stableId));
  const add = stable ? Math.max(0, Math.min(stable.cap, stable.balance + stable.allowance) - stable.balance) : 0;

  return {
    giftFoalAtMs,
    livePending: pending?.n ?? 0,
    calendar,
    freshSoon: soon(fresh),
    healSoon: soon(heal),
    cup: { opensAtMs: tomorrow * DAY, distanceM: rot?.distanceM ?? null, surface: rot?.surface ?? null },
    story: input.story ?? null,
    entries: add > 0 ? { add, atMs: nextLocalMidnight(acc?.tz ?? "UTC", now).getTime() } : null,
  };
}

// ---------------------------------------------------------------------------
// This week: every stable on one table
// ---------------------------------------------------------------------------

export interface WeekBoardView extends gc.WeekBoard {
  weekStart: string;
  /** When the week's table closes (Monday 00:00 UTC). */
  endsAtMs: number;
  /** Movement is against the table at this instant (the start of today, UTC); null on Monday. */
  sinceMs: number | null;
}

/**
 * The week's League points (leagues.weekScore: the best runs, capped) for every stable that ran
 * a Live race this week, on one table, with movement since the start of today. The viewer's own
 * unwatched races are left out of the table they see, so it never tells them how a race went.
 */
export async function weekBoardOf(ex: Executor, input: { now: Date; accountId: string | null; limit?: number }): Promise<WeekBoardView> {
  const { now } = input;
  const week = utcWeekStart(now);
  const { from, to } = weekBounds(week);
  const until = new Date(Math.min(to.getTime(), now.getTime() - BOARD_PUBLIC_LAG_MS + 1));
  const hidden = input.accountId ? await unwatchedRaceIds(ex, input.accountId) : new Set<string>();
  const runs = until > from ? (await liveRunsBetween(ex, { from, to: until })).filter((r) => !hidden.has(r.raceId)) : [];
  const accountIds = [...new Set(runs.map((r) => r.accountId))];
  const system = accountIds.length ? new Set((await ex.select({ id: accounts.id }).from(accounts).where(and(inArray(accounts.id, accountIds), eq(accounts.isSystem, true)))).map((a) => a.id)) : new Set<string>();
  const names = accountIds.length ? new Map((await ex.select({ accountId: stables.accountId, name: stables.name }).from(stables).where(inArray(stables.accountId, accountIds))).map((s) => [s.accountId, s.name])) : new Map<string, string>();
  const entries = (rs: LiveRun[]): gc.BoardEntry[] => {
    const by = new Map<string, LiveRun[]>();
    for (const r of rs) if (!system.has(r.accountId)) by.set(r.accountId, [...(by.get(r.accountId) ?? []), r]);
    return [...by].map(([accountId, list]) => ({ accountId, stableName: names.get(accountId) ?? "A stable", ...weekScore(list) }));
  };
  const todayStart = Math.floor(now.getTime() / DAY) * DAY;
  const before = todayStart > from.getTime() ? entries(runs.filter((r) => r.postTime.getTime() < todayStart)) : null;
  const board = gc.weekBoard(entries(runs), before, input.accountId, input.limit ?? 10);
  return { ...board, weekStart: week, endsAtMs: to.getTime(), sinceMs: before ? todayStart : null };
}

// ---------------------------------------------------------------------------
// The Saturday Feature
// ---------------------------------------------------------------------------

export interface SaturdayFeatureView {
  name: string;
  postTimeMs: number;
  distanceM: number;
  surface: string;
  /** The race on the card (null until the card reaches it). */
  raceId: string | null;
  status: "upcoming" | "open" | "closed" | "off";
  maxRunners: number;
  /** Runners entered so far (public on the racecard). */
  entered: { horseName: string; stableName: string; mine: boolean }[];
  /** Horses qualified so far: a top-3 in a Qualifier this week (results already public), or rated 100+. */
  qualified: { horseName: string; stableName: string; mine: boolean; via: "qualifier" | "rating" }[];
  /** This week's Qualifiers still to run (post times). */
  qualifiersLeft: number[];
  qualifyTop: number;
  ratingByRight: number;
}

/**
 * This week's Weekend Feature (Saturday 19:00 UTC): the conditions, who has qualified and who
 * has entered so far, and the Qualifiers still to come. Read-only: no new rules. Null in a week
 * without one (the Season Final week).
 */
export async function saturdayFeatureOf(ex: Executor, input: { now: Date; stableId: string | null; accountId: string | null }): Promise<SaturdayFeatureView | null> {
  const nowMs = input.now.getTime();
  const { from, to } = weekBounds(utcWeekStart(input.now));
  const season = seasonNumberAt(input.now);
  const cal = [...gc.featureCalendar(SEASON_CLOCK, season - 1), ...gc.featureCalendar(SEASON_CLOCK, season), ...gc.featureCalendar(SEASON_CLOCK, season + 1)].filter((r) => r.postTimeMs >= from.getTime() && r.postTimeMs < to.getTime());
  const wf = cal.find((r) => r.kind === "weekend_feature");
  if (!wf) return null;
  const postTimeMs = slotStart(wf.postTimeMs);

  const [race] = await ex
    .select({ id: races.id, name: races.name, status: races.status, maxRunners: races.maxRunners, conditions: races.conditions })
    .from(races)
    .where(and(eq(races.postTime, new Date(postTimeMs)), sql`${races.conditions}->'calendar'->>'kind' = 'weekend_feature'`))
    .limit(1);
  const cond = (race?.conditions ?? {}) as { distanceM?: number; surface?: string };
  const entered = race
    ? (
        await ex
          .select({ horseName: horses.name, stableName: stables.name, stableId: raceEntries.stableId })
          .from(raceEntries)
          .innerJoin(horses, eq(horses.id, raceEntries.horseId))
          .innerJoin(stables, eq(stables.id, raceEntries.stableId))
          .where(and(eq(raceEntries.raceId, race.id), eq(raceEntries.status, "entered")))
          .orderBy(asc(raceEntries.enteredAt))
      ).map((e) => ({ horseName: e.horseName, stableName: e.stableName, mine: e.stableId === input.stableId }))
    : [];

  // Qualified through a Qualifier: a top 3 in a settled one this week whose result is public, never
  // one the viewer still has to watch.
  const hidden = input.accountId ? await unwatchedRaceIds(ex, input.accountId) : new Set<string>();
  const top = await ex
    .select({ raceId: races.id, postTime: races.postTime, settledAt: races.settledAt, result: raceResults.result, horseId: horses.id, horseName: horses.name, stableName: stables.name, stableId: stables.id, isSystem: accounts.isSystem })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .leftJoin(raceResults, eq(raceResults.raceId, races.id))
    .innerJoin(horses, eq(horses.id, raceEntries.horseId))
    .innerJoin(stables, eq(stables.id, raceEntries.stableId))
    .innerJoin(accounts, eq(accounts.id, stables.accountId))
    .where(
      and(
        sql`${races.conditions}->'calendar'->>'kind' = 'feature_qualifier'`,
        eq(races.status, "settled"),
        gte(races.postTime, from),
        lt(races.postTime, new Date(postTimeMs)),
        eq(raceEntries.status, "entered"),
        lte(raceEntries.finishPosition, gc.FEATURE_QUALIFY_TOP),
      ),
    );
  const qualified = new Map<string, SaturdayFeatureView["qualified"][number]>();
  for (const t of top) {
    if (t.isSystem || hidden.has(t.raceId) || resultPublicAt(t, t.result, t.settledAt).getTime() > nowMs) continue;
    qualified.set(t.horseId, { horseName: t.horseName, stableName: t.stableName, mine: t.stableId === input.stableId, via: "qualifier" });
  }
  const rated = await ex
    .select({ horseId: horses.id, horseName: horses.name, stableName: stables.name, stableId: stables.id })
    .from(horses)
    .innerJoin(stables, eq(stables.id, horses.ownerStableId))
    .innerJoin(accounts, eq(accounts.id, stables.accountId))
    .where(and(eq(horses.careerStatus, "racing"), gte(horses.rating, gc.FEATURE_RATING_BY_RIGHT), eq(accounts.isSystem, false)))
    .orderBy(desc(horses.rating))
    .limit(50);
  for (const r of rated) if (!qualified.has(r.horseId)) qualified.set(r.horseId, { horseName: r.horseName, stableName: r.stableName, mine: r.stableId === input.stableId, via: "rating" });

  const status: SaturdayFeatureView["status"] = nowMs >= postTimeMs ? "off" : !race ? "upcoming" : race.status === "open" ? "open" : "closed";
  return {
    name: race?.name ?? wf.name,
    postTimeMs,
    distanceM: cond.distanceM ?? wf.distanceM,
    surface: cond.surface ?? wf.surface,
    raceId: race?.id ?? null,
    status,
    maxRunners: race?.maxRunners ?? wf.maxRunners,
    entered,
    qualified: [...qualified.values()].sort((a, b) => Number(b.mine) - Number(a.mine)),
    qualifiersLeft: cal.filter((r) => r.kind === "feature_qualifier" && slotStart(r.postTimeMs) > nowMs).map((r) => slotStart(r.postTimeMs)),
    qualifyTop: gc.FEATURE_QUALIFY_TOP,
    ratingByRight: gc.FEATURE_RATING_BY_RIGHT,
  };
}

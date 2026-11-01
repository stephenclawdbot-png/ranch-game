/**
 * Coming back to the yard (owner's ask after beta day one): what happened while you were away,
 * what will be new tomorrow, the week's table across every stable, and when the Saturday Feature
 * card shows. Pure: the server gathers the facts from its records and these functions only order,
 * cap and word them, so nothing here can invent an event.
 *
 * Ethics: no streaks, no countdown pressure, nothing lost by staying away. No spoilers: an
 * unwatched race's facts carry no placing at all, so no line can say how it went.
 */
import { MS_PER_DAY, MS_PER_HOUR } from "./time";
import { FEATURE_QUALIFY_TOP } from "./seasons";
import { TIRED_THRESHOLD, fatigueAt } from "./condition";
import { WORKOUTS } from "./training";

// ---------------------------------------------------------------------------
// While you were away
// ---------------------------------------------------------------------------

/** At most this many lines in the away summary (most important first). */
export const AWAY_MAX_LINES = 5;

export interface AwayFacts {
  /** Results not watched yet. Deliberately no placing or prize: the type cannot spoil. */
  unwatched: { raceId: string; horseName: string | null; live: boolean }[];
  /** Today's Live races the stable is in that haven't gone off yet, soonest first. */
  liveToday: { raceId: string; horseName: string; raceName: string; postTimeMs: number }[];
  /** Foals born since the last visit (the Club's gift foal is `gift`). */
  foalsBorn: { horseId: string; name: string; gift: boolean }[];
  /** Mares past their due time, waiting for you to foal them. */
  foalsDue: { damName: string }[];
  /** Horses whose injury healed since the last visit. */
  recovered: { horseId: string; name: string }[];
  /** Horses that were tired at the last visit and are fresh now (time alone did it). */
  fresh: { horseId: string; name: string }[];
  /** "Can train again" notes since the last visit (their own wording). */
  training: { title: string; href: string }[];
  /** Rating moves from races already watched since the last visit. */
  ratings: { horseId: string; name: string; from: number; to: number }[];
  /** Public news about a rival stable's big win since the last visit (never a race you haven't watched). */
  rivalWins: { headline: string; href: string }[];
  /** Credits moved since the last visit, from the ledger (prizes from races still to watch left out). */
  credits?: { net: number; prizes: number; refunds: number } | null;
}

export type AwayKind = "result" | "live_today" | "credits" | "gift_foal" | "foal_born" | "foal_due" | "recovered" | "fresh" | "rating" | "training" | "rival_win";

export interface AwayLine {
  kind: AwayKind;
  text: string;
  href: string;
  /** Post times to show in the player's local time (the browser formats them). */
  times?: number[];
}

/** The order of importance: a result to watch first, a rival's win last. */
export const AWAY_ORDER: readonly AwayKind[] = ["result", "live_today", "credits", "gift_foal", "foal_born", "foal_due", "recovered", "fresh", "rating", "training", "rival_win"];

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The summary lines: one per kind of news, most important first, at most AWAY_MAX_LINES. */
export function awaySummary(f: AwayFacts): AwayLine[] {
  const out: AwayLine[] = [];
  if (f.unwatched.length === 1) {
    const u = f.unwatched[0]!;
    const who = u.horseName ? `${u.horseName}'s` : "Your";
    out.push({ kind: "result", text: `${who} ${u.live ? "Live" : "Story"} race has run: watch the finish`, href: `/race/${u.raceId}` });
  } else if (f.unwatched.length > 1) {
    out.push({ kind: "result", text: `${plural(f.unwatched.length, "race has", "races have")} run: watch the finishes`, href: `/race/${f.unwatched[0]!.raceId}` });
  }
  const today = [...f.liveToday].sort((a, b) => a.postTimeMs - b.postTimeMs);
  if (today.length === 1) {
    const r = today[0]!;
    out.push({ kind: "live_today", text: `${r.horseName} runs in the ${r.raceName} today`, href: `/race/${r.raceId}`, times: [r.postTimeMs] });
  } else if (today.length > 1) {
    out.push({ kind: "live_today", text: `You're in ${today.length} Live races today`, href: `/race/${today[0]!.raceId}`, times: today.map((r) => r.postTimeMs) });
  }
  if (f.credits && f.credits.net !== 0) {
    const c = f.credits;
    const why = [c.prizes ? `prizes ${c.prizes}` : "", c.refunds ? `refunds ${c.refunds}` : ""].filter(Boolean).join(", ");
    const amount = `${c.net > 0 ? "+" : "−"}${thousands(Math.abs(c.net))} credits`;
    out.push({ kind: "credits", text: `${amount} while you were away${why ? ` (${why})` : ""}`, href: "/stable/finances" });
  }
  const gift = f.foalsBorn.find((b) => b.gift);
  if (gift) out.push({ kind: "gift_foal", text: `The Club's gift foal, ${gift.name}, has arrived`, href: `/horse/${gift.horseId}` });
  const born = f.foalsBorn.filter((b) => !b.gift);
  if (born.length === 1) out.push({ kind: "foal_born", text: `${born[0]!.name} was born`, href: `/horse/${born[0]!.horseId}` });
  else if (born.length > 1) out.push({ kind: "foal_born", text: `${born.length} foals were born`, href: "/nursery" });
  if (f.foalsDue.length === 1) out.push({ kind: "foal_due", text: `${f.foalsDue[0]!.damName} is ready to foal`, href: "/breeding" });
  else if (f.foalsDue.length > 1) out.push({ kind: "foal_due", text: `${f.foalsDue.length} mares are ready to foal`, href: "/breeding" });
  if (f.recovered.length === 1) out.push({ kind: "recovered", text: `${f.recovered[0]!.name} is over the injury and can race again`, href: `/horse/${f.recovered[0]!.horseId}` });
  else if (f.recovered.length > 1) out.push({ kind: "recovered", text: `${f.recovered.length} horses are over their injuries`, href: "/stable" });
  if (f.fresh.length === 1) out.push({ kind: "fresh", text: `${f.fresh[0]!.name} is fresh again`, href: `/horse/${f.fresh[0]!.horseId}` });
  else if (f.fresh.length > 1) out.push({ kind: "fresh", text: `${f.fresh.length} horses are fresh again`, href: "/stable" });
  if (f.ratings.length === 1) {
    const r = f.ratings[0]!;
    out.push({ kind: "rating", text: `${r.name}'s rating went ${r.to >= r.from ? "up" : "down"} from ${r.from} to ${r.to}`, href: `/horse/${r.horseId}` });
  } else if (f.ratings.length > 1) {
    out.push({ kind: "rating", text: `New ratings for ${f.ratings.length} horses after their races`, href: "/stable" });
  }
  if (f.training.length) out.push({ kind: "training", text: f.training[0]!.title, href: f.training[0]!.href });
  if (f.rivalWins.length) out.push({ kind: "rival_win", text: f.rivalWins[0]!.headline, href: f.rivalWins[0]!.href });
  return out.sort((a, b) => AWAY_ORDER.indexOf(a.kind) - AWAY_ORDER.indexOf(b.kind)).slice(0, AWAY_MAX_LINES);
}

const tired = (h: { fatigue: number; fatigueAtMs: number }, ms: number) => fatigueAt({ condition: { fatigue: h.fatigue, fatigueAtMs: h.fatigueAtMs } } as never, ms) > TIRED_THRESHOLD;

/**
 * Fresh again while away: tired at the last visit, not tired now, and no new work since (the
 * fatigue snapshot is older than the last visit). Recovery is game-core's real-time fatigueAt.
 */
export function freshSince(h: { fatigue: number; fatigueAtMs: number }, fromMs: number, nowMs: number): boolean {
  return h.fatigueAtMs <= fromMs && tired(h, fromMs) && !tired(h, nowMs);
}

/** Tired now and fresh again within `withinMs` by time alone: when (ms), else null. */
export function freshAgainAt(h: { fatigue: number; fatigueAtMs: number }, nowMs: number, withinMs = MS_PER_DAY): number | null {
  if (!tired(h, nowMs)) return null;
  // fatigue recovers FATIGUE_RECOVERY_PER_HOUR per whole hour: step hour by hour (at most a day)
  for (let t = nowMs + MS_PER_HOUR; t <= nowMs + withinMs; t += MS_PER_HOUR) if (!tired(h, t)) return t;
  return null;
}

// ---------------------------------------------------------------------------
// Tomorrow at your yard
// ---------------------------------------------------------------------------

/** At most this many lines on the "Tomorrow at your yard" card. */
export const TOMORROW_MAX_LINES = 5;

/** The day's calendar race tomorrow (UTC), from the feature calendar, or a new league week. */
export type TomorrowCalendar = { kind: "weekend_feature" | "feature_qualifier" | "season_final" | "new_week"; atMs: number };

export interface TomorrowFacts {
  /** The day-2 gift foal: when it becomes due (the next UTC day), only while not yet given. */
  giftFoalAtMs: number | null;
  /** Live races the stable is in that haven't run yet (they'll have results tomorrow). */
  livePending: number;
  /** Tomorrow's calendar race (or a new league week), from the rules' own calendar. */
  calendar: TomorrowCalendar | null;
  /** Horses tired now that time alone makes fresh within a day, and when the first one is. */
  freshSoon: { names: string[]; atMs: number } | null;
  /** Injuries that heal within a day. */
  healSoon: { names: string[]; atMs: number } | null;
  /** The next Daily Cup: when it opens, and its trip once the rotation announces it. */
  cup: { opensAtMs: number; distanceM: number | null; surface: string | null } | null;
  /** The Story chapter's next race, if a chapter is under way. */
  story: { chapter: number; raceName: string } | null;
  /** Stable entries the local-midnight allowance adds (0 = the bank is full). */
  entries: { add: number; atMs: number } | null;
}

export type TomorrowKind = "gift_foal" | "results" | "calendar" | "healed" | "fresh" | "cup" | "story" | "entries";

export interface TomorrowLine {
  kind: TomorrowKind;
  text: string;
  href: string;
  /** When it happens (the browser shows it in local time), if it has a time. */
  atMs?: number;
}

const names = (xs: string[]) => (xs.length === 1 ? xs[0]! : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs[0]}, ${xs[1]} and ${xs.length - 2} more`);

/** What will be new tomorrow, from real state only (each fact is null/0 when there's nothing). */
export function tomorrowHooks(f: TomorrowFacts): TomorrowLine[] {
  const out: TomorrowLine[] = [];
  if (f.giftFoalAtMs !== null) out.push({ kind: "gift_foal", text: "The Club's gift foal arrives at your yard", href: "/nursery", atMs: f.giftFoalAtMs });
  if (f.livePending > 0) out.push({ kind: "results", text: f.livePending === 1 ? "Your Live race will have run: the finish is waiting to be watched" : `Your ${f.livePending} Live races will have run: the finishes are waiting`, href: "/me/races" });
  if (f.calendar) {
    const c = f.calendar;
    const text =
      c.kind === "weekend_feature"
        ? "Saturday Feature day, with the Saturday Plate after it"
        : c.kind === "feature_qualifier"
          ? `A Feature Qualifier: a top ${FEATURE_QUALIFY_TOP} earns a Saturday Feature place`
          : c.kind === "season_final"
            ? "Season Final day: the championships"
            : "A new week: the League starts again and Saturday's Feature is announced";
    out.push({ kind: "calendar", text, href: c.kind === "new_week" ? "/league" : "/week", atMs: c.atMs });
  }
  if (f.healSoon && f.healSoon.names.length) out.push({ kind: "healed", text: `${names(f.healSoon.names)} will be over the injury`, href: "/stable", atMs: f.healSoon.atMs });
  if (f.freshSoon && f.freshSoon.names.length) out.push({ kind: "fresh", text: `${names(f.freshSoon.names)} will be fresh again`, href: "/stable", atMs: f.freshSoon.atMs });
  if (f.cup) {
    const trip = f.cup.distanceM && f.cup.surface ? `: ${thousands(f.cup.distanceM)} m on ${f.cup.surface === "synthetic" ? "the all-weather" : f.cup.surface}` : "";
    out.push({ kind: "cup", text: `A new Daily Cup${trip}`, href: "/cup", atMs: f.cup.opensAtMs });
  }
  if (f.story) out.push({ kind: "story", text: `Story chapter ${f.story.chapter} goes on: the ${f.story.raceName}`, href: "/story" });
  if (f.entries && f.entries.add > 0) out.push({ kind: "entries", text: `${plural(f.entries.add, "new Live entry", "new Live entries")} for your stable`, href: "/races", atMs: f.entries.atMs });
  return out.slice(0, TOMORROW_MAX_LINES);
}

/** The gift foal's arrival time when it is due tomorrow (account founded today, UTC) and not given yet. */
export function giftFoalTomorrowAt(accountCreatedAtMs: number, nowMs: number, given: boolean): number | null {
  if (given) return null;
  const created = Math.floor(accountCreatedAtMs / MS_PER_DAY);
  const today = Math.floor(nowMs / MS_PER_DAY);
  return today === created ? (created + 1) * MS_PER_DAY : null;
}

/** Monday = 0 … Sunday = 6, for a UTC instant. */
export function utcWeekday(ms: number): number {
  return (((Math.floor(ms / MS_PER_DAY) + 3) % 7) + 7) % 7;
}

/**
 * Tomorrow's (UTC) calendar fact: the first feature-calendar race on that day, else a new league
 * week when tomorrow is a Monday. `calendar` is game-core featureCalendar's slots (any seasons).
 */
export function tomorrowCalendar(nowMs: number, calendar: readonly { kind: string; postTimeMs: number }[]): TomorrowCalendar | null {
  const start = (Math.floor(nowMs / MS_PER_DAY) + 1) * MS_PER_DAY;
  const race = calendar
    .filter((r) => r.postTimeMs >= start && r.postTimeMs < start + MS_PER_DAY && (r.kind === "weekend_feature" || r.kind === "feature_qualifier" || r.kind === "season_final"))
    .sort((a, b) => a.postTimeMs - b.postTimeMs)[0];
  if (race) return { kind: race.kind as TomorrowCalendar["kind"], atMs: race.postTimeMs };
  return utcWeekday(start) === 0 ? { kind: "new_week", atMs: start } : null;
}

// ---------------------------------------------------------------------------
// This week: every stable's League points on one table
// ---------------------------------------------------------------------------

export interface BoardEntry {
  accountId: string;
  stableName: string;
  /** The week's League points (leagues.weekScore: best runs, weekly cap). */
  points: number;
  wins: number;
  runs: number;
}

export interface BoardRow extends BoardEntry {
  /** Shared on equal points (1, 2, 2, 4). */
  rank: number;
  tied: boolean;
  /** Places up (+) or down (−) since the start of today (UTC); null on the week's first day. */
  move: number | null;
  /** On the table today for the first time this week. */
  isNew: boolean;
}

export interface WeekBoard {
  top: BoardRow[];
  /** The viewer's row (also when it is in `top`), or null when they have no Live run this week. */
  mine: BoardRow | null;
  /** Stables on the table. */
  stables: number;
}

function ranked(entries: readonly BoardEntry[]): (BoardEntry & { rank: number; tied: boolean })[] {
  const sorted = [...entries].filter((e) => e.runs > 0).sort((a, b) => b.points - a.points || b.wins - a.wins || a.stableName.localeCompare(b.stableName) || (a.accountId < b.accountId ? -1 : 1));
  const count = new Map<number, number>();
  for (const e of sorted) count.set(e.points, (count.get(e.points) ?? 0) + 1);
  let rank = 0;
  return sorted.map((e, i) => {
    if (i === 0 || sorted[i - 1]!.points !== e.points) rank = i + 1;
    return { ...e, rank, tied: (count.get(e.points) ?? 0) > 1 };
  });
}

/**
 * The week's table: ranked by League points (ties share a place; equal points list by wins,
 * then name), movement against the table as it stood at the start of today (`before`, null on
 * the week's first day), the top `limit` and the viewer's own row.
 */
export function weekBoard(now: readonly BoardEntry[], before: readonly BoardEntry[] | null, viewerId: string | null, limit = 10): WeekBoard {
  const cur = ranked(now);
  const prev = before ? new Map(ranked(before).map((r) => [r.accountId, r.rank])) : null;
  const rows: BoardRow[] = cur.map((r) => {
    const p = prev?.get(r.accountId);
    return { ...r, move: prev === null ? null : p === undefined ? null : p - r.rank, isNew: prev !== null && p === undefined };
  });
  return { top: rows.slice(0, limit), mine: viewerId ? (rows.find((r) => r.accountId === viewerId) ?? null) : null, stables: rows.length };
}

// ---------------------------------------------------------------------------
// The Saturday Feature card
// ---------------------------------------------------------------------------

/** The Feature card stays on Home this long after the off (to watch it), then goes until Thursday. */
export const FEATURE_CARD_AFTER_MS = 3 * MS_PER_HOUR;

/** The Saturday Feature card shows from Thursday 00:00 UTC of its week until a while after the off. */
export function featureCardShows(nowMs: number, featurePostMs: number): boolean {
  const thursday = (Math.floor(featurePostMs / MS_PER_DAY) - 2) * MS_PER_DAY;
  return nowMs >= thursday && nowMs < featurePostMs + FEATURE_CARD_AFTER_MS;
}

// ---------------------------------------------------------------------------
// A calm word before a spend that leaves little
// ---------------------------------------------------------------------------

/** The cheapest Live entry fee on the card: a Maiden, 5 % of its 1,000 purse (packages/db card.ts; a db test keeps them equal). */
export const CHEAPEST_LIVE_ENTRY_FEE = 50;
/** The cheapest paid training session. */
export const CHEAPEST_TRAINING_SESSION = Math.min(...Object.values(WORKOUTS).map((w) => w.cost).filter((c) => c > 0));
/** Below this after a spend, the confirm shows one calm line: about a Live entry and a session of training. */
export const LOW_CREDITS_LINE = CHEAPEST_LIVE_ENTRY_FEE + CHEAPEST_TRAINING_SESSION;

/** What a spend leaves, when that is under LOW_CREDITS_LINE (null otherwise, or when the spend isn't affordable). */
export function lowCreditsAfter(balance: number, cost: number): number | null {
  if (cost <= 0 || cost > balance) return null;
  const left = balance - cost;
  return left < LOW_CREDITS_LINE ? left : null;
}

/**
 * Jockeys Phase 2 (docs/design/jockeys.md): contracts, the weekly transfer window and morale.
 *
 * A stable holds a jockey on a contract (4 weeks, 8 weeks or to the end of the season) with a
 * weekly wage (credits, burned), a number of rides promised a week and a buyout price (stored now,
 * used by Phase 3). Once a week, at Sunday 20:00 UTC, the window closes: every free agent (a
 * contract ending, a released or idle-stable jockey, a new apprentice, a jockey whose promises were
 * broken, a stable that couldn't pay) takes the best offer it can get, by jockey-proposing deferred
 * acceptance over a visible personality utility. Exact ties are broken by a seeded draw from the
 * week's committed seed, so the result is reproducible.
 *
 * Pure and deterministic: seeds and times are always passed in. Credits only, never USDG.
 */
import type { JockeyGrade, JockeyPersonality } from "./jockeys";
import { seedFrom } from "./rng";
import { MS_PER_DAY, MS_PER_HOUR, weekIndex, weekStartMs } from "./time";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Contract lengths a stable can offer: 4 weeks, 8 weeks, or to the end of the season. */
export const JOCKEY_CONTRACT_LENGTHS = ["4w", "8w", "season"] as const;
export type JockeyContractLength = (typeof JOCKEY_CONTRACT_LENGTHS)[number];
export const JOCKEY_CONTRACT_LENGTH_LABELS: Record<JockeyContractLength, string> = { "4w": "4 weeks", "8w": "8 weeks", season: "To the end of the season" };
/** Fixed-length contracts in weeks. A "season" contract runs to the last window of the season (at least JOCKEY_SEASON_CONTRACT_MIN_WEEKS). */
export const JOCKEY_CONTRACT_WEEKS: Record<Exclude<JockeyContractLength, "season">, number> = { "4w": 4, "8w": 8 };
export const JOCKEY_SEASON_CONTRACT_MIN_WEEKS = 2;

/** Standard weekly wage by grade (credits, burned in the weekly maintenance). Offers may range around it. */
export const JOCKEY_WAGE: Record<JockeyGrade, number> = { A: 600, B: 400, C: 250, D: 150, E: 100 };
/** An offer's wage must lie within [floor(wage × min / 100), wage × max / 100] of the jockey's grade wage. */
export const JOCKEY_WAGE_OFFER_PCT = { min: 50, max: 300 } as const;
/** Rides a contract may promise a week. */
export const JOCKEY_PROMISED_RIDES_MAX = 10;
/** Promised rides on a Phase 1 signing migrated to a contract, and on a stable's starting apprentice. */
export const JOCKEY_DEFAULT_PROMISED_RIDES = 2;
/** Buyout price bounds as multiples of the jockey's signing fee (default 2×). Used by Phase 3 buyouts. */
export const JOCKEY_BUYOUT_MULT = { min: 1, max: 10, default: 2 } as const;
/** An apprentice's first contract pays no wage for this many weeks (keeps every new stable's apprentice affordable). */
export const JOCKEY_APPRENTICE_FREE_WEEKS = 4;
/** Open offers a stable may hold in one window (each escrows the signing fee). */
export const JOCKEY_OPEN_OFFERS_PER_STABLE = 3;
/** Weeks of broken promises (fewer rides than promised) after which the jockey may walk out at the next window. */
export const JOCKEY_BROKEN_PROMISE_WEEKS = 2;
/** Contract-end notes go out this many weeks before the end (and again one week before). */
export const JOCKEY_CONTRACT_NOTE_WEEKS = [2, 1] as const;
/** The window closes this long after the start of the (Monday) game week: Sunday 20:00 UTC. */
export const JOCKEY_WINDOW_OFFSET_MS = 6 * MS_PER_DAY + 20 * MS_PER_HOUR;
/** Credits paid to the stable that developed a jockey when it wins a Feature or Final for another stable. */
export const JOCKEY_DEVELOPMENT_BONUS = 500;
/** An apprentice with at least this many rides for one stable counts as developed there. */
export const JOCKEY_DEVELOPED_RIDES = 25;
/** "Big wins together" (loyalty) are wins in races with a purse at least this large. */
export const JOCKEY_BIG_WIN_PURSE = 3_000;

/**
 * Personality weights (percent) over the six utility components, each scored 0..1000. Loyal
 * jockeys count the loyalty bonus twice; money-minded ones the wage; ambitious ones the quality
 * and prestige of the stable; workhorses the rides promised.
 */
export const JOCKEY_UTILITY_WEIGHTS: Record<JockeyPersonality, { wage: number; quality: number; prestige: number; rides: number; loyalty: number; length: number }> = {
  money: { wage: 50, quality: 10, prestige: 5, rides: 15, loyalty: 10, length: 10 },
  ambitious: { wage: 15, quality: 30, prestige: 25, rides: 10, loyalty: 10, length: 10 },
  loyal: { wage: 20, quality: 10, prestige: 5, rides: 15, loyalty: 40, length: 10 },
  workhorse: { wage: 20, quality: 10, prestige: 5, rides: 45, loyalty: 10, length: 10 },
};
/** Preferred contract length (weeks) by personality: ambitious jockeys keep their options open. */
export const JOCKEY_PREFERRED_WEEKS: Record<JockeyPersonality, number> = { money: 8, ambitious: 4, loyal: 8, workhorse: 8 };
/** Promised rides a week that score full marks. */
export const JOCKEY_RIDES_FULL = 6;
/** Loyalty score for the current stable: base, per week together, per big win together (capped at 1000). */
export const JOCKEY_LOYALTY = { base: 300, perWeek: 40, perBigWin: 100 } as const;

// ---------------------------------------------------------------------------
// The window clock
// ---------------------------------------------------------------------------

/** When week `week`'s window closes (Sunday 20:00 UTC). */
export function windowDeadlineMs(week: number): number {
  return weekStartMs(week) + JOCKEY_WINDOW_OFFSET_MS;
}

/** The week of the next window to close at or after `nowMs` (this week's until Sunday 20:00, then next week's). */
export function windowWeekAt(nowMs: number): number {
  const w = weekIndex(nowMs);
  return nowMs < windowDeadlineMs(w) ? w : w + 1;
}

/**
 * The window at which a contract signed now (closing at window `startWeek`) ends. Fixed lengths
 * end that many windows later; a season contract at the last window before `seasonEndMs` (the end
 * of the season in progress), or the season after when fewer than the minimum weeks are left.
 */
export function contractEndWeek(length: JockeyContractLength, startWeek: number, seasonEnds: readonly number[]): number {
  if (length !== "season") return startWeek + JOCKEY_CONTRACT_WEEKS[length];
  for (const end of [...seasonEnds].sort((a, b) => a - b)) {
    let w = weekIndex(end);
    if (windowDeadlineMs(w) > end) w--;
    if (w - startWeek >= JOCKEY_SEASON_CONTRACT_MIN_WEEKS) return w;
  }
  return startWeek + JOCKEY_CONTRACT_WEEKS["4w"];
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export function jockeyWage(grade: JockeyGrade): number {
  return JOCKEY_WAGE[grade];
}

export function wageBounds(grade: JockeyGrade): { min: number; max: number } {
  const w = JOCKEY_WAGE[grade];
  return { min: Math.floor((w * JOCKEY_WAGE_OFFER_PCT.min) / 100), max: Math.floor((w * JOCKEY_WAGE_OFFER_PCT.max) / 100) };
}

export function buyoutBounds(signingFee: number): { min: number; max: number; default: number } {
  return { min: signingFee * JOCKEY_BUYOUT_MULT.min, max: signingFee * JOCKEY_BUYOUT_MULT.max, default: signingFee * JOCKEY_BUYOUT_MULT.default };
}

/** The wage due for a contract week: nothing in an apprentice's free weeks. */
export function wageDue(c: { wage: number; wageFreeUntilWeek: number | null }, week: number): number {
  return c.wageFreeUntilWeek !== null && week < c.wageFreeUntilWeek ? 0 : Math.max(0, c.wage);
}

export interface OfferTerms {
  wage: number;
  length: JockeyContractLength;
  promisedRides: number;
  buyout: number;
}

/** Null when the terms are allowed, else the reason. */
export function offerTermsProblem(t: OfferTerms, grade: JockeyGrade, signingFee: number): string | null {
  const w = wageBounds(grade);
  if (!Number.isSafeInteger(t.wage) || t.wage < w.min || t.wage > w.max) return `wage must be between ${w.min} and ${w.max} credits a week`;
  if (!JOCKEY_CONTRACT_LENGTHS.includes(t.length)) return "unknown contract length";
  if (!Number.isSafeInteger(t.promisedRides) || t.promisedRides < 0 || t.promisedRides > JOCKEY_PROMISED_RIDES_MAX) return `promised rides must be 0 to ${JOCKEY_PROMISED_RIDES_MAX} a week`;
  const b = buyoutBounds(signingFee);
  if (!Number.isSafeInteger(t.buyout) || t.buyout < b.min || t.buyout > b.max) return `buyout must be between ${b.min} and ${b.max} credits`;
  return null;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** What a jockey sees in an offer and the stable behind it. */
export interface OfferFacts {
  wage: number;
  /** The contract length in weeks (a season contract: weeks to its end). */
  weeks: number;
  promisedRides: number;
  /** Mean official rating of the stable's top 5 racing horses (0 when it has none). */
  stableQuality: number;
  /** 0..1000 from stablePrestige. */
  prestige: number;
  /** The offer comes from the jockey's current stable. */
  current: boolean;
  weeksTogether: number;
  bigWinsTogether: number;
}

const clamp1000 = (v: number) => (v < 0 ? 0 : v > 1000 ? 1000 : Math.floor(v));

/** Prestige 0..1000: league tier (0..400), trophies = Feature/Final wins ever (0..300), recent winners (0..300). */
export function stablePrestige(s: { tier: number; tiers: number; trophies: number; recentWinners: number }): number {
  const tierPart = s.tiers > 1 ? Math.floor((Math.max(0, Math.min(s.tiers - 1, s.tier - 1)) * 400) / (s.tiers - 1)) : 0;
  return clamp1000(tierPart + Math.min(300, Math.max(0, s.trophies) * 60) + Math.min(300, Math.max(0, s.recentWinners) * 30));
}

/** The six component scores (0..1000) of an offer for a jockey of this grade and personality. */
export function offerScores(personality: JockeyPersonality, grade: JockeyGrade, o: OfferFacts): Record<keyof (typeof JOCKEY_UTILITY_WEIGHTS)["money"], number> {
  const loyalty = o.current ? clamp1000(JOCKEY_LOYALTY.base + o.weeksTogether * JOCKEY_LOYALTY.perWeek + o.bigWinsTogether * JOCKEY_LOYALTY.perBigWin) : 0;
  return {
    // The standard wage for the grade scores 500; three times it the most.
    wage: clamp1000(Math.floor((o.wage * 500) / JOCKEY_WAGE[grade])),
    // Mean rating 30 scores 0, 100 the most.
    quality: clamp1000(Math.floor(((o.stableQuality - 30) * 1000) / 70)),
    prestige: clamp1000(o.prestige),
    rides: clamp1000(Math.floor((o.promisedRides * 1000) / JOCKEY_RIDES_FULL)),
    loyalty,
    length: clamp1000(1000 - Math.floor((Math.abs(o.weeks - JOCKEY_PREFERRED_WEEKS[personality]) * 1000) / 12)),
  };
}

/** A jockey's utility for an offer: the personality-weighted sum of its scores (0..100,000). */
export function offerUtility(personality: JockeyPersonality, grade: JockeyGrade, o: OfferFacts): number {
  const w = JOCKEY_UTILITY_WEIGHTS[personality];
  const s = offerScores(personality, grade, o);
  return w.wage * s.wage + w.quality * s.quality + w.prestige * s.prestige + w.rides * s.rides + w.loyalty * s.loyalty + w.length * s.length;
}

/**
 * The "Wants" line on a jockey's page, from the personality weights and the current situation:
 * more rides (rides weigh and the jockey rides fewer than JOCKEY_RIDES_FULL/2 a week), better horses
 * (quality weighs and the stable's top horses rate under 65), a bigger stage (prestige), time
 * together (loyal), and always the wage it is after.
 */
export function jockeyWants(personality: JockeyPersonality, grade: JockeyGrade, now: { wage: number | null; ridesLastWeek: number; stableQuality: number | null; prestige: number | null }): string[] {
  const w = JOCKEY_UTILITY_WEIGHTS[personality];
  const out: string[] = [];
  if (w.rides >= 15 && now.ridesLastWeek < Math.ceil(JOCKEY_RIDES_FULL / 2)) out.push("more rides");
  if (w.quality >= 20 && (now.stableQuality ?? 0) < 65) out.push("better horses");
  if (w.prestige >= 20 && (now.prestige ?? 0) < 500) out.push("a bigger stage");
  if (w.loyalty >= 30) out.push("a long stay");
  const target = Math.ceil((JOCKEY_WAGE[grade] * (w.wage >= 40 ? 150 : 100)) / 100 / 50) * 50;
  if (now.wage === null || now.wage < target || w.wage >= 40) out.push(`wage ${target}+`);
  return out;
}

// ---------------------------------------------------------------------------
// Morale
// ---------------------------------------------------------------------------

export type JockeyMorale = "happy" | "unsettled" | "wants_out";
export const JOCKEY_MORALE_LABELS: Record<JockeyMorale, string> = { happy: "Happy", unsettled: "Unsettled", wants_out: "Wants to leave" };

/** Consecutive weeks of broken promises after a week with `rides` of `promised`. */
export function nextBrokenWeeks(brokenWeeks: number, promised: number, rides: number): number {
  return rides < promised ? brokenWeeks + 1 : 0;
}

export function jockeyMorale(brokenWeeks: number): JockeyMorale {
  return brokenWeeks >= JOCKEY_BROKEN_PROMISE_WEEKS ? "wants_out" : brokenWeeks > 0 ? "unsettled" : "happy";
}

// ---------------------------------------------------------------------------
// Matching: jockey-proposing deferred acceptance
// ---------------------------------------------------------------------------

export interface MatchOffer {
  jockeyId: string;
  stableId: string;
  /** The jockey's utility for this offer (higher is better). */
  utility: number;
  /** The stable's priority for this jockey (higher is better): the wage it offered, then the jockey's overall. */
  priority: number;
}

/** A deterministic 64-hex draw for tie-breaks. */
function draw(seed: string, side: "j" | "s", a: string, b: string): string {
  return seedFrom("jockey-window", seed, side, a, b);
}

/** The jockey's ranking of its offers, best first (exact ties by the seeded draw). */
export function rankOffersForJockey(offers: readonly MatchOffer[], seed: string): MatchOffer[] {
  return [...offers].sort((x, y) => y.utility - x.utility || cmp(draw(seed, "j", x.jockeyId, x.stableId), draw(seed, "j", y.jockeyId, y.stableId)));
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Does stable `s` prefer jockey offer `x` to `y`? (priority, then the seeded draw) */
export function stablePrefers(x: MatchOffer, y: MatchOffer, seed: string): boolean {
  return x.priority !== y.priority ? x.priority > y.priority : cmp(draw(seed, "s", x.stableId, x.jockeyId), draw(seed, "s", y.stableId, y.jockeyId)) < 0;
}

/**
 * Jockey-proposing deferred acceptance (Gale-Shapley with capacities). Each free jockey proposes
 * to its best offer not yet refused; each stable tentatively holds its best proposals up to its
 * capacity (free places) and refuses the rest. Ends when no free jockey has an offer left. The
 * result is stable (no jockey and stable both prefer each other to what they got) and
 * jockey-optimal. Deterministic for a given seed whatever the input order.
 */
export function matchJockeys(input: { offers: readonly MatchOffer[]; capacity: Readonly<Record<string, number>>; seed: string }): Map<string, string> {
  const byJockey = new Map<string, MatchOffer[]>();
  for (const o of input.offers) {
    if ((input.capacity[o.stableId] ?? 0) <= 0) continue;
    const l = byJockey.get(o.jockeyId) ?? [];
    if (l.some((x) => x.stableId === o.stableId)) continue; // one offer per (jockey, stable)
    l.push(o);
    byJockey.set(o.jockeyId, l);
  }
  const prefs = new Map<string, MatchOffer[]>();
  for (const [j, l] of byJockey) prefs.set(j, rankOffersForJockey(l, input.seed));
  const next = new Map<string, number>();
  const held = new Map<string, MatchOffer[]>();
  const free = [...prefs.keys()].sort();
  while (free.length) {
    const j = free.shift()!;
    const list = prefs.get(j)!;
    const i = next.get(j) ?? 0;
    if (i >= list.length) continue;
    next.set(j, i + 1);
    const o = list[i]!;
    const h = [...(held.get(o.stableId) ?? []), o].sort((a, b) => (stablePrefers(a, b, input.seed) ? -1 : stablePrefers(b, a, input.seed) ? 1 : 0));
    const cap = input.capacity[o.stableId] ?? 0;
    const keep = h.slice(0, cap);
    for (const out of h.slice(cap)) free.push(out.jockeyId);
    held.set(o.stableId, keep);
    free.sort();
  }
  const out = new Map<string, string>();
  for (const [s, l] of held) for (const o of l) out.set(o.jockeyId, s);
  return out;
}

/** Blocking pairs of a matching (empty when it is stable): used by tests and the published audit. */
export function blockingPairs(input: { offers: readonly MatchOffer[]; capacity: Readonly<Record<string, number>>; seed: string }, match: ReadonlyMap<string, string>): MatchOffer[] {
  const offerOf = new Map(input.offers.map((o) => [`${o.jockeyId}|${o.stableId}`, o]));
  const out: MatchOffer[] = [];
  for (const o of input.offers) {
    const cap = input.capacity[o.stableId] ?? 0;
    if (cap <= 0 || match.get(o.jockeyId) === o.stableId) continue;
    const mine = match.get(o.jockeyId);
    const cur = mine ? offerOf.get(`${o.jockeyId}|${mine}`) : undefined;
    const jockeyWants = !cur || rankOffersForJockey([o, cur], input.seed)[0] === o;
    if (!jockeyWants) continue;
    const holders = [...match].filter(([, s]) => s === o.stableId).map(([j]) => offerOf.get(`${j}|${o.stableId}`)!);
    if (holders.length < cap || holders.some((h) => stablePrefers(o, h, input.seed))) out.push(o);
  }
  return out;
}


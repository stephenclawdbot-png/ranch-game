/**
 * Near-miss honesty (experience review item 9): how close a stable came, in the competition's
 * own numbers. "5th in a Qualifier, top 3 go through: 2 places short", "12 points from Silver",
 * "OR 91, needs 95". Every line is read from the real rules (seasons.ts, leagues.ts) so it can
 * never promise more than the rules give; nothing is manufactured.
 */
import { FEATURE_QUALIFY_TOP, FEATURE_RATING_BY_RIGHT, SEASON_FINAL_MIN_RATING } from "./seasons";
import { LEAGUE_TIERS, PROMOTE, RELEGATE, RELEGATION_FROM_TIER, standings } from "./leagues";
import { TIER_RULES, classBand } from "./eligibility";
import type { LeagueMember, LeagueTier } from "./types";

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
export const tierLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const pts = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

/**
 * A Qualifier near miss: null when the horse has not run in one or already made the top places.
 * `places` = how many places short of the last qualifying place.
 */
export function qualifierNearMiss(bestFinish: number | null): { places: number; text: string } | null {
  if (bestFinish === null || bestFinish < 1 || bestFinish <= FEATURE_QUALIFY_TOP) return null;
  const places = bestFinish - FEATURE_QUALIFY_TOP;
  return { places, text: `${ordinal(bestFinish)} in a Qualifier, top ${FEATURE_QUALIFY_TOP} go through: ${places} ${places === 1 ? "place" : "places"} short` };
}

/** A rating gate: how far below `needed` the horse is (0 = high enough). */
export function ratingGap(or: number, needed: number): { short: number; text: string } {
  const short = Math.max(0, needed - or);
  return { short, text: short > 0 ? `OR ${or}, needs ${needed}: ${short} short` : `OR ${or}, needs ${needed}: high enough` };
}

/** Into the Weekend Feature by rating alone (FEATURE_RATING_BY_RIGHT). */
export const featureRatingGap = (or: number) => ratingGap(or, FEATURE_RATING_BY_RIGHT);
/** The Season Final's floor (SEASON_FINAL_MIN_RATING). */
export const seasonFinalGap = (or: number) => ratingGap(or, SEASON_FINAL_MIN_RATING);

/** The race level a horse with this mark runs in right now, as the card names it ("Hcp 70-95"). */
function levelLabel(or: number): string {
  return TIER_RULES[classBand(or)].label.replace(/^Handicap \((.*)\)$/, "Hcp $1");
}

export interface RatingTrajectory {
  /** Whole weeks at the recent rate, when there is one; null when no honest number exists. */
  weeks: number | null;
  /** The recent average OR change per week (null when there is no rise to average). */
  ratePerWeek: number | null;
  /** One line for the Road to Saturday; always "about", never a promise. */
  text: string;
}

/**
 * A realistic trajectory from a rating gap (playtest fix 15): the same "OR 40, needs 95: 55
 * short" honesty, plus how long it has been taking. The rate is the horse's own recent rated
 * runs (their deltas, grouped by the week they ran in) averaged over the weeks they span;
 * with nothing to average — or a mark that hasn't risen — the line says what the rules would
 * move it: wins at the horse's own level.
 */
export function ratingTrajectory(or: number, recent: readonly { delta: number; week: number }[], target: number): RatingTrajectory {
  const short = Math.max(0, target - or);
  const level = levelLabel(or);
  if (short <= 0) return { weeks: null, ratePerWeek: null, text: `OR ${or} already clears ${target}` };
  if (recent.length === 0) return { weeks: null, ratePerWeek: null, text: `Needs a win or two at ${level} level to start the mark moving` };
  const first = Math.min(...recent.map((r) => r.week));
  const last = Math.max(...recent.map((r) => r.week));
  const span = Math.max(1, last - first + 1);
  const rate = recent.reduce((s, r) => s + r.delta, 0) / span;
  if (rate <= 0) return { weeks: null, ratePerWeek: null, text: `The mark hasn't risen over recent weeks: about a win or two at ${level} level would move it` };
  const weeks = Math.ceil(short / rate);
  const rateText = Number.isInteger(rate) ? `${rate}` : rate.toFixed(1);
  return { weeks, ratePerWeek: rate, text: `At your current rate (+${rateText} OR a week), about ${weeks} ${weeks === 1 ? "week" : "weeks"}` };
}

export interface LeagueNearMiss {
  rank: number;
  of: number;
  points: number;
  tier: LeagueTier;
  /** The tier above, or null at the top. */
  up: LeagueTier | null;
  /** The tier below (where relegation goes), or null for a floor tier (no relegation). */
  down: LeagueTier | null;
  /** Points still needed to pass the last promotion place; 0 = in the places; null at the top tier. */
  toPromotion: number | null;
  /**
   * Relegation, only in tiers that relegate (Gold up): "zone" = in the bottom places and the
   * points needed to pass the first safe stable; "clear" = the margin over the drop zone; "away" =
   * no points yet (an owner who doesn't race is never relegated); "none" = too few stables have
   * scored for anyone to go down.
   */
  drop: { state: "zone"; toSafety: number } | { state: "clear"; margin: number } | { state: "away" } | { state: "none" } | null;
}

/**
 * Where an owner stands against the promotion and relegation lines, by the same rules as
 * settleLeague (top PROMOTE with points go up; bottom RELEGATE among those who scored go down,
 * from RELEGATION_FROM_TIER only, and only when more than PROMOTE + RELEGATE have scored).
 * Gaps are the points that would put the owner strictly ahead (a tie may go either way).
 */
export function leagueNearMiss(members: readonly LeagueMember[], ownerId: string, tier: LeagueTier): LeagueNearMiss | null {
  const table = standings({ id: "near-miss", week: 0, tier, members: [...members] });
  const i = table.findIndex((m) => m.ownerId === ownerId);
  if (i < 0) return null;
  const me = table[i]!;
  const t = LEAGUE_TIERS.indexOf(tier);
  const up = t < LEAGUE_TIERS.length - 1 ? LEAGUE_TIERS[t + 1]! : null;
  const floor = t < LEAGUE_TIERS.indexOf(RELEGATION_FROM_TIER);
  const down = floor || t === 0 ? null : LEAGUE_TIERS[t - 1]!;

  let toPromotion: number | null = null;
  if (up) {
    if (i < PROMOTE && me.points > 0) toPromotion = 0;
    else {
      const line = table[PROMOTE - 1];
      // fewer stables than promotion places: any points at all go up
      toPromotion = line && line.ownerId !== me.ownerId ? Math.max(1, line.points - me.points + 1) : Math.max(1, 1 - me.points);
    }
  }

  let drop: LeagueNearMiss["drop"] = null;
  if (down) {
    const active = table.filter((m) => m.points > 0);
    if (me.points <= 0) drop = { state: "away" };
    else if (active.length <= PROMOTE + RELEGATE) drop = { state: "none" };
    else {
      const zoneFrom = active.length - RELEGATE;
      const j = active.findIndex((m) => m.ownerId === me.ownerId);
      if (j >= zoneFrom) drop = { state: "zone", toSafety: Math.max(1, active[zoneFrom - 1]!.points - me.points + 1) };
      else drop = { state: "clear", margin: me.points - active[zoneFrom]!.points };
    }
  }
  return { rank: i + 1, of: table.length, points: me.points, tier, up, down, toPromotion, drop };
}

/** "12 points from Silver" / "in the promotion places for Silver" / null at the top tier. */
export function promotionText(l: LeagueNearMiss): string | null {
  if (!l.up || l.toPromotion === null) return null;
  return l.toPromotion === 0 ? `In the promotion places for ${tierLabel(l.up)}` : `${pts(l.toPromotion)} from ${tierLabel(l.up)}`;
}

/** "3 points from safety" / "8 points clear of the drop" / null where nobody can go down. */
export function relegationText(l: LeagueNearMiss): string | null {
  const d = l.drop;
  if (!d || !l.down) return null;
  switch (d.state) {
    case "zone":
      return `In the bottom ${RELEGATE}, down to ${tierLabel(l.down)}: ${pts(d.toSafety)} from safety`;
    case "clear":
      return d.margin === 0 ? "Level on points with the drop zone" : `${pts(d.margin)} clear of the drop`;
    case "away":
      return "No points yet: a week away never relegates";
    case "none":
      return `Too few stables have scored for anyone to go down yet (more than ${PROMOTE + RELEGATE} must)`;
  }
}

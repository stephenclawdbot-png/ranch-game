/**
 * Club runners that fill Live races (2026-10-30). Owner: "Make sure the Club horses that fill in
 * the race are median and above median, because once real people are in, I want them to feel the
 * challenge, not easy."
 *
 * Two rules live here; packages/db (races.ts pickHouseHorses) applies them at entry close:
 *
 *   1. A Club horse is honest: its stored rating is its real ability mark (ability.ts). The Club
 *      mints a seasoned horse (racing age, at the start of its peak window, fully trained, fit)
 *      whose genome is searched, deterministically from the race seed, until its ability mark
 *      lands on the target. Before this, minted Club horses were untrained novices stamped with
 *      the band's midpoint as their rating (a "62" ran like a 29).
 *   2. Who fills a race: Club runners come from the median and above of the race's players: a
 *      window (clubWindow) from just below P, the entered players' median real ability mark, to 10 above
 *      it, clipped to the race's band; about half of them sit at or just above P (clubTargets).
 *      (A first cut, [band middle, band max], put the Club above almost every player in the upper
 *      bands: players enter near the bottom of a band.)
 *
 * The Club's genomes may sit above the season's mint ceilings (genome.ts potentialCeiling): the
 * rating bands go up to Group class, which no foundation mint reaches, so the search lifts every
 * stat locus of a foundation genome by the same amount (liftGenome). Club horses never pass into a
 * player's ownership through this path (Club sale lots are minted on their own, clubMarket.ts).
 *
 * Integer maths only, like the rest of game-core.
 */
import type { Surface } from "@thoroughbred/shared";
import { ABILITY_OR_TABLE, abilityMark } from "./ability";
import { generateFoundationGenome, maturityType, preferredDistanceM, preferredSurface } from "./genome";
import { CARE_TO_RACING, CAREER_MAX_STARTS, createHorseState } from "./lifecycle";
import { PEAK_WINDOW, STAT_PEAK_SHIFT } from "./phenotype";
import { Rng, clampInt, seedFrom } from "./rng";
import { STAT_KEYS, type Genome, type HorseState, type MaturityType, type Rarity, type StatRecord } from "./types";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/**
 * The Club's window starts this many marks below P, the median real ability mark of the player horses
 * entered (every race but Story): [P - this, P + CLUB_ABOVE_MEDIAN_SPAN].
 */
export const CLUB_BELOW_MEDIAN = 2;

/** The window reaches this many marks above P (the "contenders" at the top of the Club's pack). */
export const CLUB_ABOVE_MEDIAN_SPAN = 10;

/**
 * When the race's own band leaves nothing of [P - 2, P + 12] (P far above the band's max or below
 * its min), the window is the band's top (or bottom) this many marks: [max - this, max] or
 * [min, min + this].
 */
export const CLUB_CLIPPED_SPAN = 8;

/**
 * The level P a race is pitched at when no player entered it (a calendar or sponsored race): its
 * class's floor on the card (Listed 85, Group 95); other classes use CLUB_OPEN_NOMINAL_DEFAULT, and
 * a banded race its band's middle.
 */
export const CLUB_OPEN_NOMINAL_RATING: Readonly<Record<string, number>> = { listed: 85, graded: 95 };
/** Nominal level of an open race of any other class with no player entered. */
export const CLUB_OPEN_NOMINAL_DEFAULT = 60;

/** Lowest and highest ability mark a horse can have (the ends of ability.ts ABILITY_OR_TABLE): windows are clamped to them. */
export const CLUB_MARK_MIN = ABILITY_OR_TABLE[0]![1];
export const CLUB_MARK_MAX = ABILITY_OR_TABLE[ABILITY_OR_TABLE.length - 1]![1];

/** A minted Club horse's training realisation on every stat (permille; 1000 = fully trained). */
export const CLUB_REALISATION = 1000;

/** A minted Club horse's fitness (permille): a seasoned horse in work. Racing moves it after that. */
export const CLUB_FITNESS = 1000;

/**
 * Starts a minted Club horse has already run, by maturity type: the first start at which every
 * stat is at its peak (phenotype.ts PEAK_WINDOW shifted by STAT_PEAK_SHIFT), so it races its next
 * runs at full maturity and fades from there like any horse.
 */
export const CLUB_SEASONED_STARTS: Readonly<Record<MaturityType, number>> = {
  early: seasonedStarts("early"),
  normal: seasonedStarts("normal"),
  late: seasonedStarts("late"),
};

function seasonedStarts(type: MaturityType): number {
  let from = 0;
  for (const k of STAT_KEYS) from = Math.max(from, clampInt(PEAK_WINDOW[type][0] + STAT_PEAK_SHIFT[k], 1, CAREER_MAX_STARTS - 2));
  return from;
}

/** A minted Club horse is accepted when its ability mark is within this many points of the target. */
export const CLUB_MARK_TOLERANCE = 2;

/** Most candidate genomes the mint tries before it settles for the closest one. */
export const CLUB_MINT_SEARCH_CAP = 256;

/**
 * Most potential points the mint adds to (or takes from) every stat locus of a foundation genome
 * to bring its mark to the target (liftGenome).
 */
export const CLUB_LIFT_MAX = 450;

/**
 * Genome rarity tier the mint starts from, by target mark: the tier whose seasoned, fully trained
 * horses have about that mark (season 12 mints: common median 41, uncommon 44, rare 47, epic 49,
 * legendary 55), so the lift stays small. [highest target, tier]; above the last row: legendary.
 */
export const CLUB_RARITY_BY_TARGET: readonly (readonly [number, Rarity])[] = [
  [42, "common"],
  [45, "uncommon"],
  [48, "rare"],
  [52, "epic"],
];

/**
 * A Club runner suits the race when its preferred trip is within this many metres of the race
 * distance (and it prefers the race's surface): players enter races that suit their horses, and
 * the engine penalises a horse off its trip or surface, so an unsuited Club horse runs below its
 * mark.
 */
export const CLUB_TRIP_FIT_M = 400;

/**
 * Pool picking reads the free Club horses whose stored rating is within this many points of the
 * window; their real ability mark (which drifts from the rating as they race and age) decides.
 */
export const CLUB_POOL_RATING_SLACK = 15;

/** Free Club horses read from the pool per Club runner needed (the shortfall is minted). */
export const CLUB_POOL_READ_PER_RUNNER = 12;

// ---------------------------------------------------------------------------
// The target window
// ---------------------------------------------------------------------------

/** How a race is filled: by its rating band, around the players entered (open races), or a Story race (the whole band). */
export type ClubFillKind = "banded" | "open" | "story";

/**
 * What a race's Club window is clipped to: calendar races (Feature Qualifiers, Weekend Feature,
 * Saturday Plate, Season Final) and races with no rating band are open; Story races (kind
 * "quick") take their whole band; every other race is banded. Open and banded races both centre
 * on the players entered (clubWindow).
 */
export function clubFillKind(race: { kind: string; conditions: { minRating?: number; maxRating?: number; calendar?: unknown } | null }): ClubFillKind {
  const c = race.conditions ?? {};
  if (c.calendar || (c.minRating === undefined && c.maxRating === undefined)) return "open";
  return race.kind === "quick" ? "story" : "banded";
}

export interface ClubWindowInput {
  kind: ClubFillKind;
  minRating?: number;
  maxRating?: number;
  /** Real ability marks (ability.ts abilityMark) of the player horses entered. */
  playerRatings?: readonly number[];
  /** Level of an open race with no player entered (clubNominalRating); a banded one uses its band's middle. */
  nominal?: number;
}

export interface ClubWindow {
  lo: number;
  hi: number;
}

/** Median of integer ratings (the lower of the two middles' mean for an even count); null when empty. */
export function medianRating(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.floor((s[m - 1]! + s[m]!) / 2);
}

/** The level an open race is pitched at with no player entered. */
export function clubNominalRating(raceClass: string): number {
  return CLUB_OPEN_NOMINAL_RATING[raceClass] ?? CLUB_OPEN_NOMINAL_DEFAULT;
}

/**
 * The ability window Club runners are drawn from (inclusive marks, clamped to what a horse can
 * be: CLUB_MARK_MIN..CLUB_MARK_MAX). P is the median real ability mark of the player horses entered
 * (with none: an open race's nominal level, a banded race's band middle).
 *   - banded and open: [P - CLUB_BELOW_MEDIAN, P + CLUB_ABOVE_MEDIAN_SPAN], clipped to the race's
 *     own band [min, max] (min 0 and max CLUB_MARK_MAX when absent); if nothing is left, the band's
 *     top or bottom CLUB_CLIPPED_SPAN marks;
 *   - story: the whole band (a Story race's band is already centred on the player's horse).
 */
export function clubWindow(i: ClubWindowInput): ClubWindow {
  const min = i.minRating ?? 0;
  const max = i.maxRating ?? CLUB_MARK_MAX;
  let lo: number;
  let hi: number;
  if (i.kind === "story") {
    lo = min;
    hi = i.maxRating ?? min + CLUB_ABOVE_MEDIAN_SPAN;
  } else {
    const nobody = i.kind === "open" ? (i.nominal ?? CLUB_OPEN_NOMINAL_DEFAULT) : i.maxRating === undefined ? min : Math.floor((min + max) / 2);
    const p = medianRating(i.playerRatings ?? []) ?? nobody;
    lo = Math.max(p - CLUB_BELOW_MEDIAN, min);
    hi = Math.min(p + CLUB_ABOVE_MEDIAN_SPAN, max);
    if (lo > hi) {
      if (p - CLUB_BELOW_MEDIAN > max) [lo, hi] = [max - CLUB_CLIPPED_SPAN, max];
      else [lo, hi] = [min, min + CLUB_CLIPPED_SPAN];
    }
  }
  hi = clampInt(hi, CLUB_MARK_MIN, CLUB_MARK_MAX);
  lo = clampInt(lo, CLUB_MARK_MIN, hi);
  return { lo, hi };
}

/**
 * How hard the Club's targets lean towards the bottom of the window (P): the k-th of n slice
 * edges sits (k/n)^CLUB_TARGET_SKEW of the way up. 1 spreads the pack evenly; 2 puts about half
 * of it in the window's bottom quarter; 3 in its bottom eighth, with a few contenders still
 * reaching the top.
 */
export const CLUB_TARGET_SKEW = 3;

/** Where the k-th of n slice edges sits in a window of `width` marks: (k/n)^CLUB_TARGET_SKEW of the way up. */
function edge(width: number, n: number, k: number): number {
  let num = width;
  let den = 1;
  for (let e = 0; e < CLUB_TARGET_SKEW; e++) {
    num *= k;
    den *= n;
  }
  return Math.floor(num / den);
}

/**
 * The `i`-th of `n` slices of a window, narrow at the bottom and wide at the top ((k/n)^2 edges):
 * about half the slices lie in the window's bottom quarter, near P (never empty: a slice narrower
 * than one mark is that mark).
 */
export function clubStratum(w: ClubWindow, n: number, i: number): ClubWindow {
  const width = w.hi - w.lo + 1;
  const lo = w.lo + edge(width, n, i);
  return { lo, hi: Math.max(lo, w.lo + edge(width, n, i + 1) - 1) };
}

/**
 * `n` target marks, one drawn inside each slice (clubStratum; deterministic in `seed`), lowest
 * first: about half the Club's pack sits at or just above P and a few runners clearly above it.
 */
export function clubTargets(w: ClubWindow, n: number, seed: string): number[] {
  const rng = new Rng(seedFrom("club-targets", seed, w.lo, w.hi, n));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = clubStratum(w, n, i);
    out.push(s.lo + rng.int(s.hi - s.lo + 1));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Honest Club horses
// ---------------------------------------------------------------------------

/** The tier the mint starts from for a target mark (CLUB_RARITY_BY_TARGET). */
export function clubRarityFor(target: number): Rarity {
  for (const [max, r] of CLUB_RARITY_BY_TARGET) if (target <= max) return r;
  return "legendary";
}

/** Adds `points` to both alleles of every stat locus (clamped to 0..1000): every stat potential moves by about `points`. */
export function liftGenome(genome: Genome, points: number): Genome {
  if (points === 0) return genome;
  const stats = {} as Genome["stats"];
  for (const k of STAT_KEYS) {
    const [a, b] = genome.stats[k];
    stats[k] = [clampInt(a + points, 0, 1000), clampInt(b + points, 0, 1000)];
  }
  return { ...genome, stats };
}

/** Training realisation of a minted Club horse (every stat at CLUB_REALISATION). */
export function clubRealisation(): StatRecord<number> {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, CLUB_REALISATION])) as StatRecord<number>;
}

/**
 * The game-core state of a minted Club horse: racing age, CLUB_SEASONED_STARTS starts for its
 * maturity type (no wins: it may still run in maidens), fully trained, fit, rated at its mark.
 * The database stores exactly these (starts, training, fitness, rating), so abilityMark of the
 * stored row equals the mark here.
 */
export function clubSeasonedState(genome: Genome, base: { id?: string; name?: string; sex?: "colt" | "filly"; season?: number } = {}): HorseState {
  const s = createHorseState({
    id: base.id ?? "club",
    name: base.name ?? "Club",
    sex: base.sex ?? "colt",
    ownerId: "club",
    sireId: null,
    damId: null,
    generation: 0,
    genome,
    bornAtMs: 0,
    bornSeason: base.season ?? 1,
    location: "club",
    careSessions: CARE_TO_RACING,
  });
  const starts = CLUB_SEASONED_STARTS[maturityType(genome)];
  const st: HorseState = {
    ...s,
    condition: { ...s.condition, fitness: CLUB_FITNESS },
    training: { ...s.training, realisation: clubRealisation() as HorseState["training"]["realisation"] },
    career: { ...s.career, starts },
    record: { ...s.record, starts },
  };
  const mark = abilityMark(st);
  return { ...st, rating: { or: mark, ratedRuns: starts, peakOr: mark } };
}

/** The ability mark a genome has as a minted Club horse (clubSeasonedState). */
export function clubMarkOf(genome: Genome): number {
  return clubSeasonedState(genome).rating.or;
}

/** The race a Club horse is minted or picked for (its trip and surface; either may be unknown). */
export interface ClubRaceFit {
  distanceM?: number;
  surface?: Surface | string;
}

/** True when the horse prefers the race's surface and its trip is within CLUB_TRIP_FIT_M (unknown conditions always fit). */
export function clubFitsRace(genome: Genome, race: ClubRaceFit): boolean {
  if (race.surface !== undefined && preferredSurface(genome) !== race.surface) return false;
  if (race.distanceM !== undefined && Math.abs(preferredDistanceM(genome) - race.distanceM) > CLUB_TRIP_FIT_M) return false;
  return true;
}

/** The lift (within ±CLUB_LIFT_MAX) that brings a genome's Club mark closest to `target` (the smaller lift on a tie). */
export function liftFor(genome: Genome, target: number): { lift: number; mark: number } {
  const markAt = (l: number) => clubMarkOf(liftGenome(genome, l));
  // The mark never falls as the lift rises: find the smallest lift whose mark reaches the target.
  let lo = -CLUB_LIFT_MAX;
  let hi = CLUB_LIFT_MAX;
  if (markAt(hi) < target) return { lift: hi, mark: markAt(hi) };
  if (markAt(lo) >= target) return { lift: lo, mark: markAt(lo) };
  while (hi - lo > 1) {
    const mid = lo + ((hi - lo) >> 1);
    if (markAt(mid) >= target) hi = mid;
    else lo = mid;
  }
  const up = markAt(hi);
  const down = markAt(lo);
  return target - down < up - target ? { lift: lo, mark: down } : { lift: hi, mark: up };
}

export interface ClubMintRequest extends ClubRaceFit {
  /** The race seed (every Club horse of a race is deterministic from it). */
  seed: string;
  /** Runner index within the race's mints. */
  index: number;
  /** Target ability mark. */
  target: number;
  /** The window the mark must stay inside (the race's Club window); a mark outside it is never accepted. */
  window?: { lo: number; hi: number };
  /** Competition season (the foundation mint's ceilings). */
  season?: number;
}

export interface ClubMint {
  genome: Genome;
  /** Its ability mark as a minted Club horse (the rating it is stored at). */
  mark: number;
  /** Tier the search started from. */
  rarity: Rarity;
  /** Potential points added to every stat locus (negative: taken off). */
  lift: number;
  /** Candidates tried. */
  tries: number;
  /** Whether it suits the race's trip and surface. */
  fits: boolean;
}

/** How far a genome is from suiting the race: 0 when it fits; a wrong surface outweighs any trip. */
export function clubFitMiss(genome: Genome, race: ClubRaceFit): number {
  const surface = race.surface !== undefined && preferredSurface(genome) !== race.surface ? 100_000 : 0;
  const trip = race.distanceM !== undefined ? Math.max(0, Math.abs(preferredDistanceM(genome) - race.distanceM) - CLUB_TRIP_FIT_M) : 0;
  return surface + trip;
}

/**
 * Mints the genome of an honest Club horse whose mark is `target`: tries seeded candidate
 * foundation genomes of the target's tier (CLUB_RARITY_BY_TARGET), skips those that don't suit
 * the race (clubFitsRace: few horses want 3,200 m or a turf sprint), lifts a fitting one to the
 * target (liftFor) and stops at the first within CLUB_MARK_TOLERANCE. After CLUB_MINT_SEARCH_CAP
 * candidates it settles for the closest (best fit first, then the closest mark). Deterministic in
 * (seed, index, target, season, race fit).
 */
export function mintClubGenome(req: ClubMintRequest): ClubMint {
  const target = clampInt(req.target, CLUB_MARK_MIN, CLUB_MARK_MAX);
  const rarity = clubRarityFor(target);
  const season = req.season ?? 1;
  let best: { g0: Genome; fitMiss: number; markMiss: number; lift: number; mark: number } | null = null;
  let tries = 0;
  for (let c = 0; c < CLUB_MINT_SEARCH_CAP; c++) {
    tries = c + 1;
    const g0 = generateFoundationGenome(seedFrom("club-runner", req.seed, req.index, c), { season, rarity, evenBreeds: true });
    const fitMiss = clubFitMiss(g0, req);
    // Only a candidate that suits the race at least as well as the best so far is worth lifting.
    if (best && fitMiss > best.fitMiss) continue;
    const { lift, mark } = liftFor(g0, target);
    // Outside the window counts as a big miss: never accepted, only kept as a last resort.
    const markMiss = Math.abs(mark - target) + (req.window && (mark < req.window.lo || mark > req.window.hi) ? 1000 : 0);
    if (!best || fitMiss < best.fitMiss || markMiss < best.markMiss) best = { g0, fitMiss, markMiss, lift, mark };
    if (fitMiss === 0 && markMiss <= CLUB_MARK_TOLERANCE) break;
  }
  const b = best!;
  return { genome: liftGenome(b.g0, b.lift), mark: b.mark, rarity, lift: b.lift, tries, fits: b.fitMiss === 0 };
}

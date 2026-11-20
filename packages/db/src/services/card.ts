/**
 * The Live race card (§4d): race meetings (game-core meetings.ts: MEETING_START_TIMES_UTC and
 * RACES_PER_MEETING are the two knobs; since 2026-11-01 eight a day, every three hours, of four
 * races 15 minutes apart) on the 15-minute slot grid (RULES.slotMs), published a day ahead from a
 * deterministic calendar, plus the tick that drives the card forward.
 *
 * Changing the schedule on a live database is safe: a race already published runs as published
 * (its slot key and post time are taken, so the new schedule never publishes over it or beside it
 * at the same time), new slots publish under the new schedule as they enter the horizon, and a
 * day that already has a claiming race published never gets a second one (live-races.test.ts,
 * "schedule change").
 *
 * Publishing is idempotent across serverless instances: each slot has a unique
 * `slot_key`, inserts use ON CONFLICT DO NOTHING, and the seed commitment is fixed by the
 * first insert (entries open at publication).
 *
 * Driving the card: call `tickRaceCard` lazily on reads (race list, race page) and from a
 * cron backstop (`GET /api/cron/race-card`, every minute, guarded by CRON_SECRET):
 *   1. publish the card slots of the next `cardHorizonMs` (meeting and calendar races);
 *   2. lock every field whose entries have closed (an ordinary race with no player runner is
 *      called off instead: lockField);
 *   3. return the races due for simulation + settlement; the web app runs the engine
 *      (getRaceForSimulation → simulateRace) and calls settleRace for each.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lt, lte, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { accounts, horses, raceEntries, races, stables, type RaceRow } from "../schema";
import { RULES, seasonNumberAt } from "../rules";
import { utcDay } from "../crypto";
import { bandRatingOf, gc, genomeOf } from "../gameCore";
import type { Db, Executor, Tx } from "../types";
import { runMaintenance, type MaintenanceReport } from "./maintenance";
import { claimingEligibleCount } from "./claiming";
import { applyPendingSponsorships, baseRaceName, pendingSponsorshipSlots, withoutSponsor } from "./sponsorship";
import { audit, runTx } from "./tx";
import { lockField, publicRace, raceValues, type CreateRaceInput, type FieldHooks, type PublicRace, type RaceConditions } from "./races";
import { noteRacesThatSuit } from "./notificationEvents";

export function slotIndexAt(at: Date): number {
  return Math.floor((at.getTime() - RULES.seasonEpochMs) / RULES.slotMs);
}

export function slotPostTime(index: number): Date {
  return new Date(RULES.seasonEpochMs + index * RULES.slotMs);
}

/**
 * Live card slot keys: `<prefix><index>`, sisters `<prefix><index>:<n>`. The prefix carries the slot
 * length because the index counts slots from the season epoch: production ran 3-minute slots keyed
 * `live:<index>` until 2026-10-30, and a 15-minute index reuses those numbers (races.slot_key is
 * unique), so a new slot length must get a new prefix.
 */
export const SLOT_KEY_PREFIX = `live${RULES.slotMs / 60_000}m:`;
export const slotKeyOf = (index: number): string => `${SLOT_KEY_PREFIX}${index}`;
const SLOT_KEY_RE = new RegExp(`^${SLOT_KEY_PREFIX}(\\d+)(?::\\d+)?$`);
/** Any Live card slot key, this slot length or an earlier one (`live:` = the old 3-minute card). */
export const LIVE_SLOT_KEY_RE = /^live(?:\d+m)?:\d+(?::\d+)?$/;
/** SQL LIKE pattern matching every Live card slot key, old and new. */
export const LIVE_SLOT_KEY_LIKE = "live%:%";

/** Slot index of a Live card slot key (sisters share the original's index); null for anything else. */
export function slotIndexOf(slotKey: string | null): number | null {
  const m = SLOT_KEY_RE.exec(slotKey ?? "");
  return m ? Number(m[1]!) : null;
}

interface ClassDef {
  raceClass: string;
  label: string;
  conditions: RaceConditions;
  purse: number;
}

// Purses halved 2026-10-29 (season harness: players spent only 46 of every 100 credits earned in
// play and purses were 69% of income; the economy model was balanced at about a third of the old
// live purses). Calendar purses below derive from these.
const MAIDEN: ClassDef = { raceClass: "maiden", label: "Maiden Stakes", conditions: { maxWins: 0, maxRating: 60 }, purse: 1_000 };
const NOVICE: ClassDef = { raceClass: "novice", label: "Novice Stakes", conditions: { maxWins: 2, maxRating: 70 }, purse: 1_250 };
const HCP_55: ClassDef = { raceClass: "handicap", label: "Handicap (0-55)", conditions: { minRating: 0, maxRating: 55 }, purse: 1_500 };
const HCP_75: ClassDef = { raceClass: "handicap", label: "Handicap (50-75)", conditions: { minRating: 50, maxRating: 75 }, purse: 2_000 };
const HCP_95: ClassDef = { raceClass: "handicap", label: "Handicap (70-95)", conditions: { minRating: 70, maxRating: 95 }, purse: 2_500 };
const LISTED: ClassDef = { raceClass: "listed", label: "Listed Stakes", conditions: { minRating: 85 }, purse: 4_000 };
const GROUP3: ClassDef = { raceClass: "graded", label: "Group 3", conditions: { minRating: 95 }, purse: 6_000 };
/** Hourly Features pay this multiple of their class purse. */
const FEATURE_PURSE_MULTIPLIER = 2;

/**
 * Calendar races, priced on the Live card's scale so each one pays more than anything on the
 * hourly card below it: a Feature Qualifier at least an hourly Listed Feature, the Weekend
 * Feature twice the richest hourly race (a Group 3 Feature), the Season Final three times.
 * (game-core's featureCalendar keeps its own tier-model purses; the card uses these.)
 */
export const CALENDAR_PURSE: Record<"feature_qualifier" | "weekend_feature" | "season_final", number> = {
  feature_qualifier: LISTED.purse * FEATURE_PURSE_MULTIPLIER,
  weekend_feature: GROUP3.purse * FEATURE_PURSE_MULTIPLIER * 2,
  season_final: GROUP3.purse * FEATURE_PURSE_MULTIPLIER * 3,
};

/**
 * Credit entry fee for a Live race (a sink that scales with racing, never with absence): a share
 * of the purse (CARD_ENTRY_FEE_PERMILLE), or game-core's fixed tier fee for the top classes when
 * that is higher.
 */
export const CARD_ENTRY_FEE_PERMILLE = 50;
export function cardEntryFee(raceClass: string, opts: { group1?: boolean; purse?: number } = {}): number {
  const share = Math.round(((opts.purse ?? 0) * CARD_ENTRY_FEE_PERMILLE) / 1000);
  const fixed = opts.group1 ? gc.ENTRY_FEE_BY_TIER.g1 : raceClass === "graded" ? gc.ENTRY_FEE_BY_TIER.g3 : raceClass === "listed" ? gc.ENTRY_FEE_BY_TIER.listed : 0;
  return Math.max(share, fixed);
}

/**
 * The card's class pattern: eight places (game-core CARD_PATTERN_RACES), taken in turn by the
 * meeting races of all time (game-core cardPatternPlace: the k-th meeting race takes place
 * k mod 8, whatever the meetings' size), so every day runs the whole mix a whole number of times
 * (four times with 32 races) and the 19:00 meeting's first race is always place 1:
 *
 *   place 1     the top race: a Feature (Listed or Group 3, double purse) in even-numbered runs
 *               of the pattern, a Listed race in odd ones. A calendar race (Qualifier, Weekend
 *               Feature) takes this place at 19:00.
 *   2, 4, 6, 8  juvenile races (maidens and novices: every new horse can run them), two of each;
 *               which are maidens alternates from one run of the pattern to the next, so maidens
 *               run every trip.
 *   3, 5, 7     the three handicap bands (0-55, 50-75, 70-95). One handicap a day is the
 *               claiming-race candidate (claimingSlotOfDay); it is published as the claiming race
 *               only when enough horses could enter one today (CLAIMING_MIN_ELIGIBLE, decided once
 *               at publication: ensureRaceCard). The Saturday Plate takes place 3 (19:30). The
 *               Season Finals have slots of their own in the Finals meeting. Calendar races never
 *               land on a juvenile race (tested), so no trip or surface ever drops out.
 */
type MeetingPlace = "top" | "juvenile" | ClassDef;
const MEETING_CLASSES: readonly MeetingPlace[] = ["top", "juvenile", HCP_55, "juvenile", HCP_75, "juvenile", HCP_95, "juvenile"];
/** Juvenile races per run of the pattern (4): the k-th juvenile race runs surface k mod 3, trip k mod 4. */
const JUVENILE_PER_MEETING = MEETING_CLASSES.filter((x) => x === "juvenile").length;
if (MEETING_CLASSES.length !== gc.CARD_PATTERN_RACES) throw new Error("the card's class pattern must have game-core CARD_PATTERN_RACES places");

/** The six courses (game-core courses.ts) in card order: sisters take the next one that races the surface. */
const TRACKS = gc.COURSES.map((c) => c.name);
const SURFACES = ["turf", "dirt", "synthetic"] as const;
type CardSurface = (typeof SURFACES)[number];
/**
 * Juvenile-slot trips, one per distance zone. Every trip a horse can prefer (1,000–2,900 m for
 * starters and pack foals) is within about 450 m below or 130 m above one of these, which keeps
 * the form-guide fit at grade C or better. Sprint is 1,000 m since genetics v2: MSTN C/C (most QHs) want 200 m less.
 */
const JUVENILE_TRIPS = [1000, 1500, 2000, 2400];
/** Older horses' races use the whole range, including the long trips bred stayers want. */
const OPEN_TRIPS = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2800, 3200];

const SEASON_CLOCK = { epochMs: RULES.seasonEpochMs };

/** Courses that race this surface on the day of `postTimeMs` (turf stopped by frost is not). */
export function coursesRacing(surface: CardSurface, postTimeMs: number): gc.Course[] {
  return gc.coursesFor(surface).filter((c) => !(surface === "turf" && gc.turfAbandoned(SEASON_CLOCK, c.id, postTimeMs)));
}

/**
 * Where a card race runs (game-core climate.ts): a course that races `surface` that day, the
 * `preferred` one when it can, else one picked by `roll` (a slot-hash byte). Frost can stop the
 * turf at every course at once (rare); the race then moves to the all-weather (synthetic), as
 * British racing does. Going and weather are that course's on the race day, so they always agree
 * (never rain on firm ground).
 */
export function placeRace(surface: CardSurface, postTimeMs: number, roll: number, preferred?: string): { track: string; surface: CardSurface; going: string; weather: string } {
  let options = coursesRacing(surface, postTimeMs);
  if (!options.length) {
    surface = "synthetic";
    options = coursesRacing(surface, postTimeMs);
  }
  const course = options.find((c) => c.name === preferred) ?? options[roll % options.length]!;
  const ground = gc.raceGround(SEASON_CLOCK, course.id, surface, postTimeMs);
  return { track: course.name, surface, going: ground.going, weather: ground.weather };
}
const calendarCache = new Map<number, Map<number, gc.RaceSlot>>();

/**
 * The season's special races (game-core `featureCalendar`) by card slot index: the Weekend
 * Feature (Saturday 19:00 UTC), its weekday Feature Qualifiers (19:00 UTC) and the four Season
 * Final championships on the last day. Each takes over the slot it falls in.
 */
export function specialSlotAt(index: number): gc.RaceSlot | null {
  const season = seasonNumberAt(slotPostTime(index));
  let bySlot = calendarCache.get(season);
  if (!bySlot) {
    bySlot = new Map(gc.featureCalendar(SEASON_CLOCK, season).map((r) => [Math.floor((r.postTimeMs - RULES.seasonEpochMs) / RULES.slotMs), r]));
    calendarCache.set(season, bySlot);
  }
  return bySlot.get(index) ?? null;
}

/**
 * Home course of each calendar race: the Weekend Feature, its Plate and the Season Finals run at
 * Ashcombe, the Feature Qualifiers at Bellmont. Frost on the turf there moves the race to
 * another course that day (placeRace).
 */
export const CALENDAR_HOME_COURSE: Record<"feature_qualifier" | "weekend_feature" | "weekend_plate" | "season_final", string> = {
  feature_qualifier: "Bellmont",
  weekend_feature: "Ashcombe",
  weekend_plate: "Ashcombe",
  season_final: "Ashcombe",
};

/** The Saturday Plate runs this many slots after the Weekend Feature (30 minutes; game-core). */
export const PLATE_AFTER_SLOTS = gc.PLATE_AFTER_SLOTS;

/**
 * The Saturday Plate (beta loop, from the research: Umamusume's Final B, Hattrick's lucky
 * losers): a Listed consolation race after the Weekend Feature for horses that ran in that
 * week's Feature Qualifiers but did not qualify. Returns the Weekend Feature it follows.
 */
export function plateSlotAt(index: number): gc.RaceSlot | null {
  const wf = specialSlotAt(index - PLATE_AFTER_SLOTS);
  return wf && wf.kind === "weekend_feature" && !specialSlotAt(index) ? wf : null;
}

/** A calendar race (special or Plate) takes over this slot (not for sale to sponsors either). */
export const isCalendarSlot = (index: number) => specialSlotAt(index) !== null || plateSlotAt(index) !== null;

function plateCardSlot(index: number, wf: gc.RaceSlot): CreateRaceInput {
  const postTime = slotPostTime(index);
  const place = placeRace(wf.surface, postTime.getTime(), index, CALENDAR_HOME_COURSE.weekend_plate);
  const division = wf.division ?? "mile";
  return {
    kind: "scheduled",
    name: `${place.track} Saturday Plate (${division})`,
    raceClass: "listed",
    conditions: {
      distanceM: wf.distanceM,
      surface: place.surface,
      going: place.going,
      weather: place.weather,
      track: place.track,
      calendar: { id: `${wf.id}-plate`, kind: "weekend_plate", division: wf.division },
    },
    postTime,
    entriesCloseAt: new Date(postTime.getTime() - RULES.entriesCloseBeforePostMs),
    purse: CALENDAR_PURSE.feature_qualifier,
    entryFee: cardEntryFee("listed", { purse: CALENDAR_PURSE.feature_qualifier }),
    maxRunners: RULES.maxField,
    targetRunners: RULES.maxField,
    seasonNumber: wf.season,
    slotKey: slotKeyOf(index),
  };
}

function specialCardSlot(index: number, sp: gc.RaceSlot): CreateRaceInput {
  const postTime = slotPostTime(index);
  const final = sp.kind === "season_final";
  const weekend = sp.kind === "weekend_feature";
  const home = CALENDAR_HOME_COURSE[final ? "season_final" : weekend ? "weekend_feature" : "feature_qualifier"];
  const place = placeRace(sp.surface, postTime.getTime(), index, home);
  return {
    kind: final ? "final" : weekend ? "feature" : "scheduled",
    name: `${place.track} ${sp.name}`,
    raceClass: final || weekend ? "graded" : "listed",
    conditions: {
      // The Weekend Feature's gate is qualifying (a top 3 in a qualifier, or rating 100+), not a
      // rating floor: a horse rated 85-94 that places in a qualifier must be able to run.
      // Qualifiers are open to every rating (the harness found no player rated 85+ within a
      // season); a top 3 is the test. Only the Season Final keeps a floor.
      ...(final ? { minRating: gc.SEASON_FINAL_MIN_RATING } : {}),
      distanceM: sp.distanceM,
      surface: place.surface,
      going: place.going,
      weather: place.weather,
      track: place.track,
      calendar: { id: sp.id, kind: sp.kind, division: sp.division },
    },
    postTime,
    entriesCloseAt: new Date(postTime.getTime() - RULES.entriesCloseBeforePostMs),
    purse: sp.kind === "season_final" || sp.kind === "weekend_feature" || sp.kind === "feature_qualifier" ? CALENDAR_PURSE[sp.kind] : sp.purse,
    entryFee: cardEntryFee(final || weekend ? "graded" : "listed", { group1: final || weekend, purse: sp.kind === "season_final" || sp.kind === "weekend_feature" || sp.kind === "feature_qualifier" ? CALENDAR_PURSE[sp.kind] : sp.purse }),
    maxRunners: Math.min(16, sp.maxRunners),
    targetRunners: RULES.maxField,
    seasonNumber: sp.season,
    slotKey: slotKeyOf(index),
  };
}

/** The meeting race in this slot (game-core meetings.ts), or null between meetings. */
export function meetingRaceOf(index: number): gc.MeetingRace | null {
  return gc.meetingRaceAt(SEASON_CLOCK, slotPostTime(index).getTime());
}

/** Pattern places of the three handicap bands (0-55, 50-75, 70-95), in band order. */
const HANDICAP_PLACES: readonly number[] = MEETING_CLASSES.flatMap((p, i) => (typeof p === "object" && p.raceClass === "handicap" ? [i] : []));

/** A meeting race's place in the class pattern (game-core cardPatternPlace). */
export const patternPlaceOf = (m: gc.MeetingRace): number => gc.cardPatternPlace(m).place;

/** The class definition of a handicap meeting race (null for any other place). */
function handicapDefOf(m: gc.MeetingRace): ClassDef | null {
  const place = MEETING_CLASSES[patternPlaceOf(m)];
  return typeof place === "object" && place.raceClass === "handicap" ? place : null;
}

const claimingCache = new Map<number, number | null>();

/**
 * The claiming race's candidate slot on a UTC day (game-core claiming.ts): the day's last
 * handicap place in the band of the day (claimingBandOrder from the UTC day, so the band
 * rotates); when a calendar race holds that slot (the Saturday Plate) the next band takes over.
 * With the card's pattern the bands' last handicaps run in the evening meetings (UTC). Null
 * when every band's last handicap is a calendar race. Whether the candidate is actually published as the
 * claiming race is a separate, once-at-publication decision (enough eligible horses today,
 * game-core CLAIMING_MIN_ELIGIBLE; see ensureRaceCard).
 */
export function claimingSlotOfDay(dayMs: number): number | null {
  const day = Math.floor(dayMs / 86_400_000);
  if (claimingCache.has(day)) return claimingCache.get(day)!;
  // the day's last handicap place of each band (a Season Final has no place)
  const lastOfBand = new Map<number, number>();
  for (const m of gc.meetingsOn(SEASON_CLOCK, day * 86_400_000)) {
    for (let r = 0; r < m.races; r++) {
      if (gc.isSeasonFinalRace({ ...m, race: r })) continue;
      const index = slotIndexAt(new Date(m.startMs + r * m.spacingMs));
      const band = HANDICAP_PLACES.indexOf(patternPlaceOf({ ...m, race: r }));
      if (band >= 0) lastOfBand.set(band, index);
    }
  }
  let out: number | null = null;
  for (const band of gc.claimingBandOrder(day)) {
    const latest = lastOfBand.get(band);
    if (latest !== undefined && !isCalendarSlot(latest)) {
      out = latest;
      break;
    }
  }
  claimingCache.set(day, out);
  return out;
}

/** This slot is the day's claiming-race candidate (a handicap, see claimingSlotOfDay). */
export function isClaimingSlot(index: number): boolean {
  const m = meetingRaceOf(index);
  return !!m && handicapDefOf(m) !== null && claimingSlotOfDay(slotPostTime(index).getTime()) === index;
}

/**
 * A Live race runs in this slot: a meeting race, or a calendar race (which always sits inside
 * a meeting: the 19:00 one, or the Finals meeting). Every other slot of the 15-minute grid stays
 * empty.
 */
export const isCardSlot = (index: number): boolean => meetingRaceOf(index) !== null || isCalendarSlot(index);

/**
 * Deterministic conditions for a card slot (a meeting race or a calendar race; throws for a
 * slot between meetings: use `cardSlotAt` or check `isCardSlot` first).
 *
 * Juvenile races cycle through every (surface, trip zone) pair: the k-th juvenile race (four in
 * each run of the class pattern, k counted over all time) runs on surface k mod 3 at trip zone
 * k mod 4, so any 12 consecutive juvenile races cover all 12 pairs, on good or firm ground. Every
 * horse that can run maidens or novices therefore finds a race that suits its surface and trip
 * within a day's card, which is always published (RULES.cardHorizonMs; tested in the web app
 * with the form-guide rating). The other classes draw surface (all three, synthetic included)
 * and trip (1,000–3,200 m) from the slot hash. Every race's course is one that races its
 * surface that day, and its going and weather are that course's on the race day (game-core
 * climate.ts, via placeRace): the time of year shows on the card. Calendar races (Weekend Feature,
 * Qualifiers, the Saturday Plate, Season Finals) take over their slots (`specialSlotAt`,
 * `plateSlotAt`); they only ever land on a meeting's top race or a handicap.
 *
 * `opts.claiming` (default true) is the once-at-publication decision that the day's claiming-race
 * candidate slot really is the claiming race (ensureRaceCard); pure callers that don't pass it
 * keep the old always-claiming answer.
 */
export function defaultCardSlot(index: number, opts: { claiming?: boolean } = {}): CreateRaceInput {
  const sp = specialSlotAt(index);
  if (sp) return specialCardSlot(index, sp);
  const plate = plateSlotAt(index);
  if (plate) return plateCardSlot(index, plate);
  const meeting = meetingRaceOf(index);
  if (!meeting) throw new Error(`card slot ${index} is between race meetings: no race runs then`);
  const h = createHash("sha256").update(`card-slot:${index}`).digest();
  let byte = 0;
  const pick = <T>(xs: readonly T[]): T => xs[h[byte++]! % xs.length]!;
  const postTime = slotPostTime(index);
  // The class pattern runs over the meeting races of all time (block: whole runs of the pattern).
  const { block: m, place: pos } = gc.cardPatternPlace(meeting);
  const place = MEETING_CLASSES[pos]!;
  const feature = place === "top" && m % 2 === 0;
  let def: ClassDef;
  let conditions: RaceConditions;
  if (place === "juvenile") {
    const j = MEETING_CLASSES.slice(0, pos).filter((x) => x === "juvenile").length;
    const k = m * JUVENILE_PER_MEETING + j;
    def = (j + m) % 2 === 0 ? MAIDEN : NOVICE;
    const where = placeRace(SURFACES[((k % 3) + 3) % 3]!, postTime.getTime(), h[byte++]!);
    conditions = {
      ...def.conditions,
      distanceM: JUVENILE_TRIPS[((k % 4) + 4) % 4]!,
      surface: where.surface,
      going: where.going,
      weather: where.weather,
      track: where.track,
    };
  } else {
    def = place === "top" ? (feature ? (h[30]! % 2 === 0 ? LISTED : GROUP3) : LISTED) : place;
    const distanceM = pick(OPEN_TRIPS);
    const where = placeRace(SURFACES[(((m * 8 + pos + (h[28]! % 3)) % 3) + 3) % 3]!, postTime.getTime(), h[byte++]!);
    // The day's claiming race: that handicap band's conditions, trip and course, renamed.
    if (place !== "top" && (opts.claiming ?? true) && isClaimingSlot(index)) def = { ...def, label: `Claiming Stakes (${def.label.replace(/^Handicap \((.*)\)$/, "$1")})` };
    conditions = {
      ...def.conditions,
      ...(def.label.startsWith("Claiming") ? { claiming: true } : {}),
      distanceM,
      surface: where.surface,
      going: where.going,
      weather: where.weather,
      track: where.track,
    };
  }
  return {
    kind: feature ? "feature" : "scheduled",
    name: `${conditions.track} ${feature ? "Feature " : ""}${def.label}`,
    raceClass: def.raceClass,
    conditions,
    postTime,
    entriesCloseAt: new Date(postTime.getTime() - RULES.entriesCloseBeforePostMs),
    purse: feature ? def.purse * FEATURE_PURSE_MULTIPLIER : def.purse,
    entryFee: cardEntryFee(def.raceClass, { purse: feature ? def.purse * FEATURE_PURSE_MULTIPLIER : def.purse }),
    maxRunners: RULES.maxField,
    targetRunners: RULES.minField + (h[29]! % (RULES.maxField - RULES.minField + 1)),
    seasonNumber: seasonNumberAt(postTime),
    slotKey: slotKeyOf(index),
  };
}

/** The race a slot publishes, or null for a slot between meetings (see defaultCardSlot's opts). */
export function cardSlotAt(index: number, opts: { claiming?: boolean } = {}): CreateRaceInput | null {
  return isCardSlot(index) ? defaultCardSlot(index, opts) : null;
}

/**
 * How a meeting's ordinary races are chosen.
 *   "demand" (the default): from the horses that exist (game-core cardPlan.ts), decided once when
 *            the meeting is published and stored as its race rows.
 *   "fixed": every slot of every meeting from the class pattern above (the card until 2026-11-20).
 * LIVE_CARD_PLAN=fixed in the environment switches a deployment back to the fixed card at once:
 * races already published run as published, and every empty slot inside the horizon is filled
 * from the pattern on the next tick.
 */
export type CardPlanMode = "demand" | "fixed";

export function cardPlanMode(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): CardPlanMode {
  return env.LIVE_CARD_PLAN === "fixed" ? "fixed" : "demand";
}

export interface CardHooks extends FieldHooks {
  /** Conditions for a slot, null for no race (defaults to cardSlotAt: meetings and calendar races). Implies the fixed card. */
  cardSlot?(index: number): CreateRaceInput | null;
  /** Overrides cardPlanMode() (tests). */
  plan?: CardPlanMode;
}

/** A claiming race is already published on the UTC day of `at` (any slot, any schedule). */
async function claimingRaceOnDay(db: Executor, at: Date): Promise<boolean> {
  const day = Math.floor(at.getTime() / 86_400_000) * 86_400_000;
  const [row] = await db
    .select({ id: races.id })
    .from(races)
    .where(and(gte(races.postTime, new Date(day)), lt(races.postTime, new Date(day + 86_400_000)), like(races.slotKey, LIVE_SLOT_KEY_LIKE), sql`(${races.conditions}->>'claiming') = 'true'`))
    .limit(1);
  return !!row;
}

/**
 * Whether the day's claiming-race candidate slot `index` is published as the claiming race: once
 * per candidate slot, at publication (not on re-reads). Only when no claiming race is on that day
 * yet (e.g. one published under the schedule before a change) and enough horses could enter one
 * today (game-core CLAIMING_MIN_ELIGIBLE); otherwise the slot is an ordinary race. The kind lives
 * on the published race row from then on, so it never flips.
 */
async function claimingDecision(ex: Executor, index: number, now: Date): Promise<boolean> {
  const band = handicapDefOf(meetingRaceOf(index)!)!;
  if (await claimingRaceOnDay(ex, slotPostTime(index))) return false;
  return (await claimingEligibleCount(ex, { minRating: band.conditions.minRating, maxRating: band.conditions.maxRating, now })) >= gc.CLAIMING_MIN_ELIGIBLE;
}

// ---------------------------------------------------------------------------
// The demand-aware card (game-core cardPlan.ts)
// ---------------------------------------------------------------------------

/**
 * Stored on every race the demand-aware card publishes (`conditions.card`): why the race is on
 * the card. "demand" and "cover" races are the meeting's plan; "sponsor" and "claiming" are races
 * the pattern fixed in their slot (a sponsor bought that race; the day's claiming race). A meeting
 * with a marked race is planned: its other slots stay empty (marked races are only ever published
 * with the plan, or into a meeting that has one). `stables` is how many active stables had a horse
 * for it when it was published.
 */
export interface CardMark {
  plan: number;
  reason: "demand" | "cover" | "sponsor" | "claiming";
  stables?: number;
}
export const CARD_PLAN_VERSION = 1;

export function cardMarkOf(race: Pick<RaceRow, "conditions">): CardMark | null {
  const m = ((race.conditions ?? {}) as RaceConditions).card as CardMark | undefined;
  return m && typeof m === "object" && typeof m.reason === "string" ? m : null;
}

/** The classes the demand-aware card can publish, in card order (ties and turns follow it). */
interface PlanClass {
  key: string;
  def: ClassDef;
  tier: gc.RaceTier;
  trips: readonly number[];
  /** A class every new horse can enter. */
  starter?: boolean;
  /** Run as a Feature (double purse): in even-numbered meetings, or always. */
  feature?: "even" | "always";
}
const PLAN_CLASSES: readonly PlanClass[] = [
  { key: "maiden", def: MAIDEN, tier: "maiden", trips: JUVENILE_TRIPS, starter: true },
  { key: "novice", def: NOVICE, tier: "novice", trips: JUVENILE_TRIPS, starter: true },
  { key: "hcp55", def: HCP_55, tier: "hcp_0_55", trips: OPEN_TRIPS, starter: true },
  { key: "hcp75", def: HCP_75, tier: "hcp_50_75", trips: OPEN_TRIPS },
  { key: "hcp95", def: HCP_95, tier: "hcp_70_95", trips: OPEN_TRIPS },
  { key: "listed", def: LISTED, tier: "listed", trips: OPEN_TRIPS, feature: "even" },
  { key: "group3", def: GROUP3, tier: "g3", trips: OPEN_TRIPS, feature: "always" },
];
const isFeature = (c: PlanClass, meeting: number) => c.feature === "always" || (c.feature === "even" && meeting % 2 === 0);

/** The plan's options: each class with its conditions and the licence it needs. */
export function cardPlanOptions(meeting: number): gc.CardOption[] {
  return PLAN_CLASSES.map((c) => ({
    key: c.key,
    maxWins: c.def.conditions.maxWins,
    minRating: c.def.conditions.minRating,
    maxRating: c.def.conditions.maxRating,
    licence: gc.licenceForTier(c.tier, isFeature(c, meeting)),
    trips: c.trips,
    starter: c.starter,
  }));
}

/** The conditions the plan checks, read back from a published race (class, band and licence). */
function planConditionsOf(r: Pick<RaceRow, "kind" | "raceClass" | "conditions">): gc.FixedCardRace {
  const c = (r.conditions ?? {}) as RaceConditions;
  const max = c.maxRating ?? 140;
  const tier: gc.RaceTier =
    r.raceClass === "maiden" ? "maiden" : r.raceClass === "novice" ? "novice" : r.raceClass === "listed" ? "listed" : r.raceClass === "graded" ? "g3" : max <= 55 ? "hcp_0_55" : max <= 75 ? "hcp_50_75" : "hcp_70_95";
  return { maxWins: c.maxWins, minRating: c.minRating, maxRating: c.maxRating, licence: gc.licenceForTier(tier, r.kind === "feature"), distanceM: Number(c.distanceM ?? 0) };
}

/** A planned race as the row to publish in card slot `index` (course, going and weather as every card race: placeRace). */
export function plannedCardSlot(index: number, meeting: number, p: gc.PlannedRace): CreateRaceInput {
  const c = PLAN_CLASSES.find((x) => x.key === p.key);
  if (!c) throw new Error(`card plan: unknown class ${p.key}`);
  const h = createHash("sha256").update(`card-slot:${index}`).digest();
  const postTime = slotPostTime(index);
  const feature = isFeature(c, meeting);
  const where = placeRace(p.surface, postTime.getTime(), h[1]!);
  const purse = feature ? c.def.purse * FEATURE_PURSE_MULTIPLIER : c.def.purse;
  const mark: CardMark = { plan: CARD_PLAN_VERSION, reason: p.reason, stables: p.eligibleStables };
  return {
    kind: feature ? "feature" : "scheduled",
    name: `${where.track} ${feature ? "Feature " : ""}${c.def.label}`,
    raceClass: c.def.raceClass,
    conditions: { ...c.def.conditions, distanceM: p.distanceM, surface: where.surface, going: where.going, weather: where.weather, track: where.track, card: mark },
    postTime,
    entriesCloseAt: new Date(postTime.getTime() - RULES.entriesCloseBeforePostMs),
    purse,
    entryFee: cardEntryFee(c.def.raceClass, { purse }),
    maxRunners: RULES.maxField,
    targetRunners: RULES.minField + (h[29]! % (RULES.maxField - RULES.minField + 1)),
    seasonNumber: seasonNumberAt(postTime),
    slotKey: slotKeyOf(index),
  };
}

/** The pattern's race for a slot the plan must keep as it is (a sponsor bought it; the claiming race), marked. */
function fixedCardSlot(index: number, reason: "sponsor" | "claiming", claiming: boolean): CreateRaceInput {
  const input = defaultCardSlot(index, { claiming });
  return { ...input, conditions: { ...input.conditions, card: { plan: CARD_PLAN_VERSION, reason } satisfies CardMark } };
}

/** A meeting's ordinary slots (card slot indices, in order): its races that are not calendar races. */
export function ordinarySlotsOf(m: gc.Meeting): number[] {
  const out: number[] = [];
  for (let r = 0; r < m.races; r++) {
    const index = slotIndexAt(new Date(m.startMs + r * m.spacingMs));
    if (!isCalendarSlot(index)) out.push(index);
  }
  return out;
}

/**
 * The player horses the card is planned for: racing horses that can race by `at`, kept by a
 * stable whose account was seen, founded or played in the last gc.CARD_DEMAND_ACTIVE_MS. The most
 * recently seen stables first, at most gc.CARD_DEMAND_READ_LIMIT horses (a world beyond that fills
 * the whole card anyway).
 */
export async function cardDemand(ex: Executor, now: Date, at: Date = now): Promise<gc.DemandHorse[]> {
  const since = new Date(now.getTime() - gc.CARD_DEMAND_ACTIVE_MS);
  const rows = await ex
    .select({ horse: horses, stableId: stables.id, licence: stables.licenceLevel })
    .from(horses)
    .innerJoin(stables, sql`${stables.id} = coalesce(${horses.lesseeStableId}, ${horses.ownerStableId})`)
    .innerJoin(accounts, eq(accounts.id, stables.accountId))
    .where(
      and(
        eq(horses.careerStatus, "racing"),
        gte(horses.careSessions, RULES.careToRacing),
        lt(horses.starts, RULES.maxStarts),
        isNull(horses.releasedAt),
        eq(accounts.isSystem, false),
        or(isNull(horses.injuredUntil), lte(horses.injuredUntil, at)),
        or(
          gte(accounts.lastSeenAt, since),
          gte(accounts.createdAt, since),
          sql`exists (select 1 from account_play_days d where d.account_id = ${accounts.id} and d.day >= ${utcDay(since)})`,
        ),
      ),
    )
    .orderBy(desc(accounts.lastSeenAt), asc(horses.id))
    .limit(gc.CARD_DEMAND_READ_LIMIT);
  const out: gc.DemandHorse[] = [];
  for (const r of rows) {
    const g = genomeOf(r.horse.genome);
    if (!g) continue;
    out.push({
      stable: r.stableId,
      wins: r.horse.wins,
      rating: r.horse.rating,
      bandRating: bandRatingOf(r.horse).rating,
      licence: r.licence,
      distanceM: gc.preferredDistanceM(g),
      surface: gc.preferredSurface(g),
    });
  }
  return out;
}

/** Player entries in a meeting's ordinary races (sister courses included; a called-off race has none). */
async function meetingPlayerEntries(ex: Executor, m: gc.Meeting): Promise<number> {
  const keys = ordinarySlotsOf(m).flatMap((i) => [slotKeyOf(i), ...Array.from({ length: SISTER_MAX }, (_, n) => `${slotKeyOf(i)}:${n + 2}`)]);
  if (!keys.length) return 0;
  const [row] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(inArray(races.slotKey, keys), eq(raceEntries.status, "entered"), isNotNull(raceEntries.stableId)));
  return Number(row?.n ?? 0);
}

/**
 * The player entries a meeting can expect: what the same meeting of the day drew one and two
 * days before it (the one a day before is at its first post time when this one is published, so
 * its entries are nearly all in). Growth counts at once, a quiet day only by half.
 */
export async function expectedMeetingEntries(ex: Executor, m: gc.Meeting): Promise<number> {
  const before = (days: number) => gc.meetingsOn(SEASON_CLOCK, m.startMs - days * 86_400_000)[m.ofDay];
  const [d1, d2] = [before(1), before(2)];
  const e1 = d1 ? await meetingPlayerEntries(ex, d1) : 0;
  const e2 = d2 ? await meetingPlayerEntries(ex, d2) : 0;
  return Math.max(e1, Math.floor((e1 + e2 + 1) / 2));
}

/** Serialises the planning of one meeting across instances (transaction-scoped advisory lock). */
async function lockMeeting(tx: Tx, meeting: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`card-meeting:${meeting}`}))`);
}

/**
 * Plans and publishes one meeting's ordinary races, exactly once: under the meeting's advisory
 * lock it re-reads the meeting, and does nothing when it holds a race already (another instance
 * planned it, or races of the fixed card: those meetings are completed from the pattern). Otherwise it
 * reads the demand, runs game-core planMeeting and inserts the races into the meeting's earliest
 * free slots (ON CONFLICT DO NOTHING on the slot key, as everywhere; each row's seed commitment is
 * fixed by this insert). `forced` slots (a sponsor bought that race; the day's claiming race, when
 * `claimingAt` says so) are published from the pattern in the same transaction and count as races
 * the meeting already has. Returns the slot keys it inserted.
 */
async function planMeetingTx(db: Db, m: gc.Meeting, input: { now: Date; first: number; taken: ReadonlySet<number>; sponsored: ReadonlySet<number> }): Promise<string[]> {
  const { now, first } = input;
  const slots = ordinarySlotsOf(m);
  return runTx(db, async (tx) => {
    await lockMeeting(tx, m.number);
    const existing = await tx.select().from(races).where(inArray(races.slotKey, slots.map(slotKeyOf)));
    if (existing.length) return [];
    const open = slots.filter((i) => i >= first && !input.taken.has(slotPostTime(i).getTime()));
    // Slots the pattern fixes: a sponsor's race, and the day's claiming race when it is on.
    const forced: CreateRaceInput[] = [];
    for (const i of open) {
      const claiming = isClaimingSlot(i) ? await claimingDecision(tx, i, now) : false;
      if (input.sponsored.has(i)) forced.push(fixedCardSlot(i, "sponsor", claiming));
      else if (claiming) forced.push(fixedCardSlot(i, "claiming", true));
    }
    const forcedKeys = new Set(forced.map((f) => f.slotKey));
    const free = open.filter((i) => !forcedKeys.has(slotKeyOf(i)));
    const rows = forced.map((f) => raceValues(f));
    if (free.length) {
      const before = gc.meetingOf(SEASON_CLOCK, m.startMs - 1);
      const previous = before.number === m.number ? [] : await tx.select().from(races).where(inArray(races.slotKey, ordinarySlotsOf(before).map(slotKeyOf)));
      const countsAsRace = (r: Pick<RaceRow, "conditions">) => !((r.conditions ?? {}) as RaceConditions).claiming; // a claiming race puts the horse up for sale
      const plan = gc.planMeeting({
        meeting: m.number,
        slots: free.length,
        horses: await cardDemand(tx, now, new Date(m.startMs)),
        recentEntries: await expectedMeetingEntries(tx, m),
        options: cardPlanOptions(m.number),
        fixed: forced.map((f) => ({ kind: f.kind, raceClass: f.raceClass, conditions: f.conditions })).filter(countsAsRace).map(planConditionsOf),
        previous: previous.filter(countsAsRace).map(planConditionsOf),
      });
      plan.forEach((p, j) => rows.push(raceValues(plannedCardSlot(free[j]!, m.number, p))));
    }
    if (!rows.length) return [];
    const inserted = await tx.insert(races).values(rows).onConflictDoNothing({ target: races.slotKey }).returning({ slotKey: races.slotKey });
    return inserted.map((r) => r.slotKey!);
  });
}

/**
 * Calendar races (Feature Qualifiers, the Weekend Feature, the Plate, Season Finals) publish on
 * the same day-ahead horizon as the meetings (they did before the meetings, when the rest of
 * the card was 6 h ahead). Kept as its own name for the callers that mean calendar races.
 */
export const CALENDAR_HORIZON_MS = RULES.cardHorizonMs;

/**
 * Publishes the card from now to now + horizon (idempotent) and returns the open card.
 *
 * Calendar races publish slot by slot as they enter the horizon. A meeting's ordinary races
 * publish together, when its first slot enters the horizon (cardPlanMode "demand", the default):
 * planMeetingTx decides them from the horses that exist, once, and the meeting's other slots stay
 * empty. A meeting that already holds races of the fixed card (published before the switch to
 * the demand-aware card, or while LIVE_CARD_PLAN=fixed) is completed from the pattern, slot by
 * slot, as before. With cardPlanMode "fixed" (or a `cardSlot` hook) every slot is.
 *
 * Cheap on the steady state: one read of the published card and one of the pending
 * sponsorships; only what is missing is built and inserted (ON CONFLICT DO NOTHING keeps
 * concurrent instances safe; a meeting's plan also takes the meeting's advisory lock).
 */
export async function ensureRaceCard(db: Db, now: Date, hooks: CardHooks = {}, horizonMs = RULES.cardHorizonMs): Promise<PublicRace[]> {
  const first = slotIndexAt(now) + 1;
  const last = slotIndexAt(new Date(now.getTime() + horizonMs));
  const horizonEnd = new Date(now.getTime() + horizonMs);
  const mode: CardPlanMode = hooks.cardSlot ? "fixed" : (hooks.plan ?? cardPlanMode());
  // Demand-aware card: the meetings with a slot inside the horizon, and their ordinary slots.
  const meetings = new Map<number, { meeting: gc.Meeting; slots: number[] }>();
  if (mode === "demand") {
    for (let i = first; i <= last; i++) {
      const m = meetingRaceOf(i);
      if (m && !meetings.has(m.number)) meetings.set(m.number, { meeting: m, slots: ordinarySlotsOf(m) });
    }
  }
  const meetingKeys = [...meetings.values()].flatMap((m) => m.slots.map(slotKeyOf));
  // The card inside the horizon, plus every race of those meetings wherever its post time is now
  // (a meeting's later slots lie just beyond the horizon; a race that started early has moved).
  const inHorizon = and(gte(races.postTime, now), lte(races.postTime, horizonEnd));
  const readCard = () =>
    db
      .select()
      .from(races)
      .where(and(like(races.slotKey, LIVE_SLOT_KEY_LIKE), meetingKeys.length ? or(inHorizon, inArray(races.slotKey, meetingKeys)) : inHorizon))
      .orderBy(asc(races.postTime), asc(races.slotKey)); // slotKey: sisters right after their original
  const onCard = (r: RaceRow) => r.postTime >= now && r.postTime <= horizonEnd;
  let all = await readCard();
  const published = new Set(all.map((r) => r.slotKey));
  // a post time that already has a card race (e.g. one published under an older slot length) is taken
  const taken = new Set(all.filter((r) => !/:\d+:\d+$/.test(r.slotKey ?? "")).map((r) => r.postTime.getTime()));
  const free = (i: number) => i >= first && !published.has(slotKeyOf(i)) && !taken.has(slotPostTime(i).getTime());

  // Which meetings the plan owns: all but those holding races of the fixed card.
  const byKey = new Map(all.map((r) => [r.slotKey, r]));
  const planSlots = new Set<number>();
  const planMeetings = new Set<number>();
  const toPlan: gc.Meeting[] = [];
  for (const { meeting, slots } of meetings.values()) {
    const rowsIn = slots.map((i) => byKey.get(slotKeyOf(i))).filter((r): r is RaceRow => !!r);
    if (rowsIn.some((r) => !cardMarkOf(r))) continue; // a meeting of the fixed card: completed from the pattern below
    for (const i of slots) planSlots.add(i);
    planMeetings.add(meeting.number);
    if (!rowsIn.length && slots.some(free)) toPlan.push(meeting);
  }
  // Sponsorships bought before their slot was on the card (one indexed read when there are none).
  const lastPlanSlot = Math.max(last, ...planSlots);
  const pending = await pendingSponsorshipSlots(db, first, lastPlanSlot);
  const sponsored = new Set(pending.map((p) => p.slotIndex).filter((i) => planSlots.has(i)));

  // Slots published one by one from the pattern: calendar races, the fixed card, and a sponsor's
  // race in a meeting that was planned before the sponsor bought it.
  const planning = new Set(toPlan.flatMap((m) => ordinarySlotsOf(m)));
  const single: number[] = [];
  for (let i = first; i <= lastPlanSlot; i++) {
    if (!free(i)) continue;
    if (planSlots.has(i) ? sponsored.has(i) && !planning.has(i) : i <= last) single.push(i);
  }
  const claimingAt = new Map<number, boolean>();
  if (!hooks.cardSlot) for (const i of single) if (isClaimingSlot(i)) claimingAt.set(i, await claimingDecision(db, i, now));
  const rows = [];
  for (const i of single) {
    const input = hooks.cardSlot ? hooks.cardSlot(i) : planSlots.has(i) ? fixedCardSlot(i, "sponsor", claimingAt.get(i) ?? false) : cardSlotAt(i, { claiming: claimingAt.get(i) ?? true });
    if (input) rows.push(raceValues({ ...input, slotKey: slotKeyOf(i) }));
  }
  const inserted = rows.length ? await db.insert(races).values(rows).onConflictDoNothing({ target: races.slotKey }).returning({ slotKey: races.slotKey }) : [];
  // A meeting is complete once its last race is published (fixed card) or once it is planned:
  // tell players which of its races suit their horses (one digest per meeting; this instance
  // published it, so it runs once).
  const complete: gc.Meeting[] = [];
  for (const r of inserted) {
    const m = meetingRaceOf(slotIndexOf(r.slotKey) ?? -1);
    if (m && m.race === m.races - 1 && !planMeetings.has(m.number)) complete.push(m);
  }
  let planned = 0;
  for (const m of toPlan) {
    const keys = await planMeetingTx(db, m, { now, first, taken, sponsored });
    planned += keys.length;
    if (keys.length) complete.push(m);
  }
  for (const m of complete) {
    try {
      await noteRacesThatSuit(db, { meeting: m.number, fromMs: m.startMs, toMs: m.lastPostMs, now });
    } catch (e) {
      console.error("[card] race-suits notes failed", m.number, e);
    }
  }
  // sponsorships whose slot is on the card now take the name (sponsorship.ts)
  const named = pending.length ? await applyPendingSponsorships(db, first, lastPlanSlot, now) : 0;
  if (rows.length || planned || named) all = await readCard();
  return all.filter(onCard).map(publicRace);
}

// ---------------------------------------------------------------------------
// Sister courses (§4d): a slot never turns players away
// ---------------------------------------------------------------------------

/** At most 5 sisters per slot: with the original, all six courses run. */
const SISTER_MAX = 5;

/**
 * Serialises sister-course work on one slot (transaction-scoped advisory lock on
 * hashtext('slot:<index>'), like lockPremiumCheckout): concurrent entries that fill the
 * slot's races can't both create the next sister.
 */
export async function lockSlot(tx: Tx, index: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`slot:${index}`}))`);
}

/** A slot's races: the original (slotKeyOf(i)) first, then its sisters (`<key>:n`) in order. */
async function slotRaces(ex: Executor, index: number): Promise<RaceRow[]> {
  return ex
    .select()
    .from(races)
    .where(or(eq(races.slotKey, slotKeyOf(index)), like(races.slotKey, `${slotKeyOf(index)}:%`)))
    .orderBy(asc(races.slotKey));
}

/** Player entries per race (Club horses are added at lock and never count towards filling). */
async function playerEntryCounts(ex: Executor, raceIds: string[]): Promise<Map<string, number>> {
  const rows = await ex
    .select({ raceId: raceEntries.raceId, n: sql<number>`count(*)::int` })
    .from(raceEntries)
    .where(and(inArray(raceEntries.raceId, raceIds), eq(raceEntries.status, "entered"), isNotNull(raceEntries.stableId)))
    .groupBy(raceEntries.raceId);
  return new Map(rows.map((r) => [r.raceId, Number(r.n)]));
}

function hasFreeGate(r: RaceRow, entered: number, now: Date): boolean {
  return r.status === "open" && r.entriesCloseAt > now && entered < r.maxRunners;
}

/**
 * Sister course (§4d): when a Live card race is one gate from full, the same race is created
 * once on another course in the same slot — identical class, trip, ground, purse, post time
 * and entry close, its own fresh seed commitment, slotKey live:<index>:<n> (n = 2, 3 …).
 *
 * The course (sisterCourse): the next in TRACKS the slot hasn't used that races the surface
 * that day (no frost-stopped turf), preferring one whose own going that day is the race's, so
 * the ground usually matches the course too. When every course racing the surface already has
 * a race in the slot (synthetic has two, dirt four), the next race is a second division at one
 * of them ("… (division 2)"), so the slot still never turns players away.
 *
 * Called inside the entry transaction;
 * the slot advisory lock plus the unique slot_key make it exactly-once under concurrency.
 * No-op when another race in the slot still has a free gate, or at the 5-sister cap.
 */
export async function ensureSisterRace(tx: Tx, race: RaceRow, now: Date): Promise<RaceRow | null> {
  const index = slotIndexOf(race.slotKey);
  if (index === null || (race.kind !== "scheduled" && race.kind !== "feature" && race.kind !== "final")) return null;
  if (now >= race.entriesCloseAt) return null;
  await lockSlot(tx, index);
  const slot = await slotRaces(tx, index);
  const sisters = slot.filter((r) => r.slotKey !== slotKeyOf(index));
  if (sisters.length >= SISTER_MAX) return null;
  const entered = await playerEntryCounts(tx, slot.map((r) => r.id));
  if (slot.some((r) => r.id !== race.id && hasFreeGate(r, entered.get(r.id) ?? 0, now))) return null;
  const original = slot.find((r) => r.slotKey === slotKeyOf(index)) ?? race;
  const origTrack = String((original.conditions as RaceConditions).track ?? "");
  const place = sisterCourse(original, slot.map((r) => String((r.conditions as RaceConditions).track ?? "")));
  if (!place) return null;
  const { track, division } = place;
  // a sponsored original keeps its own name on the sponsor's record: sisters use the course's name
  const origName = baseRaceName(original);
  const bare = origName.startsWith(`${origTrack} `) ? origName.slice(origTrack.length + 1) : origName;
  const [sister] = await tx
    .insert(races)
    .values(
      raceValues({
        kind: race.kind,
        name: `${track} ${bare}${division > 1 ? ` (division ${division})` : ""}`,
        raceClass: race.raceClass,
        conditions: { ...withoutSponsor(race.conditions as RaceConditions), track },
        postTime: race.postTime,
        entriesCloseAt: race.entriesCloseAt,
        purse: race.purse,
        entryFee: race.entryFee,
        maxRunners: race.maxRunners,
        targetRunners: race.targetRunners,
        entryCost: race.entryCost,
        seasonNumber: race.seasonNumber,
        slotKey: `${slotKeyOf(index)}:${sisters.length + 2}`,
      }),
    )
    .onConflictDoNothing({ target: races.slotKey }) // the lock's belt and braces
    .returning();
  if (sister) {
    await audit(tx, { actor: null, action: "race.sister", entityType: "race", entityId: sister.id, data: { slot: index, of: original.id, track } });
  }
  return sister ?? null;
}

/**
 * The course for a slot's next sister (see ensureSisterRace), and its division there (1 = the
 * course's first race in the slot). Null when no course fits.
 */
export function sisterCourse(original: Pick<RaceRow, "conditions" | "postTime">, slotTracks: readonly string[]): { track: string; division: number } | null {
  const cond = original.conditions as RaceConditions;
  const origTrack = String(cond.track ?? "");
  const start = Math.max(0, TRACKS.indexOf(origTrack));
  const order = [...TRACKS.slice(start + 1), ...TRACKS.slice(0, start + 1)];
  const used = new Set(slotTracks);
  const surface = SURFACES.find((x) => x === cond.surface);
  // a race without a known surface (old rows, fixtures) may go to any course, as before
  if (!surface) {
    const track = order.find((t) => !used.has(t));
    return track ? { track, division: 1 } : null;
  }
  const postMs = original.postTime.getTime();
  const racing = new Set(coursesRacing(surface, postMs).map((c) => c.name));
  const fits = order.filter((t) => racing.has(t));
  const sameGoing = (t: string) => cond.going === undefined || gc.raceGround(SEASON_CLOCK, gc.courseByName(t)!.id, surface, postMs).going === cond.going;
  const fresh = fits.filter((t) => !used.has(t));
  const track = fresh.find(sameGoing) ?? fresh[0];
  if (track) return { track, division: 1 };
  // every course racing the surface has a race here: a further division at the least used one
  const count = (t: string) => slotTracks.filter((x) => x === t).length;
  const pool = fits.length ? fits : order.filter((t) => t === origTrack);
  const next = [...pool].sort((a, b) => count(a) - count(b))[0];
  return next ? { track: next, division: count(next) + 1 } : null;
}

/** The next race in the same slot with a free gate (the sister course a full race retries on). */
export async function openSlotRace(db: Db, raceId: string, now: Date): Promise<PublicRace | null> {
  const [race] = await db.select().from(races).where(eq(races.id, raceId));
  const index = slotIndexOf(race?.slotKey ?? null);
  if (!race || index === null) return null;
  const slot = await slotRaces(db, index);
  const entered = await playerEntryCounts(db, slot.map((r) => r.id));
  const next = slot.find((r) => r.id !== raceId && hasFreeGate(r, entered.get(r.id) ?? 0, now));
  return next ? publicRace(next) : null;
}

export interface TickReport {
  card: PublicRace[];
  locked: string[];
  /** Ordinary races called off at the close: no player runner (races.ts callsOffWithoutPlayers). */
  calledOff: string[];
  /** Locked races whose broadcast is over: simulate + settleRace them. */
  dueForSettlement: PublicRace[];
  maintenance?: MaintenanceReport;
}

export async function tickRaceCard(db: Db, now: Date, hooks: CardHooks = {}, opts: { maintenance?: boolean } = {}): Promise<TickReport> {
  const card = await ensureRaceCard(db, now, hooks);
  const closing = await db
    .select({ id: races.id })
    .from(races)
    .where(and(eq(races.status, "open"), lte(races.entriesCloseAt, now)))
    .orderBy(asc(races.postTime))
    .limit(50);
  const locked: string[] = [];
  const calledOff: string[] = [];
  for (const r of closing) {
    if (await lockField(db, r.id, now, hooks)) locked.push(r.id);
    else calledOff.push(r.id);
  }
  const due = await db
    .select()
    .from(races)
    .where(and(eq(races.status, "locked"), lte(races.postTime, new Date(now.getTime() - RULES.settleAfterPostMs))))
    .orderBy(asc(races.postTime))
    .limit(50);
  const maintenance = opts.maintenance ? await runMaintenance(db, now) : undefined;
  return { card, locked, calledOff, dueForSettlement: due.map(publicRace), maintenance };
}

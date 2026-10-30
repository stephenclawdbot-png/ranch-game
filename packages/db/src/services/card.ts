/**
 * The Live race card (§4d): three race meetings a day of eight races 15 minutes apart
 * (game-core meetings.ts) on the 15-minute slot grid (RULES.slotMs), published a day ahead
 * from a deterministic calendar, plus the tick that drives the card forward.
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
import { and, asc, eq, gte, inArray, isNotNull, like, lte, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { raceEntries, races, type RaceRow } from "../schema";
import { RULES, seasonNumberAt } from "../rules";
import { gc } from "../gameCore";
import type { Db, Executor, Tx } from "../types";
import { runMaintenance, type MaintenanceReport } from "./maintenance";
import { applyPendingSponsorships, baseRaceName, withoutSponsor } from "./sponsorship";
import { audit } from "./tx";
import { lockField, publicRace, raceValues, type CreateRaceInput, type FieldHooks, type PublicRace, type RaceConditions } from "./races";

export function slotIndexAt(at: Date): number {
  return Math.floor((at.getTime() - RULES.seasonEpochMs) / RULES.slotMs);
}

export function slotPostTime(index: number): Date {
  return new Date(RULES.seasonEpochMs + index * RULES.slotMs);
}

/** Slot index of a Live card slot key (sisters share the original's index); null for anything else. */
export function slotIndexOf(slotKey: string | null): number | null {
  const m = /^live:(\d+)(?::\d+)?$/.exec(slotKey ?? "");
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
 * The class pattern of a race meeting (8 races, game-core RACES_PER_MEETING), stepped per
 * meeting race, never per wall-clock slot, so every meeting has the full mix:
 *
 *   race 1   the meeting's top race: a Feature (Listed or Group 3, double purse) at even-numbered
 *            meetings, a Listed race at odd ones. A calendar race (Qualifier, Weekend Feature,
 *            Season Final) takes this place in the evening meeting.
 *   2, 4, 6, 8  juvenile races (maidens and novices: every new horse can run them), two of each;
 *            which are maidens alternates from one meeting to the next, so maidens run every trip.
 *   3, 5, 7  the three handicap bands (0-55, 50-75, 70-95). The Saturday Plate takes race 3 and
 *            the Season Finals races 1, 3, 5 and 7 of their evening meetings: calendar races
 *            never land on a juvenile race (tested), so no trip or surface ever drops out.
 */
type MeetingPlace = "top" | "juvenile" | ClassDef;
const MEETING_CLASSES: readonly MeetingPlace[] = ["top", "juvenile", HCP_55, "juvenile", HCP_75, "juvenile", HCP_95, "juvenile"];
/** Juvenile races per meeting (4): the k-th juvenile race runs surface k mod 3, trip k mod 4. */
const JUVENILE_PER_MEETING = MEETING_CLASSES.filter((x) => x === "juvenile").length;
/** Races in one meeting of the class pattern above (game-core RACES_PER_MEETING). */
export const CARD_MEETING_RACES = MEETING_CLASSES.length;

const TRACKS = ["Ashcombe", "Kestrel Downs", "Saltmarsh", "Bellmont", "Larkspur", "Harrowgate"];
const SURFACES = ["turf", "dirt", "synthetic"] as const;
/**
 * Juvenile-slot trips, one per distance zone. Every trip a horse can prefer (1,000–2,900 m for
 * starters and pack foals) is within about 450 m below or 130 m above one of these, which keeps
 * the form-guide fit at grade C or better. Sprint is 1,000 m since genetics v2: MSTN C/C (most QHs) want 200 m less.
 */
const JUVENILE_TRIPS = [1000, 1500, 2000, 2400];
/** Older horses' races use the whole range, including the long trips bred stayers want. */
const OPEN_TRIPS = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2800, 3200];
const GOING: Record<string, string[]> = { turf: ["firm", "good", "good", "soft", "heavy"], dirt: ["good", "good", "good", "heavy"], synthetic: ["good"] };
const WEATHER = ["clear", "clear", "overcast", "rain", "dusk"];

const SEASON_CLOCK = { epochMs: RULES.seasonEpochMs };
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

/** The Saturday Plate runs this many slots after the Weekend Feature (30 minutes). */
export const PLATE_AFTER_SLOTS = 2;

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
  const track = "Ashcombe";
  const division = wf.division ?? "mile";
  return {
    kind: "scheduled",
    name: `${track} Saturday Plate (${division})`,
    raceClass: "listed",
    conditions: {
      distanceM: wf.distanceM,
      surface: wf.surface,
      going: wf.surface === "synthetic" ? "good" : wf.goingForecast,
      weather: wf.weather,
      track,
      calendar: { id: `${wf.id}-plate`, kind: "weekend_plate", division: wf.division },
    },
    postTime,
    entriesCloseAt: new Date(postTime.getTime() - RULES.entriesCloseBeforePostMs),
    purse: CALENDAR_PURSE.feature_qualifier,
    entryFee: cardEntryFee("listed", { purse: CALENDAR_PURSE.feature_qualifier }),
    maxRunners: RULES.maxField,
    targetRunners: RULES.maxField,
    seasonNumber: wf.season,
    slotKey: `live:${index}`,
  };
}

function specialCardSlot(index: number, sp: gc.RaceSlot): CreateRaceInput {
  const postTime = slotPostTime(index);
  const final = sp.kind === "season_final";
  const weekend = sp.kind === "weekend_feature";
  const track = final || weekend ? "Ashcombe" : "Bellmont";
  return {
    kind: final ? "final" : weekend ? "feature" : "scheduled",
    name: `${track} ${sp.name}`,
    raceClass: final || weekend ? "graded" : "listed",
    conditions: {
      // The Weekend Feature's gate is qualifying (a top 3 in a qualifier, or rating 100+), not a
      // rating floor: a horse rated 85-94 that places in a qualifier must be able to run.
      // Qualifiers are open to every rating (the harness found no player rated 85+ within a
      // season); a top 3 is the test. Only the Season Final keeps a floor.
      ...(final ? { minRating: 95 } : {}),
      distanceM: sp.distanceM,
      surface: sp.surface,
      going: sp.surface === "synthetic" ? "good" : sp.goingForecast,
      weather: sp.weather,
      track,
      calendar: { id: sp.id, kind: sp.kind, division: sp.division },
    },
    postTime,
    entriesCloseAt: new Date(postTime.getTime() - RULES.entriesCloseBeforePostMs),
    purse: sp.kind === "season_final" || sp.kind === "weekend_feature" || sp.kind === "feature_qualifier" ? CALENDAR_PURSE[sp.kind] : sp.purse,
    entryFee: cardEntryFee(final || weekend ? "graded" : "listed", { group1: final || weekend, purse: sp.kind === "season_final" || sp.kind === "weekend_feature" || sp.kind === "feature_qualifier" ? CALENDAR_PURSE[sp.kind] : sp.purse }),
    maxRunners: Math.min(16, sp.maxRunners),
    targetRunners: RULES.maxField,
    seasonNumber: sp.season,
    slotKey: `live:${index}`,
  };
}

/** The meeting race in this slot (game-core meetings.ts), or null between meetings. */
export function meetingRaceOf(index: number): gc.MeetingRace | null {
  return gc.meetingRaceAt(SEASON_CLOCK, slotPostTime(index).getTime());
}

/**
 * A Live race runs in this slot: a meeting race, or a calendar race (which always sits inside
 * the evening meeting). Every other slot of the 15-minute grid stays empty.
 */
export const isCardSlot = (index: number): boolean => meetingRaceOf(index) !== null || isCalendarSlot(index);

/**
 * Deterministic conditions for a card slot (a meeting race or a calendar race; throws for a
 * slot between meetings: use `cardSlotAt` or check `isCardSlot` first).
 *
 * Juvenile races cycle through every (surface, trip zone) pair: the k-th juvenile race (four a
 * meeting, k counted over meetings) runs on surface k mod 3 at trip zone k mod 4, so any 12
 * consecutive juvenile races (three meetings) cover all 12 pairs, on good or firm ground. Every
 * horse that can run maidens or novices therefore finds a race that suits its surface and trip
 * within a day's card, which is always published (RULES.cardHorizonMs; tested in the web app
 * with the form-guide rating). The other classes draw surface (all three, synthetic included),
 * trip (1,000–3,200 m) and going from the slot hash. Calendar races (Weekend Feature,
 * Qualifiers, the Saturday Plate, Season Finals) take over their slots (`specialSlotAt`,
 * `plateSlotAt`); they only ever land on a meeting's top race or a handicap.
 */
export function defaultCardSlot(index: number): CreateRaceInput {
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
  const m = meeting.number;
  const pos = meeting.race;
  const place = MEETING_CLASSES[pos]!;
  const feature = place === "top" && m % 2 === 0;
  let def: ClassDef;
  let conditions: RaceConditions;
  if (place === "juvenile") {
    const j = MEETING_CLASSES.slice(0, pos).filter((x) => x === "juvenile").length;
    const k = m * JUVENILE_PER_MEETING + j;
    def = (j + m) % 2 === 0 ? MAIDEN : NOVICE;
    const surface = SURFACES[((k % 3) + 3) % 3]!;
    const weather = pick(["clear", "clear", "overcast", "dusk"]);
    conditions = {
      ...def.conditions,
      distanceM: JUVENILE_TRIPS[((k % 4) + 4) % 4]!,
      surface,
      going: surface === "turf" ? pick(["good", "good", "firm"]) : "good",
      weather,
      track: pick(TRACKS),
    };
  } else {
    def = place === "top" ? (feature ? (h[30]! % 2 === 0 ? LISTED : GROUP3) : LISTED) : place;
    const surface = SURFACES[(((m * 8 + pos + (h[28]! % 3)) % 3) + 3) % 3]!;
    conditions = {
      ...def.conditions,
      distanceM: pick(OPEN_TRIPS),
      surface,
      going: pick(GOING[surface]!),
      weather: pick(WEATHER),
      track: pick(TRACKS),
    };
  }
  if (conditions.surface === "synthetic") conditions.going = "good";
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
    slotKey: `live:${index}`,
  };
}

/** The race a slot publishes, or null for a slot between meetings. */
export function cardSlotAt(index: number): CreateRaceInput | null {
  return isCardSlot(index) ? defaultCardSlot(index) : null;
}

export interface CardHooks extends FieldHooks {
  /** Conditions for a slot, null for no race (defaults to cardSlotAt: meetings and calendar races). */
  cardSlot?(index: number): CreateRaceInput | null;
}

/**
 * Calendar races (Feature Qualifiers, the Weekend Feature, the Plate, Season Finals) publish on
 * the same day-ahead horizon as the meetings (they did before the meetings, when the rest of
 * the card was 6 h ahead). Kept as its own name for the callers that mean calendar races.
 */
export const CALENDAR_HORIZON_MS = RULES.cardHorizonMs;

/**
 * Publishes every card slot from now to now + horizon (idempotent) and returns the open card.
 * Cheap on the steady state: one read of the published card; only slots missing from it are
 * built and inserted (ON CONFLICT DO NOTHING keeps concurrent instances safe), which after the
 * first tick is the one new slot every 15 minutes.
 */
export async function ensureRaceCard(db: Db, now: Date, hooks: CardHooks = {}, horizonMs = RULES.cardHorizonMs): Promise<PublicRace[]> {
  const first = slotIndexAt(now) + 1;
  const last = slotIndexAt(new Date(now.getTime() + horizonMs));
  const make = hooks.cardSlot ?? cardSlotAt;
  const readCard = () =>
    db
      .select()
      .from(races)
      .where(and(gte(races.postTime, now), lte(races.postTime, new Date(now.getTime() + horizonMs)), like(races.slotKey, "live:%")))
      .orderBy(asc(races.postTime), asc(races.slotKey)); // slotKey: sisters right after their original
  let card = await readCard();
  const published = new Set(card.map((r) => r.slotKey));
  const rows = [];
  for (let i = first; i <= last; i++) {
    if (published.has(`live:${i}`)) continue;
    const input = make(i);
    if (input) rows.push(raceValues({ ...input, slotKey: `live:${i}` }));
  }
  if (rows.length) await db.insert(races).values(rows).onConflictDoNothing({ target: races.slotKey });
  // sponsorships bought before their slot was on the card take the name now (sponsorship.ts;
  // one indexed read when there are none)
  const named = await applyPendingSponsorships(db, first, last, now);
  if (rows.length || named) card = await readCard();
  return card.map(publicRace);
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

/** A slot's races: the original (live:<i>) first, then its sisters (live:<i>:n) in order. */
async function slotRaces(ex: Executor, index: number): Promise<RaceRow[]> {
  return ex
    .select()
    .from(races)
    .where(or(eq(races.slotKey, `live:${index}`), like(races.slotKey, `live:${index}:%`)))
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
 * and entry close, the next course in TRACKS the slot hasn't used, its own fresh seed
 * commitment, slotKey live:<index>:<n> (n = 2, 3 …). Called inside the entry transaction;
 * the slot advisory lock plus the unique slot_key make it exactly-once under concurrency.
 * No-op when another race in the slot still has a free gate, or at the 5-sister cap.
 */
export async function ensureSisterRace(tx: Tx, race: RaceRow, now: Date): Promise<RaceRow | null> {
  const index = slotIndexOf(race.slotKey);
  if (index === null || (race.kind !== "scheduled" && race.kind !== "feature" && race.kind !== "final")) return null;
  if (now >= race.entriesCloseAt) return null;
  await lockSlot(tx, index);
  const slot = await slotRaces(tx, index);
  const sisters = slot.filter((r) => r.slotKey !== `live:${index}`);
  if (sisters.length >= SISTER_MAX) return null;
  const entered = await playerEntryCounts(tx, slot.map((r) => r.id));
  if (slot.some((r) => r.id !== race.id && hasFreeGate(r, entered.get(r.id) ?? 0, now))) return null;
  const original = slot.find((r) => r.slotKey === `live:${index}`) ?? race;
  const origTrack = String((original.conditions as RaceConditions).track ?? "");
  const used = new Set(slot.map((r) => String((r.conditions as RaceConditions).track ?? "")));
  const start = Math.max(0, TRACKS.indexOf(origTrack));
  const track = [...TRACKS.slice(start + 1), ...TRACKS.slice(0, start + 1)].find((t) => !used.has(t));
  if (!track) return null;
  // a sponsored original keeps its own name on the sponsor's record: sisters use the course's name
  const origName = baseRaceName(original);
  const bare = origName.startsWith(`${origTrack} `) ? origName.slice(origTrack.length + 1) : origName;
  const [sister] = await tx
    .insert(races)
    .values(
      raceValues({
        kind: race.kind,
        name: `${track} ${bare}`,
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
        slotKey: `live:${index}:${sisters.length + 2}`,
      }),
    )
    .onConflictDoNothing({ target: races.slotKey }) // the lock's belt and braces
    .returning();
  if (sister) {
    await audit(tx, { actor: null, action: "race.sister", entityType: "race", entityId: sister.id, data: { slot: index, of: original.id, track } });
  }
  return sister ?? null;
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

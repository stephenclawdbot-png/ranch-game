/**
 * The Live race card (§4d): a race every 15 minutes (RULES.slotMs), published ahead from a deterministic
 * calendar, plus the tick that drives the card forward.
 *
 * Publishing is idempotent across serverless instances: each slot has a unique
 * `slot_key`, inserts use ON CONFLICT DO NOTHING, and the seed commitment is fixed by the
 * first insert (entries open at publication).
 *
 * Driving the card: call `tickRaceCard` lazily on reads (race list, race page) and from a
 * cron backstop (`GET /api/cron/race-card`, every minute, guarded by CRON_SECRET):
 *   1. publish the next `cardHorizonMs` of slots;
 *   2. lock every field whose entries have closed;
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

const MAIDEN: ClassDef = { raceClass: "maiden", label: "Maiden Stakes", conditions: { maxWins: 0, maxRating: 60 }, purse: 2_000 };
const NOVICE: ClassDef = { raceClass: "novice", label: "Novice Stakes", conditions: { maxWins: 2, maxRating: 70 }, purse: 2_500 };
const HCP_55: ClassDef = { raceClass: "handicap", label: "Handicap (0-55)", conditions: { minRating: 0, maxRating: 55 }, purse: 3_000 };
const HCP_75: ClassDef = { raceClass: "handicap", label: "Handicap (50-75)", conditions: { minRating: 50, maxRating: 75 }, purse: 4_000 };
const HCP_95: ClassDef = { raceClass: "handicap", label: "Handicap (70-95)", conditions: { minRating: 70, maxRating: 95 }, purse: 5_000 };
const LISTED: ClassDef = { raceClass: "listed", label: "Listed Stakes", conditions: { minRating: 85 }, purse: 8_000 };
const GROUP3: ClassDef = { raceClass: "graded", label: "Group 3", conditions: { minRating: 95 }, purse: 12_000 };
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

/** Credit entry fee (a sink, on top of the stable entries) for the top classes, from game-core's tier fees. */
export function cardEntryFee(raceClass: string, opts: { group1?: boolean } = {}): number {
  if (opts.group1) return gc.ENTRY_FEE_BY_TIER.g1;
  if (raceClass === "graded") return gc.ENTRY_FEE_BY_TIER.g3;
  if (raceClass === "listed") return gc.ENTRY_FEE_BY_TIER.listed;
  return 0;
}

/**
 * One class cycle of the card (20 slots: 5 hours at 15-minute spacing). Slot 0 is the cycle's
 * Feature (Listed or Group 3). 12 of the other 19 are maiden / novice races ("juvenile slots":
 * every new horse can run them), then the handicap bands and a Listed race.
 */
const CYCLE: readonly (ClassDef | "feature")[] = [
  "feature", MAIDEN, NOVICE, HCP_55, MAIDEN, NOVICE, HCP_75, MAIDEN, NOVICE, HCP_95,
  MAIDEN, LISTED, NOVICE, MAIDEN, HCP_55, NOVICE, MAIDEN, HCP_75, NOVICE, HCP_95,
];
/** Slots in one class cycle. */
export const CARD_CYCLE_SLOTS = 20;
/** Index of each juvenile slot inside the cycle (-1 for the others). */
const JUVENILE_ORDINAL = CYCLE.map((d, i) => (d === MAIDEN || d === NOVICE ? CYCLE.slice(0, i).filter((x) => x === MAIDEN || x === NOVICE).length : -1));
const JUVENILE_PER_CYCLE = JUVENILE_ORDINAL.filter((x) => x >= 0).length; // 12

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
      minRating: final || weekend ? 95 : 85,
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
    entryFee: cardEntryFee(final || weekend ? "graded" : "listed", { group1: final || weekend }),
    maxRunners: Math.min(16, sp.maxRunners),
    targetRunners: RULES.maxField,
    seasonNumber: sp.season,
    slotKey: `live:${index}`,
  };
}

/**
 * Deterministic conditions for a card slot.
 *
 * Juvenile slots cycle through every (surface, trip zone) pair: the k-th juvenile slot runs on
 * surface k mod 3 at trip zone k mod 4, so any 12 consecutive juvenile slots (one cycle) cover
 * all 12 pairs, on good or firm ground. Every horse that can run maidens or novices therefore
 * finds a race that suits its surface and trip within one cycle, which the published card
 * always covers (RULES.cardHorizonMs; tested in the web app with the
 * form-guide rating). The other classes draw surface (all three, synthetic included), trip
 * (1,000–3,200 m) and going from the slot hash. Calendar races (Weekend Feature, qualifiers,
 * Season Final) take over their slots (`specialSlotAt`); a juvenile race they displace moves to
 * the next ordinary handicap / Listed slot (`carriedJuvenile`), so no trip ever drops out.
 */
export function defaultCardSlot(index: number): CreateRaceInput {
  const sp = specialSlotAt(index);
  if (sp) return specialCardSlot(index, sp);
  const h = createHash("sha256").update(`card-slot:${index}`).digest();
  let byte = 0;
  const pick = <T>(xs: readonly T[]): T => xs[h[byte++]! % xs.length]!;
  const postTime = slotPostTime(index);
  // a juvenile race displaced by a calendar race runs here instead of this slot's own class
  const source = carriedJuvenile(index) ?? index;
  const pos = cyclePos(source);
  const cycle = Math.floor(source / CARD_CYCLE_SLOTS);
  const slot = CYCLE[pos]!;
  const feature = slot === "feature";
  const def: ClassDef = feature ? (h[30]! % 2 === 0 ? LISTED : GROUP3) : slot;
  let conditions: RaceConditions;
  const juvenile = JUVENILE_ORDINAL[pos]!;
  if (juvenile >= 0) {
    const k = cycle * JUVENILE_PER_CYCLE + juvenile;
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
    const surface = SURFACES[(cycle * 8 + pos + (h[28]! % 3)) % 3]!;
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
    entryFee: cardEntryFee(def.raceClass),
    maxRunners: RULES.maxField,
    targetRunners: RULES.minField + (h[29]! % (RULES.maxField - RULES.minField + 1)),
    seasonNumber: seasonNumberAt(postTime),
    slotKey: `live:${index}`,
  };
}

const cyclePos = (index: number) => ((index % CARD_CYCLE_SLOTS) + CARD_CYCLE_SLOTS) % CARD_CYCLE_SLOTS;
const isJuvenileSlot = (index: number) => JUVENILE_ORDINAL[cyclePos(index)]! >= 0;
/** An ordinary (non-juvenile, non-Feature, non-calendar) slot: one that can carry a displaced juvenile race. */
const isCarrierSlot = (index: number) => !isJuvenileSlot(index) && CYCLE[cyclePos(index)] !== "feature" && !specialSlotAt(index);
/** How far back a displaced juvenile race can be (calendar races cluster within 7 slots on Season Final day). */
const CARRY_LOOKBACK = 16;

/**
 * The slot index of a juvenile race that a calendar race displaced and that runs in this slot
 * instead. Displaced juvenile races queue in order and each takes the next carrier slot after
 * it, so several calendar races in a row (Season Final day) still keep every trip on the card.
 * Null for every other slot.
 */
function carriedJuvenile(index: number): number | null {
  if (!isCarrierSlot(index)) return null;
  const queue: number[] = [];
  for (let t = index - CARRY_LOOKBACK; t <= index; t++) {
    if (specialSlotAt(t)) {
      if (isJuvenileSlot(t)) queue.push(t);
    } else if (isCarrierSlot(t) && queue.length) {
      const carried = queue.shift()!;
      if (t === index) return carried;
    }
  }
  return null;
}

export interface CardHooks extends FieldHooks {
  /** game-core calendar: conditions for a slot (defaults to defaultCardSlot). */
  cardSlot?(index: number): CreateRaceInput;
}

/** Publishes every slot from now to now + horizon (idempotent). Returns the open card. */
export async function ensureRaceCard(db: Db, now: Date, hooks: CardHooks = {}, horizonMs = RULES.cardHorizonMs): Promise<PublicRace[]> {
  const first = slotIndexAt(now) + 1;
  const last = slotIndexAt(new Date(now.getTime() + horizonMs));
  const make = hooks.cardSlot ?? defaultCardSlot;
  const rows = [];
  for (let i = first; i <= last; i++) rows.push(raceValues({ ...make(i), slotKey: `live:${i}` }));
  if (rows.length) await db.insert(races).values(rows).onConflictDoNothing({ target: races.slotKey });
  const card = await db
    .select()
    .from(races)
    .where(and(gte(races.postTime, now), lte(races.postTime, new Date(now.getTime() + horizonMs))))
    .orderBy(asc(races.postTime), asc(races.slotKey)); // slotKey: sisters right after their original
  return card.filter((r) => r.slotKey?.startsWith("live:")).map(publicRace);
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
  const bare = original.name.startsWith(`${origTrack} `) ? original.name.slice(origTrack.length + 1) : original.name;
  const [sister] = await tx
    .insert(races)
    .values(
      raceValues({
        kind: race.kind,
        name: `${track} ${bare}`,
        raceClass: race.raceClass,
        conditions: { ...(race.conditions as RaceConditions), track },
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
  for (const r of closing) {
    await lockField(db, r.id, now, hooks);
    locked.push(r.id);
  }
  const due = await db
    .select()
    .from(races)
    .where(and(eq(races.status, "locked"), lte(races.postTime, new Date(now.getTime() - RULES.settleAfterPostMs))))
    .orderBy(asc(races.postTime))
    .limit(50);
  const maintenance = opts.maintenance ? await runMaintenance(db, now) : undefined;
  return { card, locked, dueForSettlement: due.map(publicRace), maintenance };
}

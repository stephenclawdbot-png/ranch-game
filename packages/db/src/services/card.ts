/**
 * The Live race card (§4d): a race every 3 minutes, published ahead from a deterministic
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
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { createHash } from "node:crypto";
import { races } from "../schema";
import { RULES, seasonNumberAt } from "../rules";
import type { Db } from "../types";
import { runMaintenance, type MaintenanceReport } from "./maintenance";
import { lockField, publicRace, raceValues, type CreateRaceInput, type FieldHooks, type PublicRace, type RaceConditions } from "./races";

export function slotIndexAt(at: Date): number {
  return Math.floor((at.getTime() - RULES.seasonEpochMs) / RULES.slotMs);
}

export function slotPostTime(index: number): Date {
  return new Date(RULES.seasonEpochMs + index * RULES.slotMs);
}

interface ClassDef {
  raceClass: string;
  label: string;
  conditions: RaceConditions;
  purse: number;
}

const CLASSES: { weight: number; def: ClassDef }[] = [
  { weight: 25, def: { raceClass: "maiden", label: "Maiden Stakes", conditions: { maxWins: 0, maxRating: 60 }, purse: 2_000 } },
  { weight: 20, def: { raceClass: "novice", label: "Novice Stakes", conditions: { maxWins: 2, maxRating: 70 }, purse: 2_500 } },
  { weight: 15, def: { raceClass: "handicap", label: "Handicap (0-55)", conditions: { minRating: 0, maxRating: 55 }, purse: 3_000 } },
  { weight: 15, def: { raceClass: "handicap", label: "Handicap (50-75)", conditions: { minRating: 50, maxRating: 75 }, purse: 4_000 } },
  { weight: 15, def: { raceClass: "handicap", label: "Handicap (70-95)", conditions: { minRating: 70, maxRating: 95 }, purse: 5_000 } },
  { weight: 7, def: { raceClass: "listed", label: "Listed Stakes", conditions: { minRating: 85 }, purse: 8_000 } },
  { weight: 3, def: { raceClass: "graded", label: "Group 3", conditions: { minRating: 95 }, purse: 12_000 } },
];
const TRACKS = ["Ashcombe", "Kestrel Downs", "Saltmarsh", "Bellmont", "Larkspur", "Harrowgate"];
const DISTANCES = [1000, 1200, 1400, 1600, 2000, 2400];
const SURFACES = ["turf", "turf", "dirt"];
const GOING: Record<string, string[]> = { turf: ["firm", "good", "good", "soft"], dirt: ["good", "good", "heavy"] };
const WEATHER = ["clear", "clear", "overcast", "rain", "dusk"];

/** Deterministic conditions for a card slot. Every hour (20 slots) is a Feature race. */
export function defaultCardSlot(index: number): CreateRaceInput {
  const h = createHash("sha256").update(`card-slot:${index}`).digest();
  let byte = 0;
  const pick = <T>(xs: readonly T[]): T => xs[h[byte++]! % xs.length]!;
  const postTime = slotPostTime(index);
  const feature = index % 20 === 0;
  let def: ClassDef;
  if (feature) def = h[30]! % 2 === 0 ? CLASSES[5]!.def : CLASSES[6]!.def;
  else {
    let r = h[31]! % 100;
    def = CLASSES[0]!.def;
    for (const c of CLASSES) {
      if (r < c.weight) {
        def = c.def;
        break;
      }
      r -= c.weight;
    }
  }
  const surface = pick(SURFACES);
  const conditions: RaceConditions = {
    ...def.conditions,
    distanceM: pick(DISTANCES),
    surface,
    going: pick(GOING[surface]!),
    weather: pick(WEATHER),
    track: pick(TRACKS),
  };
  return {
    kind: feature ? "feature" : "scheduled",
    name: `${conditions.track} ${feature ? "Feature " : ""}${def.label}`,
    raceClass: def.raceClass,
    conditions,
    postTime,
    entriesCloseAt: new Date(postTime.getTime() - RULES.entriesCloseBeforePostMs),
    purse: feature ? def.purse * 2 : def.purse,
    maxRunners: RULES.maxField,
    targetRunners: RULES.minField + (h[29]! % (RULES.maxField - RULES.minField + 1)),
    seasonNumber: seasonNumberAt(postTime),
    slotKey: `live:${index}`,
  };
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
    .orderBy(asc(races.postTime));
  return card.filter((r) => r.slotKey?.startsWith("live:")).map(publicRace);
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

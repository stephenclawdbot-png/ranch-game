/**
 * Races (game-design §4d): every Live race is shared and live.
 *
 *   publish (card.ts, seed committed)  →  enterRace (open until post − 30 s)
 *   →  lockField at entry close (snapshot, house horses fill to 8–12, gate draw from seed)
 *   →  getRaceForSimulation at post time (seed revealed)  →  engine (web app)
 *   →  settleRace after the broadcast (idempotent: purses, ratings, records, unlock, inbox;
 *       Story races pay and fatigue as usual but skip the career clock and record).
 *
 * Every transition takes the race row lock first, so concurrent serverless instances
 * (lazy-on-read plus the cron backstop) serialise: the first does the work, the rest read
 * the stored outcome. Lock order everywhere: race → stable → horse(s).
 */
import { and, asc, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { commitSeed, newSeed, seededUniform, sha256Hex } from "../crypto";
import { DomainError } from "../errors";
import { horses, inboxItems, raceEntries, raceResults, races, stables, type HorseRow, type RaceEntryRow, type RaceRow } from "../schema";
import { bps, placeholderHooks, RULES, seasonNumberAt, stageFor, type GameHooks } from "../rules";
import { bandRatingOf, gc, isGenome, statePatch, toHorseState, type HorseState } from "../gameCore";
import { defaultHooks } from "../hooks";
import type { Db, Executor, Tx } from "../types";
import type { RaceKit } from "@thoroughbred/shared";
import { accountIdOfStable, insertHorse, lockStableOf, recordPlayDay } from "./accounts";
import { ensureSisterRace } from "./card";
import { consumeEntries, ensureDailyEntries, refundEntries } from "./entries";
import { LIVE_RACE_KINDS } from "./leagues";
import { completeGoal } from "./dailyGoals";
import { isCarrying, lockHorse, startsOnDay } from "./horses";
import { playerLedgerAccountId, post, spendCreditsTx, systemAccountId, type Posting } from "./ledger";
import { audit, runTx } from "./tx";

export type RaceKind = RaceRow["kind"];

/** Stable entries a race costs: Live 1, feature / final / graded 2, Story & Daily Cup free. */
export function entryCostFor(kind: RaceKind, raceClass: string): number {
  if (kind === "quick" || kind === "daily_cup" || kind === "trial") return 0;
  if (kind === "feature" || kind === "final" || raceClass === "graded") return 2;
  return 1;
}

export interface RaceConditions {
  distanceM?: number;
  surface?: string;
  going?: string;
  weather?: string;
  /** Official-rating band for handicaps etc. (inclusive). */
  minRating?: number;
  maxRating?: number;
  /** Maiden: 0 wins; novice: at most 2. */
  maxWins?: number;
  [k: string]: unknown;
}

export interface CreateRaceInput {
  kind: RaceKind;
  name: string;
  raceClass: string;
  conditions: RaceConditions;
  postTime: Date;
  entriesCloseAt: Date;
  purse?: number;
  entryFee?: number;
  maxRunners?: number;
  targetRunners?: number;
  /** Defaults to entryCostFor(kind, raceClass). */
  entryCost?: number;
  seasonNumber?: number | null;
  slotKey?: string | null;
  /** Optional externally derived seed (e.g. HMAC(secret, raceId)); random by default. */
  seed?: string;
}

/** Public view: never includes the secret seed. */
export type PublicRace = Omit<RaceRow, "seed">;

export function publicRace(r: RaceRow): PublicRace {
  const { seed: _seed, ...rest } = r;
  return rest;
}

export function raceValues(input: CreateRaceInput) {
  const seed = input.seed ?? newSeed();
  const maxRunners = input.maxRunners ?? RULES.maxField;
  return {
    kind: input.kind,
    name: input.name,
    raceClass: input.raceClass,
    conditions: input.conditions,
    postTime: input.postTime,
    entriesCloseAt: input.entriesCloseAt,
    purse: input.purse ?? 0,
    entryFee: input.entryFee ?? 0,
    maxRunners,
    targetRunners: Math.min(maxRunners, input.targetRunners ?? Math.min(maxRunners, 10)),
    entryCost: input.entryCost ?? entryCostFor(input.kind, input.raceClass),
    seasonNumber: input.seasonNumber ?? null,
    slotKey: input.slotKey ?? null,
    seed,
    seedCommitment: commitSeed(seed),
  };
}

export async function createRace(db: Executor, input: CreateRaceInput): Promise<PublicRace> {
  const [row] = await db.insert(races).values(raceValues(input)).returning();
  return publicRace(row!);
}

export async function getRace(ex: Executor, raceId: string): Promise<PublicRace | null> {
  const [r] = await ex.select().from(races).where(eq(races.id, raceId));
  return r ? publicRace(r) : null;
}

/** Active (non-scratched) entries, by gate then entry time. */
export async function listRaceEntries(ex: Executor, raceId: string): Promise<RaceEntryRow[]> {
  return ex
    .select()
    .from(raceEntries)
    .where(and(eq(raceEntries.raceId, raceId), eq(raceEntries.status, "entered")))
    .orderBy(asc(raceEntries.gate), asc(raceEntries.enteredAt), asc(raceEntries.id));
}

/** Immutable snapshot stored with the entry (what the engine races). */
export function horseSnapshot(h: HorseRow): Record<string, unknown> {
  return {
    id: h.id,
    name: h.name,
    sex: h.sex,
    ownerStableId: h.ownerStableId,
    sireId: h.sireId,
    damId: h.damId,
    generation: h.generation,
    stage: h.stage,
    starts: h.starts,
    rating: h.rating,
    stats: h.stats,
    genome: h.genome,
    appearance: h.appearance,
    maturityType: h.maturityType,
    fitness: h.fitness,
    fatigue: h.fatigue,
    freshness: h.freshness,
    form: h.form,
    morale: h.morale,
    bond: h.bond,
    quirks: h.quirks,
    dynamics: h.dynamics,
    record: { starts: h.starts, wins: h.wins, places: h.places, shows: h.shows, earnings: h.earnings },
    /** game-core state at entry (JSON): the web app builds the engine snapshot from it at lock. */
    state: isGenome(h.genome) ? toHorseState(h) : null,
  };
}

/** Hard racing eligibility (career, age, lock, injury). Returns a DomainError to throw, or null. */
export function racingBlock(h: HorseRow, race: RaceRow, now: Date): DomainError | null {
  if (h.careerStatus !== "racing") return new DomainError("HORSE_RETIRED", "retired horses cannot race");
  if (h.starts >= RULES.maxStarts) return new DomainError("HORSE_RETIRED", "career complete");
  const nursery = stageFor(h.careSessions, h.starts);
  const ofAge = h.careSessions >= RULES.careToRacing || (race.kind === "trial" && nursery === "yearling");
  if (!ofAge) return new DomainError("HORSE_NOT_OF_AGE", "not yet of racing age");
  if (h.lockKind) return new DomainError("HORSE_LOCKED", h.lockKind === "race" ? "already entered in a race" : "listed on the market");
  if (h.injuredUntil && h.injuredUntil > now) return new DomainError("HORSE_INJURED", "recovering from injury");
  return null;
}

/** Class / rating band eligibility from the race conditions (§6). Returns a reason or null.
 * Max checks use the band rating (peak and ability floor, gc.bandRating), so a horse can't
 * drop a band by losing on purpose and a strong newcomer can't farm below its settled level. */
export function classEligibility(h: HorseRow, race: Pick<RaceRow, "raceClass" | "conditions">): string | null {
  const c = (race.conditions ?? {}) as RaceConditions;
  if (c.maxWins !== undefined && h.wins > c.maxWins) return c.maxWins === 0 ? "maiden races are for horses without a win" : `at most ${c.maxWins} wins`;
  if (c.minRating !== undefined && h.rating < c.minRating) return `rating ${h.rating} is below the band (${c.minRating}+)`;
  if (c.maxRating !== undefined) {
    const check = bandRatingOf(h);
    if (check.rating > c.maxRating) {
      // A strong newcomer's OR may still be below the band it belongs in: novices first.
      const band = gc.TIER_RULES[gc.classBand(check.rating)];
      return check.source === "ability"
        ? `too strong for this band — try ${h.rating >= band.minOr ? band.label : "Novice races"}`
        : `rated ${check.rating} at best — this band is for horses rated up to ${c.maxRating}`;
    }
  }
  return null;
}

/** The Weekend Feature's qualifying window: the week of qualifiers before it. */
const FEATURE_QUALIFYING_WINDOW_MS = 7 * 86_400_000;

/**
 * Weekend Feature places (game-core featureQualified): a top-3 finish in a Feature Qualifier in
 * the week before the race, or an official rating of 100+ by right. The Saturday Plate takes the
 * horses that ran in a qualifier that week but did not qualify. Other races: no check.
 */
export async function featureQualificationReason(ex: Executor, h: HorseRow, race: Pick<RaceRow, "postTime" | "conditions">): Promise<string | null> {
  const cal = ((race.conditions ?? {}) as RaceConditions).calendar as { kind?: string } | undefined;
  if (cal?.kind !== "weekend_feature" && cal?.kind !== "weekend_plate") return null;
  const rows = await ex
    .select({ position: raceEntries.finishPosition })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(
      and(
        eq(raceEntries.horseId, h.id),
        sql`${races.conditions}->'calendar'->>'kind' = 'feature_qualifier'`,
        gte(races.postTime, new Date(race.postTime.getTime() - FEATURE_QUALIFYING_WINDOW_MS)),
        lt(races.postTime, race.postTime),
      ),
    );
  const finishes = rows.map((r) => r.position).filter((p): p is number => p !== null);
  const qualified = gc.featureQualified(finishes, h.rating);
  if (cal.kind === "weekend_plate") {
    // the Plate is the consolation race: for horses that tried this week and missed the Feature
    if (!finishes.length) return "the Saturday Plate is for horses that ran in this week's Feature Qualifiers";
    return qualified ? "this horse qualified for the Weekend Feature: run it there" : null;
  }
  return qualified ? null : "the Weekend Feature needs a top-3 finish in this week's Feature Qualifiers (or a rating of 100+)";
}

export interface CalendarRun {
  horseId: string;
  raceId: string;
  kind: string;
  postTime: Date;
  /** Null until the race has settled. */
  position: number | null;
}

/** A stable's runs in calendar races (Feature Qualifiers, Weekend Feature, Plate, Finals) in [from, to). */
export async function stableCalendarRuns(ex: Executor, stableId: string, from: Date, to: Date): Promise<CalendarRun[]> {
  const rows = await ex
    .select({ horseId: raceEntries.horseId, raceId: races.id, kind: sql<string>`${races.conditions}->'calendar'->>'kind'`, postTime: races.postTime, position: raceEntries.finishPosition })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(
      and(
        eq(raceEntries.stableId, stableId),
        eq(raceEntries.status, "entered"),
        sql`${races.conditions}->'calendar'->>'kind' is not null`,
        gte(races.postTime, from),
        lt(races.postTime, to),
      ),
    );
  return rows.map((r) => ({ ...r, horseId: r.horseId! }));
}

// ---------------------------------------------------------------------------
// Entering & scratching
// ---------------------------------------------------------------------------

export interface EnterRaceInput {
  accountId: string;
  raceId: string;
  horseId: string;
  tactic: string;
  now: Date;
  /**
   * The real request time for daily goals, when `now` is not the wall clock (instant Story
   * races enter with a backdated `now` = post time - 1s, which can be yesterday). Defaults
   * to `now`.
   */
  goalNow?: Date;
  /**
   * Extra entry data stored with the snapshot (e.g. the race plan, the owner's silks and
   * stable name for the race card). Never overrides snapshot fields.
   */
  meta?: Record<string, unknown>;
  /**
   * Race-day extras and jockey (game-core raceDay.ts), Live races only. Priced from the race's
   * purse, charged with the entry (kinds `race_extras` and `jockey_fee`, burned) and stored in
   * the snapshot as `raceDay` (the choice plus what was paid) for the lock and refunds.
   */
  raceDay?: gc.RaceDayChoice;
}

/** What an entry bought on race day: the choice and the credits paid for it (refunds read this). */
export interface StoredRaceDay extends gc.RaceDayChoice {
  paid: { extras: number; jockey: number };
}

/** The race-day purchase stored with an entry snapshot (null when it bought nothing). */
export function storedRaceDay(snapshot: unknown): StoredRaceDay | null {
  const raw = (snapshot as { raceDay?: unknown } | null)?.raceDay as { paid?: { extras?: unknown; jockey?: unknown } } | undefined;
  if (!raw) return null;
  const choice = gc.parseRaceDay(raw);
  const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0);
  return { ...choice, paid: { extras: n(raw.paid?.extras), jockey: n(raw.paid?.jockey) } };
}

/** The going a race runs on (good when missing). */
export function raceGoing(race: Pick<RaceRow, "conditions">): "firm" | "good" | "soft" | "heavy" {
  const g = ((race.conditions ?? {}) as RaceConditions).going;
  return g === "firm" || g === "soft" || g === "heavy" ? g : "good";
}

/** Pays back what an entry spent on race day (scratch before close, abandoned race). Idempotent. */
async function refundRaceDay(tx: Tx, accountId: string, raceId: string, horseId: string, snapshot: unknown): Promise<void> {
  const rd = storedRaceDay(snapshot);
  if (!rd) return;
  const burn = await systemAccountId(tx, "burn");
  const player = await playerLedgerAccountId(tx, accountId);
  const parts = [
    ["extras", rd.paid.extras, "race_extras_refund"],
    ["jockey", rd.paid.jockey, "jockey_fee_refund"],
  ] as const;
  for (const [what, amount, kind] of parts) {
    if (amount <= 0) continue;
    await post(tx, {
      idempotencyKey: `race-day-refund:${what}:${raceId}:${horseId}`,
      kind,
      postings: [
        { ledgerAccountId: burn, amount: -amount },
        { ledgerAccountId: player, amount },
      ],
    });
  }
}

/**
 * Enters a horse (transactional, idempotent: entering the same horse again returns the
 * existing entry without charging twice).
 */
export async function enterRace(db: Db, input: EnterRaceInput, hooks: GameHooks = defaultHooks): Promise<RaceEntryRow> {
  return runTx(db, async (tx) => {
    const [race] = await tx.select().from(races).where(eq(races.id, input.raceId)).for("update");
    if (!race) throw new DomainError("NOT_FOUND", "race not found");
    const stable = await lockStableOf(tx, input.accountId);
    const horse = await lockHorse(tx, input.horseId);
    if (horse.ownerStableId !== stable.id) throw new DomainError("NOT_OWNER", "not your horse");

    const [existing] = await tx.select().from(raceEntries).where(and(eq(raceEntries.raceId, race.id), eq(raceEntries.horseId, horse.id)));
    if (existing?.status === "entered") return existing;
    if (existing) throw new DomainError("RACE_CLOSED", "a scratched horse cannot re-enter the same race");
    if (race.status !== "open" || input.now >= race.entriesCloseAt) throw new DomainError("RACE_CLOSED", "entries are closed");

    const block = racingBlock(horse, race, input.now);
    if (block) throw block;
    if (await isCarrying(tx, horse.id)) throw new DomainError("HORSE_IN_FOAL", "mares in foal do not race");
    if ((await startsOnDay(tx, horse.id, race.postTime)) >= RULES.startsPerDay) {
      throw new DomainError("RACE_LIMIT", `at most ${RULES.startsPerDay} starts per horse per day`);
    }
    if ((LIVE_RACE_KINDS as readonly string[]).includes(race.kind) && (await startsOnDay(tx, horse.id, race.postTime, { liveOnly: true })) >= RULES.liveStartsPerDay) {
      throw new DomainError("RACE_LIMIT", RULES.liveStartsPerDay === 1 ? "one Live race per horse per day" : `at most ${RULES.liveStartsPerDay} Live races per horse per day`);
    }
    const reason = hooks.raceEligibility ? hooks.raceEligibility({ horse, race, now: input.now }) : classEligibility(horse, race);
    if (reason) throw new DomainError("NOT_ELIGIBLE", reason);
    const qualifying = await featureQualificationReason(tx, horse, race);
    if (qualifying) throw new DomainError("NOT_ELIGIBLE", qualifying);

    const active = await listRaceEntries(tx, race.id);
    if (active.length >= race.maxRunners) throw new DomainError("RACE_FULL", "the field is full");
    // One horse per stable per Live race (story races and the Daily Cup are excluded).
    if ((LIVE_RACE_KINDS as readonly string[]).includes(race.kind)) {
      const mine = active.find((e) => e.stableId === stable.id);
      if (mine) throw new DomainError("STABLE_ALREADY_ENTERED", `you already have ${(mine.snapshot as { name?: string }).name ?? "a horse"} in this race`);
    }
    const mine = active.filter((e) => e.stableId === stable.id).length;
    if (race.kind !== "quick" && mine + 1 > Math.floor(race.targetRunners / 2)) {
      throw new DomainError("NOT_ELIGIBLE", "one stable may not make up more than half of the field");
    }

    // Race-day extras and jockey: checked against this race (a sister course has the same
    // conditions) and priced from its purse.
    const raceDay = input.raceDay ?? gc.NO_RACE_DAY;
    const raceDayProblem = gc.raceDayProblem(raceDay, { going: raceGoing(race), live: (LIVE_RACE_KINDS as readonly string[]).includes(race.kind) });
    if (raceDayProblem) throw new DomainError("NOT_ELIGIBLE", raceDayProblem);
    const quote = gc.raceDayQuote(raceDay, race.purse);

    await ensureDailyEntries(tx, stable, input.now);
    await consumeEntries(tx, stable, race.entryCost, race.id, horse.id);
    if (race.entryFee > 0) {
      await spendCreditsTx(tx, { accountId: input.accountId, amount: race.entryFee, idempotencyKey: `entry-fee:${race.id}:${horse.id}`, kind: "entry_fee" });
    }
    if (quote.extrasTotal > 0) {
      await spendCreditsTx(tx, { accountId: input.accountId, amount: quote.extrasTotal, idempotencyKey: `race-extras:${race.id}:${horse.id}`, kind: "race_extras", memo: quote.extras.map((x) => x.key).join(",") });
    }
    if (quote.jockeyFee > 0) {
      await spendCreditsTx(tx, { accountId: input.accountId, amount: quote.jockeyFee, idempotencyKey: `jockey-fee:${race.id}:${horse.id}`, kind: "jockey_fee", memo: raceDay.jockey });
    }
    const stored: StoredRaceDay | null = gc.hasRaceDay(raceDay)
      ? { extras: quote.extras.map((x) => x.key), jockey: raceDay.jockey, paid: { extras: quote.extrasTotal, jockey: quote.jockeyFee } }
      : null;
    const [entry] = await tx
      .insert(raceEntries)
      .values({
        raceId: race.id,
        horseId: horse.id,
        stableId: stable.id,
        tactic: input.tactic,
        snapshot: { ...(input.meta ?? {}), ...horseSnapshot(horse), ...(stored ? { raceDay: stored } : {}) },
        ratingBefore: horse.rating,
        entryCost: race.entryCost,
        enteredAt: input.now,
      })
      .returning();
    await tx.update(horses).set({ lockKind: "race", lockRef: race.id, updatedAt: input.now }).where(eq(horses.id, horse.id));
    await recordPlayDay(tx, input.accountId, input.now);
    // One gate left in a Live card race: open a sister course in the same slot (§4d, card.ts).
    if (active.length + 1 >= race.maxRunners - 1) await ensureSisterRace(tx, race, input.now);
    // Today's "run a race" goal on the wall clock (a no-op once it has already paid today);
    // a cancelled race keeps the day's goal (owner-accepted edge).
    await completeGoal(tx, { accountId: input.accountId, goal: "race", now: input.goalNow ?? input.now });
    await audit(tx, { actor: input.accountId, action: "race.enter", entityType: "race", entityId: race.id, data: { horseId: horse.id, cost: race.entryCost, ...(stored ? { raceDay: stored } : {}) } });
    return entry!;
  });
}

/**
 * Owner scratch while entries are open: unlocks the horse; the entry (and any fee) is forfeited,
 * but race-day extras and the jockey's fee are paid back (nothing was used).
 */
export async function scratchEntry(db: Db, input: { accountId: string; raceId: string; horseId: string; now: Date }): Promise<void> {
  await runTx(db, async (tx) => {
    const [race] = await tx.select().from(races).where(eq(races.id, input.raceId)).for("update");
    if (!race) throw new DomainError("NOT_FOUND", "race not found");
    if (race.status !== "open" || input.now >= race.entriesCloseAt) throw new DomainError("RACE_CLOSED", "the field is locked");
    const stable = await lockStableOf(tx, input.accountId);
    const horse = await lockHorse(tx, input.horseId);
    const [entry] = await tx.select().from(raceEntries).where(and(eq(raceEntries.raceId, race.id), eq(raceEntries.horseId, horse.id)));
    if (!entry || entry.stableId !== stable.id) throw new DomainError("NOT_FOUND", "no such entry");
    if (entry.status === "scratched") return;
    await tx.update(raceEntries).set({ status: "scratched", scratchedAt: input.now }).where(eq(raceEntries.id, entry.id));
    await refundRaceDay(tx, input.accountId, race.id, horse.id, entry.snapshot);
    if (horse.lockKind === "race" && horse.lockRef === race.id) {
      await tx.update(horses).set({ lockKind: null, lockRef: null, updatedAt: input.now }).where(eq(horses.id, horse.id));
    }
    await audit(tx, { actor: input.accountId, action: "race.scratch", entityType: "race", entityId: race.id, data: { horseId: horse.id } });
  });
}

// ---------------------------------------------------------------------------
// Field lock (entry close)
// ---------------------------------------------------------------------------

export interface FieldRunner {
  gate: number;
  tactic: string;
  horseId: string;
  stableId: string | null;
  isHouse: boolean;
  /** Entry snapshot, or the engine-ready horse when hooks.engineHorse is provided. */
  horse: unknown;
  /**
   * The engine's per-runner race-day kit (jockey, soft-ground shoes: game-core raceDayKit),
   * only when the entry bought something that acts on the track. Fields locked before race-day
   * extras existed never have it, and hash exactly as they did.
   */
  kit?: RaceKit;
}

export interface LockedField {
  raceId: string;
  seedCommitment: string;
  lockedAt: string;
  runners: FieldRunner[];
  /** sha256 of the canonical runner list; published so the field is provably fixed. */
  fieldHash: string;
}

export interface FieldHooks extends Partial<GameHooks> {
  /** Maps an entry snapshot to the engine's Horse (shared HorseSchema). */
  engineHorse?(input: { snapshot: Record<string, unknown>; race: RaceRow; isHouse: boolean }): unknown;
}

const TACTICS = ["front", "stalker", "closer"] as const;

function seededShuffle<T>(xs: T[], seed: string, label: string): T[] {
  const u = seededUniform(seed, label);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(u() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function bandRating(c: RaceConditions): number {
  const lo = c.minRating ?? 0;
  const hi = c.maxRating ?? Math.max(lo, 40);
  return Math.round((lo + hi) / 2);
}

async function pickHouseHorses(tx: Tx, race: RaceRow, needed: number, hooks: FieldHooks, now: Date): Promise<HorseRow[]> {
  if (needed <= 0) return [];
  const c = race.conditions as RaceConditions;
  // Free house horses of the class band. SKIP LOCKED: concurrent locks of different races
  // never grab the same horse.
  const pool = await tx
    .select()
    .from(horses)
    .where(
      and(
        isNull(horses.ownerStableId),
        eq(horses.origin, "house"),
        eq(horses.careerStatus, "racing"),
        isNull(horses.lockKind),
        sql`${horses.rating} between ${c.minRating ?? 0} and ${c.maxRating ?? 140}`,
        c.maxWins !== undefined ? sql`${horses.wins} <= ${c.maxWins}` : sql`true`,
        sql`(${horses.injuredUntil} is null or ${horses.injuredUntil} <= ${now})`,
      ),
    )
    .orderBy(asc(horses.id))
    .limit(needed * 4)
    .for("update", { skipLocked: true });
  const chosen = seededShuffle(pool, race.seed, "house-pick").slice(0, needed);
  // Not enough: breed the house stable deterministically from the race seed.
  const make = hooks.houseHorse ?? defaultHooks.houseHorse ?? defaultHouseHorse;
  for (let i = chosen.length; i < needed; i++) {
    const spec = make({ seed: race.seed, index: i, raceClass: race.raceClass, rating: bandRating(c), season: race.seasonNumber ?? seasonNumberAt(now) });
    const id = await insertHorse(tx, { stableId: null, spec: { ...spec, careSessions: RULES.careToRacing }, origin: "house", now });
    chosen.push((await lockHorse(tx, id))!);
  }
  return chosen;
}

function defaultHouseHorse(input: { seed: string; index: number; raceClass: string; rating: number }) {
  const spec = placeholderHooks.starterHorse({ seed: input.seed, index: 1000 + input.index });
  return { ...spec, rating: input.rating };
}

async function lockFieldTx(tx: Tx, raceId: string, now: Date, hooks: FieldHooks): Promise<LockedField> {
  const [race] = await tx.select().from(races).where(eq(races.id, raceId)).for("update");
  if (!race) throw new DomainError("NOT_FOUND", "race not found");
  if (race.field) return race.field as LockedField; // already locked: idempotent
  if (race.status === "cancelled") throw new DomainError("RACE_CLOSED", "race was abandoned");
  if (now < race.entriesCloseAt) throw new DomainError("TOO_EARLY", "entries are still open");

  const entries = await listRaceEntries(tx, race.id);
  const players = entries.filter((e) => !e.isHouse);
  const target = Math.max(players.length, Math.min(race.maxRunners, race.targetRunners));
  const house = await pickHouseHorses(tx, race, target - players.length, hooks, now);

  type Pending = { horseId: string; stableId: string | null; isHouse: boolean; tactic: string; snapshot: Record<string, unknown>; entryId?: string };
  const pending: Pending[] = players.map((e) => ({ horseId: e.horseId, stableId: e.stableId, isHouse: false, tactic: e.tactic, snapshot: e.snapshot as Record<string, unknown>, entryId: e.id }));
  const u = seededUniform(race.seed, "house-tactic");
  for (const h of house) pending.push({ horseId: h.id, stableId: null, isHouse: true, tactic: TACTICS[Math.floor(u() * 3)]!, snapshot: horseSnapshot(h) });

  // Gate draw from the committed seed (deterministic, verifiable after the reveal).
  const drawn = seededShuffle(
    [...pending].sort((a, b) => (a.horseId < b.horseId ? -1 : 1)),
    race.seed,
    "gate-draw",
  );
  const runners: FieldRunner[] = [];
  for (let i = 0; i < drawn.length; i++) {
    const p = drawn[i]!;
    const gate = i + 1;
    if (p.entryId) {
      await tx.update(raceEntries).set({ gate }).where(eq(raceEntries.id, p.entryId));
    } else {
      const h = house.find((x) => x.id === p.horseId)!;
      await tx.insert(raceEntries).values({
        raceId: race.id,
        horseId: p.horseId,
        stableId: null,
        isHouse: true,
        gate,
        tactic: p.tactic,
        snapshot: p.snapshot,
        ratingBefore: h.rating,
        enteredAt: now,
      });
      await tx.update(horses).set({ lockKind: "race", lockRef: race.id }).where(eq(horses.id, p.horseId));
    }
    const rd = p.isHouse ? null : storedRaceDay(p.snapshot);
    const kit = rd ? gc.raceDayKit(rd, raceGoing(race)) : undefined;
    runners.push({
      gate,
      tactic: p.tactic,
      horseId: p.horseId,
      stableId: p.stableId,
      isHouse: p.isHouse,
      horse: hooks.engineHorse ? hooks.engineHorse({ snapshot: p.snapshot, race, isHouse: p.isHouse }) : p.snapshot,
      ...(kit ? { kit } : {}),
    });
  }
  const fieldHash = fieldHashOf(runners);
  const field: LockedField = { raceId: race.id, seedCommitment: race.seedCommitment, lockedAt: now.toISOString(), runners, fieldHash };
  await tx.update(races).set({ status: "locked", field, fieldHash, lockedAt: now }).where(eq(races.id, race.id));
  await audit(tx, { actor: null, action: "race.lock", entityType: "race", entityId: race.id, data: { runners: runners.length, house: house.length, fieldHash } });
  return field;
}

/** sha256 of the canonical runner list (a runner's kit is hashed only when it has one). */
export function fieldHashOf(runners: readonly FieldRunner[]): string {
  return sha256Hex(JSON.stringify(runners.map((r) => (r.kit ? [r.gate, r.horseId, r.tactic, r.horse, r.kit] : [r.gate, r.horseId, r.tactic, r.horse]))));
}

/**
 * Locks the field at entry close: snapshot, house horses fill empty gates (deterministic
 * from the race seed), gates drawn from the seed. Idempotent and safe under concurrency
 * (race row lock; the stored field is returned to every later caller).
 */
export async function lockField(db: Db, raceId: string, now: Date, hooks: FieldHooks = {}): Promise<LockedField> {
  return runTx(db, (tx) => lockFieldTx(tx, raceId, now, hooks));
}

export interface SimulationInput {
  /** Includes the revealed seed. */
  race: RaceRow;
  field: LockedField;
}

/** Field + revealed seed for the engine. Locks lazily if needed; TOO_EARLY before post time. */
export async function getRaceForSimulation(db: Db, raceId: string, now: Date, hooks: FieldHooks = {}): Promise<SimulationInput> {
  const [race] = await db.select().from(races).where(eq(races.id, raceId));
  if (!race) throw new DomainError("NOT_FOUND", "race not found");
  if (now < race.postTime) throw new DomainError("TOO_EARLY", "the seed is revealed at post time");
  const field = (race.field as LockedField | null) ?? (await lockField(db, raceId, now, hooks));
  return { race: { ...race, status: race.status === "open" ? "locked" : race.status }, field };
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export interface RunnerOutcome {
  horseId: string;
  position: number;
  finishTimeUs?: number;
  /** New official rating (game-core ratings); unchanged if omitted. */
  ratingAfter?: number;
  /** Injury from this run. Career-ending forces racing retirement; fatal retires the horse for good. */
  injury?: { severity: "minor" | "moderate" | "career_ending" | "fatal"; recoveryMs: number; detail?: Record<string, unknown> } | null;
  quirksRevealed?: string[];
  /** Post-race condition snapshot (permille). */
  condition?: Partial<Pick<HorseRow, "fitness" | "fatigue" | "freshness" | "form" | "morale" | "bond">>;
  /** Merged into horses.dynamics (recent runs, realisation ...). */
  dynamics?: Record<string, unknown>;
  stats?: unknown;
  /**
   * The horse's game-core state after the run (career.settleField / applyRun). When given,
   * rating, condition, fatigue, injury, quirks, stats and dynamics are taken from it;
   * starts, record, prizes and retirement remain the database's own bookkeeping.
   */
  state?: HorseState;
}

export interface SettleInput {
  raceId: string;
  now: Date;
  runners: RunnerOutcome[];
  resultHash: string;
  engineVersion?: string;
  /** Finish order, margins, etc. as produced by the engine (stored as jsonb). */
  result: unknown;
}

export interface SettleResult {
  alreadySettled: boolean;
  prizes: Record<string, number>;
  retired: string[];
}

export async function settleRace(db: Db, input: SettleInput): Promise<SettleResult> {
  return runTx(db, async (tx) => {
    const [race] = await tx.select().from(races).where(eq(races.id, input.raceId)).for("update");
    if (!race) throw new DomainError("NOT_FOUND", "race not found");
    if (race.status === "settled") {
      const done = await listRaceEntries(tx, race.id);
      return { alreadySettled: true, prizes: Object.fromEntries(done.map((e) => [e.horseId, e.prize])), retired: [] };
    }
    if (race.status === "cancelled") throw new DomainError("RACE_CLOSED", "race was abandoned");
    if (input.now < race.postTime) throw new DomainError("TOO_EARLY", "race has not run yet");
    if (!race.field) await lockFieldTx(tx, race.id, input.now, {});
    const entries = await listRaceEntries(tx, race.id);

    const byHorse = new Map(input.runners.map((r) => [r.horseId, r]));
    if (byHorse.size !== entries.length || entries.some((e) => !byHorse.has(e.horseId))) {
      throw new DomainError("INVALID_INPUT", "outcome must cover exactly the locked field");
    }

    // Purses: minted to each placed player runner's owner, in one ledger transaction.
    const prizes: Record<string, number> = {};
    const owners = new Map<string, string>();
    for (const e of entries) if (e.stableId && !owners.has(e.stableId)) owners.set(e.stableId, await accountIdOfStable(tx, e.stableId));
    const postings: Posting[] = [];
    let minted = 0;
    for (const e of entries) {
      const r = byHorse.get(e.horseId)!;
      const prize = bps(race.purse, RULES.purseSplitBps[r.position - 1] ?? 0);
      prizes[e.horseId] = prize;
      if (prize > 0 && e.stableId) {
        postings.push({ ledgerAccountId: await playerLedgerAccountId(tx, owners.get(e.stableId)!), amount: prize });
        minted += prize;
      }
    }
    let ledgerTransactionId: string | null = null;
    if (minted > 0) {
      postings.push({ ledgerAccountId: await systemAccountId(tx, "mint"), amount: -minted });
      ledgerTransactionId = (await post(tx, { idempotencyKey: `purse:${race.id}`, kind: "purse", postings, meta: { raceId: race.id } })).transactionId;
    }

    const retired: string[] = [];
    // Story races (§4e, kind "quick") never use a career start: no career clock, no record and
    // no max-starts retirement (a career-ending injury still retires). Prizes, fatigue, injury
    // and the per-day limit are unchanged; only the career counters differ.
    const story = race.kind === "quick";
    const ordered = [...entries].sort((a, b) => (a.horseId < b.horseId ? -1 : 1)); // lock order
    for (const e of ordered) {
      const r = byHorse.get(e.horseId)!;
      const h = await lockHorse(tx, e.horseId);
      const starts = story ? h.starts : Math.min(RULES.maxStarts, h.starts + 1);
      const fromState = r.state ? statePatch(r.state, input.now.getTime()) : null;
      const fatal = r.injury?.severity === "fatal" || r.state?.injury?.severity === "fatal";
      const careerEnding = fatal || r.injury?.severity === "career_ending" || r.state?.injury?.severity === "career_ending";
      const mustRetire = h.careerStatus === "racing" && (careerEnding || (!story && starts >= RULES.maxStarts));
      const quirks = [...new Set([...((h.quirks as string[]) ?? []), ...(r.quirksRevealed ?? [])])];
      if (mustRetire) retired.push(h.id);
      await tx
        .update(horses)
        .set({
          starts,
          wins: story ? h.wins : h.wins + (r.position === 1 ? 1 : 0),
          places: story ? h.places : h.places + (r.position === 2 ? 1 : 0),
          shows: story ? h.shows : h.shows + (r.position === 3 ? 1 : 0),
          earnings: story ? h.earnings : h.earnings + (prizes[h.id] ?? 0),
          rating: r.ratingAfter ?? h.rating,
          stage: stageFor(h.careSessions, starts),
          quirks,
          stats: r.stats ?? h.stats,
          // The peak rides along whenever the rating is written here (some callers send only
          // ratingAfter, no dynamics), so a settled horse can't drop a band by losing.
          ...(r.condition ?? {}),
          ...(r.injury
            ? { injury: { severity: r.injury.severity, raceId: race.id, ...(r.injury.detail ?? {}) }, injuredUntil: new Date(input.now.getTime() + r.injury.recoveryMs) }
            : {}),
          ...(fromState ?? {}),
          // after fromState: its dynamics hold only the state's keys, so merge onto the stored ones
          dynamics: {
            ...(h.dynamics as Record<string, unknown>),
            ...(fromState?.dynamics ?? {}),
            ...(r.dynamics ?? {}),
            peakOr: Math.max((h.dynamics as { peakOr?: number }).peakOr ?? 0, fromState?.dynamics.peakOr ?? 0, (r.dynamics?.peakOr as number | undefined) ?? 0, r.ratingAfter ?? h.rating),
            ...(fatal ? { diedAtMs: input.now.getTime(), diedAtRaceId: race.id } : {}),
          },
          ...(mustRetire
            ? { careerStatus: "retired" as const, retirementReason: careerEnding ? ("injury" as const) : ("max_starts" as const), retiredAt: input.now }
            : {}),
          // a fatal injury: retired for good (the Legacy Farm keeps the horse's memory; no stall)
          ...(fatal ? { careerStatus: "pasture" as const, pasturedAt: input.now, retirementReason: "injury" as const, retiredAt: h.retiredAt ?? input.now, studFee: null } : {}),
          ...(h.lockKind === "race" && h.lockRef === race.id ? { lockKind: null, lockRef: null } : {}),
          updatedAt: input.now,
        })
        .where(eq(horses.id, h.id));
      await tx
        .update(raceEntries)
        .set({ finishPosition: r.position, finishTimeUs: r.finishTimeUs ?? null, prize: prizes[h.id] ?? 0, ratingAfter: r.ratingAfter ?? h.rating })
        .where(eq(raceEntries.id, e.id));
      if (careerEnding && h.insured && e.stableId) {
        const payout = isGenome(h.genome) ? gc.insurancePayout(toHorseState(h)) : RULES.insurancePayout;
        await post(tx, {
          idempotencyKey: `insurance-payout:${h.id}`,
          kind: "insurance_payout",
          postings: [
            { ledgerAccountId: await systemAccountId(tx, "mint"), amount: -payout },
            { ledgerAccountId: await playerLedgerAccountId(tx, owners.get(e.stableId)!), amount: payout },
          ],
        });
      }
      // Inbox: the result waits for owners who were away.
      if (e.stableId) {
        await tx
          .insert(inboxItems)
          .values({
            accountId: owners.get(e.stableId)!,
            kind: "race_result",
            dedupeKey: `race:${race.id}:${h.id}`,
            title: fatal ? `${h.name} was fatally injured in the ${race.name}` : `${h.name} finished ${ordinal(r.position)} in the ${race.name}`,
            data: { position: r.position, fieldSize: entries.length, prize: prizes[h.id] ?? 0, retired: mustRetire, injury: (fatal ? "fatal" : (r.injury?.severity ?? r.state?.injury?.severity ?? null)) as string | null },
            raceId: race.id,
            horseId: h.id,
            createdAt: input.now,
          })
          .onConflictDoNothing();
      }
    }

    if (commitSeed(race.seed) !== race.seedCommitment) throw new Error("seed does not match its commitment");
    await tx.insert(raceResults).values({
      raceId: race.id,
      seedCommitment: race.seedCommitment,
      seedReveal: race.seed,
      resultHash: input.resultHash,
      engineVersion: input.engineVersion ?? null,
      result: input.result,
      ledgerTransactionId,
    });
    await tx.update(races).set({ status: "settled", settledAt: input.now }).where(eq(races.id, race.id));
    await audit(tx, { actor: null, action: "race.settle", entityType: "race", entityId: race.id, data: { prizes, retired, resultHash: input.resultHash } });
    return { alreadySettled: false, prizes, retired };
  });
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

/** Abandons an unsettled race: refunds stable entries, fees and race-day extras, unlocks horses. Idempotent. */
export async function cancelRace(db: Db, input: { raceId: string; now: Date; reason: string }): Promise<void> {
  await runTx(db, async (tx) => {
    const [race] = await tx.select().from(races).where(eq(races.id, input.raceId)).for("update");
    if (!race) throw new DomainError("NOT_FOUND", "race not found");
    if (race.status === "cancelled") return;
    if (race.status === "settled") throw new DomainError("RACE_CLOSED", "race already settled");
    const entries = await listRaceEntries(tx, race.id);
    // Lock order: race → stables → horses.
    const stableIds = [...new Set(entries.map((e) => e.stableId).filter((x): x is string => !!x))].sort();
    for (const id of stableIds) await tx.select({ id: stables.id }).from(stables).where(eq(stables.id, id)).for("update");
    for (const e of [...entries].sort((a, b) => (a.horseId < b.horseId ? -1 : 1))) {
      const h = await lockHorse(tx, e.horseId);
      if (h.lockKind === "race" && h.lockRef === race.id) {
        await tx.update(horses).set({ lockKind: null, lockRef: null }).where(eq(horses.id, h.id));
      }
      if (!e.stableId) continue;
      await refundEntries(tx, e.stableId, e.entryCost, race.id, e.horseId);
      if (race.entryFee > 0) {
        await post(tx, {
          idempotencyKey: `entry-refund:${race.id}:${e.horseId}`,
          kind: "entry_fee_refund",
          postings: [
            { ledgerAccountId: await systemAccountId(tx, "burn"), amount: -race.entryFee },
            { ledgerAccountId: await playerLedgerAccountId(tx, await accountIdOfStable(tx, e.stableId)), amount: race.entryFee },
          ],
        });
      }
      await refundRaceDay(tx, await accountIdOfStable(tx, e.stableId), race.id, e.horseId, e.snapshot);
    }
    await tx.update(races).set({ status: "cancelled" }).where(eq(races.id, race.id));
    await audit(tx, { actor: null, action: "race.cancel", entityType: "race", entityId: race.id, data: { reason: input.reason } });
  });
}

export async function getRaceResult(ex: Executor, raceId: string) {
  const [r] = await ex.select().from(raceResults).where(eq(raceResults.raceId, raceId));
  return r ?? null;
}

/** A stable's active entries (for "your horse runs at 14:03"). */
export async function listStableEntries(ex: Executor, stableId: string) {
  return ex
    .select({ entry: raceEntries, race: { id: races.id, name: races.name, kind: races.kind, postTime: races.postTime, status: races.status } })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.stableId, stableId), eq(raceEntries.status, "entered"), ne(races.status, "settled"), ne(races.status, "cancelled")))
    .orderBy(asc(races.postTime));
}


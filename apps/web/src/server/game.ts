/**
 * The game server: connects @thoroughbred/db (state, locking, ledger), game-core (rules) and
 * the racing engine (simulation) for the web app. Every function takes the database and
 * `now`, so tests drive time explicitly.
 *
 * Live card (game-design §4d), all races shared:
 *   tickRaceCard (lazy on reads, throttled; cron backstop) publishes slots and locks fields at
 *   entry close (house horses fill the gates; `engineHorse` turns each entry snapshot into the
 *   engine Horse with game-core's raceSnapshot) → at post time getRaceForSimulation reveals the
 *   seed to the server → simulateRace → the broadcast is sliced by live.ts (no spoilers) →
 *   settleRace once the broadcast is over (purses, ratings, careers, inbox).
 *
 * Story mode (§4e): solo races against house horses, created, simulated and settled in one go
 * when the player enters (Story rewards capped by game-core), so viewing never changes the
 * outcome or the ledger. Instant races are back-dated so the result shows at once.
 */
import * as gc from "@thoroughbred/game-core";
import { HorseSchema, RaceCourseSchema, RaceKitSchema, RaceModelSchema, RunningStyleSchema, type Horse, type RaceClass, type RaceConfig, type RaceInput, type RaceReplay, type RaceBroadcastChunk, type RaceBroadcastHeader } from "@thoroughbred/shared";
import { ENGINE_VERSION, SAMPLE_EVERY, TICK_HZ, commitSeed, engineVersionFor, simulateRace, verifyReplay } from "@thoroughbred/racing-engine";
import {
  DomainError,
  cancelRace,
  createRace,
  enterRace,
  getBalance,
  getEntryBank,
  getHorse,
  getRace as dbGetRace,
  getRaceForSimulation,
  getRaceResult,
  isDomainError,
  bandRatingOf,
  courseForRace,
  facilityLevels,
  goalsForToday,
  cupRunsOf,
  breedingStatus,
  CLUB_STUD_NAME,
  getStable,
  grantGiftFoal,
  testerForAccount,
  tradeStatus,
  isGenome,
  listCardRaces,
  listHorseRuns,
  horseFormFigures,
  listInbox,
  listRaceEntries,
  listStableEntries,
  listStableHorses,
  listStableRuns,
  lockField,
  claimingCard,
  claimPriceBand,
  isClaimingRace,
  lodgeClaim,
  myClaim,
  markInboxRead,
  occupancy,
  openSlotRace,
  pageStableRuns,
  refillEntries,
  scratchEntry,
  settleRace,
  stableEntriesInRace,
  stableRunSummary,
  storyRewardFor,
  storyState,
  ensureLeagueMembership,
  tickRaceCard,
  toHorseState,
  RULES,
  studRestingUntilOf,
  classEligibility,
  featureQualificationReason,
  startsOnDay,
  storedRaceDay,
  upkeepThisWeek,
  raceSponsor,
  leaseForHorse,
  CLUB_OWNER_NAME,
  stableLeases,
  type CardHooks,
  type Db,
  type FieldRunner,
  type HorseRow,
  type LockedField,
  type PublicRace,
  type RaceConditions,
  type RaceEntryRow,
  type RunnerOutcome,
  slotIndexOf,
  slotKeyOf,
  stablePhotoHashes,
  formLineOf,
  rivalTags,
} from "@thoroughbred/db";
import { getJockey as dbGetJockey, handicapWeightsFor } from "@thoroughbred/db";
import { conditionRating } from "@/lib/aptitude";
import { raceDayRiskKey } from "@/lib/raceDay";
import { replayStartSec } from "@/lib/replayStart";
import { CLAIMING_RULES } from "@/lib/claiming";
import type {
  ActiveEntry,
  FieldEntry,
  HorseDetailView,
  PedigreeNode,
  InboxView,
  MyRaceResult,
  MyRacesView,
  PlayerView,
  RaceCard,
  ClaimStatus,
  RaceKind,
  RacePlan,
  RaceDayOffer,
  RaceSponsorView,
  RaceSummary,
  RiskView,
  RunView,
  FormLineView,
} from "@/lib/types";
import { RaceNotFoundError, TooEarlyError } from "./errors";
import { houseStableFor } from "./house";
import { houseOwnerFor, settleStoryRace } from "./storyField";
import { stableNews } from "./moments";
import { DEFAULT_SILKS, bigCrowd, engineHorseFromSnapshot, geneticsView, horseFromRow, parsePlan, parseSilks, raceConds, raceRisk, raceTier, stableHorseView } from "./horseView";
import { broadcastEndsAtMs, broadcastStartMs, isBroadcastOver, sliceBroadcast } from "./live";
import type { Session } from "./session";
import { maybeSweepLeases } from "./leasing";
import { raceGroundTrend } from "./ground";
import { horseForm, sireLineSplits } from "./formBook";
import { riderOptions } from "./jockeys";

// ---------------------------------------------------------------------------
// Hooks, ids, small helpers
// ---------------------------------------------------------------------------

/** Field hooks: entry snapshots become engine Horses (game-core raceSnapshot) when the field locks. */
export const raceHooks: CardHooks = {
  engineHorse: ({ snapshot, race, isHouse, extraWeightLb }) => engineHorseFromSnapshot(snapshot, race, isHouse, extraWeightLb ?? 0),
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLASSES: readonly RaceClass[] = ["maiden", "novice", "handicap", "listed", "graded"];

export function isRaceId(id: string): boolean {
  return UUID_RE.test(id);
}

async function loadRace(db: Db, id: string): Promise<PublicRace> {
  if (!isRaceId(id)) throw new RaceNotFoundError(id);
  const race = await dbGetRace(db, id);
  if (!race || race.status === "cancelled") throw new RaceNotFoundError(id);
  return race;
}

export function kindOf(race: Pick<PublicRace, "kind">): RaceKind {
  return race.kind === "quick" ? "story" : "live";
}

export function raceConfig(race: PublicRace): RaceConfig {
  const c = raceConds(race);
  return {
    id: race.id,
    name: race.name,
    distanceM: c.distanceM,
    surface: c.surface,
    weather: c.weather,
    going: c.going,
    raceClass: (CLASSES as readonly string[]).includes(race.raceClass) ? (race.raceClass as RaceClass) : "handicap",
    postTimeMs: race.postTime.getTime(),
    purse: race.purse,
  };
}

function snapshotOf(e: RaceEntryRow | undefined): Record<string, unknown> {
  return (e?.snapshot ?? {}) as Record<string, unknown>;
}

/** A locked runner's engine Horse (the field stores it; older fields may hold raw snapshots). */
function runnerHorse(r: FieldRunner, race: PublicRace): Horse {
  const parsed = HorseSchema.safeParse(r.horse);
  return parsed.success ? parsed.data : engineHorseFromSnapshot(r.horse as Record<string, unknown>, race, r.isHouse, r.extraWeightLb ?? 0);
}

function stableNameOf(e: RaceEntryRow | undefined, horseId: string, isHouse: boolean, race?: Pick<PublicRace, "kind" | "conditions">): string {
  if (isHouse || !e?.stableId) return houseOwnerFor(race, horseId).name;
  const n = snapshotOf(e).stableName;
  return typeof n === "string" && n ? n : "Private stable";
}

// ---------------------------------------------------------------------------
// Simulation (server-only: replays contain the seed and the result)
// ---------------------------------------------------------------------------

class Lru<V> {
  private map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, v: V): void {
    this.map.delete(key);
    this.map.set(key, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

const replayCache = new Lru<RaceReplay>(128);
const formCache = new Lru<Map<string, string | null>>(256);

/** A locked runner's race-day kit (jockey, shoes), or none: fields locked before extras have none. */
function runnerKit(r: FieldRunner) {
  if (r.kit === undefined) return {};
  const k = RaceKitSchema.safeParse(r.kit);
  return k.success ? { kit: k.data } : {};
}

/**
 * The course profile frozen into a locked field (Live card races locked since course character
 * shipped), or none: older fields and Story/Quick/Daily Cup races run course-less, exactly as
 * they were simulated and hashed.
 */
function fieldCourse(field: LockedField) {
  if (field.course === undefined) return {};
  const c = RaceCourseSchema.safeParse(field.course);
  return c.success ? { course: c.data } : {};
}

/** The race model frozen into a locked field (Live races locked since engine 1.4.0), or none. */
function fieldModel(field: LockedField) {
  if (field.model === undefined) return {};
  const m = RaceModelSchema.safeParse(field.model);
  return m.success ? { model: m.data } : {};
}

function inputFrom(race: PublicRace, field: LockedField, seed: string) {
  return {
    race: raceConfig(race),
    ...fieldCourse(field),
    ...fieldModel(field),
    entries: field.runners.map((r) => ({ gate: r.gate, tactic: (RunningStyleSchema.safeParse(r.tactic).success ? r.tactic : "stalker") as Horse["style"], horse: runnerHorse(r, race), ...runnerKit(r) })),
    seed,
  };
}

/**
 * The racecard's course line: the course the race runs with (frozen in a locked field; before
 * the lock, the one it will lock with), or null when it runs course-less.
 */
function courseLine(race: PublicRace, field: LockedField | null): RaceCard["course"] {
  const profile = field ? fieldCourse(field).course : courseForRace(race);
  const course = profile ? gc.COURSES.find((c) => c.id === profile.id) : undefined;
  return course ? { name: course.name, character: course.character } : null;
}

/** The engine version a locked field runs under (1.1.0; 1.2.0 with race-day kit; 1.3.0 with a course; 1.4.0 with the race model). */
function fieldEngineVersion(field: LockedField | null): string {
  return field ? engineVersionFor(field.runners.map(runnerKit), fieldCourse(field).course, fieldModel(field).model) : ENGINE_VERSION;
}

/** Racecard tags for an entry's race-day extras and jockey ("Soft shoes", "Top jockey"). */
function gearOf(e: RaceEntryRow | undefined): string[] {
  const rd = e && !e.isHouse ? storedRaceDay(e.snapshot) : null;
  return rd ? gc.raceDayTags(rd) : [];
}

/**
 * The full simulated race. `simNow` must be at or after post time (the seed is revealed to
 * the server then). SERVER-ONLY: serve it only through live.ts or once the broadcast is over.
 */
async function simulateLocked(db: Db, race: PublicRace, simNow: Date): Promise<RaceReplay> {
  // A locked field never changes, so the replay is cached by race id.
  const hit = replayCache.get(race.id);
  if (hit) return hit;
  const sim = await getRaceForSimulation(db, race.id, simNow, raceHooks);
  const replay = simulateRace(inputFrom(race, sim.field, sim.race.seed));
  replayCache.set(race.id, replay);
  return replay;
}

/** The replay for a race whose post time has passed (throws TooEarlyError before). */
async function replayFor(db: Db, race: PublicRace, now: Date): Promise<RaceReplay> {
  if (now < race.postTime) throw new TooEarlyError(race.postTime.getTime());
  return simulateLocked(db, race, now);
}

// ---------------------------------------------------------------------------
// Driving the card (lazy on reads + cron backstop) and settlement
// ---------------------------------------------------------------------------

const TICK_EVERY_MS = 4_000;
const G = globalThis as typeof globalThis & { __tbTick?: { at: number; inflight: Promise<unknown> | null } };
const tickState = (G.__tbTick ??= { at: 0, inflight: null });

export interface DriveReport {
  locked: number;
  settled: string[];
  maintenance?: unknown;
}

/**
 * Publishes the card, locks fields whose entries have closed and settles races whose
 * broadcast is over. Throttled per server instance unless `force` (the cron); every step is
 * idempotent in the database, so concurrent instances are safe.
 */
/**
 * Preview deployments share production's database (Vercel's Neon integration gives both the same
 * DATABASE_URL), so a preview build's unreleased rules or engine must never publish, lock or
 * settle real races: only production drives the card. PREVIEW_DRIVES_CARD=1 opts a preview back
 * in (e.g. one with its own database branch).
 */
export const cardFrozen = (): boolean => process.env.VERCEL_ENV === "preview" && process.env.PREVIEW_DRIVES_CARD !== "1";

export async function driveCard(db: Db, now: Date, opts: { force?: boolean; maintenance?: boolean } = {}): Promise<DriveReport | null> {
  if (cardFrozen()) return null;
  if (!opts.force) {
    if (tickState.inflight) {
      await tickState.inflight.catch(() => undefined);
      return null;
    }
    if (now.getTime() - tickState.at < TICK_EVERY_MS && now.getTime() >= tickState.at) return null;
  }
  tickState.at = now.getTime();
  const run = (async (): Promise<DriveReport> => {
    const tick = await tickRaceCard(db, now, raceHooks, { maintenance: opts.maintenance });
    const settled: string[] = [];
    // Card races settle as soon as their broadcast is over (often before the database's
    // conservative settleAfterPostMs), plus anything else the tick reports as due.
    const recent = await listCardRaces(db, { from: new Date(now.getTime() - 30 * 60_000), to: now });
    const due = new Map([...recent.filter((r) => r.status === "locked"), ...tick.dueForSettlement].map((r) => [r.id, r]));
    for (const r of due.values()) {
      try {
        if (await settleIfDue(db, r.id, now)) settled.push(r.id);
      } catch (e) {
        console.error("[game] settlement failed", r.id, e);
      }
    }
    return { locked: tick.locked.length, settled, maintenance: tick.maintenance };
  })();
  tickState.inflight = run;
  try {
    return await run;
  } finally {
    if (tickState.inflight === run) tickState.inflight = null;
  }
}

/**
 * Settles a race once its broadcast is over (Story races: at once). Idempotent: a settled
 * race is left alone. Returns true when this call settled it.
 */
export async function settleIfDue(db: Db, raceId: string, now: Date): Promise<boolean> {
  if (cardFrozen()) return false;
  const race = await dbGetRace(db, raceId);
  if (!race || race.status === "settled" || race.status === "cancelled") return false;
  if (now < race.postTime) return false;
  const replay = await simulateLocked(db, race, now);
  if (race.kind !== "quick" && !isBroadcastOver(replay, now.getTime())) return false;
  return settleWithReplay(db, race, replay, now);
}

async function settleWithReplay(db: Db, race: PublicRace, replay: RaceReplay, now: Date): Promise<boolean> {
  const at = now < race.postTime ? race.postTime : now;
  const sim = await getRaceForSimulation(db, race.id, at, raceHooks);
  const entries = await listRaceEntries(db, race.id);
  const byHorse = new Map(entries.map((e) => [e.horseId, e]));
  const rows = new Map<string, HorseRow>();
  for (const e of entries) {
    const row = await getHorse(db, e.horseId);
    if (row) rows.set(row.id, row);
  }
  const states = [...rows.values()].filter((r) => isGenome(r.genome)).map((r) => toHorseState(r));
  // Each owner's vet facility level shortens injury recovery (house horses: none).
  const vetByStable = new Map<string, number>();
  for (const stableId of new Set(entries.map((e) => e.stableId).filter((s): s is string => !!s))) {
    const stable = await getStable(db, stableId);
    vetByStable.set(stableId, stable ? facilityLevels(stable).vet : 0);
  }
  const vetOf = (horseId: string) => {
    const sid = byHorse.get(horseId)?.stableId;
    return sid ? (vetByStable.get(sid) ?? 0) : 0;
  };
  const conds = raceConds(race);
  const results = gc.settleField(
    states,
    replay.result.finishOrder,
    {
      raceId: race.id,
      seed: sim.race.seed,
      atMs: race.postTime.getTime(),
      tier: raceTier(race),
      distanceM: conds.distanceM,
      going: conds.going,
      fieldSize: replay.result.finishOrder.length,
      bigCrowd: bigCrowd(race),
    },
    (id) => ({ intensity: parsePlan(snapshotOf(byHorse.get(id)).plan).intensity, vetLevel: vetOf(id), raceDay: storedRaceDay(byHorse.get(id)?.snapshot) ?? undefined }),
  );
  const byId = new Map(results.map((r) => [r.state.id, r]));
  const runners: RunnerOutcome[] = replay.result.finishOrder.map((f) => {
    const r = byId.get(f.horseId);
    return { horseId: f.horseId, position: f.position, finishTimeUs: f.finishTimeUs, ratingAfter: r?.state.rating.or, quirksRevealed: r?.revealedQuirks, state: r?.state };
  });
  const res = await settleRace(db, { raceId: race.id, now: at, runners, resultHash: replay.result.resultHash, engineVersion: replay.engineVersion, result: replay.result });
  // Story: capped reward + chapter progress and licences (storyField.ts).
  if (race.kind === "quick") await settleStoryRace(db, race, entries, replay);
  return !res.alreadySettled;
}

// ---------------------------------------------------------------------------
// Race card, list, broadcast, replay, verify
// ---------------------------------------------------------------------------

/** A Live race's sponsor for the card (sister courses show the original's). */
async function sponsorFor(db: Db, race: PublicRace, viewerStableId: string | null): Promise<RaceSponsorView | undefined> {
  const s = await raceSponsor(db, race);
  return s ? { stableName: s.stableName, silks: parseSilks(s.silks), mine: !!viewerStableId && s.stableId === viewerStableId } : undefined;
}

function phaseOf(race: PublicRace, now: Date, replay: RaceReplay | null): RaceCard["status"] {
  if (now < race.postTime) return race.field || now >= race.entriesCloseAt ? "closed" : "open";
  return replay && isBroadcastOver(replay, now.getTime()) ? "finished" : "live";
}

/** The race card for a viewer (never the seed; no outcome before the finish is broadcast). */
export async function raceCard(db: Db, id: string, now: Date, viewerStableId: string | null): Promise<RaceCard> {
  if (!isRaceId(id)) throw new RaceNotFoundError(id);
  await driveCard(db, now);
  let race = await loadRace(db, id);
  // Entries have closed but the (throttled) tick hasn't locked this field yet: lock it now.
  if (!race.field && now >= race.entriesCloseAt && race.status === "open" && !cardFrozen()) {
    await lockField(db, id, now, raceHooks);
    race = await loadRace(db, id);
  }
  const entries = await listRaceEntries(db, id);
  const byHorse = new Map(entries.map((e) => [e.horseId, e]));
  const field = race.field as LockedField | null;
  let list: FieldEntry[];
  if (field) {
    list = field.runners
      .map((r) => {
        const e = byHorse.get(r.horseId);
        return {
          gate: r.gate,
          tactic: r.tactic as FieldEntry["tactic"],
          // A weighted runner's sealed horse has the weight folded into its stats: the card shows
          // the horse itself (grades as entered) and the weight in its own column.
          horse: r.weightLb !== undefined && e ? engineHorseFromSnapshot(snapshotOf(e), race, r.isHouse) : runnerHorse(r, race),
          weightLb: r.weightLb ?? null,
          stableName: stableNameOf(e, r.horseId, r.isHouse, race),
          isPlayer: !r.isHouse,
          mine: !!viewerStableId && r.stableId === viewerStableId,
          form: null,
          rating: null,
          gear: gearOf(e),
          jockey: r.jockey ? { id: r.jockey.id, name: r.jockey.name, claimLb: r.jockey.claimLb, cardName: gc.jockeyCardName(r.jockey.name, r.jockey.claimLb) } : null,
        };
      })
      .sort((a, b) => a.gate - b.gate);
  } else {
    list = entries.map((e) => ({
      gate: 0,
      tactic: e.tactic as FieldEntry["tactic"],
      horse: engineHorseFromSnapshot(snapshotOf(e), race, e.isHouse),
      weightLb: null,
      stableName: stableNameOf(e, e.horseId, e.isHouse, race),
      isPlayer: !e.isHouse,
      mine: !!viewerStableId && e.stableId === viewerStableId,
      form: null,
      rating: null,
      gear: gearOf(e),
      jockey: null as FieldEntry["jockey"],
    }));
    // Booked jockeys before the lock (the claim shows only where it comes off a handicap weight).
    const weighted = handicapWeightsFor(race);
    for (const [i, e] of entries.entries()) {
      if (!e.jockeyId) continue;
      const j = await dbGetJockey(db, e.jockeyId);
      if (!j) continue;
      const claimLb = weighted ? j.claimLb : 0;
      list[i]!.jockey = { id: j.id, name: j.name, claimLb, cardName: gc.jockeyCardName(j.name, claimLb) };
    }
  }
  // Player stables' photos, one read for the field.
  const stableOfRunner = new Map<string, string | null>([...entries.map((e) => [e.horseId, e.stableId] as const), ...(field?.runners.map((r) => [r.horseId, r.stableId ?? null] as const) ?? [])]);
  const photos = await stablePhotoHashes(db, [...stableOfRunner.values()].filter((x): x is string => !!x));
  for (const e of list) {
    const sid = e.isPlayer ? stableOfRunner.get(e.horse.id) : null;
    e.stablePhotoUrl = sid ? gc.stablePhotoUrl(sid, photos.get(sid) ?? null) : null;
    e.stableId = sid ?? null;
  }
  // The viewer's rivals and nemesis (counted from races already over, never this one's result).
  if (viewerStableId && list.some((e) => e.isPlayer && !e.mine)) {
    const tags = await rivalTags(db, viewerStableId, now);
    for (const e of list) {
      if (e.mine || !e.isPlayer) continue;
      e.rival = e.horse.id === tags.nemesisHorseId ? "nemesis" : e.stableId && tags.rivalStableIds.includes(e.stableId) ? "rival" : null;
    }
  }
  // Racecard form + rating: form is fixed before the off, so it's cached per race and field.
  const formKey = `${race.id}:${list.map((e) => e.horse.id).join(",")}`;
  let form = formCache.get(formKey);
  if (!form) {
    const figs = await Promise.all(list.map((e) => horseFormFigures(db, e.horse.id, race.postTime, 3)));
    form = new Map(list.map((e, i) => [e.horse.id, figs[i]!.length ? [...figs[i]!].reverse().map((p) => (p > 9 ? "0" : String(p))).join("-") : null]));
    formCache.set(formKey, form);
  }
  list = list.map((e) => ({ ...e, form: form!.get(e.horse.id) ?? null, rating: byHorse.get(e.horse.id)?.ratingBefore ?? null }));
  // A claiming race: each runner's claim price and how many claims it has (never who).
  let claiming: RaceCard["claiming"];
  if (isClaimingRace(race)) {
    const claims = await claimingCard(db, race.id);
    for (const e of list) e.claim = claims.get(e.horse.id) ?? null;
    const mine = viewerStableId ? await myClaim(db, race.id, viewerStableId) : null;
    claiming = { rules: CLAIMING_RULES, myClaim: mine ? { horseId: mine.horseId, price: mine.price, status: mine.status as ClaimStatus } : null };
  }
  const replay = now >= race.postTime ? await replayFor(db, race, now) : null;
  return {
    id: race.id,
    kind: kindOf(race),
    config: raceConfig(race),
    field: list,
    seedCommitment: race.seedCommitment,
    status: phaseOf(race, now, replay),
    fieldLocked: !!field,
    entriesCloseAtMs: race.entriesCloseAt.getTime(),
    entryCost: race.entryCost,
    targetRunners: race.targetRunners,
    maxRunners: race.maxRunners,
    engineVersion: replay?.engineVersion ?? fieldEngineVersion(field),
    course: courseLine(race, field),
    sponsor: await sponsorFor(db, race, viewerStableId),
    groundTrend: raceGroundTrend(race.conditions as Record<string, unknown>, race.postTime),
    track: raceConds(race).track,
    ...(claiming ? { claiming } : {}),
  };
}

/** Lodges a claim on a runner of a claiming race (the price goes into escrow until the race). */
export async function claimLive(db: Db, session: Session, raceId: string, horseId: string, now: Date) {
  if (!isRaceId(raceId)) throw new RaceNotFoundError(raceId);
  await driveCard(db, now);
  return lodgeClaim(db, { accountId: session.accountId, raceId, horseId, now });
}

async function summarize(db: Db, race: PublicRace & { entered: number; mine: number; stables: number }, now: Date, viewerStableId: string | null = null): Promise<RaceSummary> {
  const c = raceConds(race);
  const base: RaceSummary = {
    id: race.id,
    kind: kindOf(race),
    name: race.name,
    distanceM: c.distanceM,
    surface: c.surface,
    going: c.going,
    weather: c.weather,
    raceClass: raceConfig(race).raceClass,
    purse: race.purse,
    postTimeMs: race.postTime.getTime(),
    entriesCloseAtMs: race.entriesCloseAt.getTime(),
    entryCost: race.entryCost,
    entryFee: race.entryFee,
    fieldSize: race.field ? (race.field as LockedField).runners.length : race.entered,
    targetRunners: race.targetRunners,
    stables: race.stables,
    meetingStartMs: meetingStartOf(race.postTime.getTime()),
    phase: phaseOf(race, now, null),
    mine: race.mine,
    ...(isClaimingRace(race) ? { claiming: true } : {}),
  };
  const sponsor = await sponsorFor(db, race, viewerStableId);
  if (sponsor) base.sponsor = sponsor;
  if (now < race.postTime) return base;
  const winnerOf = (horseId: string, timeUs: number) => {
    const runner = (race.field as LockedField | null)?.runners.find((r) => r.horseId === horseId);
    const horse = runner ? runnerHorse(runner, race) : null;
    return { horseId, name: horse?.name ?? "Winner", stableName: runner?.isHouse || !runner ? houseOwnerFor(race, horseId).name : "", timeUs };
  };
  if (race.status === "settled") {
    // Settled only after the broadcast was over: the stored result is public now.
    const stored = await getRaceResult(db, race.id);
    const first = (stored?.result as { finishOrder?: { horseId: string; finishTimeUs: number }[] } | null)?.finishOrder?.[0];
    const w = first ? winnerOf(first.horseId, first.finishTimeUs) : undefined;
    if (w && !w.stableName) w.stableName = await playerStableName(db, race, first!.horseId);
    return { ...base, phase: "finished", winner: w };
  }
  const replay = await replayFor(db, race, now);
  // While live: no end time and no winner (either would reveal the outcome).
  if (!isBroadcastOver(replay, now.getTime())) return { ...base, phase: "live" };
  const first = replay.result.finishOrder[0];
  const w = first ? winnerOf(first.horseId, first.finishTimeUs) : undefined;
  if (w && !w.stableName) w.stableName = await playerStableName(db, race, first!.horseId);
  return { ...base, phase: "finished", endsAtMs: broadcastEndsAtMs(replay), winner: w };
}

async function playerStableName(db: Db, race: PublicRace, horseId: string): Promise<string> {
  const e = (await listRaceEntries(db, race.id)).find((x) => x.horseId === horseId);
  return stableNameOf(e, horseId, !e?.stableId, race);
}

/** The meeting a Live race belongs to (game-core meetings.ts), for grouping the card. */
const SEASON_CLOCK = { epochMs: RULES.seasonEpochMs };
export function meetingStartOf(postTimeMs: number): number {
  return gc.meetingFor(SEASON_CLOCK, postTimeMs).startMs;
}

const isCalendarRace = (r: Pick<PublicRace, "conditions">) => !!(r.conditions as { calendar?: unknown } | null)?.calendar;

/**
 * The Live card: the next races (entries open or closed) and the latest ones (live first, then
 * results). The card is the whole published day: three race meetings (game-core meetings.ts)
 * with the calendar races inside the evening meeting. `upcoming` caps the list: the soonest
 * races, with every calendar race on the card kept in (a short list still shows the evening's
 * Qualifier). Races called off at the close (nobody entered) are left out.
 */
export async function raceList(db: Db, now: Date, viewerStableId: string | null, opts: { upcoming?: number; recent?: number } = {}) {
  await driveCard(db, now);
  const nowMs = now.getTime();
  const ahead = (await listCardRaces(db, { from: new Date(nowMs + 1), to: new Date(nowMs + RULES.cardHorizonMs), stableId: viewerStableId })).filter((r) => r.status !== "cancelled");
  const calendarAhead = ahead.filter(isCalendarRace);
  const limit = opts.upcoming ?? 6;
  const order = (x: PublicRace, y: PublicRace) => x.postTime.getTime() - y.postTime.getTime() || String(x.slotKey).localeCompare(String(y.slotKey));
  const rows = [...ahead.filter((r) => !isCalendarRace(r)).slice(0, Math.max(0, limit - calendarAhead.length)), ...calendarAhead.slice(0, limit)].sort(order);
  const upcoming = await Promise.all(rows.map((r) => summarize(db, r, now, viewerStableId)));
  // Sister courses (§4d) sort right after their original: name them under the original's row.
  for (const [i, r] of rows.entries()) {
    if (!r.slotKey || slotIndexOf(r.slotKey) === null || r.slotKey !== slotKeyOf(slotIndexOf(r.slotKey)!)) continue;
    const courses = rows
      .filter((s) => s.slotKey?.startsWith(`${r.slotKey}:`))
      .map((s) => String((s.conditions as RaceConditions).track ?? ""))
      .filter(Boolean);
    if (courses.length) upcoming[i]!.alsoAt = courses;
  }
  // The latest results: the last meeting can be hours ago, so look back a day.
  const behind = await listCardRaces(db, { from: new Date(nowMs - RULES.cardHorizonMs), to: now, stableId: viewerStableId });
  const recent = await Promise.all(
    behind
      .filter((r) => r.status !== "cancelled")
      .reverse()
      .slice(0, opts.recent ?? 6)
      .map((r) => summarize(db, r, now, viewerStableId)),
  );
  return { upcoming, recent };
}

/** Outcome-free header for a locked field, identical to broadcastHeader(replay) once simulated. */
function headerFromField(race: PublicRace, field: LockedField): RaceBroadcastHeader {
  const runners = [...field.runners].sort((a, b) => a.gate - b.gate);
  return {
    version: 1,
    engineVersion: fieldEngineVersion(field),
    race: raceConfig(race),
    seedCommitment: race.seedCommitment,
    tickHz: TICK_HZ,
    sampleEvery: SAMPLE_EVERY,
    trackLengthMm: raceConds(race).distanceM * 1000,
    laneCount: Math.max(6, runners.length),
    horses: runners.map((r) => {
      const h = runnerHorse(r, race);
      return { horseId: h.id, name: h.name, gate: r.gate, tactic: r.tactic as Horse["style"], appearance: h.appearance };
    }),
  };
}

/**
 * The live broadcast chunk. Before the off: header only (the field must be locked); from the
 * off: live.ts slices the replay up to "now" (no result, seed or later frames until the
 * finish has been broadcast). At most `maxFrames` frames from `fromFrame`. Reads nothing
 * viewer-specific, so the windowed route can share one response between all viewers.
 */
export async function liveChunk(db: Db, id: string, fromFrame: number, now: Date, maxFrames?: number): Promise<RaceBroadcastChunk> {
  if (!isRaceId(id)) throw new RaceNotFoundError(id);
  await driveCard(db, now);
  const race = await loadRace(db, id);
  if (now < race.postTime) {
    if (!race.field && now >= race.entriesCloseAt && !cardFrozen() && !(await lockField(db, id, now, raceHooks))) throw new RaceNotFoundError(id); // called off: nobody entered
    const field = (await dbGetRace(db, id))?.field as LockedField | null;
    if (!field) throw new TooEarlyError(race.postTime.getTime());
    return {
      raceId: race.id,
      serverNowMs: now.getTime(),
      broadcastStartMs: broadcastStartMs(race.postTime.getTime()),
      header: headerFromField(race, field),
      fromFrame: Math.max(0, Math.floor(fromFrame)),
      frames: [],
      events: [],
      liveEdgeFrame: -1,
      final: null,
    };
  }
  const replay = await replayFor(db, race, now);
  if (isBroadcastOver(replay, now.getTime()) && race.status === "locked") await settleIfDue(db, id, now);
  return sliceBroadcast(replay, fromFrame, now.getTime(), maxFrames);
}

/** Full replay with the revealed seed: only once the finish has been broadcast. */
export async function servedReplay(db: Db, id: string, now: Date): Promise<RaceReplay> {
  const race = await loadRace(db, id);
  const replay = await replayFor(db, race, now);
  if (!isBroadcastOver(replay, now.getTime())) throw new TooEarlyError(race.postTime.getTime(), "live");
  return replay;
}

/**
 * Where `?at=` opens the replay on a race page: "finish" = winning time − FINISH_LEAD_SEC,
 * or a race second. Undefined unless the finish has been broadcast (no spoilers: a live or
 * upcoming race ignores the param entirely).
 */
export async function replayStartFor(db: Db, id: string, at: string | null | undefined, now: Date): Promise<number | undefined> {
  const race = await loadRace(db, id);
  if (now < race.postTime) return undefined;
  const replay = await replayFor(db, race, now);
  if (!isBroadcastOver(replay, now.getTime())) return undefined;
  const winnerUs = replay.result.finishOrder[0]?.finishTimeUs;
  return replayStartSec(at, true, winnerUs != null ? winnerUs / 1_000_000 : null);
}

export interface VerifyResult {
  commitmentOk: boolean;
  resultHashOk: boolean;
  seed: string;
  seedCommitment: string;
  resultHash: string;
  engineVersion: string;
}

/** Re-simulates from the stored field and revealed seed (bypassing the cache). */
export async function verifyRace(db: Db, id: string, now: Date, claimed: { commitment?: string; resultHash?: string } = {}): Promise<VerifyResult> {
  const race = await loadRace(db, id);
  const served = await servedReplay(db, id, now);
  const sim = await getRaceForSimulation(db, id, now, raceHooks);
  const input = inputFrom(race, sim.field, sim.race.seed);
  const fresh = simulateRace(input);
  const commitment = commitSeed(input.seed);
  const commitmentOk = commitment === race.seedCommitment && commitment === served.seedCommitment && (claimed.commitment ? claimed.commitment === commitment : true);
  const resultHashOk =
    verifyReplay(input, served) && fresh.result.resultHash === served.result.resultHash && (claimed.resultHash ? claimed.resultHash === fresh.result.resultHash : true);
  return { commitmentOk, resultHashOk, seed: input.seed, seedCommitment: commitment, resultHash: fresh.result.resultHash, engineVersion: fresh.engineVersion };
}

/**
 * A race's engine input exactly as it locked (field, course, model, revealed seed) and its
 * official replay: what verifyRace re-simulates and what a "What if?" re-run (whatIf.ts) changes
 * one runner of. SERVER-ONLY: callers check the race has settled before using either.
 */
export async function lockedRaceInput(db: Db, race: PublicRace, now: Date): Promise<{ input: RaceInput; field: LockedField; replay: RaceReplay }> {
  const replay = await replayFor(db, race, now);
  const sim = await getRaceForSimulation(db, race.id, now, raceHooks);
  return { input: inputFrom(race, sim.field, sim.race.seed), field: sim.field, replay };
}

// ---------------------------------------------------------------------------
// Entering Live races, Quick Pick
// ---------------------------------------------------------------------------

function entryMeta(session: Session, plan: RacePlan) {
  return { plan, silks: parseSilks(session.stable.silks), stableName: session.stable.name, accountId: session.accountId };
}

/**
 * Enters a horse in a Live card race. `raceDay` = optional race-day extras and jockey
 * (game-core raceDay.ts), priced from the race's purse and charged with the entry.
 */
export async function enterLive(db: Db, session: Session, raceId: string, horseId: string, plan: RacePlan, now: Date, raceDay: gc.RaceDayChoice = gc.NO_RACE_DAY, claimPrice?: number) {
  if (!isRaceId(raceId)) throw new RaceNotFoundError(raceId);
  await driveCard(db, now);
  let race = await loadRace(db, raceId);
  if (race.kind === "quick") throw new DomainError("NOT_ELIGIBLE", "Story races are entered from Story mode");
  // Licences only ever go up, so checking the request's stable row is safe outside the entry transaction.
  const licence = licenceReason(race, session.stable.licenceLevel);
  if (licence) throw new DomainError("NOT_ELIGIBLE", licence);
  const meta = entryMeta(session, plan);
  let entry: Awaited<ReturnType<typeof enterRace>>;
  try {
    entry = await enterRace(db, { accountId: session.accountId, raceId, horseId, tactic: plan.tactic, now, meta, raceDay, claimPrice });
  } catch (e) {
    // A full Live race has a sister course in the same slot (§4d): retry once there.
    if (!isDomainError(e, "RACE_FULL")) throw e;
    const sister = await openSlotRace(db, raceId, now);
    if (!sister) throw e;
    race = await loadRace(db, sister.id);
    entry = await enterRace(db, { accountId: session.accountId, raceId: race.id, horseId, tactic: plan.tactic, now, meta, raceDay, claimPrice });
  }
  // Racing Live puts the stable in this week's league (idempotent; never blocks the entry).
  await ensureLeagueMembership(db, { accountId: session.accountId, now }).catch((e) => console.error("[game] league join failed", e));
  return { raceId: race.id, horseId: entry.horseId, postTimeMs: race.postTime.getTime(), entriesCloseAtMs: race.entriesCloseAt.getTime() };
}

export async function scratchLive(db: Db, session: Session, raceId: string, horseId: string, now: Date) {
  if (!isRaceId(raceId)) throw new RaceNotFoundError(raceId);
  await scratchEntry(db, { accountId: session.accountId, raceId, horseId, now });
}

function slotFor(race: PublicRace): gc.RaceSlot {
  const c = raceConds(race);
  return {
    id: race.id,
    name: race.name,
    kind: race.kind === "quick" ? "quick" : "regular",
    tier: raceTier(race),
    season: Math.max(1, race.seasonNumber ?? 1),
    postTimeMs: race.postTime.getTime(),
    entryCloseMs: race.entriesCloseAt.getTime(),
    distanceM: c.distanceM,
    surface: c.surface,
    goingForecast: c.going,
    weather: c.weather,
    purse: race.purse,
    entryFee: race.entryFee,
    maxRunners: race.maxRunners,
    handicap: race.raceClass === "handicap",
    division: null,
  };
}

/** Licence a Live race needs that the stable doesn't hold yet (Story licences, §4e), as a reason. */
export function licenceReason(race: PublicRace, licenceLevel: number): string | null {
  if (race.kind === "quick") return null;
  const block = gc.licenceBlock(licenceLevel, raceTier(race), race.kind === "final" ? "final" : race.kind === "feature");
  return block ? `Needs a ${block.name}: earn it in Story mode` : null;
}

/** game-core's class blocks: the Live card's own conditions decide these (classEligibility), not the tier model. */
const CLASS_BLOCKS: ReadonlySet<string> = new Set(["rating_too_low", "rating_too_high", "too_many_wins", "juvenile_class", "not_juvenile"]);

const sentence = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : null);

/**
 * Why a horse can't enter this race (null = eligible), the same rules the server enforces on
 * entry: licence, the horse's state (age, injury, starts today, in foal), then the race's own
 * class conditions with the band rating (db classEligibility). Weekend Feature qualifying needs
 * the database: see entryReasonFull.
 */
export function entryReason(row: HorseRow, race: PublicRace, now: Date, licenceLevel?: number): string | null {
  if (row.lockKind) return row.lockKind === "race" ? "Already entered in a race" : row.lockKind === "stud" ? "Booked for a covering" : "Listed on the market";
  const licence = licenceLevel === undefined ? null : licenceReason(race, licenceLevel);
  if (licence) return licence;
  if (isGenome(row.genome)) {
    const block = gc.entryBlock(toHorseState(row), slotFor(race), now.getTime());
    if (block && !CLASS_BLOCKS.has(block)) return BLOCK_REASON[block] ?? block;
  }
  return sentence(classEligibility(row, race));
}

/** entryReason plus the checks that need the database (one Live race a day, Weekend Feature qualifying). */
export async function entryReasonFull(db: Db, row: HorseRow, race: PublicRace, now: Date, licenceLevel?: number): Promise<string | null> {
  const base = entryReason(row, race, now, licenceLevel);
  if (base) return base;
  if (race.kind !== "quick" && (await startsOnDay(db, row.id, race.postTime, { liveOnly: true })) >= RULES.liveStartsPerDay) {
    return RULES.liveStartsPerDay === 1 ? "Already raced Live today (one Live race a day)" : `Raced ${RULES.liveStartsPerDay} Live races today`;
  }
  return sentence(await featureQualificationReason(db, row, race));
}

const BLOCK_REASON: Record<string, string> = {
  not_racing_age: "Not yet of racing age",
  retired: "At stud: no longer racing",
  injured: "Recovering from injury",
  daily_limit: `Raced ${RULES.startsPerDay} times today`,
  in_foal: "In foal",
  career_complete: "Career complete",
  rating_too_low: "Rating below this class",
  rating_too_high: "Rating above this class",
  too_many_wins: "Too many wins for this class",
  juvenile_class: "Juveniles can't run in this class yet",
  not_juvenile: "Juveniles only",
  entries_closed: "Entries have closed",
  field_full: "The field is full",
  stable_daily_limit: "No stable entries left",
};

/** Expected strength of a horse in a race on its natural style, minus its ideal (0 = perfect fit). */
function fitLoss(horse: Horse, race: PublicRace): number {
  const c = raceConds(race);
  const here = conditionRating(horse, horse.style, { distanceM: c.distanceM, surface: c.surface, going: c.going });
  const ideal = conditionRating(horse, horse.style, { distanceM: horse.preferredDistanceM, surface: horse.preferredSurface, going: "good" });
  return Math.max(0, ideal - here);
}

export interface EntryOption {
  horseId: string;
  reason: string | null;
  fitLoss: number;
  risk: Record<RacePlan["intensity"], RiskView | null>;
  /**
   * The risk for every ride and combination of the risk-changing extras on offer, keyed by
   * raceDayRiskKey (so the sheet updates live as physio, the vet check or shoes are ticked).
   */
  riskBy: Record<string, RiskView | null>;
  /** Claiming races: the horse's appraisal and the claim price band (70%-300%). */
  claim?: { appraisal: number; min: number; max: number };
}

/** The race-day extras and jockeys on offer for a race, priced (empty for Story races). */
export function raceDayOffer(race: PublicRace): RaceDayOffer {
  if (race.kind === "quick" || race.kind === "daily_cup" || race.kind === "trial") return { extras: [], jockeys: [] };
  const going = raceConds(race).going;
  return {
    extras: gc.offeredExtras(going).map((k) => {
      const d = gc.RACE_EXTRAS[k];
      return { key: k, label: d.label, tag: d.tag, effect: d.effect, price: gc.raceDayPrice(d.price, race.purse) };
    }),
    // Named jockeys replaced the tiers: the entry sheet offers `riders` (entryOptions).
    jockeys: [],
  };
}

/** Every subset of the extras on offer (each changes injury risk; the jockey doesn't). */
function riskSubsets(offered: readonly gc.RaceExtraKey[]): gc.RaceExtraKey[][] {
  let out: gc.RaceExtraKey[][] = [[]];
  for (const k of offered) out = [...out, ...out.map((xs) => [...xs, k])];
  return out;
}

/** Per-horse eligibility, fit and injury risk for a race (the entry sheet). */
export async function entryOptions(db: Db, session: Session, raceId: string, now: Date): Promise<{ race: RaceSummary; options: EntryOption[]; raceDay: RaceDayOffer }> {
  const race = await loadRace(db, raceId);
  const offer = raceDayOffer(race);
  if (race.kind !== "quick" && race.kind !== "daily_cup" && race.kind !== "trial") offer.riders = await riderOptions(db, session, race);
  const subsets = riskSubsets(offer.extras.map((x) => x.key));
  const silks = parseSilks(session.stable.silks);
  const rows = (await listStableHorses(db, session.stable.id)).filter((r) => r.careerStatus === "racing");
  const entered = (await listRaceEntries(db, raceId)).filter((e) => e.stableId === session.stable.id);
  const claiming = isClaimingRace(race);
  const options = await Promise.all(rows.map(async (row) => {
    const horse = horseFromRow(row, silks, now.getTime());
    const already = entered.some((e) => e.horseId === row.id);
    const claimBlock = claiming ? claimingReason(row) : null;
    return {
      horseId: row.id,
      reason: already ? "Entered" : race.kind === "quick" ? null : (claimBlock ?? (await entryReasonFull(db, row, race, now, session.stable.licenceLevel))),
      ...(claiming ? { claim: claimPriceBand(row) } : {}),
      fitLoss: fitLoss(horse, race),
      risk: {
        conservative: raceRisk(row, race, "conservative", now.getTime()),
        normal: raceRisk(row, race, "normal", now.getTime()),
        all_out: raceRisk(row, race, "all_out", now.getTime()),
      },
      riskBy: Object.fromEntries(
        (["conservative", "normal", "all_out"] as const).flatMap((i) => subsets.map((xs) => [raceDayRiskKey(i, xs), raceRisk(row, race, i, now.getTime(), { extras: xs })])),
      ),
    };
  }));
  const all = await listRaceEntries(db, raceId);
  const summary = await summarize(db, { ...race, entered: all.length, mine: entered.length, stables: new Set(all.map((e) => e.stableId).filter(Boolean)).size }, now, session.stable.id);
  return { race: summary, options, raceDay: offer };
}

/**
 * Quick reasons a horse can't run in a claiming race (it must be sellable for credits today); the
 * entry itself runs the market's full checks (seller requirements, resale lock, USDG, in foal).
 */
function claimingReason(row: HorseRow): string | null {
  if (row.bound) return "Club-bred horses can't be sold, so they don't run in claiming races";
  if (row.starts < row.tradeMinStarts) return `Can run in claiming races after ${row.tradeMinStarts} starts`;
  if (row.lesseeStableId) return "On lease: only its owner can sell it";
  return null;
}

export interface LivePick {
  raceId: string;
  raceName: string;
  horseId: string;
  horseName: string;
  tactic: Horse["style"];
  postTimeMs: number;
  reason: string;
  /** Other player stables already in the race (0 = a Club field). */
  rivals: number;
}

/**
 * Live Quick Pick (§4d): enter the best-fit fresh horse into the next suitable race on the
 * card. Races are tried soonest first; a horse must be eligible (game-core rules + band) and
 * fit the trip and ground well, else the best fit in the next few races. Races with real
 * players in them score better (6 points a stable, up to 4), so quick-join groups players;
 * a race that is already full still wins on score, and the entry lands on its sister course.
 */
export async function quickPickLive(db: Db, session: Session, now: Date): Promise<LivePick> {
  await driveCard(db, now);
  const silks = parseSilks(session.stable.silks);
  const nowMs = now.getTime();
  const rows = (await listStableHorses(db, session.stable.id)).filter((r) => r.careerStatus === "racing" && !r.lockKind);
  const candidates = rows.map((row) => ({ row, horse: horseFromRow(row, silks, nowMs), view: stableHorseView(row, silks, nowMs) })).filter((c) => !c.view.block);
  const fresh = candidates.filter((c) => c.view.condition !== "tired");
  const pool = fresh.length ? fresh : candidates;
  if (!pool.length) throw new DomainError("NOT_ELIGIBLE", candidates.length ? "your horses are tired" : "none of your horses can race right now");
  // Other player stables in each race (lazy: the loop usually stops at the first good fit).
  const rivalStables = new Map<string, number>();
  const rivalsOf = async (raceId: string): Promise<number> => {
    let n = rivalStables.get(raceId);
    if (n === undefined) {
      n = new Set((await listRaceEntries(db, raceId)).filter((e) => e.stableId && e.stableId !== session.stable.id).map((e) => e.stableId)).size;
      rivalStables.set(raceId, n);
    }
    return n;
  };
  const card = (await listCardRaces(db, { from: new Date(nowMs + 1), to: new Date(nowMs + RULES.cardHorizonMs), stableId: session.stable.id }))
    .filter((r) => r.status === "open" && r.entriesCloseAt.getTime() > nowMs + 5_000 && r.mine === 0 && !isClaimingRace(r)) // a claiming race needs a price the owner sets // full races stay (their sister takes the entry); one horse per stable per race
    .slice(0, 8);
  let best: { race: PublicRace; c: (typeof pool)[number]; loss: number; score: number } | null = null;
  for (const [i, race] of card.entries()) {
    const open = await Promise.all(pool.map(async (c) => (await entryReasonFull(db, c.row, race, now, session.stable.licenceLevel)) === null));
    const fits = pool.filter((_, j) => open[j]).map((c) => ({ c, loss: fitLoss(c.horse, race) + c.view.ranToday * 15 }));
    fits.sort((a, b) => a.loss - b.loss);
    const top = fits[0];
    if (!top) continue;
    const bonus = 6 * Math.min(await rivalsOf(race.id), 4);
    const score = top.loss + i * 4 - bonus; // fit + 4 a slot of waiting - the draw of real players
    if (top.loss - bonus <= 25) {
      best = { race, c: top.c, loss: top.loss, score };
      break; // a good fit wins early, social bonus included
    }
    if (!best || score < best.score) best = { race, c: top.c, loss: top.loss, score };
  }
  if (!best) throw new DomainError("NOT_ELIGIBLE", "no race on the card suits your horses right now");
  const { race, c } = best;
  const plan: RacePlan = { tactic: c.horse.style, intensity: "normal" };
  const entered = await enterLive(db, session, race.id, c.row.id, plan, now);
  // A full race's entry lands on its sister course: report the race actually entered.
  const run = entered.raceId === race.id ? race : await loadRace(db, entered.raceId);
  const conds = raceConds(race);
  const fitWord = best.loss <= 10 ? "a great fit" : best.loss <= 25 ? "a good fit" : "the best fit on the card";
  return {
    raceId: run.id,
    raceName: run.name,
    horseId: c.row.id,
    horseName: c.horse.name,
    tactic: plan.tactic,
    postTimeMs: run.postTime.getTime(),
    rivals: await rivalsOf(run.id),
    reason: `${c.horse.name}: ${fitWord} at ${conds.distanceM.toLocaleString("en-GB")} m on ${conds.surface}${c.view.condition === "fresh" ? ", and fresh" : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Story mode (solo, settled at creation)
// ---------------------------------------------------------------------------

/** Instant Story races are back-dated past the longest possible broadcast. */
export const STORY_INSTANT_BACKDATE_MS = 10 * 60_000;
export const STORY_POST_DELAY_MS = 10_000;
const STORY_TRACKS = ["Ashcombe", "Kestrel Downs", "Saltmarsh", "Bellmont", "Larkspur", "Harrowgate"];
/** Open Story races cover every trip a horse can prefer (1,000-3,200 m) on all three surfaces. */
const STORY_DISTANCES = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2800, 3200];
const STORY_SURFACES = ["turf", "dirt", "synthetic"] as const;

function rand(n: number): number {
  const b = new Uint32Array(1);
  globalThis.crypto.getRandomValues(b);
  return b[0]! % n;
}

export interface StoryRequest {
  /** Omit for Quick Pick (the best-suited fresh horse). */
  horseId?: string;
  plan?: RacePlan;
  instant?: boolean;
}

export interface StoryCreated {
  raceId: string;
  postTimeMs: number;
  horseId: string;
  pick?: { horseId: string; horseName: string; tactic: Horse["style"]; reason: string };
}

/** Story Quick Pick: the strongest fresh horse at its own best conditions, rotating away from horses that ran today. */
function storyPick(rows: HorseRow[], silks: ReturnType<typeof parseSilks>, nowMs: number) {
  const scored = rows
    .filter((r) => r.careerStatus === "racing" && !r.lockKind)
    .map((row) => {
      const view = stableHorseView(row, silks, nowMs);
      const h = view.horse;
      const ideal = conditionRating(h, h.style, { distanceM: h.preferredDistanceM, surface: h.preferredSurface, going: "good" });
      return { row, view, score: ideal - view.ranToday * 40 - (view.condition === "tired" ? 60 : 0) };
    })
    .filter((x) => !x.view.block)
    .sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

/** A solo Story race to run now: its card conditions (conditions.story says which chapter and rivals). */
export interface SoloRaceSpec {
  name: string;
  raceClass: string;
  conditions: RaceConditions;
  targetRunners: number;
}

/**
 * Creates, enters, locks, simulates and settles a solo Story race for one horse in one go
 * (Story rewards and chapter progress are paid at settlement). Instant races are back-dated
 * so the result shows at once; otherwise the race goes off in STORY_POST_DELAY_MS.
 */
export async function runSoloRace(db: Db, session: Session, row: HorseRow, plan: RacePlan, spec: SoloRaceSpec, instant: boolean, now: Date): Promise<{ raceId: string; postTimeMs: number }> {
  const nowMs = now.getTime();
  const postTime = instant ? new Date(Math.floor((nowMs - STORY_INSTANT_BACKDATE_MS) / 1000) * 1000) : new Date(Math.ceil((nowMs + STORY_POST_DELAY_MS) / 1000) * 1000);
  const enterAt = instant ? new Date(postTime.getTime() - 1000) : now;
  const closeAt = instant ? postTime : new Date(nowMs + 1000);
  const race = await createRace(db, {
    kind: "quick",
    name: spec.name,
    raceClass: spec.raceClass,
    conditions: spec.conditions,
    postTime,
    entriesCloseAt: closeAt,
    purse: 0,
    maxRunners: 12,
    targetRunners: spec.targetRunners,
  });
  try {
    await enterRace(db, { accountId: session.accountId, raceId: race.id, horseId: row.id, tactic: plan.tactic, now: enterAt, goalNow: now, meta: entryMeta(session, plan) });
    await lockField(db, race.id, closeAt, raceHooks);
    const locked = (await dbGetRace(db, race.id))!;
    const simAt = now < postTime ? postTime : now;
    const replay = await simulateLocked(db, locked, simAt);
    await settleWithReplay(db, locked, replay, simAt);
  } catch (e) {
    await cancelRace(db, { raceId: race.id, now, reason: "story entry failed" }).catch(() => undefined);
    throw e;
  }
  return { raceId: race.id, postTimeMs: postTime.getTime() };
}

/**
 * An open Story race (Quick Pick / "race now"): the race secretary finds a race near the
 * horse's trip (3 in 4) and on its surface (3 in 4, synthetic included), at the stable's
 * current Story chapter against that chapter's rival stables.
 */
export async function createStoryRace(db: Db, session: Session, req: StoryRequest, now: Date): Promise<StoryCreated> {
  const nowMs = now.getTime();
  const silks = parseSilks(session.stable.silks);
  const rows = await listStableHorses(db, session.stable.id);
  let row: HorseRow | undefined;
  let pick: StoryCreated["pick"];
  if (req.horseId) {
    row = rows.find((r) => r.id === req.horseId);
    if (!row) throw new DomainError("NOT_OWNER", "that horse isn't in your stable");
  } else {
    const p = storyPick(rows, silks, nowMs);
    if (!p) throw new DomainError("NOT_ELIGIBLE", "none of your horses can race right now");
    row = p.row;
    const h = p.view.horse;
    pick = {
      horseId: row.id,
      horseName: h.name,
      tactic: h.style,
      reason: `${h.name}: best fit at ${h.preferredDistanceM.toLocaleString("en-GB")} m on ${h.preferredSurface}${p.view.ranToday === 0 ? ", and fresh" : ""}`,
    };
  }
  const horse = horseFromRow(row, silks, nowMs);
  const plan = req.plan ?? { tactic: horse.style, intensity: "normal" as const };

  const near = STORY_DISTANCES.filter((d) => d <= horse.preferredDistanceM + 100 && d >= horse.preferredDistanceM - 300);
  const distanceM = near.length && rand(4) < 3 ? near[rand(near.length)]! : STORY_DISTANCES[rand(STORY_DISTANCES.length)]!;
  const surface = rand(4) < 3 ? horse.preferredSurface : STORY_SURFACES[rand(3)]!;
  const going = surface === "turf" ? (["firm", "good", "good", "soft"] as const)[rand(4)]! : surface === "dirt" ? (["good", "good", "heavy"] as const)[rand(3)]! : "good";
  const weather = (["clear", "clear", "overcast", "rain", "dusk"] as const)[rand(5)]!;
  const raceClass = row.wins === 0 ? "maiden" : row.wins <= 2 ? "novice" : "handicap";
  const track = STORY_TRACKS[rand(STORY_TRACKS.length)]!;
  // Story difficulty follows the anti-throwing band rating, not the raw OR (a thrown OR
  // must not buy easier Story fields).
  const or = bandRatingOf(row).rating;
  const st = await storyState(db, session.accountId);
  const chapter = gc.currentChapter(st.licenceLevel, new Set(st.wonKeys));
  const chapterName = gc.chapterDef(chapter).title.replace(/^The /, "");
  const created = await runSoloRace(
    db,
    session,
    row,
    plan,
    {
      name: `${track} ${chapterName} ${raceClass === "maiden" ? "Maiden" : raceClass === "novice" ? "Novice Stakes" : "Handicap"}`,
      raceClass,
      conditions: { distanceM, surface, going, weather, track, minRating: Math.max(0, or - 12), maxRating: Math.min(140, or + 12), story: { chapter, rivals: gc.chapterRivals(chapter).map((r) => r.id) } },
      targetRunners: 8 + rand(3),
    },
    !!req.instant,
    now,
  );
  return { ...created, horseId: row.id, pick };
}

// ---------------------------------------------------------------------------
// Player views
// ---------------------------------------------------------------------------

function runView(r: Awaited<ReturnType<typeof listStableRuns>>[number], names: Map<string, string>): RunView {
  const c = raceConds(r);
  return {
    raceId: r.raceId,
    raceName: r.raceName,
    kind: r.kind === "quick" ? "story" : "live",
    horseId: r.horseId,
    horseName: names.get(r.horseId),
    position: r.position ?? 0,
    fieldSize: Number(r.fieldSize),
    prize: r.prize,
    postTimeMs: r.postTime.getTime(),
    distanceM: c.distanceM,
    surface: c.surface,
    ratingBefore: r.ratingBefore,
    ratingAfter: r.ratingAfter,
  };
}

/** Everything the signed-in player's pages need. Drives the card first so results arrive. */
// Accounts known to have had their day-2 gift foal (per instance; the database is the authority).
const GF = globalThis as typeof globalThis & { __tbGiftDone?: Set<string> };

/** Onboarding §10: the Club's day-2 gift foal (idempotent; packages/db onboarding.ts). */
async function maybeGiftFoal(db: Db, session: Session, now: Date): Promise<void> {
  const done = (GF.__tbGiftDone ??= new Set());
  if (done.has(session.accountId)) return;
  if (done.size > 50_000) done.clear();
  try {
    const r = await grantGiftFoal(db, { accountId: session.accountId, now });
    if (r.status === "granted" || r.status === "already") done.add(session.accountId);
  } catch (err) {
    console.error("gift foal", err);
  }
}

export async function playerView(db: Db, session: Session, now: Date): Promise<PlayerView> {
  await driveCard(db, now);
  await maybeGiftFoal(db, session, now);
  await maybeSweepLeases(db, now);
  const nowMs = now.getTime();
  const silks = parseSilks(session.stable.silks);
  const rows = await listStableHorses(db, session.stable.id);
  // Leases either way: chips on horses held on lease, and the stable's own horses away on lease.
  const leases = (await stableLeases(db, session.stable.id, now)).filter((l) => l.lease.status === "active");
  const leasedIn = new Map(leases.filter((l) => l.role === "lessee").map((l) => [l.horse.id, l]));
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const [credits, bank, occ, entries, inbox, runs, goals] = [
    await getBalance(db, session.accountId),
    await getEntryBank(db, { accountId: session.accountId, now }),
    await occupancy(db, session.stable),
    await listStableEntries(db, session.stable.id),
    await listInbox(db, session.accountId, 20),
    await listStableRuns(db, session.stable.id, 30),
    await goalsForToday(db, session.accountId, now),
  ];
  const active: ActiveEntry[] = entries.map(({ entry, race }) => ({
    raceId: race.id,
    raceName: race.name,
    kind: race.kind === "quick" ? "story" : "live",
    horseId: entry.horseId,
    horseName: names.get(entry.horseId) ?? "Your horse",
    postTimeMs: race.postTime.getTime(),
    status: race.status,
  }));
  // Story results pay a capped Story reward instead of a purse: show it with the result.
  const rewards = new Map<string, number>();
  for (const i of inbox) {
    if (i.readAt && i.raceId && !rewards.has(i.raceId)) rewards.set(i.raceId, (await storyRewardFor(db, i.raceId))?.amount ?? 0);
  }
  const inboxView: InboxView[] = inbox.map((i) => ({
    id: i.id,
    kind: i.kind,
    raceId: i.raceId,
    horseId: i.horseId,
    title: i.readAt ? i.title : null,
    createdAtMs: i.createdAt.getTime(),
    read: !!i.readAt,
    data: i.readAt
      ? { ...((i.data ?? {}) as Record<string, unknown>), prize: Number((i.data as { prize?: number } | null)?.prize ?? 0) + (rewards.get(i.raceId ?? "") ?? 0) }
      : null,
  }));
  return {
    accountId: session.accountId,
    stableName: session.stable.name,
    silks,
    photoUrl: gc.stablePhotoUrl(session.stable.id, session.stable.photoHash),
    credits,
    entries: { balance: bank.balance, cap: bank.cap, allowance: bank.allowance, refillAvailable: bank.refillAvailable, refillPrice: RULES.entryRefillPrice },
    stalls: { slots: occ.slots, used: occ.used },
    upkeep: await upkeepThisWeek(db, session.stable.id, now),
    horses: rows
      .filter((r) => r.careerStatus !== "pasture")
      .map((r) => {
        const v = stableHorseView(r, silks, nowMs);
        const l = leasedIn.get(r.id);
        return l
          ? {
              ...v,
              lease: {
                leaseId: l.lease.id,
                fromStable: l.otherStableName,
                endsAtMs: l.lease.endsAt.getTime(),
                sharePct: 100 - l.lease.ownerSharePct,
                earned: l.lease.lesseeEarned,
                races: l.lease.races,
                allowAllOut: l.lease.allowAllOut,
                maxLiveStartsPerWeek: l.lease.maxLiveStartsPerWeek,
                returnPending: !!l.lease.endRequestedAt,
              },
            }
          : v;
      }),
    leasedOut: leases
      .filter((l) => l.role === "owner")
      .map((l) => ({
        id: l.horse.id,
        leaseId: l.lease.id,
        horse: horseFromRow(l.horse, silks, nowMs),
        toStable: l.otherStableName,
        endsAtMs: l.lease.endsAt.getTime(),
        ownerSharePct: l.lease.ownerSharePct,
        earned: l.lease.ownerEarned,
        races: l.lease.races,
        returnPending: !!l.lease.endRequestedAt,
      })),
    active,
    inbox: inboxView,
    runs: runs.map((r) => runView(r, names)),
    hasRaced: runs.length > 0 || entries.length > 0 || (await cupRunsOf(db, session.accountId, 1)).length > 0,
    goals,
    tester: !!(await testerForAccount(db, session.accountId)),
    serverNowMs: nowMs,
    news: await stableNews(db, session.accountId),
  };
}

export async function refill(db: Db, session: Session, now: Date) {
  return refillEntries(db, { accountId: session.accountId, now });
}

export interface MyRacesFilter {
  horseId?: string | null;
  kind: "all" | "live" | "story";
  winsOnly: boolean;
}

/**
 * /api/me/races: one page of the stable's settled runs (newest first, its replay one tap
 * away) plus the totals for the same filter. Only races already settled appear.
 */
export async function myRaces(db: Db, session: Session, filter: MyRacesFilter, cursor: string | null, limit = 30): Promise<MyRacesView> {
  const q = { stableId: session.stable.id, horseId: filter.horseId && UUID_RE.test(filter.horseId) ? filter.horseId : null, kind: filter.kind, winsOnly: filter.winsOnly };
  const [page, summary] = [await pageStableRuns(db, q, cursor, limit), await stableRunSummary(db, q)];
  const names = new Map(page.rows.map((r) => [r.horseId, r.horseName]));
  const nowMs = Date.now();
  return {
    rows: page.rows.map((r) => ({ ...runView(r, names), line: formLineOf(r, { nowMs, keeper: true }) as FormLineView })),
    summary,
    nextCursor: page.nextCursor,
  };
}

/**
 * The owner's horse at the off, from its entry snapshot: fatigue (recovered to post time, less a
 * race-day physio) and hours since its last hard work. The owner saw both before entering.
 */
function conditionAtOff(snapshot: unknown, postMs: number): { fatigue: number; hoursSinceHardWork: number | null } | null {
  const state = (snapshot as { state?: gc.HorseState | null } | null)?.state;
  if (!state?.condition) return null;
  const rd = storedRaceDay(snapshot);
  const off = gc.withPhysio(state, rd ? { extras: rd.extras } : null, postMs);
  const last = state.condition.lastHardWorkMs;
  return { fatigue: gc.fatigueAt(off, postMs), hoursSinceHardWork: last === null ? null : Math.max(0, Math.floor((postMs - last) / gc.MS_PER_HOUR)) };
}

/** The viewer's own result in a race. Only after the broadcast is over; settles lazily; marks the inbox read. */
export async function myRaceResult(db: Db, session: Session, raceId: string, now: Date): Promise<MyRaceResult> {
  const race = await loadRace(db, raceId);
  const replay = await replayFor(db, race, now);
  if (!isBroadcastOver(replay, now.getTime())) throw new TooEarlyError(race.postTime.getTime(), "live");
  await settleIfDue(db, raceId, now);
  const fresh = (await dbGetRace(db, raceId))!;
  const mine = await stableEntriesInRace(db, session.stable.id, raceId);
  const story = race.kind === "quick" ? await storyRewardFor(db, raceId) : null;
  const runners = [];
  for (const e of mine) {
    const row = await getHorse(db, e.horseId);
    const pos = e.finishPosition ?? replay.result.finishOrder.find((f) => f.horseId === e.horseId)?.position ?? 0;
    runners.push({
      horseId: e.horseId,
      horseName: row?.name ?? "Your horse",
      position: pos,
      prize: e.prize,
      storyReward: story?.amount ?? 0,
      firstWin: story?.firstWin ?? false,
      ratingBefore: e.ratingBefore,
      ratingAfter: e.ratingAfter,
      atOff: conditionAtOff(e.snapshot, race.postTime.getTime()),
    });
  }
  const firstView = (await markInboxRead(db, { accountId: session.accountId, raceId, now })) > 0;
  return { raceId, settled: fresh.status === "settled", firstView, runners };
}

/** Three generations above `row` (15 horses at most), fetched a generation at a time. */
async function pedigreeTree(db: Db, row: NonNullable<Awaited<ReturnType<typeof getHorse>>>, nowMs: number, depth = 3): Promise<PedigreeNode> {
  const rows = new Map<string, NonNullable<Awaited<ReturnType<typeof getHorse>>>>([[row.id, row]]);
  let level = [row];
  for (let g = 0; g < depth; g++) {
    const ids = [...new Set(level.flatMap((r) => [r.sireId, r.damId]).filter((x): x is string => !!x && !rows.has(x)))];
    const got = (await Promise.all(ids.map((id) => getHorse(db, id)))).filter((r): r is NonNullable<typeof r> => !!r);
    for (const r of got) rows.set(r.id, r);
    level = got;
  }
  const node = (id: string | null, d: number): PedigreeNode | null => {
    const r = id ? rows.get(id) : undefined;
    if (!r) return null;
    const h = horseFromRow(r, DEFAULT_SILKS, nowMs);
    return {
      id: r.id,
      name: r.name,
      regNo: gc.registrationNumber(r.generation, r.regNo),
      sex: h.sex,
      appearance: h.appearance,
      starts: r.starts,
      wins: r.wins,
      generation: r.generation,
      sire: d < depth ? node(r.sireId, d + 1) : null,
      dam: d < depth ? node(r.damId, d + 1) : null,
    };
  };
  return node(row.id, 0)!;
}

export async function horseDetail(db: Db, horseId: string, session: Session | null, now: Date): Promise<HorseDetailView | null> {
  if (!UUID_RE.test(horseId)) return null;
  const row = await getHorse(db, horseId);
  if (!row) return null;
  const nowMs = now.getTime();
  // The form book (every start's form line, no result before settlement) and the splits.
  const form = await horseForm(db, row, session, now);
  const runs: RunView[] = form.lines
    .filter((l) => l.result)
    .slice(0, 20)
    .map((l) => ({
      raceId: l.raceId,
      raceName: l.raceName,
      kind: l.kind,
      horseId: l.horseId,
      horseName: row.name,
      position: l.result!.position,
      fieldSize: l.fieldSize,
      prize: l.result!.prize,
      postTimeMs: l.postTimeMs,
      distanceM: l.distanceM,
      surface: l.surface,
      ratingBefore: l.ratingBefore,
      ratingAfter: l.result!.ratingAfter,
    }));
  const sireLine = await sireLineSplits(db, row, now);
  const parentRows = [row.sireId, row.damId].filter((x): x is string => !!x);
  const parents = new Map<string, { name: string; regNo: string }>();
  for (const id of parentRows) {
    const p = await getHorse(db, id);
    if (p) parents.set(id, { name: p.name, regNo: gc.registrationNumber(p.generation, p.regNo) });
  }
  const parent = (id: string | null) => (id ? { id, name: parents.get(id)?.name ?? "Unknown", regNo: parents.get(id)?.regNo ?? null } : null);
  const pedigree = { sire: parent(row.sireId), dam: parent(row.damId) };
  const tree = await pedigreeTree(db, row, nowMs);
  const regNo = gc.registrationNumber(row.generation, row.regNo);
  // Coat genetics are public stud-book information: any viewer gets them.
  const genetics = geneticsView(row, nowMs);
  // capped = delisted: a stallion with every breeding used no longer stands at stud
  const atStud = (row.studFee !== null || row.studFeeUsdg !== null) && row.sex === "male" && !row.gelded && row.careerStatus !== "pasture" && row.breedingCount < RULES.breedingLifetimeLimit;
  // Resting after a covering (game-core STUD_COOLDOWN_MS): listed, not bookable until then.
  const restingUntil = atStud ? await studRestingUntilOf(db, row.id, now) : null;
  const resting = restingUntil === null ? null : `Resting · available again in ${gc.hoursUntil(restingUntil, nowMs)} h`;
  if (!row.ownerStableId && !row.lesseeStableId) {
    // A Club house stallion standing at stud, or a house runner from the Live card.
    if (row.origin === "house" && atStud) {
      return { horse: horseFromRow(row, DEFAULT_SILKS, nowMs), regNo, kind: "house", stableName: CLUB_STUD_NAME, trainer: null, mine: false, status: null, runs, form, sireLine, pedigree, tree, genetics, stud: { fee: row.studFee!, club: true, resting }, actions: null };
    }
    const house = houseStableFor(row.id);
    return { horse: horseFromRow(row, house.silks, nowMs), regNo, kind: "house", stableName: house.name, trainer: house.trainer, mine: false, status: null, runs, form, sireLine, pedigree, tree, genetics, stud: null, actions: null };
  }
  // A Club horse away on lease (owner null) shows under its lessee's colours like any leased horse.
  const stable = row.ownerStableId ? await getStable(db, row.ownerStableId) : null;
  // On lease the horse races in the lessee's colours; the lessee keeps it, the owner owns it.
  const lessee = row.lesseeStableId ? await getStable(db, row.lesseeStableId) : null;
  const silks = parseSilks((lessee ?? stable)?.silks);
  const owned = session?.stable.id === row.ownerStableId;
  const mine = session?.stable.id === (row.lesseeStableId ?? row.ownerStableId);
  const active = row.lesseeStableId ? await leaseForHorse(db, row.id) : null;
  const lease: HorseDetailView["lease"] = active
    ? {
        leaseId: active.id,
        role: owned ? "owner" : mine ? "lessee" : "public",
        ownerStableName: active.ownerStableName,
        lesseeStableName: active.lesseeStableName,
        endsAtMs: active.endsAt.getTime(),
        ownerSharePct: active.ownerSharePct,
        races: active.races,
        ownerEarned: owned ? active.ownerEarned : 0,
        lesseeEarned: mine ? active.lesseeEarned : 0,
        allowAllOut: active.allowAllOut,
        maxLiveStartsPerWeek: active.maxLiveStartsPerWeek,
        returnPending: !!active.endRequestedAt,
      }
    : null;
  let actions: HorseDetailView["actions"] = null;
  if (owned && !row.lesseeStableId && row.careerStatus !== "pasture") {
    const breeding = await breedingStatus(db, row, now);
    const trade = await tradeStatus(db, row, now);
    actions = {
      cover: row.sex === "female" && breeding.block === null,
      stud: row.sex === "male" && !row.gelded && (breeding.block === null || breeding.block === "season_limit" || breeding.block === "stud_resting"),
      sell: trade.lock === null || trade.lock === "listed",
    };
  }
  return {
    horse: horseFromRow(row, silks, nowMs),
    regNo,
    kind: "player",
    stableName: stable?.name ?? (row.ownerStableId ? "Private stable" : CLUB_OWNER_NAME),
    trainer: null,
    mine,
    owned,
    lease,
    status: mine ? stableHorseView(row, silks, nowMs) : null,
    runs,
    form,
    sireLine,
    pedigree,
    tree,
    genetics,
    stud: atStud ? { fee: row.studFee ?? 0, club: false, feeUsdg: row.studFeeUsdg, resting } : null,
    actions,
  };
}

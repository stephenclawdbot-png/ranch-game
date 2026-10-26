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
import { HorseSchema, RunningStyleSchema, type Horse, type RaceClass, type RaceConfig, type RaceReplay, type RaceBroadcastChunk, type RaceBroadcastHeader } from "@thoroughbred/shared";
import { ENGINE_VERSION, SAMPLE_EVERY, TICK_HZ, commitSeed, simulateRace, verifyReplay } from "@thoroughbred/racing-engine";
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
  getStable,
  isGenome,
  listCardRaces,
  listHorseRuns,
  listInbox,
  listRaceEntries,
  listStableEntries,
  listStableHorses,
  listStableRuns,
  lockField,
  markInboxRead,
  occupancy,
  refillEntries,
  scratchEntry,
  settleRace,
  stableEntriesInRace,
  storyRewardFor,
  storyState,
  ensureLeagueMembership,
  tickRaceCard,
  toHorseState,
  RULES,
  type CardHooks,
  type Db,
  type FieldRunner,
  type HorseRow,
  type LockedField,
  type PublicRace,
  type RaceConditions,
  type RaceEntryRow,
  type RunnerOutcome,
} from "@thoroughbred/db";
import { conditionRating } from "@/lib/aptitude";
import type {
  ActiveEntry,
  FieldEntry,
  HorseDetailView,
  InboxView,
  MyRaceResult,
  PlayerView,
  RaceCard,
  RaceKind,
  RacePlan,
  RaceSummary,
  RiskView,
  RunView,
} from "@/lib/types";
import { RaceNotFoundError, TooEarlyError } from "./errors";
import { houseStableFor } from "./house";
import { houseOwnerFor, settleStoryRace } from "./storyField";
import { bigCrowd, engineHorseFromSnapshot, horseFromRow, parsePlan, parseSilks, raceConds, raceRisk, raceTier, stableHorseView } from "./horseView";
import { broadcastEndsAtMs, broadcastStartMs, isBroadcastOver, sliceBroadcast } from "./live";
import type { Session } from "./session";

// ---------------------------------------------------------------------------
// Hooks, ids, small helpers
// ---------------------------------------------------------------------------

/** Field hooks: entry snapshots become engine Horses (game-core raceSnapshot) when the field locks. */
export const raceHooks: CardHooks = {
  engineHorse: ({ snapshot, race, isHouse }) => engineHorseFromSnapshot(snapshot, race, isHouse),
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
  return parsed.success ? parsed.data : engineHorseFromSnapshot(r.horse as Record<string, unknown>, race, r.isHouse);
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

function inputFrom(race: PublicRace, field: LockedField, seed: string) {
  return {
    race: raceConfig(race),
    entries: field.runners.map((r) => ({ gate: r.gate, tactic: (RunningStyleSchema.safeParse(r.tactic).success ? r.tactic : "stalker") as Horse["style"], horse: runnerHorse(r, race) })),
    seed,
  };
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
export async function driveCard(db: Db, now: Date, opts: { force?: boolean; maintenance?: boolean } = {}): Promise<DriveReport | null> {
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
    (id) => ({ intensity: parsePlan(snapshotOf(byHorse.get(id)).plan).intensity, vetLevel: 0 }),
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
  if (!race.field && now >= race.entriesCloseAt && race.status === "open") {
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
          horse: runnerHorse(r, race),
          stableName: stableNameOf(e, r.horseId, r.isHouse, race),
          isPlayer: !r.isHouse,
          mine: !!viewerStableId && r.stableId === viewerStableId,
        };
      })
      .sort((a, b) => a.gate - b.gate);
  } else {
    list = entries.map((e) => ({
      gate: 0,
      tactic: e.tactic as FieldEntry["tactic"],
      horse: engineHorseFromSnapshot(snapshotOf(e), race, e.isHouse),
      stableName: stableNameOf(e, e.horseId, e.isHouse, race),
      isPlayer: !e.isHouse,
      mine: !!viewerStableId && e.stableId === viewerStableId,
    }));
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
    engineVersion: ENGINE_VERSION,
  };
}

async function summarize(db: Db, race: PublicRace & { entered: number; mine: number }, now: Date): Promise<RaceSummary> {
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
    fieldSize: race.field ? (race.field as LockedField).runners.length : race.entered,
    targetRunners: race.targetRunners,
    phase: phaseOf(race, now, null),
    mine: race.mine,
  };
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

/** The Live card: the next races (entries open or closed) and the latest ones (live first, then results). */
export async function raceList(db: Db, now: Date, viewerStableId: string | null, opts: { upcoming?: number; recent?: number } = {}) {
  await driveCard(db, now);
  const nowMs = now.getTime();
  const ahead = await listCardRaces(db, { from: new Date(nowMs + 1), to: new Date(nowMs + RULES.cardHorizonMs), stableId: viewerStableId });
  const behind = await listCardRaces(db, { from: new Date(nowMs - 8 * RULES.slotMs), to: now, stableId: viewerStableId });
  const upcoming = await Promise.all(ahead.slice(0, opts.upcoming ?? 6).map((r) => summarize(db, r, now)));
  const recent = await Promise.all(
    behind
      .filter((r) => r.status !== "cancelled")
      .reverse()
      .slice(0, opts.recent ?? 6)
      .map((r) => summarize(db, r, now)),
  );
  return { upcoming, recent };
}

/** Outcome-free header for a locked field, identical to broadcastHeader(replay) once simulated. */
function headerFromField(race: PublicRace, field: LockedField): RaceBroadcastHeader {
  const runners = [...field.runners].sort((a, b) => a.gate - b.gate);
  return {
    version: 1,
    engineVersion: ENGINE_VERSION,
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
 * finish has been broadcast).
 */
export async function liveChunk(db: Db, id: string, fromFrame: number, now: Date): Promise<RaceBroadcastChunk> {
  if (!isRaceId(id)) throw new RaceNotFoundError(id);
  await driveCard(db, now);
  const race = await loadRace(db, id);
  if (now < race.postTime) {
    const field = (race.field as LockedField | null) ?? (now >= race.entriesCloseAt ? await lockField(db, id, now, raceHooks) : null);
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
  return sliceBroadcast(replay, fromFrame, now.getTime());
}

/** Full replay with the revealed seed: only once the finish has been broadcast. */
export async function servedReplay(db: Db, id: string, now: Date): Promise<RaceReplay> {
  const race = await loadRace(db, id);
  const replay = await replayFor(db, race, now);
  if (!isBroadcastOver(replay, now.getTime())) throw new TooEarlyError(race.postTime.getTime(), "live");
  return replay;
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
  return { commitmentOk, resultHashOk, seed: input.seed, seedCommitment: commitment, resultHash: fresh.result.resultHash, engineVersion: ENGINE_VERSION };
}

// ---------------------------------------------------------------------------
// Entering Live races, Quick Pick
// ---------------------------------------------------------------------------

function entryMeta(session: Session, plan: RacePlan) {
  return { plan, silks: parseSilks(session.stable.silks), stableName: session.stable.name, accountId: session.accountId };
}

export async function enterLive(db: Db, session: Session, raceId: string, horseId: string, plan: RacePlan, now: Date) {
  if (!isRaceId(raceId)) throw new RaceNotFoundError(raceId);
  await driveCard(db, now);
  const race = await loadRace(db, raceId);
  if (race.kind === "quick") throw new DomainError("NOT_ELIGIBLE", "Story races are entered from Story mode");
  // Licences only ever go up, so checking the request's stable row is safe outside the entry transaction.
  const licence = licenceReason(race, session.stable.licenceLevel);
  if (licence) throw new DomainError("NOT_ELIGIBLE", licence);
  const entry = await enterRace(db, { accountId: session.accountId, raceId, horseId, tactic: plan.tactic, now, meta: entryMeta(session, plan) });
  // Racing Live puts the stable in this week's league (idempotent; never blocks the entry).
  await ensureLeagueMembership(db, { accountId: session.accountId, now }).catch((e) => console.error("[game] league join failed", e));
  return { raceId, horseId: entry.horseId, postTimeMs: race.postTime.getTime(), entriesCloseAtMs: race.entriesCloseAt.getTime() };
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
  const block = gc.licenceBlock(licenceLevel, raceTier(race), race.kind === "feature" || race.kind === "final");
  return block ? `Needs a ${block.name}: earn it in Story mode` : null;
}

/** Why a horse can't enter this race (null = eligible): licence, game-core entry rules + the race's rating band. */
export function entryReason(row: HorseRow, race: PublicRace, now: Date, licenceLevel?: number): string | null {
  if (row.lockKind) return row.lockKind === "race" ? "Already entered in a race" : "Listed on the market";
  const licence = licenceLevel === undefined ? null : licenceReason(race, licenceLevel);
  if (licence) return licence;
  if (!isGenome(row.genome)) return null;
  const state = toHorseState(row);
  const block = gc.entryBlock(state, slotFor(race), now.getTime());
  if (block) return BLOCK_REASON[block] ?? block;
  const c = race.conditions as RaceConditions;
  if (c.maxWins !== undefined && row.wins > c.maxWins) return c.maxWins === 0 ? "Maidens only (no wins yet)" : `At most ${c.maxWins} wins`;
  if (c.minRating !== undefined && row.rating < c.minRating) return `Rating ${row.rating} is below the band (${c.minRating}+)`;
  if (c.maxRating !== undefined && row.rating > c.maxRating) return `Rating ${row.rating} is above the band (up to ${c.maxRating})`;
  return null;
}

const BLOCK_REASON: Record<string, string> = {
  not_racing_age: "Not yet of racing age",
  retired: "Retired from racing",
  injured: "Recovering from injury",
  daily_limit: "Raced 3 times today",
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
}

/** Per-horse eligibility, fit and injury risk for a race (the entry sheet). */
export async function entryOptions(db: Db, session: Session, raceId: string, now: Date): Promise<{ race: RaceSummary; options: EntryOption[] }> {
  const race = await loadRace(db, raceId);
  const silks = parseSilks(session.stable.silks);
  const rows = (await listStableHorses(db, session.stable.id)).filter((r) => r.careerStatus === "racing");
  const entered = (await listRaceEntries(db, raceId)).filter((e) => e.stableId === session.stable.id);
  const options = rows.map((row) => {
    const horse = horseFromRow(row, silks, now.getTime());
    const already = entered.some((e) => e.horseId === row.id);
    return {
      horseId: row.id,
      reason: already ? "Entered" : race.kind === "quick" ? null : entryReason(row, race, now, session.stable.licenceLevel),
      fitLoss: fitLoss(horse, race),
      risk: {
        conservative: raceRisk(row, race, "conservative", now.getTime()),
        normal: raceRisk(row, race, "normal", now.getTime()),
        all_out: raceRisk(row, race, "all_out", now.getTime()),
      },
    };
  });
  const summary = await summarize(db, { ...race, entered: (await listRaceEntries(db, raceId)).length, mine: entered.length }, now);
  return { race: summary, options };
}

export interface LivePick {
  raceId: string;
  raceName: string;
  horseId: string;
  horseName: string;
  tactic: Horse["style"];
  postTimeMs: number;
  reason: string;
}

/**
 * Live Quick Pick (§4d): enter the best-fit fresh horse into the next suitable race on the
 * card. Races are tried soonest first; a horse must be eligible (game-core rules + band) and
 * fit the trip and ground well (grade B or better), else the best fit in the next few races.
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
  const card = (await listCardRaces(db, { from: new Date(nowMs + 1), to: new Date(nowMs + RULES.cardHorizonMs), stableId: session.stable.id }))
    .filter((r) => r.status === "open" && r.entriesCloseAt.getTime() > nowMs + 5_000 && r.entered < r.maxRunners)
    .slice(0, 8);
  let best: { race: PublicRace; c: (typeof pool)[number]; loss: number; wait: number } | null = null;
  for (const [i, race] of card.entries()) {
    const fits = pool.filter((c) => entryReason(c.row, race, now, session.stable.licenceLevel) === null).map((c) => ({ c, loss: fitLoss(c.horse, race) + c.view.ranToday * 15 }));
    fits.sort((a, b) => a.loss - b.loss);
    const top = fits[0];
    if (!top) continue;
    if (top.loss <= 25) {
      best = { race, c: top.c, loss: top.loss, wait: i };
      break;
    }
    if (!best || top.loss + i * 4 < best.loss + best.wait * 4) best = { race, c: top.c, loss: top.loss, wait: i };
  }
  if (!best) throw new DomainError("NOT_ELIGIBLE", "no race on the card suits your horses right now");
  const { race, c } = best;
  const plan: RacePlan = { tactic: c.horse.style, intensity: "normal" };
  await enterLive(db, session, race.id, c.row.id, plan, now);
  const conds = raceConds(race);
  const fitWord = best.loss <= 10 ? "a great fit" : best.loss <= 25 ? "a good fit" : "the best fit on the card";
  return {
    raceId: race.id,
    raceName: race.name,
    horseId: c.row.id,
    horseName: c.horse.name,
    tactic: plan.tactic,
    postTimeMs: race.postTime.getTime(),
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
    await enterRace(db, { accountId: session.accountId, raceId: race.id, horseId: row.id, tactic: plan.tactic, now: enterAt, meta: entryMeta(session, plan) });
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
  const or = row.rating;
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
export async function playerView(db: Db, session: Session, now: Date): Promise<PlayerView> {
  await driveCard(db, now);
  const nowMs = now.getTime();
  const silks = parseSilks(session.stable.silks);
  const rows = await listStableHorses(db, session.stable.id);
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const [credits, bank, occ, entries, inbox, runs] = [
    await getBalance(db, session.accountId),
    await getEntryBank(db, { accountId: session.accountId, now }),
    await occupancy(db, session.stable),
    await listStableEntries(db, session.stable.id),
    await listInbox(db, session.accountId, 20),
    await listStableRuns(db, session.stable.id, 30),
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
    credits,
    entries: { balance: bank.balance, cap: bank.cap, allowance: bank.allowance, refillAvailable: bank.refillAvailable, refillPrice: RULES.entryRefillPrice },
    stalls: { slots: occ.slots, used: occ.used },
    horses: rows.filter((r) => r.careerStatus !== "pasture").map((r) => stableHorseView(r, silks, nowMs)),
    active,
    inbox: inboxView,
    runs: runs.map((r) => runView(r, names)),
    serverNowMs: nowMs,
  };
}

export async function refill(db: Db, session: Session, now: Date) {
  return refillEntries(db, { accountId: session.accountId, now });
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
    });
  }
  const firstView = (await markInboxRead(db, { accountId: session.accountId, raceId, now })) > 0;
  return { raceId, settled: fresh.status === "settled", firstView, runners };
}

export async function horseDetail(db: Db, horseId: string, session: Session | null, now: Date): Promise<HorseDetailView | null> {
  if (!UUID_RE.test(horseId)) return null;
  const row = await getHorse(db, horseId);
  if (!row) return null;
  const nowMs = now.getTime();
  const runs = (await listHorseRuns(db, horseId, 20)).map((r) => runView(r, new Map([[row.id, row.name]])));
  if (!row.ownerStableId) {
    const house = houseStableFor(row.id);
    return { horse: horseFromRow(row, house.silks, nowMs), kind: "house", stableName: house.name, trainer: house.trainer, mine: false, status: null, runs };
  }
  const stable = await getStable(db, row.ownerStableId);
  const silks = parseSilks(stable?.silks);
  const mine = session?.stable.id === row.ownerStableId;
  return {
    horse: horseFromRow(row, silks, nowMs),
    kind: "player",
    stableName: stable?.name ?? "Private stable",
    trainer: null,
    mine,
    status: mine ? stableHorseView(row, silks, nowMs) : null,
    runs,
  };
}

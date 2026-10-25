/**
 * Race scheduling, stateless quick-race ids, seeds and replays.
 *
 * Nothing here needs storage:
 *  - Scheduled races are a pure function of their slot index (`s-<slot>`).
 *  - Quick races carry their own (signed) parameters inside the race id, so any
 *    server instance can rebuild the exact same field and conditions.
 *  - Seeds are HMAC(secret, "seed:" + raceId); the commitment sha256(seed) is shown
 *    before post time and the seed is only revealed once the race has run.
 *  - The engine is deterministic, so a replay can be recomputed on every request;
 *    an in-memory LRU just saves the few milliseconds.
 */
import type { Horse, RaceClass, RaceConfig, RaceInput, RaceReplay, RunningStyle, Silks, Surface, Weather, Going } from "@thoroughbred/shared";
import { RunningStyleSchema } from "@thoroughbred/shared";
import { z } from "zod";
import { decodeSilks, encodeSilks } from "@/lib/silks";
import { commitSeed, deriveSeed, simulateRace, verifyReplay, ENGINE_VERSION } from "./engine";
import {
  RIVAL_POOL,
  STARTER_COUNT,
  defaultPlayerSilks,
  isValidPlayerId,
  ownerStableName,
  starterHorses,
} from "./demoData";
import { createRng, type Rng } from "./prng";
import { broadcastEndsAtMs, isBroadcastOver } from "./live";

// ---------------------------------------------------------------------------
// Constants & errors
// ---------------------------------------------------------------------------

/** A scheduled race goes off every 3 minutes, counted from this fixed epoch. */
export const SLOT_MS = 180_000;
export const SCHEDULE_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
/** Gate-loading countdown for quick races. */
export const QUICK_POST_DELAY_MS = 10_000;
export const DISTANCES_M = [1000, 1200, 1400, 1600, 2000, 2400] as const;

const DEV_SECRET = "thoroughbred-DEV-ONLY-seed-secret--set-RACE_SEED_SECRET-in-production";
let warnedSecret = false;

/** Server secret for seeds and race-id signatures. */
export function seedSecret(): string {
  const s = process.env.RACE_SEED_SECRET;
  if (s && s.length >= 16) return s;
  if (!warnedSecret && process.env.NODE_ENV === "production") {
    warnedSecret = true;
    console.warn("[races] RACE_SEED_SECRET is not set; using the public DEV fallback. Race seeds are predictable.");
  }
  return DEV_SECRET;
}

export class RaceNotFoundError extends Error {
  constructor(id: string) {
    super(`race not found: ${id.slice(0, 40)}`);
    this.name = "RaceNotFoundError";
  }
}

export class TooEarlyError extends Error {
  /** "live": the race is running on the broadcast clock; never carries a finish time. */
  constructor(
    public readonly postTimeMs: number,
    public readonly phase: "upcoming" | "live" = "upcoming",
  ) {
    super(phase === "live" ? "race is still running" : "race has not started yet");
    this.name = "TooEarlyError";
  }
}

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface FieldEntry {
  gate: number;
  tactic: RunningStyle;
  horse: Horse;
  stableName: string;
  isPlayer: boolean;
}

export type RaceKind = "scheduled" | "quick";

export interface RaceCard {
  id: string;
  kind: RaceKind;
  config: RaceConfig;
  /** Sorted by gate. Never includes the seed. */
  field: FieldEntry[];
  seedCommitment: string;
  /** "live" from post time until the finish has been broadcast; "finished" once the result can be revealed. */
  status: "upcoming" | "live" | "finished";
  /** For quick races: the entering player's id. */
  playerId: string | null;
  engineVersion: string;
}

export interface RaceSummary {
  id: string;
  name: string;
  distanceM: number;
  surface: Surface;
  going: Going;
  weather: Weather;
  raceClass: RaceClass;
  purse: number;
  postTimeMs: number;
  fieldSize: number;
  /** live = post time passed but the finish has not been broadcast yet. */
  phase: "upcoming" | "live" | "finished";
  /** When the result became official. Only present once finished (it would reveal the final time while live). */
  endsAtMs?: number;
  /** Only present once the race has finished in real time (no spoilers for live viewers). */
  winner?: { horseId: string; name: string; stableName: string; timeUs: number };
}

// ---------------------------------------------------------------------------
// Conditions & names
// ---------------------------------------------------------------------------

const PLACES = ["Harbour", "Copperfield", "Saltmarsh", "Wrenfield", "Blackwater", "Kingsmead", "Fenwick", "Ashby", "Ravenhill", "Oakhurst", "Larkhill", "Thornbury"];
const SPONSORS = ["Copperfield", "Midsummer", "Coronation", "Lantern", "Meridian", "Sovereign", "Brassmoor", "Juniper", "Wexford", "Gilded Spur", "Old Bell", "Nightjar"];

export const CLASS_PURSE: Record<RaceClass, number> = { maiden: 2000, novice: 3000, handicap: 4500, listed: 8000, graded: 15000 };

function goingFor(rng: Rng, surface: Surface, weather: Weather): Going {
  if (surface === "synthetic") return rng.pick(["good", "good", "firm"] as const);
  if (weather === "rain") return surface === "turf" ? rng.pick(["soft", "heavy"] as const) : rng.pick(["soft", "heavy", "good"] as const);
  if (weather === "overcast") return rng.pick(["good", "good", "soft"] as const);
  return surface === "turf" ? rng.pick(["firm", "good"] as const) : rng.pick(["firm", "good", "good"] as const);
}

function raceName(rng: Rng, raceClass: RaceClass, distanceM: number): string {
  const place = rng.pick(PLACES);
  const sponsor = rng.pick(SPONSORS);
  switch (raceClass) {
    case "graded":
      return distanceM >= 2000 ? `The ${sponsor} Gold Cup` : `The ${sponsor} Stakes`;
    case "listed":
      return distanceM <= 1200 ? `The ${sponsor} Sprint Trophy` : `The ${sponsor} Trophy`;
    case "handicap":
      return `${place} ${distanceM === 1600 ? "Mile" : distanceM <= 1200 ? "Sprint" : distanceM >= 2000 ? "Stayers'" : "Classic"} Handicap`;
    case "novice":
      return `${place} Novice Stakes`;
    default:
      return `${place} Maiden Plate`;
  }
}

function purseFor(raceClass: RaceClass, distanceM: number): number {
  // Longer races pay a little more; always a round number.
  return Math.round((CLASS_PURSE[raceClass] * (900 + distanceM / 8)) / 1000 / 100) * 100;
}

function makeConditions(rng: Rng, distanceM: number, raceClass: RaceClass) {
  const surface = rng.weighted<Surface>([["turf", 5], ["dirt", 4], ["synthetic", 2]]);
  const weather = rng.weighted<Weather>([["clear", 5], ["overcast", 3], ["rain", 2], ["dusk", 2]]);
  const going = goingFor(rng, surface, weather);
  return { surface, weather, going, name: raceName(rng, raceClass, distanceM), purse: purseFor(raceClass, distanceM) };
}

// ---------------------------------------------------------------------------
// Ratings (form guide)
// ---------------------------------------------------------------------------

/**
 * Pre-race rating on the stat scale (a plain 650 horse in ideal conditions rates 650):
 * how strong this horse should be under these conditions with this tactic. It mirrors the
 * engine's deterministic profile terms; day form, traffic and pace noise are left out, so it is
 * an expectation, not a prediction. Used to pick the favourite, build class-graded fields and
 * in the balance tests. The simulation itself never reads it.
 */
export function raceRating(horse: Horse, tactic: RunningStyle, race: Pick<RaceConfig, "distanceM" | "surface" | "going">): number {
  const s = horse.stats;
  const D = race.distanceM;
  const adaptGap = 1000 - s.adaptability;
  const matched = horse.style === tactic;
  // Cruise-speed terms, mirroring packages/racing-engine/src/model.ts (mm/s).
  let cruise = ((s.speed - 650) * 105) / 100;
  if (horse.preferredSurface !== race.surface) cruise -= 40 + (110 * adaptGap) / 1000;
  cruise -= ({ firm: 0, good: 0, soft: 140, heavy: 300 }[race.going] * adaptGap) / 1000;
  const distDelta = D - horse.preferredDistanceM;
  if (distDelta < 0) cruise += (distDelta * (1100 - s.adaptability)) / 6000;
  cruise += matched ? 15 : -15;
  // Energy drain multiplier (permille), same terms as the engine.
  const stamMul = 1000 + ((650 - s.stamina) * ((Math.max(0, D - 800) * 9) / 20)) / 1000;
  const distMul = distDelta > 0 ? 1000 + (distDelta * (1100 - s.adaptability)) / 3000 : 1000;
  const durMul = 1000 + (600 - s.durability) / 6;
  const tacMul = matched ? 994 : 1006;
  const drain = (stamMul * distMul * durMul * tacMul) / 1e9;
  const drainRef = (1000 * 1000 * (1000 + (600 - 650) / 6) * 994) / 1e9; // a plain 650 horse, ideal conditions
  // Convert to speed points. Weights measured with tools/balance/stats.report.ts: 1 permille of
  // drain ~ 0.75 speed points; burst is worth more in sprints; temperament ~ 0.22.
  const burstW = 0.4 - (D - 1000) / 7000;
  const r = 650 + cruise / 1.05 - 0.75 * (drain - drainRef) + burstW * (s.burst - 650) + 0.22 * (s.temperament - 650);
  return Math.round(r);
}

/**
 * Class windows over the rival pool ranked by rating for the race's conditions (0 = best,
 * 1 = worst). Graded races take the best horses for the trip and ground, maidens the weakest;
 * windows overlap so horses move between classes as conditions change. Handicaps take a
 * middle slice, so their fields are tightly matched.
 */
export const CLASS_WINDOW: Record<RaceClass, readonly [number, number]> = {
  graded: [0, 0.28],
  listed: [0.14, 0.46],
  handicap: [0.3, 0.64],
  novice: [0.46, 0.84],
  maiden: [0.62, 1],
};

/** Rivals ranked best-first by rating for these conditions (ties broken by id, so it is stable). */
function rankedPool(race: Pick<RaceConfig, "distanceM" | "surface" | "going">): Horse[] {
  return RIVAL_POOL.map((h) => ({ h, r: raceRating(h, h.style, race) }))
    .sort((a, b) => b.r - a.r || (a.h.id < b.h.id ? -1 : 1))
    .map((x) => x.h);
}

/** `size` rivals drawn from the class window for these conditions. */
export function classField(rng: Rng, race: Pick<RaceConfig, "distanceM" | "surface" | "going" | "raceClass">, size: number): Horse[] {
  const ranked = rankedPool(race);
  const n = ranked.length;
  const [lo, hi] = CLASS_WINDOW[race.raceClass];
  let from = Math.floor(lo * n);
  let to = Math.ceil(hi * n);
  // Always leave room to draw a full field.
  if (to - from < size) {
    to = Math.min(n, from + size);
    from = Math.max(0, to - size);
  }
  return rng.shuffle(ranked.slice(from, to)).slice(0, size);
}

// ---------------------------------------------------------------------------
// Scheduled races
// ---------------------------------------------------------------------------

const SCHEDULED_RE = /^s-(\d{1,9})$/;

export function slotPostTime(slot: number): number {
  return SCHEDULE_EPOCH_MS + slot * SLOT_MS;
}

/** Index of the most recent slot whose post time is <= now. */
export function currentSlot(nowMs: number): number {
  return Math.floor((nowMs - SCHEDULE_EPOCH_MS) / SLOT_MS);
}

function scheduledCard(slot: number): Omit<RaceCard, "status" | "seedCommitment"> {
  const id = `s-${slot}`;
  const rng = createRng(`schedule:${id}`);
  const distanceM = DISTANCES_M[slot % DISTANCES_M.length]!;
  const raceClass = rng.weighted<RaceClass>([["maiden", 2], ["novice", 3], ["handicap", 4], ["listed", 2], ["graded", 1]]);
  const c = makeConditions(rng, distanceM, raceClass);
  const config: RaceConfig = { id, name: c.name, distanceM, surface: c.surface, weather: c.weather, going: c.going, raceClass, postTimeMs: slotPostTime(slot), purse: c.purse };

  const fieldRng = createRng(`field:${id}`);
  const size = fieldRng.int(8, 12);
  const horses = classField(fieldRng, config, size);
  const gates = fieldRng.shuffle(Array.from({ length: size }, (_, i) => i + 1));
  const field = horses.map((horse, i) => ({
    gate: gates[i]!,
    // House trainers mostly ride to the horse's natural style, sometimes they gamble.
    tactic: fieldRng.chance(1, 6) ? fieldRng.pick(RunningStyleSchema.options) : horse.style,
    horse,
    stableName: ownerStableName(horse.ownerId) ?? "Independent",
    isPlayer: false,
  }));
  return { id, kind: "scheduled", config, field: sortByGate(field), playerId: null, engineVersion: ENGINE_VERSION };
}

// ---------------------------------------------------------------------------
// Quick races (signed, stateless ids)
// ---------------------------------------------------------------------------

export const StableNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[\p{L}\p{N} '&.\-]+$/u, "letters, numbers, spaces and ' & . - only");

const QuickPayloadSchema = z.object({
  v: z.literal(1),
  p: z.string().regex(/^[a-z0-9]{10,24}$/),
  h: z.number().int().min(0).max(STARTER_COUNT - 1),
  t: RunningStyleSchema,
  ts: z.number().int().positive(),
  n: z.string().regex(/^[a-z0-9]{6,16}$/),
  c: z.number().int().min(0),
  /** Player silks ("pattern.rrggbb.rrggbb.rrggbb") and stable name, so the card shows the player's colours. */
  s: z.string().max(40).optional(),
  sn: StableNameSchema.optional(),
});
type QuickPayload = z.infer<typeof QuickPayloadSchema>;

/**
 * Templates for quick races. `c` in the race id indexes this list. Quick races are where a new
 * stable races, so they are mostly maiden and novice company (where modest starters can win),
 * with a handicap now and then as a stretch target that pays more.
 */
const QUICK_TEMPLATES: readonly { distanceM: number; raceClass: RaceClass }[] = [
  ...DISTANCES_M.map((distanceM) => ({ distanceM, raceClass: "maiden" as const })),
  ...DISTANCES_M.map((distanceM) => ({ distanceM, raceClass: "novice" as const })),
  { distanceM: 1200, raceClass: "handicap" },
  { distanceM: 1600, raceClass: "handicap" },
  { distanceM: 2000, raceClass: "handicap" },
];

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

function sign(payload: string): string {
  return deriveSeed(seedSecret(), payload).slice(0, 16);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomNonce(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

export interface QuickRaceRequest {
  playerId: string;
  horseIndex: number;
  tactic: RunningStyle;
  silks?: Silks;
  stableName?: string;
}

/** Creates a signed quick-race id. Post time is now + 10 s. */
export function createQuickRace(req: QuickRaceRequest, nowMs: number, nonce = randomNonce()): { raceId: string; postTimeMs: number } {
  if (!isValidPlayerId(req.playerId)) throw new Error("invalid playerId");
  const horse = starterHorses(req.playerId)[req.horseIndex];
  if (!horse) throw new Error("invalid horseIndex");
  // Bias the draw towards the horse's preferred trip so a fresh stable stays competitive.
  const rng = createRng(`quick-config:${req.playerId}:${nonce}`);
  const near = QUICK_TEMPLATES.map((t, i) => ({ t, i })).filter(({ t }) => Math.abs(t.distanceM - horse.preferredDistanceM) <= 400);
  const c = near.length > 0 && rng.chance(2, 3) ? rng.pick(near).i : rng.int(0, QUICK_TEMPLATES.length - 1);
  const postTimeMs = Math.ceil((nowMs + QUICK_POST_DELAY_MS) / 1000) * 1000;
  const payload: QuickPayload = {
    v: 1,
    p: req.playerId,
    h: req.horseIndex,
    t: req.tactic,
    ts: postTimeMs,
    n: nonce,
    c,
    ...(req.silks ? { s: encodeSilks(req.silks) } : {}),
    ...(req.stableName ? { sn: req.stableName } : {}),
  };
  const body = b64urlEncode(JSON.stringify(payload));
  return { raceId: `${body}.${sign(body)}`, postTimeMs };
}

/** Verifies the signature and decodes a quick-race id. Returns null when invalid or tampered. */
export function decodeQuickRaceId(id: string): QuickPayload | null {
  if (id.length > 600) return null;
  const dot = id.indexOf(".");
  if (dot <= 0 || dot !== id.lastIndexOf(".")) return null;
  const body = id.slice(0, dot);
  const sig = id.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[0-9a-f]{16}$/.test(sig)) return null;
  if (!safeEqual(sig, sign(body))) return null;
  try {
    const parsed = QuickPayloadSchema.safeParse(JSON.parse(b64urlDecode(body)));
    if (!parsed.success || parsed.data.c >= QUICK_TEMPLATES.length) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function quickCard(id: string, q: QuickPayload): Omit<RaceCard, "status" | "seedCommitment"> {
  const template = QUICK_TEMPLATES[q.c]!;
  const rng = createRng(`quick:${id}`);
  const c = makeConditions(rng, template.distanceM, template.raceClass);
  const config: RaceConfig = {
    id,
    name: c.name,
    distanceM: template.distanceM,
    surface: c.surface,
    weather: c.weather,
    going: c.going,
    raceClass: template.raceClass,
    postTimeMs: q.ts,
    purse: c.purse,
  };
  const silks = (q.s && decodeSilks(q.s)) || defaultPlayerSilks(q.p);
  const playerHorse = starterHorses(q.p, silks)[q.h]!;
  const size = rng.int(8, 12);
  const rivals = classField(rng, config, size - 1);
  const gates = rng.shuffle(Array.from({ length: size }, (_, i) => i + 1));
  const field: FieldEntry[] = [
    { gate: gates[0]!, tactic: q.t, horse: playerHorse, stableName: q.sn ?? "Your stable", isPlayer: true },
    ...rivals.map((horse, i) => ({
      gate: gates[i + 1]!,
      tactic: horse.style,
      horse,
      stableName: ownerStableName(horse.ownerId) ?? "Independent",
      isPlayer: false,
    })),
  ];
  return { id, kind: "quick", config, field: sortByGate(field), playerId: q.p, engineVersion: ENGINE_VERSION };
}

// ---------------------------------------------------------------------------
// Lookup, seeds, replays
// ---------------------------------------------------------------------------

function sortByGate<T extends { gate: number }>(field: T[]): T[] {
  return field.sort((a, b) => a.gate - b.gate);
}

function baseCard(id: string): Omit<RaceCard, "status" | "seedCommitment"> | null {
  const s = SCHEDULED_RE.exec(id);
  if (s) {
    const slot = Number(s[1]);
    return Number.isSafeInteger(slot) ? scheduledCard(slot) : null;
  }
  const q = decodeQuickRaceId(id);
  return q ? quickCard(id, q) : null;
}

function raceSeed(raceId: string): string {
  return deriveSeed(seedSecret(), `seed:${raceId}`);
}

/** Race card (never includes the seed). Throws RaceNotFoundError. */
export function getRace(id: string, nowMs: number): RaceCard {
  const base = baseCard(id);
  if (!base) throw new RaceNotFoundError(id);
  return {
    ...base,
    seedCommitment: commitSeed(raceSeed(id)),
    status: nowMs < base.config.postTimeMs ? "upcoming" : isBroadcastOver(computeReplay(id), nowMs) ? "finished" : "live",
  };
}

/** The immutable simulation input. Contains the seed: server-only. */
export function getRaceInput(id: string): RaceInput {
  const base = baseCard(id);
  if (!base) throw new RaceNotFoundError(id);
  return {
    race: base.config,
    entries: base.field.map(({ gate, tactic, horse }) => ({ gate, tactic, horse })),
    seed: raceSeed(id),
  };
}

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

const replayCache = new Lru<RaceReplay>(256);

/**
 * The complete simulated race, regardless of the clock. SERVER-ONLY: it contains the seed and
 * result. Serve it only through getReplay() or live.ts (sliceBroadcast), which enforce the clock.
 */
export function computeReplay(id: string): RaceReplay {
  const cached = replayCache.get(id);
  if (cached) return cached;
  const replay = simulateRace(getRaceInput(id));
  replayCache.set(id, replay);
  return replay;
}

/**
 * Full replay including the revealed seed — only once the finish has been broadcast.
 * Throws TooEarlyError before post time ("upcoming") and while the race is running ("live").
 */
export function getReplay(id: string, nowMs: number): RaceReplay {
  const replay = computeReplay(id);
  if (nowMs < replay.race.postTimeMs) throw new TooEarlyError(replay.race.postTimeMs);
  if (!isBroadcastOver(replay, nowMs)) throw new TooEarlyError(replay.race.postTimeMs, "live");
  return replay;
}

export function replayDurationMs(replay: RaceReplay): number {
  return Math.ceil((replay.totalTicks * 1000) / replay.tickHz);
}

export interface VerifyResult {
  commitmentOk: boolean;
  resultHashOk: boolean;
  seed: string;
  seedCommitment: string;
  resultHash: string;
  engineVersion: string;
}

/**
 * Re-simulates from scratch (bypassing the cache) and checks:
 *  - commitmentOk: sha256(revealed seed) equals the commitment (the one the client saw, if provided)
 *  - resultHashOk: the fresh simulation reproduces the served result hash (and the client's, if provided)
 */
export function verifyRace(id: string, nowMs: number, claimed: { commitment?: string; resultHash?: string } = {}): VerifyResult {
  const served = getReplay(id, nowMs);
  const input = getRaceInput(id);
  const fresh = simulateRace(input);
  const commitment = commitSeed(input.seed);
  const commitmentOk = commitment === served.seedCommitment && (claimed.commitment ? claimed.commitment === commitment : true);
  const resultHashOk =
    verifyReplay(input, served) &&
    fresh.result.resultHash === served.result.resultHash &&
    (claimed.resultHash ? claimed.resultHash === fresh.result.resultHash : true);
  return { commitmentOk, resultHashOk, seed: input.seed, seedCommitment: commitment, resultHash: fresh.result.resultHash, engineVersion: ENGINE_VERSION };
}

function summarize(id: string, nowMs: number): RaceSummary {
  const card = getRace(id, nowMs);
  const { config } = card;
  const summary: RaceSummary = {
    id,
    name: config.name,
    distanceM: config.distanceM,
    surface: config.surface,
    going: config.going,
    weather: config.weather,
    raceClass: config.raceClass,
    purse: config.purse,
    postTimeMs: config.postTimeMs,
    fieldSize: card.field.length,
    phase: "upcoming",
  };
  if (nowMs < config.postTimeMs) return summary;
  const replay = computeReplay(id);
  // While live: no end time and no winner (either would reveal the outcome).
  if (!isBroadcastOver(replay, nowMs)) return { ...summary, phase: "live" };
  const endsAtMs = broadcastEndsAtMs(replay);
  const first = replay.result.finishOrder[0];
  const entry = first && card.field.find((e) => e.horse.id === first.horseId);
  return {
    ...summary,
    phase: "finished",
    endsAtMs,
    winner: entry && first ? { horseId: entry.horse.id, name: entry.horse.name, stableName: entry.stableName, timeUs: first.finishTimeUs } : undefined,
  };
}

/** Upcoming scheduled races (next `upcoming`) and the most recent ones (live first, then finished). */
export function listScheduled(nowMs: number, upcoming = 4, recent = 6): { upcoming: RaceSummary[]; recent: RaceSummary[] } {
  const k = currentSlot(nowMs);
  return {
    upcoming: Array.from({ length: upcoming }, (_, i) => summarize(`s-${k + 1 + i}`, nowMs)),
    recent: Array.from({ length: recent }, (_, i) => summarize(`s-${k - i}`, nowMs)),
  };
}

/**
 * Client-side player identity + progression for the Milestone A demo.
 *
 * MILESTONE C: this whole module becomes the server-side credits ledger
 * (double-entry, idempotent settlement keyed by raceId). Until then the browser
 * keeps the player's profile, credits, per-horse record and race history in
 * localStorage, and races are settled once per raceId when the player views the
 * finished result. Nothing here is trusted by the server.
 */
import { useSyncExternalStore } from "react";
import type { HorseRecord, Silks, Surface } from "@thoroughbred/shared";

export const STARTING_CREDITS = 5_000;
const KEY = "thoroughbred:v1";
const CHANGE_EVENT = "thoroughbred:state";

export interface PlayerProfile {
  playerId: string;
  stableName: string;
  silks: Silks;
  createdAtMs: number;
}

export interface RaceHistoryEntry {
  raceId: string;
  raceName: string;
  horseIndex: number;
  horseName: string;
  position: number;
  fieldSize: number;
  prize: number;
  postTimeMs: number;
  distanceM: number;
  surface: Surface;
}

export interface Progress {
  credits: number;
  /** Keyed by horse index ("0".."5"). */
  horses: Record<string, HorseRecord>;
  /** Newest first. */
  history: RaceHistoryEntry[];
  /** raceId -> settled-at ms. The idempotency key for settlement. */
  settled: Record<string, number>;
  /**
   * Races this player entered whose result they have not seen yet (raceId -> entry).
   * Lets Home show "Watch your race" / "Result ready" without spoiling the result.
   */
  pending?: Record<string, PendingRace>;
}

export interface PendingRace {
  raceId: string;
  horseIndex: number;
  horseName: string;
  tactic: string;
  postTimeMs: number;
  enteredAtMs: number;
}

export interface PlayerState {
  v: 1;
  player: PlayerProfile;
  progress: Progress;
}

const EMPTY_RECORD: HorseRecord = { starts: 0, wins: 0, places: 0, shows: 0, earnings: 0 };

export function newPlayerId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("") + Date.now().toString(36).slice(-6);
}

// ---------------------------------------------------------------------------
// Store (useSyncExternalStore over localStorage)
// ---------------------------------------------------------------------------

let cacheRaw: string | null | undefined;
let cacheValue: PlayerState | null = null;

function read(): PlayerState | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw === cacheRaw) return cacheValue;
  cacheRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as PlayerState) : null;
    cacheValue = parsed && parsed.v === 1 && parsed.player?.playerId ? parsed : null;
  } catch {
    cacheValue = null;
  }
  return cacheValue;
}

function write(state: PlayerState | null): void {
  try {
    if (state) window.localStorage.setItem(KEY, JSON.stringify(state));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage full or blocked: the demo keeps running without persistence */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** undefined while hydrating (unknown), null when no player exists yet. */
export function usePlayerState(): PlayerState | null | undefined {
  return useSyncExternalStore<PlayerState | null | undefined>(subscribe, read, () => undefined);
}

export function getPlayerState(): PlayerState | null {
  return typeof window === "undefined" ? null : read();
}

export function createPlayer(profile: Omit<PlayerProfile, "createdAtMs">): PlayerState {
  const state: PlayerState = {
    v: 1,
    player: { ...profile, createdAtMs: Date.now() },
    progress: { credits: STARTING_CREDITS, horses: {}, history: [], settled: {} },
  };
  write(state);
  return state;
}

export function updateProfile(patch: Partial<Pick<PlayerProfile, "stableName" | "silks">>): void {
  const s = read();
  if (s) write({ ...s, player: { ...s.player, ...patch } });
}

export function resetPlayer(): void {
  write(null);
}

export function horseRecord(state: PlayerState | null | undefined, index: number): HorseRecord {
  return state?.progress.horses[String(index)] ?? EMPTY_RECORD;
}

/**
 * Applies a finished race to the local ledger exactly once per raceId.
 * Returns true if this call settled it, false if it was already settled.
 */
export function settleRace(entry: RaceHistoryEntry): boolean {
  const s = read();
  if (!s || s.progress.settled[entry.raceId]) return false;
  const key = String(entry.horseIndex);
  const prev = s.progress.horses[key] ?? EMPTY_RECORD;
  const record: HorseRecord = {
    starts: prev.starts + 1,
    wins: prev.wins + (entry.position === 1 ? 1 : 0),
    places: prev.places + (entry.position === 2 ? 1 : 0),
    shows: prev.shows + (entry.position === 3 ? 1 : 0),
    earnings: prev.earnings + entry.prize,
  };
  write({
    ...s,
    progress: {
      credits: s.progress.credits + entry.prize,
      horses: { ...s.progress.horses, [key]: record },
      history: [entry, ...s.progress.history].slice(0, 100),
      settled: { ...s.progress.settled, [entry.raceId]: Date.now() },
      pending: withoutKey(s.progress.pending, entry.raceId),
    },
  });
  return true;
}

function withoutKey<T>(rec: Record<string, T> | undefined, key: string): Record<string, T> {
  const out = { ...(rec ?? {}) };
  delete out[key];
  return out;
}

/** Remembers a race the player just entered (no result yet). Keeps the newest few. */
export function addPendingRace(entry: PendingRace): void {
  const s = read();
  if (!s) return;
  const all = Object.values({ ...(s.progress.pending ?? {}), [entry.raceId]: entry })
    .sort((a, b) => b.enteredAtMs - a.enteredAtMs)
    .slice(0, 5);
  write({ ...s, progress: { ...s.progress, pending: Object.fromEntries(all.map((p) => [p.raceId, p])) } });
}

/** Forgets a pending race (e.g. the player opened it and saw the result). */
export function clearPendingRace(raceId: string): void {
  const s = read();
  if (!s?.progress.pending?.[raceId]) return;
  write({ ...s, progress: { ...s.progress, pending: withoutKey(s.progress.pending, raceId) } });
}

/** Unseen races, newest first. A race already settled is never pending. */
export function pendingRaces(state: PlayerState | null | undefined): PendingRace[] {
  if (!state) return [];
  return Object.values(state.progress.pending ?? {})
    .filter((p) => !state.progress.settled[p.raceId])
    .sort((a, b) => b.postTimeMs - a.postTimeMs);
}

export function totals(state: PlayerState | null | undefined): { starts: number; wins: number; earnings: number } {
  const recs = Object.values(state?.progress.horses ?? {});
  return {
    starts: recs.reduce((a, r) => a + r.starts, 0),
    wins: recs.reduce((a, r) => a + r.wins, 0),
    earnings: recs.reduce((a, r) => a + r.earnings, 0),
  };
}

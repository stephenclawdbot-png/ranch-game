/**
 * The signed-in player, as the server knows it (GET /api/me). The browser holds only an
 * httpOnly session cookie; credits, horses, entries and results all live in Postgres and are
 * settled on the server. A copy of the last response is cached in localStorage purely so pages
 * paint instantly; it is never trusted and is replaced by the server's answer on every load.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { Silks } from "@thoroughbred/shared";
import type { ApiError, PlayerView, StableHorse } from "./types";
import { conditionRating } from "./aptitude";

export type PlayerState = PlayerView;

const CACHE_KEY = "thoroughbred:cache:v2";
/** The pre-database demo kept the whole stable here; only its name and silks are imported. */
const LEGACY_KEY = "thoroughbred:v1";

type Snapshot = PlayerView | null | undefined;
let current: Snapshot = undefined;
let loaded = false;
let inflight: Promise<PlayerView | null> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of [...listeners]) l();
}

function readCache(): Snapshot {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as PlayerView;
    return v && typeof v.accountId === "string" && Array.isArray(v.horses) ? v : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(v: PlayerView | null): void {
  try {
    if (v) window.localStorage.setItem(CACHE_KEY, JSON.stringify(v));
    else window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* storage blocked: the cache is only a convenience */
  }
}

/** Replaces the player state (e.g. from a mutation response that carries `player`). */
export function setPlayer(v: PlayerView | null): void {
  current = v;
  loaded = true;
  writeCache(v);
  emit();
}

/** Fetches the player from the server (deduplicated). */
export function refreshPlayer(): Promise<PlayerView | null> {
  inflight ??= fetch("/api/me", { cache: "no-store" })
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { player } = (await r.json()) as { player: PlayerView | null };
      setPlayer(player);
      return player;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (current === undefined && !loaded) {
    const cached = readCache();
    if (cached) {
      current = cached;
      queueMicrotask(emit);
    }
  }
  if (!loaded && !inflight) refreshPlayer().catch(() => undefined);
  const onFocus = () => refreshPlayer().catch(() => undefined);
  window.addEventListener("focus", onFocus);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("focus", onFocus);
  };
}

/**
 * undefined while unknown (first load), null when this browser has no stable yet.
 * `pollMs` refreshes periodically while mounted (e.g. while a race is pending).
 */
export function usePlayerState(opts: { pollMs?: number } = {}): PlayerState | null | undefined {
  const state = useSyncExternalStore<Snapshot>(subscribe, () => current, () => undefined);
  const { pollMs } = opts;
  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(() => refreshPlayer().catch(() => undefined), pollMs);
    return () => clearInterval(t);
  }, [pollMs]);
  return state;
}

export function getPlayerState(): PlayerState | null | undefined {
  return current;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export class ApiFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

/** POST/PATCH/DELETE JSON; throws ApiFailure with the server's friendly message. Applies `player` from the response. */
export async function api<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "POST",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiFailure(0, "network", "Couldn't reach the track. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as Partial<ApiError> & { player?: PlayerView | null };
  if (!res.ok) throw new ApiFailure(res.status, data.error ?? `http_${res.status}`, data.message ?? `Something went wrong (HTTP ${res.status}).`, data.details);
  if (data.player !== undefined) setPlayer(data.player);
  return data as T;
}

function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Founds the stable: account + starter horses + credits + today's entries, on the server. */
export async function createStable(input: { stableName: string; silks: Silks; inviteCode?: string; rival?: boolean; deviceId?: string }): Promise<PlayerView> {
  const out = await api<{ player: PlayerView }>("/api/account", { body: { ...input, timezone: deviceTimezone() } });
  clearLegacyProfile();
  return out.player;
}

export async function updateProfile(patch: { stableName?: string; silks?: Silks }): Promise<void> {
  await api("/api/account", { method: "PATCH", body: patch });
}

/** Forgets this browser's stable (clears the session cookie and the cache). */
export async function signOut(): Promise<void> {
  await api("/api/account/session", { method: "DELETE" });
  setPlayer(null);
}

// ---------------------------------------------------------------------------
// One-time import from the localStorage demo
// ---------------------------------------------------------------------------

export interface LegacyProfile {
  stableName: string;
  silks: Silks;
}

/** The stable name and silks of a demo stable kept in this browser, if any. */
export function legacyProfile(): LegacyProfile | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const p = (JSON.parse(raw) as { player?: { stableName?: unknown; silks?: Silks } }).player;
    if (!p || typeof p.stableName !== "string" || !p.silks || typeof p.silks.primary !== "string") return null;
    return { stableName: p.stableName, silks: p.silks };
  } catch {
    return null;
  }
}

export function clearLegacyProfile(): void {
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export function totals(state: PlayerState | null | undefined): { starts: number; wins: number; earnings: number } {
  const hs = state?.horses ?? [];
  return {
    starts: hs.reduce((a, h) => a + h.horse.record.starts, 0),
    wins: hs.reduce((a, h) => a + h.horse.record.wins, 0),
    earnings: hs.reduce((a, h) => a + h.horse.record.earnings, 0),
  };
}

/** Horses that can race right now, best Quick Pick candidates first (fresh, not raced today). */
export function readyHorses(state: PlayerState | null | undefined) {
  return (state?.horses ?? []).filter((h) => h.block === null);
}

/**
 * The horse Quick Pick (Story) will choose: the strongest at its own best conditions, rotating
 * away from horses that already ran today and resting tired ones. Mirrors the server's pick.
 */
export function recommendHorse(state: PlayerState | null | undefined): StableHorse | null {
  let best: StableHorse | null = null;
  let bestScore = -Infinity;
  for (const h of readyHorses(state)) {
    const x = h.horse;
    const score = conditionRating(x, x.style, { distanceM: x.preferredDistanceM, surface: x.preferredSurface, going: "good" }) - h.ranToday * 40 - (h.condition === "tired" ? 60 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

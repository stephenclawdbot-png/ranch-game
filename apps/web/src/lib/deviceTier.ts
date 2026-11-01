/**
 * Device tier: how much horse detail this device draws (owner decision 2026-11-01: "our default on
 * devices that can handle the load; on lower-end devices disable it automatically, give them an
 * optimized version, and let them know body builds and hair are what's off").
 *
 * - "full": body builds and per-horse long hair drawn (painted in a worker, cached per device).
 * - "lite": builds and long hair hidden (the painted body and mane), the Ranch keeps fewer
 *   horses roaming; everything else is the same.
 *
 * Auto (the default) picks from cheap signals first (navigator.deviceMemory <= 4 GB,
 * hardwareConcurrency <= 4, Save-Data, no worker painting), then drops a "full" device to lite
 * for good when it proves slow: a horse paint job over 800 ms, or a median frame over 40 ms over
 * the Ranch's first 3 s. Reduced motion is not a reason. The player can pin Full or Lite in
 * Profile (Horse detail), per device. Everything is in localStorage, wrapped in try/catch.
 *
 * art-pipeline's buildsOn() reads the tier through setDeviceBuilds, registered when this module
 * loads in a browser (the layout imports it, and so does every painter).
 */
import { useSyncExternalStore } from "react";
import { setDeviceBuilds } from "@thoroughbred/art-pipeline";

export type HorseDetail = "auto" | "full" | "lite";
export type Tier = "full" | "lite";

export const DETAIL_KEY = "thoroughbred:horse-detail";
export const AUTO_KEY = "thoroughbred:tier-auto";
export const NOTE_KEY = "thoroughbred:lite-note";
const EVENT = "thoroughbred:tier";

/** Measured limits for a "full" device (Auto only). */
export const SLOW_PAINT_MS = 800;
export const SLOW_FRAME_MS = 40;

export interface TierSignals {
  /** navigator.deviceMemory (GB, Chromium only; rounded down to a power of two). */
  deviceMemory?: number;
  hardwareConcurrency?: number;
  /** navigator.connection.saveData */
  saveData?: boolean;
  /** Whether horse painting can run in a worker (Worker + OffscreenCanvas 2d). */
  workerPaint?: boolean;
}

/** The tier the cheap signals pick, and why (null reason: full). */
export function tierFromSignals(s: TierSignals): { tier: Tier; reason: string | null } {
  if (typeof s.deviceMemory === "number" && s.deviceMemory > 0 && s.deviceMemory <= 4) return { tier: "lite", reason: "memory" };
  if (typeof s.hardwareConcurrency === "number" && s.hardwareConcurrency > 0 && s.hardwareConcurrency <= 4) return { tier: "lite", reason: "cores" };
  if (s.saveData) return { tier: "lite", reason: "save-data" };
  if (s.workerPaint === false) return { tier: "lite", reason: "no-worker" };
  return { tier: "full", reason: null };
}

/** The tier for a setting, the signals and an earlier measured drop (pure). */
export function resolveTier(detail: HorseDetail, signals: TierSignals, measured: { tier: Tier; reason: string } | null): { tier: Tier; reason: string | null; auto: boolean } {
  if (detail === "full" || detail === "lite") return { tier: detail, reason: "setting", auto: false };
  if (measured?.tier === "lite") return { tier: "lite", reason: measured.reason, auto: true };
  return { ...tierFromSignals(signals), auto: true };
}

// ----------------------------------------------------------------------------- browser state

interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
function store(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}
function get(k: string): string | null {
  try {
    return store()?.getItem(k) ?? null;
  } catch {
    return null;
  }
}
function set(k: string, v: string | null): void {
  try {
    const s = store();
    if (!s) return;
    if (v === null) s.removeItem(k);
    else s.setItem(k, v);
  } catch {
    /* storage blocked: this page view only */
  }
}

export function readDetail(): HorseDetail {
  const v = get(DETAIL_KEY);
  return v === "full" || v === "lite" ? v : "auto";
}

function readMeasured(): { tier: Tier; reason: string } | null {
  try {
    const raw = get(AUTO_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as { tier?: string; reason?: string };
    return m.tier === "lite" ? { tier: "lite", reason: m.reason ?? "measured" } : null;
  } catch {
    return null;
  }
}

/** The browser's signals (absent ones stay undefined). */
export function browserSignals(): TierSignals {
  const n = (globalThis as { navigator?: Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } } }).navigator;
  if (!n) return {};
  let workerPaint = false;
  try {
    workerPaint = typeof Worker === "function" && typeof OffscreenCanvas === "function" && typeof createImageBitmap === "function" && !!new OffscreenCanvas(1, 1).getContext("2d");
  } catch {
    workerPaint = false;
  }
  return { deviceMemory: n.deviceMemory, hardwareConcurrency: n.hardwareConcurrency, saveData: !!n.connection?.saveData, workerPaint };
}

export interface TierState {
  detail: HorseDetail;
  tier: Tier;
  reason: string | null;
  /** True when Auto chose it (not the player's setting). */
  auto: boolean;
}

const SERVER: TierState = { detail: "auto", tier: "full", reason: null, auto: true };
let state: TierState | null = null;
let signals: TierSignals | null = null;

function compute(): TierState {
  signals ??= browserSignals();
  const detail = readDetail();
  return { detail, ...resolveTier(detail, signals, readMeasured()) };
}

/** The current tier state (browser; the server answers "full"). */
export function tierState(): TierState {
  if (typeof window === "undefined") return SERVER;
  state ??= compute();
  return state;
}

export function currentTier(): Tier {
  return tierState().tier;
}

function changed() {
  state = compute();
  try {
    document.documentElement.dataset.tier = state.tier;
  } catch {
    /* no document */
  }
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* no window */
  }
}

/** The player's Horse detail setting (per device). Takes effect for horses painted from now on. */
export function setHorseDetail(d: HorseDetail): void {
  set(DETAIL_KEY, d === "auto" ? null : d);
  changed();
}

/** Auto only: this "full" device measured too slow; draw lite from now on, and remember it. */
export function dropToLite(reason: string): boolean {
  const s = tierState();
  if (!s.auto || s.tier === "lite") return false;
  set(AUTO_KEY, JSON.stringify({ tier: "lite", reason, at: Date.now() }));
  changed();
  return true;
}

/** A horse paint job's time on this device (ms, painting only, not cache hits). */
export function reportPaintMs(ms: number): void {
  if (ms > SLOW_PAINT_MS) dropToLite("slow-paint");
}

/** The median frame time of a scene's first seconds of motion (ms). */
export function reportFrameMedian(ms: number): void {
  if (ms > SLOW_FRAME_MS) dropToLite("slow-frames");
}

/** Median of a list of numbers (0 when empty). */
export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function subscribe(cb: () => void): () => void {
  const on = () => {
    state = null;
    cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", on);
  };
}

export function useTier(): TierState {
  return useSyncExternalStore(subscribe, tierState, () => SERVER);
}

// ----------------------------------------------------------------------------- the lite note

/** Whether the one-time "Lite graphics on this device" note should show (Auto picked lite, not dismissed). */
export function liteNoteDue(s: TierState = tierState()): boolean {
  return s.auto && s.tier === "lite" && get(NOTE_KEY) !== "seen";
}

export function dismissLiteNote(): void {
  set(NOTE_KEY, "seen");
  window.dispatchEvent(new Event(EVENT));
}

export function useLiteNote(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => liteNoteDue(),
    () => false,
  );
}

// ----------------------------------------------------------------------------- start

if (typeof window !== "undefined") {
  setDeviceBuilds(() => currentTier() === "full");
  try {
    document.documentElement.dataset.tier = currentTier();
  } catch {
    /* no document */
  }
}

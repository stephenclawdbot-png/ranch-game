/**
 * Per-device display settings (text size, motion). Stored in localStorage and applied as
 * attributes on <html> (`data-text`, `data-motion`) by an inline script before first paint.
 */
import { useSyncExternalStore } from "react";

export type TextSize = "90" | "100" | "115" | "130";
/** "system" follows prefers-reduced-motion; "reduce" forces calm; "full" allows motion. */
export type MotionPref = "system" | "reduce" | "full";

export interface Settings {
  text: TextSize;
  motion: MotionPref;
}

const KEY = "thoroughbred:settings";
const EVENT = "thoroughbred:settings";
const DEFAULTS: Settings = { text: "100", motion: "system" };

/** Inline script (runs in <head>): applies saved settings before the first paint. */
export const SETTINGS_BOOT_SCRIPT = `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})||"{}");var d=document.documentElement;if(s.text&&s.text!=="100")d.dataset.text=s.text;if(s.motion&&s.motion!=="system")d.dataset.motion=s.motion;}catch(e){}`;

let cacheRaw: string | null | undefined;
let cache: Settings = DEFAULTS;

function read(): Settings {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  try {
    cache = { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<Settings>) : {}) };
  } catch {
    cache = DEFAULTS;
  }
  return cache;
}

function apply(s: Settings): void {
  const d = document.documentElement;
  if (s.text === "100") delete d.dataset.text;
  else d.dataset.text = s.text;
  if (s.motion === "system") delete d.dataset.motion;
  else d.dataset.motion = s.motion;
}

export function saveSettings(patch: Partial<Settings>): void {
  const next = { ...read(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: still apply for this page view */
  }
  apply(next);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}

/** True when motion should be calm (OS setting or the in-app toggle). Client-only. */
export function prefersCalm(): boolean {
  if (typeof window === "undefined") return true;
  const m = document.documentElement.dataset.motion;
  if (m === "reduce") return true;
  if (m === "full") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

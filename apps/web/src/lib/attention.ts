/**
 * Background refreshes that follow the player's attention.
 *
 * Every background request reaches the database, and the database is billed for as long as it
 * stays awake: one tab polling in the background keeps it awake all day. So a poller only runs
 * while somebody is plausibly looking:
 *
 *   - the tab is visible (`document.visibilityState`), and
 *   - the player has done something (pointer, key, touch, scroll, focus) in the last
 *     IDLE_AFTER_MS.
 *
 * A hidden or idle tab asks for nothing. When the player comes back (the tab shows again, or the
 * first input after idling), every poller that missed a turn runs at once, so what they see is
 * fresh the moment they look. Pollers that follow something happening right now (a race in
 * progress) can opt out of the idle rule with `evenWhenIdle`; nothing runs in a hidden tab.
 *
 *   const stop = startPoll(load, 60_000);           // plain
 *   usePoll(load, 60_000, enabled);                 // React
 */
import { useEffect, useRef } from "react";

/** No input for this long and the tab counts as idle (a little under the database's own sleep timer). */
export const IDLE_AFTER_MS = 3 * 60_000;

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel", "scroll"] as const;

interface Poller {
  run: () => unknown;
  periodMs: number;
  evenWhenIdle: boolean;
  lastRunAt: number;
  missed: boolean;
  timer: ReturnType<typeof setInterval> | null;
}

let lastActiveAt = 0;
let installed = false;
const pollers = new Set<Poller>();
const wakeListeners = new Set<() => void>();

function visible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/** True when the tab is visible and the player was active recently. */
export function isAttentive(now = Date.now()): boolean {
  install();
  return visible() && now - lastActiveAt < IDLE_AFTER_MS;
}

function mayRun(p: Poller, now: number): boolean {
  return visible() && (p.evenWhenIdle || now - lastActiveAt < IDLE_AFTER_MS);
}

function fire(p: Poller, now: number): void {
  p.lastRunAt = now;
  p.missed = false;
  try {
    void Promise.resolve(p.run()).catch(() => undefined);
  } catch {
    // a poller never breaks the page
  }
}

/** The player is back (tab shown, or first input after idling): run what was missed. */
function wake(): void {
  const now = Date.now();
  for (const p of [...pollers]) {
    if (mayRun(p, now) && (p.missed || now - p.lastRunAt >= p.periodMs)) fire(p, now);
  }
  for (const l of [...wakeListeners]) l();
}

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  lastActiveAt = Date.now();
  const onActivity = () => {
    const now = Date.now();
    const wasIdle = now - lastActiveAt >= IDLE_AFTER_MS;
    lastActiveAt = now;
    if (wasIdle) wake();
  };
  for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true, capture: true });
  window.addEventListener("focus", onActivity);
  document.addEventListener("visibilitychange", () => {
    if (!visible()) return;
    // coming back to the tab is attention in itself
    lastActiveAt = Date.now();
    wake();
  });
}

/**
 * Calls `run` every `periodMs` while the player is attentive (see the file comment). Does not
 * call it at the start (callers load once themselves). Returns the stop function.
 */
export function startPoll(run: () => unknown, periodMs: number, opts: { evenWhenIdle?: boolean } = {}): () => void {
  if (typeof window === "undefined") return () => undefined;
  install();
  const p: Poller = { run, periodMs, evenWhenIdle: !!opts.evenWhenIdle, lastRunAt: Date.now(), missed: false, timer: null };
  p.timer = setInterval(() => {
    const now = Date.now();
    if (mayRun(p, now)) fire(p, now);
    else p.missed = true;
  }, periodMs);
  pollers.add(p);
  return () => {
    if (p.timer) clearInterval(p.timer);
    p.timer = null;
    pollers.delete(p);
  };
}

/** React: `startPoll` for the life of the component (the latest `run` is always the one called). */
export function usePoll(run: () => unknown, periodMs: number | null | undefined, enabled = true, opts: { evenWhenIdle?: boolean } = {}): void {
  const ref = useRef(run);
  ref.current = run;
  const evenWhenIdle = !!opts.evenWhenIdle;
  useEffect(() => {
    if (!enabled || !periodMs) return;
    return startPoll(() => ref.current(), periodMs, { evenWhenIdle });
  }, [periodMs, enabled, evenWhenIdle]);
}

/**
 * Runs `run` once at `atMs` (this browser's clock) if the player is attentive then; otherwise as
 * soon as they are back. Returns the cancel function. For one-off scheduled refreshes ("when the
 * next race goes off").
 */
export function runWhenAttentive(atMs: number, run: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  install();
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const attempt = () => {
    if (done) return;
    if (Date.now() < atMs) return;
    if (!isAttentive()) return; // wait for wake()
    done = true;
    wakeListeners.delete(attempt);
    run();
  };
  wakeListeners.add(attempt);
  timer = setTimeout(attempt, Math.min(Math.max(0, atMs - Date.now()), 2_147_000_000));
  return () => {
    done = true;
    if (timer) clearTimeout(timer);
    wakeListeners.delete(attempt);
  };
}

/** Tests: forget every poller and the activity clock. */
export function resetAttentionForTests(): void {
  for (const p of pollers) if (p.timer) clearInterval(p.timer);
  pollers.clear();
  wakeListeners.clear();
  lastActiveAt = Date.now();
}

/** Tests: pretend the last input happened `msAgo` ago. */
export function setLastActiveForTests(msAgo: number): void {
  lastActiveAt = Date.now() - msAgo;
}

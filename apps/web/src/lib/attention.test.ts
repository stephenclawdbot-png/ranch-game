/**
 * Background refreshes follow attention: nothing is asked for in a hidden tab or after a few
 * minutes without input, and what was missed runs the moment the player is back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = () => void;
const windowListeners = new Map<string, Listener[]>();
const documentListeners = new Map<string, Listener[]>();
let visibility: "visible" | "hidden" = "visible";

function emit(map: Map<string, Listener[]>, type: string): void {
  for (const l of map.get(type) ?? []) l();
}
function show(v: "visible" | "hidden"): void {
  visibility = v;
  emit(documentListeners, "visibilitychange");
}

vi.stubGlobal("window", {
  addEventListener: (type: string, l: Listener) => windowListeners.set(type, [...(windowListeners.get(type) ?? []), l]),
});
vi.stubGlobal("document", {
  get visibilityState() {
    return visibility;
  },
  addEventListener: (type: string, l: Listener) => documentListeners.set(type, [...(documentListeners.get(type) ?? []), l]),
});

import { IDLE_AFTER_MS, isAttentive, resetAttentionForTests, runWhenAttentive, startPoll } from "./attention";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
  visibility = "visible";
  resetAttentionForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startPoll", () => {
  it("runs on its period while the tab is visible and the player active", () => {
    const run = vi.fn();
    const stop = startPoll(run, 60_000);
    expect(run).not.toHaveBeenCalled(); // callers load once themselves
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(600_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("asks for nothing in a hidden tab, and catches up once when the tab shows again", () => {
    const run = vi.fn();
    startPoll(run, 60_000);
    show("hidden");
    vi.advanceTimersByTime(30 * 60_000);
    expect(run).not.toHaveBeenCalled();
    show("visible");
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("stops after a few minutes without input, and resumes at the first input", () => {
    const run = vi.fn();
    startPoll(run, 60_000);
    vi.advanceTimersByTime(IDLE_AFTER_MS + 5 * 60_000);
    // 60 s and 120 s ran; from 180 s on the tab is idle
    expect(run).toHaveBeenCalledTimes(2);
    expect(isAttentive()).toBe(false);
    emit(windowListeners, "pointerdown");
    expect(run).toHaveBeenCalledTimes(3);
    expect(isAttentive()).toBe(true);
    // ordinary input while active does not trigger extra requests
    emit(windowListeners, "keydown");
    emit(windowListeners, "pointermove");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("evenWhenIdle keeps running without input (a race in progress), but never in a hidden tab", () => {
    const run = vi.fn();
    startPoll(run, 15_000, { evenWhenIdle: true });
    vi.advanceTimersByTime(IDLE_AFTER_MS + 60_000);
    expect(run).toHaveBeenCalledTimes(16);
    show("hidden");
    vi.advanceTimersByTime(10 * 60_000);
    expect(run).toHaveBeenCalledTimes(16);
  });

  it("a failing poller never throws into the page", () => {
    startPoll(() => {
      throw new Error("boom");
    }, 1000);
    startPoll(() => Promise.reject(new Error("async boom")), 1000);
    expect(() => vi.advanceTimersByTime(3000)).not.toThrow();
  });
});

describe("runWhenAttentive", () => {
  it("runs once at the time when the player is there", () => {
    const run = vi.fn();
    runWhenAttentive(Date.now() + 10_000, run);
    vi.advanceTimersByTime(9_000);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_500);
    expect(run).toHaveBeenCalledTimes(1);
    show("hidden");
    show("visible");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits for the player when the tab is hidden at the time, and can be cancelled", () => {
    const run = vi.fn();
    const cancelled = vi.fn();
    runWhenAttentive(Date.now() + 10_000, run);
    const cancel = runWhenAttentive(Date.now() + 10_000, cancelled);
    show("hidden");
    vi.advanceTimersByTime(60 * 60_000);
    expect(run).not.toHaveBeenCalled();
    cancel();
    show("visible");
    expect(run).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { IllegalTransitionError, machineProblems } from "@thoroughbred/shared";
import { PLAYBACK_MACHINE, VIEWER_LOAD_MACHINE, playbackMode, viewerMove, type PlaybackMode } from "./machines";
import { LiveClock, PlaybackClock, type LiveClockSource } from "./playback";
import { fakeReplay } from "./dev/fakeReplay";

describe("viewer machines", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("are well formed", () => {
    expect(machineProblems(VIEWER_LOAD_MACHINE)).toEqual([]);
    expect(machineProblems(PLAYBACK_MACHINE)).toEqual([]);
  });

  it("load: every waiting state has a way out, and Try again restarts from loading", () => {
    expect(VIEWER_LOAD_MACHINE.next("loading")).toEqual(expect.arrayContaining(["ready", "slow", "failed"]));
    expect(VIEWER_LOAD_MACHINE.can("slow", "ready")).toBe(true);
    expect(VIEWER_LOAD_MACHINE.can("failed", "loading")).toBe(true);
    expect(VIEWER_LOAD_MACHINE.can("failed", "ready")).toBe(false);
  });

  it("viewerMove throws outside production and warns + stays in production", () => {
    expect(viewerMove(VIEWER_LOAD_MACHINE, "loading", "ready")).toBe("ready");
    expect(viewerMove(VIEWER_LOAD_MACHINE, "ready", "ready")).toBe("ready");
    expect(() => viewerMove(VIEWER_LOAD_MACHINE, "failed", "ready")).toThrow(IllegalTransitionError);
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(viewerMove(VIEWER_LOAD_MACHINE, "failed", "ready")).toBe("failed");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

/** A seeded walk over every control a viewer can press, checking the clock's mode after each step. */
function walk(clock: PlaybackClock | LiveClock, steps: number, seed: number, startMs: number): PlaybackMode[] {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let now = startMs;
  const seen: PlaybackMode[] = [playbackMode(clock)];
  for (let i = 0; i < steps; i++) {
    const before = playbackMode(clock);
    const op = Math.floor(rnd() * 8);
    if (op === 0) clock.play();
    else if (op === 1) clock.pause();
    else if (op === 2) clock.toggle();
    else if (op === 3) clock.seek(rnd() * 40, now);
    else if (op === 4) clock.restart(now);
    else if (op === 5) clock.setRate([0.5, 1, 2, 4][Math.floor(rnd() * 4)]!);
    else if (op === 6) clock.goLive(now);
    else for (let k = 0; k < 30; k++) clock.tick(0.05, (now += 50));
    const after = playbackMode(clock);
    // live always means playing; every change is a move the machine declares
    expect(clock.live && !clock.playing).toBe(false);
    if (after !== before) expect(PLAYBACK_MACHINE.can(before, after)).toBe(true);
    seen.push(after);
  }
  return seen;
}

describe("playback clocks follow PLAYBACK_MACHINE", () => {
  const T0 = 1_000_000;

  it("PlaybackClock (replay, and replay pinned to a start time)", () => {
    const replay = fakeReplay();
    for (let seed = 1; seed <= 20; seed++) {
      const seen = walk(new PlaybackClock(replay, { autoplay: seed % 2 === 0 }), 200, seed, T0);
      expect(new Set(seen).size).toBeGreaterThan(1);
      walk(new PlaybackClock(replay, { startAtMs: T0 - 2000 }, T0), 200, seed * 7, T0);
    }
  });

  it("LiveClock (the broadcast)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const src: LiveClockSource = { broadcastStartMs: T0, liveEdgeFrame: 400, frameDt: 0.1 };
      const seen = walk(new LiveClock(src, seed % 2 === 0, T0 + 5000), 200, seed, T0 + 5000);
      expect(new Set(seen).size).toBeGreaterThan(1);
    }
  });
});

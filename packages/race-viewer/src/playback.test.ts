import { describe, expect, it } from "vitest";
import { fakeReplay } from "./dev/fakeReplay";
import { POST_RACE_SEC, PRE_ROLL_SEC, PlaybackClock, RUNOUT_SEC, timeLeaderReaches } from "./playback";
import { replayTiming } from "./sampleReplay";

const photo = fakeReplay({ horses: 8, seed: 3, distanceM: 1000, photoFinish: true });
const plain = fakeReplay({ horses: 6, seed: 5, distanceM: 1000, photoFinish: false });

function run(c: PlaybackClock, seconds: number, step = 1 / 60, nowMs?: { v: number }) {
  let last = c.tick(0, nowMs?.v);
  for (let t = 0; t < seconds; t += step) {
    if (nowMs) nowMs.v += step * 1000;
    last = c.tick(step, nowMs?.v);
  }
  return last;
}

describe("PlaybackClock (local)", () => {
  it("autoplay starts with a short pre-roll and advances at the chosen rate", () => {
    const c = new PlaybackClock(plain, { autoplay: true });
    expect(c.time).toBeCloseTo(-PRE_ROLL_SEC);
    run(c, 2);
    expect(c.time).toBeCloseTo(2 - PRE_ROLL_SEC, 1);
    c.setRate(4);
    const before = c.time;
    run(c, 1);
    expect(c.time - before).toBeCloseTo(4, 1);
  });

  it("autoplay=false holds at 0", () => {
    const c = new PlaybackClock(plain, { autoplay: false });
    run(c, 1);
    expect(c.time).toBe(0);
    expect(c.playing).toBe(false);
  });

  it("runs on through the ease-down after the line, then stops at the run-out end", () => {
    const c = new PlaybackClock(plain, { initialTimeSec: replayTiming(plain).duration - 0.5 });
    expect(c.runoutEnd).toBeCloseTo(Math.max(c.duration + RUNOUT_SEC, c.winnerTime + POST_RACE_SEC));
    expect(c.runoutEnd - c.winnerTime).toBeGreaterThanOrEqual(POST_RACE_SEC);
    run(c, 10);
    expect(c.playing).toBe(true); // still easing down: no stop 6 s after the last finisher
    run(c, POST_RACE_SEC + 3);
    expect(c.ended).toBe(true);
    expect(c.playing).toBe(false);
    expect(c.time).toBeLessThanOrEqual(c.runoutEnd + 1e-9);
  });

  it("seek clamps to the race and clears live mode", () => {
    const now = { v: 1_000_000 };
    const c = new PlaybackClock(plain, { startAtMs: now.v - 5000 }, now.v);
    expect(c.live).toBe(true);
    c.seek(-10);
    expect(c.time).toBe(0);
    expect(c.live).toBe(false);
    c.seek(1e9);
    expect(c.time).toBe(c.duration);
  });
});

describe("PlaybackClock (wall-clock sync)", () => {
  it("counts down before post time, then follows the wall clock", () => {
    const now = { v: 5_000_000 };
    const c = new PlaybackClock(plain, { startAtMs: now.v + 3000 }, now.v);
    expect(c.live).toBe(true);
    expect(c.tick(0, now.v).time).toBeCloseTo(-3);
    run(c, 5, 1 / 30, now);
    expect(c.time).toBeCloseTo(2, 1);
  });

  it("opens on the result when the race is already over", () => {
    const now = { v: 9_000_000 };
    const c = new PlaybackClock(plain, { startAtMs: now.v - 3_600_000 }, now.v);
    expect(c.ended).toBe(true);
    expect(c.playing).toBe(false);
    expect(c.live).toBe(false);
    expect(c.canGoLive(now.v)).toBe(false);
  });

  it("goLive snaps back to wall time", () => {
    const now = { v: 1_000_000 };
    const c = new PlaybackClock(plain, { startAtMs: now.v - 10_000 }, now.v);
    c.seek(2);
    c.goLive(now.v);
    expect(c.live).toBe(true);
    expect(c.time).toBeCloseTo(10);
  });
});

describe("photo finish", () => {
  it("fixture is a photo finish with a slow-mo window before the winner's time", () => {
    expect(photo.result.photoFinish).toBe(true);
    const from = timeLeaderReaches(photo, 14);
    expect(from).not.toBeNull();
    expect(from!).toBeLessThan(replayTiming(photo).winnerTime);
  });

  it("the race plays through the line at full speed, live or replay (the photo and slow-mo are the finale's)", () => {
    const from = timeLeaderReaches(photo, 14)!;
    const c = new PlaybackClock(photo, { initialTimeSec: from + 0.01 });
    const t0 = c.time;
    let frozen = false;
    let slow = false;
    for (let i = 0; i < 60 * 3; i++) {
      const fr = c.tick(1 / 60);
      frozen ||= fr.frozen;
      slow ||= fr.slowmo;
    }
    expect(c.time - t0).toBeCloseTo(3, 1);
    expect(frozen || slow).toBe(false);
    // A live viewer stays on the wall clock through the finish.
    const now = { v: 50_000_000 };
    const live = new PlaybackClock(photo, { startAtMs: now.v - (from - 1) * 1000 }, now.v);
    run(live, 6, 1 / 60, now);
    expect((now.v - live.startAtMs!) / 1000 - live.time).toBeLessThan(0.05);
  });
});

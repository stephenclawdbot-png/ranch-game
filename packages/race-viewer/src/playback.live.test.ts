import { describe, expect, it } from "vitest";
import { LiveClock, type LiveClockSource } from "./playback";
import { createReplaySampler, crossingTimeFromFrames } from "./sampleReplay";
import { standingsAt } from "./timeline";
import { fakeReplay } from "./dev/fakeReplay";

const T0 = 1_000_000;
function src(edgeFrame: number): LiveClockSource {
  return { broadcastStartMs: T0, liveEdgeFrame: edgeFrame, frameDt: 0.1 };
}

describe("LiveClock", () => {
  it("counts down before the off and never shows frames that weren't broadcast", () => {
    const s = src(-1);
    const c = new LiveClock(s, true, T0 - 5000);
    expect(c.tick(0, T0 - 5000).time).toBeCloseTo(-5);
    // Wall clock is at 3 s but only frame 10 (1.0 s) has arrived: hold at the data edge.
    s.liveEdgeFrame = 10;
    expect(c.tick(0.016, T0 + 3000).time).toBeCloseTo(1.0);
    for (let i = 0; i < 50; i++) c.tick(0.016, T0 + 3000);
    expect(c.buffering).toBe(true);
    s.liveEdgeFrame = 30;
    expect(c.tick(0.016, T0 + 3000).time).toBeCloseTo(3.0);
    expect(c.buffering).toBe(false);
  });

  it("cannot seek or fast-forward past the live edge", () => {
    const s = src(100);
    const c = new LiveClock(s, true, T0 + 10_000);
    c.seek(9999, T0 + 10_000);
    expect(c.time).toBeCloseTo(10);
    c.seek(2, T0 + 10_000);
    expect(c.live).toBe(false);
    c.play();
    c.setRate(4);
    let now = T0 + 10_000;
    for (let i = 0; i < 300; i++) {
      now += 16;
      c.tick(0.016, now);
      expect(c.time).toBeLessThanOrEqual(c.edge(now) + 1e-9);
    }
    // Caught up -> back to live at 1x.
    expect(c.live).toBe(true);
    expect(c.rate).toBe(1);
  });

  it("speed changes are ignored while live; pause + rewind work", () => {
    const s = src(200);
    const c = new LiveClock(s, true, T0 + 15_000);
    c.setRate(4);
    expect(c.rate).toBe(1);
    c.toggle();
    expect(c.playing).toBe(false);
    c.tick(1, T0 + 16_000);
    const t = c.time;
    c.tick(1, T0 + 17_000);
    expect(c.time).toBe(t);
    c.goLive(T0 + 17_000);
    expect(c.time).toBeCloseTo(17);
  });
});

describe("LiveClock past the data edge", () => {
  it("keeps running (no freeze, no jump back) once every runner is home, until the final arrives", () => {
    const s = { broadcastStartMs: T0, liveEdgeFrame: 700, frameDt: 0.1, allFinished: false };
    const c = new LiveClock(s, true, T0 + 70_000);
    let now = T0 + 70_000;
    let prev = c.tick(0.016, now).time;
    expect(prev).toBeCloseTo(70);
    // the last runner crosses: no more frames will come
    s.allFinished = true;
    for (let i = 0; i < 300; i++) {
      now += 16;
      const t = c.tick(0.016, now).time;
      expect(t).toBeGreaterThanOrEqual(prev); // never back
      prev = t;
    }
    expect(prev).toBeCloseTo(70 + 300 * 0.016, 1); // follows the wall clock past the 70 s data edge
    expect(c.buffering).toBe(false);
  });

  it("still holds at the data edge while runners are out on the course (buffering)", () => {
    const s = { broadcastStartMs: T0, liveEdgeFrame: 300, frameDt: 0.1, allFinished: false };
    const c = new LiveClock(s, true, T0 + 35_000);
    expect(c.tick(0.016, T0 + 35_000).time).toBeCloseTo(30);
  });

  it("extrapolates finished horses with the shared run-out model past the edge", async () => {
    const { FieldMotion } = await import("./stage/motion");
    const full = fakeReplay({ horses: 6, seed: 4, distanceM: 1000, photoFinish: false });
    const live = { ...full, result: null };
    const m = new FieldMotion(live);
    const edge = (full.frames.length - 1) * (full.sampleEvery / full.tickHz);
    const a = m.stateAt(edge).map((r) => r.x);
    const b = m.stateAt(edge + 4).map((r) => r.x);
    b.forEach((x, i) => expect(x).toBeGreaterThan(a[i]!));
  });
});

describe("live sampling (no result)", () => {
  it("orders finishers by frame-derived crossing time, never reading result", () => {
    // No photo: 10 Hz frames cannot resolve a nose (that is what final.result is for).
    const full = fakeReplay({ horses: 6, seed: 4, distanceM: 1000, photoFinish: false });
    const live = { horses: full.horses, frames: full.frames, tickHz: full.tickHz, sampleEvery: full.sampleEvery, trackLengthMm: full.trackLengthMm, events: full.events, result: null };
    const sample = createReplaySampler(live);
    const end = (full.frames.length - 1) * (full.sampleEvery / full.tickHz);
    const order = [...sample(end)].sort((a, b) => a.position - b.position).map((s) => s.horseId);
    expect(order).toEqual(full.result.finishOrder.map((f) => f.horseId));
    const winner = full.horses.findIndex((h) => h.horseId === order[0]);
    expect(crossingTimeFromFrames(live, winner)!).toBeCloseTo(full.result.winningTimeUs / 1e6, 1);
    const rows = standingsAt(live, sample(end));
    expect(rows[0]!.gapLabel).toBe("");
  });

  it("follows a growing frames array", () => {
    const full = fakeReplay({ horses: 4, seed: 9, distanceM: 1000 });
    const frames: number[][] = full.frames.slice(0, 50).map((f) => [...f]);
    const sample = createReplaySampler({ ...full, frames, result: null });
    const x1 = sample(100)[0]!.x;
    frames.push(...full.frames.slice(50, 120).map((f) => [...f]));
    expect(sample(100)[0]!.x).toBeGreaterThan(x1);
  });
});

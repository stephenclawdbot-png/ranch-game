/**
 * Horses twitching while racing (testers, beta): a recorded-run jitter metric over the
 * Trackside pipeline (clock -> shared motion -> eased camera -> field layout -> sprite
 * placement), the same steps TracksideScene.render takes, at 60 frames a second with a real
 * browser's frame callbacks (a few ms late now and then) and a live clock-offset correction.
 *
 * Metrics, per runner and frame, while the runner moves forward on the track:
 *  - flips: its drawn anchor's screen x reverses for a frame (+, -, + or -, +, -);
 *  - scale changes: the sprite is drawn at a new scale (nearest sampling re-picks its columns);
 *  - stride: the strip frame steps back or skips (a stride-phase reset);
 *  - clock: the race advanced by something other than the frame's dt (camera vs field).
 *
 * The "before" pipeline reproduces what was measured in the browser (scene.recordMotion), so
 * these tests fail on it.
 */
import { describe, expect, it } from "vitest";
import { fakeReplay } from "../dev/fakeReplay";
import { LiveClock, PlaybackClock } from "../playback";
import { FieldMotion } from "../stage/motion";
import { gallopMetrics, placeField, TracksideCamera } from "./layout";
import { snappedOrigin, steadyScale } from "./spriteSnap";

const ANCHOR = { x: 223, y: 145 };
const FW = 229;
const FRAMES = 12;
const SRC_PPM = 96;

interface Run {
  flips: number;
  scaleChanges: number;
  strideBack: number;
  strideSkip: number;
  clockOff: number;
  runnerFrames: number;
}

/** A seeded 0..1 stream (callback lateness). */
function rnd(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chooseLod(q: number, cur: number): number {
  let ideal = 4;
  for (let s = 1; s <= 4; s++) {
    if (q * s >= 1) {
      ideal = s;
      break;
    }
  }
  if (!cur) return ideal;
  if (ideal > cur) return q * cur < 0.92 ? ideal : cur;
  if (ideal < cur) return q * ideal >= 1.08 ? ideal : cur;
  return cur;
}

function simulate(o: { mode: "live" | "replay"; legacy: boolean; W: number; H: number; dpr: number; seconds: number }): Run {
  const replay = fakeReplay({ horses: 10, seed: 7, distanceM: 1200, photoFinish: false });
  const T0 = 1_000_000;
  const frameDt = replay.sampleEvery / replay.tickHz;
  // live: every frame received (6 s broadcast buffer), the clock offset corrected by 180 ms mid-run
  const src = { broadcastStartMs: T0, liveEdgeFrame: replay.frames.length - 1, frameDt };
  const start = 6;
  const live = new LiveClock(src, true, T0 + start * 1000);
  const play = new PlaybackClock(replay, { initialTimeSec: start, autoplay: true });
  const motion = new FieldMotion(replay);
  const cam = new TracksideCamera();
  const sprite = gallopMetrics();
  const B = o.dpr;
  const late = rnd(11);
  const run: Run = { flips: 0, scaleChanges: 0, strideBack: 0, strideSkip: 0, clockOff: 0, runnerFrames: 0 };
  const n = replay.horses.length;
  const lod = new Array<number>(n).fill(0);
  const held = new Array<number>(n).fill(0);
  const prevX: number[][] = [];
  const prevK = new Array<number>(n).fill(0);
  const prevFrame = new Array<number>(n).fill(-1);
  const prevRace = new Array<number>(n).fill(0);
  let vsync = T0 + start * 1000;
  let lastT = Number.NaN;
  const frames = Math.round(o.seconds * 60);
  for (let f = 0; f < frames; f++) {
    const dt = 1 / 60;
    vsync += dt * 1000;
    if (f === Math.round(frames / 2)) src.broadcastStartMs -= 180; // a re-estimated clock offset
    // the callback runs a little after vsync (and the clock is read then)
    const now = vsync + (late() < 0.25 ? late() * 9 : late() * 2);
    let t: number;
    if (o.mode === "live") {
      if (o.legacy) {
        live.tick(dt, now);
        t = live.edge(now); // what LiveClock did: the playhead read the wall clock every frame
        live.time = t;
      } else t = live.tick(dt, now).time;
    } else t = play.tick(dt, now).time;
    let simDt = Number.isNaN(lastT) ? 0 : t - lastT;
    const seek = Math.abs(simDt) > 0.6 || simDt < -1e-9;
    if (seek) simDt = 0;
    const snap = Number.isNaN(lastT) || seek;
    if (!snap && Math.abs(simDt - dt) > 0.002) run.clockOff++;
    lastT = t;
    const states = motion.stateAt(t);
    const runners = states.map((s) => ({ x: s.x, lane: s.lane, speed: s.speed }));
    const realDt = Math.min(0.1, dt);
    cam.update({ W: o.W, H: o.H, dpr: B, sprite, railLane: 14.8, finishX: replay.trackLengthMm / 1000, runners }, snap ? 0 : o.legacy ? realDt : simDt > 0 ? Math.min(0.25, simDt) : realDt, snap);
    const lay = placeField({ W: o.W, H: o.H, ppm: cam.ppm, cx: cam.cx, sprite, runners, railLane: 14.8, laneSpan: cam.laneSpan, headroomM: 0.5 });
    for (let h = 0; h < n; h++) {
      const p = lay.placed[h]!;
      const s = states[h]!;
      const q = (p.pxPerM * B) / SRC_PPM;
      const lod0 = lod[h]!;
      lod[h] = chooseLod(q, lod[h]!);
      const s2 = lod[h]!;
      const ax = ANCHOR.x / s2;
      const ay = ANCHOR.y / s2;
      let k: number;
      let x: number;
      if (o.legacy) {
        k = q * s2;
        x = Math.round(p.ax * B - ax * k);
      } else {
        k = held[h] = steadyScale(q * s2, s2 === lod0 ? held[h]! : 0);
        x = snappedOrigin(p.ax * B, p.feetY * B, ax, ay, k)[0];
      }
      const anchorX = x + ax * k;
      const frame = Math.floor((s.phase - Math.floor(s.phase)) * FRAMES) % FRAMES;
      const moving = s.x - prevRace[h]! > 0 && f > 1 && s.x > 3;
      const hist = (prevX[h] ??= []);
      if (moving) {
        run.runnerFrames++;
        if (hist.length >= 2) {
          const d1 = hist[hist.length - 1]! - hist[hist.length - 2]!;
          const d2 = anchorX - hist[hist.length - 1]!;
          if (d1 * d2 < 0) run.flips++;
        }
        if (lod0 === s2 && k !== prevK[h]) run.scaleChanges++;
        if (s.anim === "gallop" && prevFrame[h]! >= 0) {
          const df = (((frame - prevFrame[h]!) % FRAMES) + FRAMES) % FRAMES;
          if (df > FRAMES / 2) run.strideBack++;
          else if (df > 2) run.strideSkip++;
        }
      }
      hist.push(anchorX);
      if (hist.length > 3) hist.shift();
      prevK[h] = k;
      prevFrame[h] = frame;
      prevRace[h] = s.x;
    }
  }
  void FW;
  return run;
}

const pct = (a: number, r: Run) => (100 * a) / Math.max(1, r.runnerFrames);

describe("steady sprites", () => {
  it("holds a sprite's scale while it drifts a little, snaps it to whole pixels per texel near one", () => {
    expect(steadyScale(1.3, 0)).toBe(1.3);
    expect(steadyScale(1.31, 1.3)).toBe(1.3);
    expect(steadyScale(1.36, 1.3)).toBe(1.36);
    expect(steadyScale(2.05, 0)).toBe(2);
    expect(steadyScale(2.07, 2)).toBe(2);
    expect(steadyScale(0.5, 0)).toBe(0.5);
  });
  it("puts the anchor on the whole pixel nearest its place, whatever the scale", () => {
    const [x, y] = snappedOrigin(100.4, 50.6, 10, 5, 1.37);
    expect(x + 10 * 1.37).toBeCloseTo(100);
    expect(y + 5 * 1.37).toBeCloseTo(51);
  });
});

describe("recorded-run jitter (Trackside pipeline, 60 fps)", () => {
  for (const [W, H, dpr] of [
    [390, 420, 2],
    [1440, 620, 1],
  ] as const) {
    it(`live at ${W} px: no screen reversals, no scale crawl, the race moves with the frame (fails on the old clock and placement)`, () => {
      const before = simulate({ mode: "live", legacy: true, W, H, dpr, seconds: 12 });
      const after = simulate({ mode: "live", legacy: false, W, H, dpr, seconds: 12 });
      if (process.env.JITTER_LOG) console.log("live", W, JSON.stringify(before), JSON.stringify(after));
      // the old pipeline, as measured in the browser
      expect(pct(before.flips, before)).toBeGreaterThan(2);
      expect(pct(before.scaleChanges, before)).toBeGreaterThan(50);
      expect(before.clockOff).toBeGreaterThan(100);
      // now
      expect(pct(after.flips, after)).toBeLessThan(0.5);
      expect(pct(after.scaleChanges, after)).toBeLessThan(8);
      expect(after.clockOff).toBeLessThan(5);
      expect(after.strideBack).toBe(0);
      expect(after.strideSkip).toBe(0);
    });
    it(`replay at ${W} px: no screen reversals, no scale crawl, continuous strides`, () => {
      const before = simulate({ mode: "replay", legacy: true, W, H, dpr, seconds: 12 });
      const after = simulate({ mode: "replay", legacy: false, W, H, dpr, seconds: 12 });
      if (process.env.JITTER_LOG) console.log("replay", W, JSON.stringify(before), JSON.stringify(after));
      expect(pct(before.scaleChanges, before)).toBeGreaterThan(50);
      expect(pct(after.flips, after)).toBeLessThan(0.5);
      expect(pct(after.flips, after)).toBeLessThan(pct(before.flips, before));
      expect(pct(after.scaleChanges, after)).toBeLessThan(8);
      expect(after.clockOff).toBe(0);
      expect(after.strideBack).toBe(0);
      expect(after.strideSkip).toBe(0);
    });
  }
});

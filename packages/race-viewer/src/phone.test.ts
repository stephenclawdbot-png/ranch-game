/**
 * Race on a phone (visual research V-01 / V-02): who the close-up finish frames, and the
 * Trackside camera over a whole replay on a 390 px phone stage with it on: the final 400 m are
 * framed around the leaders and your horse (bigger horses, the leaders never out of frame), the
 * whole field before and after, eased, with no zoom pumping. Camera only: the replay is untouched.
 */
import { describe, expect, it } from "vitest";
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";
import { CLOSE_UP_AFTER_S, CLOSE_UP_MINE_M, CloseUpFinish, PHONE_PX, closeUpBlend } from "./phone";
import { CLOSING_M, KEEP_WITH_LEADER_M } from "./director";
import { fakeReplay } from "./dev/fakeReplay";
import { createReplaySampler, replayTiming } from "./sampleReplay";
import { TracksideCamera, gallopMetrics, placeField, crowding, laneFalloff } from "./trackside/layout";

const L = (n: number) => (n * HORSE_LENGTH_MM) / 1000;
const field = (xs: number[]) => xs.map((x, i) => ({ id: `h${i}`, x }));

describe("CloseUpFinish: who the final 400 m frame", () => {
  it("frames nobody before the final 400 m or after the line", () => {
    const c = new CloseUpFinish();
    expect(c.group({ t: 40, trackLengthM: 1200, winnerTime: 74, runners: field([700, 690, 680]), highlightId: null })).toBeNull();
    expect(c.group({ t: 74 + CLOSE_UP_AFTER_S + 0.05, trackLengthM: 1200, winnerTime: 74, runners: field([1205, 1203, 1190]), highlightId: null })).toBeNull();
    expect(c.active).toBe(false);
  });

  it("holds the leader, everyone within two lengths, the runner-up within three and your horse within six lengths", () => {
    const c = new CloseUpFinish();
    const lead = 1200 - CLOSING_M + 50;
    const xs = [lead, lead - L(1.5), lead - L(4), lead - L(5.5), lead - L(9)];
    // h1 within 2 L; h2 is not the runner-up and beyond 2 L: out; h3 is mine (5.5 L): in; h4 at 9 L: out
    expect(c.group({ t: 60, trackLengthM: 1200, winnerTime: 74, runners: field(xs), highlightId: "h3" })).toEqual(["h0", "h1", "h3"]);
    expect(c.active).toBe(true);
    // a clear leader keeps its nearest pursuer for company within three lengths, not five
    const d = new CloseUpFinish();
    expect(d.group({ t: 60, trackLengthM: 1200, winnerTime: 74, runners: field([lead, lead - L(2.8)]), highlightId: null })).toEqual(["h0", "h1"]);
    expect(new CloseUpFinish().group({ t: 60, trackLengthM: 1200, winnerTime: 74, runners: field([lead, lead - L(5)]), highlightId: null })).toEqual(["h0"]);
    expect(CLOSE_UP_MINE_M).toBeCloseTo(L(6));
    expect(KEEP_WITH_LEADER_M).toBeCloseTo(L(2));
  });

  it("keeps a member a little past the edge (no zoom pumping as a horse hovers at two lengths)", () => {
    const c = new CloseUpFinish();
    const lead = 1000;
    c.group({ t: 60, trackLengthM: 1200, winnerTime: 74, runners: field([lead, lead - L(1.9), lead - L(8)]), highlightId: null });
    // h1 drifts to 2.3 L: still framed (hysteresis), while a newcomer at 2.3 L would not join
    expect(c.group({ t: 60.1, trackLengthM: 1200, winnerTime: 74, runners: field([lead, lead - L(2.3), lead - L(8)]), highlightId: null })).toContain("h1");
    const fresh = new CloseUpFinish();
    expect(fresh.group({ t: 60.1, trackLengthM: 1200, winnerTime: 74, runners: field([lead, lead - L(6.3), lead - L(3.3)]), highlightId: null })).toEqual(["h0"]);
  });
});

describe("Trackside camera with the close-up finish on a phone (V-02)", () => {
  const replay = fakeReplay({ horses: 10, seed: 7, distanceM: 1200, photoFinish: true });
  const sample = createReplaySampler(replay);
  const timing = replayTiming(replay);
  const W = 358;
  const H = 320;
  const sprite = gallopMetrics();
  const me = "h3";

  /** Runs the camera through the race at 30 fps; returns per-frame stats. */
  function run(closeUp: boolean, fps = 30) {
    const cam = new TracksideCamera();
    const cu = new CloseUpFinish();
    const out: { t: number; toGo: number; ppm: number; group: number[] | null; horseLen: number[]; inFrame: boolean[]; xs: number[]; ax: number[] }[] = [];
    const dt = 1 / fps;
    let first = true;
    let blend = 0;
    for (let t = 1; t < timing.winnerTime + 4; t += dt) {
      const s = sample(t);
      const runners = s.map((h) => ({ x: h.x / 1000, lane: h.lane, speed: h.speed / 1000 }));
      const ids = closeUp ? cu.group({ t, trackLengthM: 1200, winnerTime: timing.winnerTime, runners: s.map((h) => ({ id: h.horseId, x: h.x / 1000 })), highlightId: me }) : null;
      const group = ids ? s.filter((h) => ids.includes(h.horseId)).map((h) => h.index) : null;
      cam.update({ W, H, dpr: 2, sprite, railLane: 9, finishX: 1200, runners, groupIndices: group }, first ? 0 : dt, first);
      first = false;
      // as the scene: the placement eases to linear with the lens, and back
      blend = closeUpBlend(blend, !!group, dt);
      const lay = placeField({ W, H, ppm: cam.ppm, cx: cam.cx, sprite, runners, railLane: 9, laneSpan: cam.laneSpan, headroomM: 0.5, free: blend });
      const lead = Math.max(...runners.map((r) => r.x));
      out.push({
        t,
        toGo: 1200 - lead,
        ppm: cam.ppm,
        group,
        horseLen: lay.placed.map((p) => p.rect.w * 0.93),
        inFrame: lay.placed.map((p) => p.rect.x >= -1 && p.rect.x + p.rect.w <= W + 1),
        xs: runners.map((r) => r.x),
        ax: lay.placed.map((p) => p.ax),
      });
    }
    return out;
  }

  it("is a phone-only layout (480 px and narrower)", () => {
    expect(PHONE_PX).toBe(480);
    expect(W).toBeLessThanOrEqual(PHONE_PX);
  });

  it("final 400 m: bigger horses (median >= 60 CSS px), every runner within two lengths of the leader in frame", () => {
    const on = run(true);
    const off = run(false);
    const closing = (f: (typeof on)[number]) => f.toGo < CLOSING_M - 40 && f.t < timing.winnerTime;
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;
    const lensOn = on.filter(closing).flatMap((f) => f.group!.map((i) => f.horseLen[i]!));
    const lensOff = off.filter(closing).flatMap((f) => f.horseLen);
    expect(med(lensOn)).toBeGreaterThanOrEqual(60);
    expect(med(lensOn)).toBeGreaterThan(med(lensOff) * 1.3);
    // ...also on a slow phone drawing 10 frames a second (the springs feed the field's speed forward)
    for (const frames of [on, run(true, 10)])
      for (const f of frames.filter(closing)) {
        const lead = Math.max(...f.xs);
        f.xs.forEach((x, i) => {
          if (lead - x <= KEEP_WITH_LEADER_M) expect(f.inFrame[i], `t=${f.t.toFixed(2)} runner ${i}`).toBe(true);
        });
      }
  });

  it("whole field before the final 400 m and back for the run-out; eased, no zoom pumping", () => {
    const on = run(true);
    const off = run(false);
    // identical camera (whole field) until the close-up starts
    for (let i = 0; i < on.length; i++) if (on[i]!.toGo > CLOSING_M + 1) expect(on[i]!.ppm).toBeCloseTo(off[i]!.ppm, 6);
    // the group is framed only from 400 m to just past the line
    for (const f of on) if (f.group) expect(f.toGo).toBeLessThan(CLOSING_M);
    expect(on.filter((f) => f.t > timing.winnerTime + CLOSE_UP_AFTER_S + 0.05).every((f) => !f.group)).toBe(true);
    // the zoom eases: never more than a few percent a frame, and turns at most twice (in for the
    // close-up, out for the run-out) once the field has settled into the closing stages
    let turns = 0;
    let dir = 0;
    for (let i = 1; i < on.length; i++) {
      const r = on[i]!.ppm / on[i - 1]!.ppm;
      expect(Math.abs(Math.log(r))).toBeLessThan(0.08);
      if (on[i]!.toGo > CLOSING_M + 20) continue;
      const d = Math.abs(Math.log(r)) < 0.004 ? 0 : Math.sign(r - 1);
      if (d !== 0 && dir !== 0 && d !== dir) turns++;
      if (d !== 0) dir = d;
    }
    expect(turns).toBeLessThanOrEqual(3);
  });

  it("no runner pops: on screen, each moves no further a frame than the field and the lens carry it", () => {
    const on = run(true);
    for (let i = 1; i < on.length; i++) {
      const a = on[i - 1]!;
      const b = on[i]!;
      b.ax.forEach((x, k) => {
        const inView = (v: number) => v > -40 && v < W + 40;
        if (!inView(x) || !inView(a.ax[k]!)) return;
        // a galloping horse at the close-up zoom covers ~20 px a frame at 30 fps; a pop is far more
        expect(Math.abs(x - a.ax[k]!), `t=${b.t.toFixed(2)} runner ${k}`).toBeLessThan(40);
      });
    }
  });

  it("never moves a runner: the replay positions are the layout's input, not its output", () => {
    const s = sample(70).map((h) => h.x);
    run(true);
    expect(sample(70).map((h) => h.x)).toEqual(s);
    expect(laneFalloff(crowding(W, 10))).toBeGreaterThan(0);
  });
});

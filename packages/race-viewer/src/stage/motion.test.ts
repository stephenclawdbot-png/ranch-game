import { describe, expect, it } from "vitest";
import { fakeReplay } from "../dev/fakeReplay";
import { createReplaySampler } from "../sampleReplay";
import { FieldMotion, GAIT_AT, RUNOUT, gaitFor, postLine, runnerState, timeToSpeed, type FinishInfo, type RunnerState } from "./motion";

const close = fakeReplay({ horses: 10, seed: 7, distanceM: 1200 });
const open = fakeReplay({ horses: 8, seed: 3, distanceM: 1200, photoFinish: false });

describe("post-line run-out", () => {
  it("eases from the line speed at ~0.8 m/s^2 to a canter, then trot and walk over 150-250 m and 15-20 s", () => {
    for (const v0 of [16, 17, 18]) {
      const toWalk = timeToSpeed(v0, RUNOUT.walk);
      expect(toWalk).toBeGreaterThanOrEqual(15);
      expect(toWalk).toBeLessThanOrEqual(21);
      const d = postLine(v0, toWalk).d;
      expect(d).toBeGreaterThanOrEqual(150);
      expect(d).toBeLessThanOrEqual(250);
      // deceleration bounds: never harder than 1 m/s^2 (a real horse, not a car)
      let prev = postLine(v0, 0);
      for (let t = 0.1; t < 30; t += 0.1) {
        const cur = postLine(v0, t);
        const a = (prev.v - cur.v) / 0.1;
        expect(a).toBeLessThanOrEqual(1.0 + 1e-9);
        expect(a).toBeGreaterThanOrEqual(-1e-9);
        expect(cur.d).toBeGreaterThanOrEqual(prev.d);
        prev = cur;
      }
      expect(postLine(v0, 2).v).toBeCloseTo(v0 - 1.6, 5);
    }
  });

  it("gaits run gallop -> canter -> trot -> walk -> stand, never skipping", () => {
    const order = ["gallop", "canter", "trot", "walk", "stand"];
    let last = 0;
    for (let t = 0; t < 40; t += 0.05) {
      const g = gaitFor(postLine(17, t).v);
      const i = order.indexOf(g);
      expect(i - last).toBeLessThanOrEqual(1);
      expect(i).toBeGreaterThanOrEqual(last);
      last = i;
    }
    expect(last).toBe(4);
    expect(gaitFor(GAIT_AT.canter)).toBe("canter");
  });

  it("an injured horse is pulled up with the pull-up strip, ending stood still on frame 9", () => {
    const f: FinishInfo = { L: 1200, finishT: 70, finishSpeed: 16, phaseAtLine: 3, winner: false, lungeT: null, injured: true };
    const s0 = runnerState({ x: 1200000, lane: 2, speed: 16000 }, 70.2, f);
    expect(s0.anim).toBe("pullup");
    const s1 = runnerState({ x: 1200000, lane: 2, speed: 16000 }, 90, f);
    expect(s1.speed).toBe(0);
    expect(s1.frame).toBe(9);
    expect(s1.gait).toBe("stand");
  });
});

describe("FieldMotion", () => {
  function run(replay: typeof close, from: number, to: number, dt = 1 / 60) {
    const m = new FieldMotion(replay);
    const out: RunnerState[][] = [];
    for (let t = from; t <= to; t += dt) out.push(m.stateAt(t).map((s) => ({ ...s })));
    return { m, out };
  }

  it("keeps the replay's x exactly up to each horse's finish", () => {
    const m = new FieldMotion(close);
    const sampler = createReplaySampler(close);
    for (let t = 0; t < 80; t += 0.37) {
      const st = m.stateAt(t);
      const s = sampler(t);
      st.forEach((r, h) => {
        const ft = m.finishInfo(h).finishT;
        if (ft === null || t <= ft) expect(r.x).toBe(s[h]!.x / 1000);
      });
    }
  });

  it("is continuous across the line and decelerates gently afterwards", () => {
    const winner = close.result.finishOrder[0]!;
    const h = close.horses.findIndex((x) => x.horseId === winner.horseId);
    const ft = winner.finishTimeUs / 1e6;
    const m = new FieldMotion(close);
    const a = m.stateAt(ft - 1 / 120)[h]!.x;
    const b = m.stateAt(ft + 1 / 120)[h]!.x;
    expect(Math.abs(b - a)).toBeLessThan(0.5);
    const v1 = m.stateAt(ft + 1)[h]!.speed;
    const v6 = m.stateAt(ft + 6)[h]!.speed;
    expect((v1 - v6) / 5).toBeLessThanOrEqual(0.81);
    expect(m.stateAt(ft + 5)[h]!.x).toBeGreaterThan(1200 + 50);
    expect(m.stateAt(ft + 15)[h]!.x).toBeGreaterThan(1200 + 140);
  });

  it("is deterministic and scrub-safe (same state whatever the path)", () => {
    const a = new FieldMotion(close);
    const b = new FieldMotion(close);
    for (let t = 0; t < 70; t += 0.5) a.stateAt(t);
    const t = 81.3;
    const sa = a.stateAt(t);
    const sb = b.stateAt(t);
    expect(sb).toEqual(sa);
  });

  it("plays break -> gallop -> drive -> (lunge) -> run-out strips; the winner celebrates", () => {
    const { out } = run(close, -1, 95, 1 / 30);
    const winner = close.horses.findIndex((x) => x.horseId === close.result.finishOrder[0]!.horseId);
    const second = close.horses.findIndex((x) => x.horseId === close.result.finishOrder[1]!.horseId);
    const anims = (h: number) => [...new Set(out.map((f) => f[h]!.anim))];
    expect(out[0]![0]!.anim).toBe("break");
    expect(out[0]![0]!.frame).toBe(0);
    const w = anims(winner);
    expect(w).toEqual(expect.arrayContaining(["break", "gallop", "drive", "lunge", "easeup", "celebrate"]));
    expect(w.indexOf("drive")).toBeLessThan(w.indexOf("celebrate"));
    // close finish: the runner-up lunges too and does not celebrate
    expect(anims(second)).toContain("lunge");
    expect(anims(second)).not.toContain("celebrate");
    // no horse ever freezes mid-gallop: a horse drawn galloping is moving
    for (const f of out) for (const r of f) if (r.anim === "gallop" || r.anim === "drive") expect(r.speed).toBeGreaterThan(0);
  });

  it("no lunge when the finish is not close", () => {
    const { out } = run(open, 0, 90, 1 / 20);
    const order = open.result.finishOrder;
    const marginM = order[1]!.marginMm / 1000;
    if (marginM > 3) for (const f of out) for (const r of f) expect(r.anim).not.toBe("lunge");
  });

  it("live (no result): finishes from frames, the winner celebrates only once clear", () => {
    const live = { ...open, result: null };
    const m = new FieldMotion(live);
    const ft = open.result.finishOrder[0]!.finishTimeUs / 1e6;
    const st = m.stateAt(ft + 3);
    expect(m.winner()).toBeGreaterThanOrEqual(0);
    expect(st[m.winner()]!.anim).toBe("celebrate");
    const photo = new FieldMotion({ ...close, result: null });
    photo.stateAt(close.result.finishOrder[1]!.finishTimeUs / 1e6 + 3);
    expect(photo.winner()).toBe(-1); // a photo: wait for the official result
  });
});

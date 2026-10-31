import { describe, expect, it } from "vitest";
import { fakeReplay } from "../dev/fakeReplay";
import { Director } from "../director";
import { FieldMotion, type RunnerState } from "./motion";
import { LOAD_FROM, POST_FROM, PRE_OFF_SEC, SETTLE_AT, WALK_IN_S, loadingAt, postCentre, preOffPlan, preOffRunner, preOffStep } from "./preoff";

const replay = fakeReplay({ horses: 10, seed: 7, distanceM: 1200 });
/** What a live viewer has before the off: the header only (no frames, no result, no seed). */
const header = { ...replay, frames: [] as number[][], events: [], result: null };

describe("the build-up before the off", () => {
  it("is 15-25 s long and runs paddock -> to post -> loading -> settled -> off", () => {
    expect(PRE_OFF_SEC).toBeGreaterThanOrEqual(15);
    expect(PRE_OFF_SEC).toBeLessThanOrEqual(25);
    const kinds: string[] = [];
    for (let t = -PRE_OFF_SEC - 2; t < 1; t += 0.05) {
      const k = preOffStep(t).kind;
      if (kinds[kinds.length - 1] !== k) kinds.push(k);
    }
    expect(kinds).toEqual(["parade", "post", "loading", "settled", "off"]);
  });

  it("is built from the locked field alone (stalls), the same for the header and the finished replay", () => {
    const a = preOffPlan(replay.horses, 1200, replay.laneCount);
    const b = preOffPlan(header.horses.map((h) => ({ gate: h.gate })), 1200, header.laneCount);
    expect(b).toEqual(a);
    // Odd stalls load first, then even, each in stall order, one at a time.
    const gates = a.order.map((h) => replay.horses[h]!.gate);
    const odd = gates.filter((g) => g % 2 === 1);
    expect(gates).toEqual([...odd, ...gates.filter((g) => g % 2 === 0)]);
    expect([...odd].sort((x, y) => x - y)).toEqual(odd);
    for (let j = 1; j < a.order.length; j++) expect(a.loadAt[a.order[j]!]! - a.loadAt[a.order[j - 1]!]!).toBeGreaterThan(0.3);
    for (const h of a.order) {
      expect(a.loadAt[h]!).toBeGreaterThanOrEqual(LOAD_FROM);
      expect(a.loadAt[h]! + WALK_IN_S).toBeLessThanOrEqual(SETTLE_AT);
    }
  });

  it("a live viewer and a replay viewer see the same horses at the same moment, joining at any time", () => {
    const plan = preOffPlan(replay.horses, 1200, replay.laneCount);
    const live = new FieldMotion(header, { preOff: plan });
    const done = new FieldMotion(replay, { preOff: plan });
    // A late arrival (no history) sees exactly what a viewer who watched from the start sees.
    const watched = new FieldMotion(replay, { preOff: plan });
    for (let t = -PRE_OFF_SEC; t < -0.05; t += 0.37) watched.stateAt(t);
    for (const t of [-23, -17.5, -12, -9.4, -6.6, -3.1, -0.4]) {
      const a = live.stateAt(t).map((s) => ({ ...s }));
      const b = done.stateAt(t).map((s) => ({ ...s }));
      const c = new FieldMotion(replay, { preOff: plan }).stateAt(t);
      expect(a).toEqual(b);
      expect(c).toEqual(b);
    }
    expect(watched.stateAt(-0.4)).toEqual(done.stateAt(-0.4));
  });

  it("canters past the stands to post, then every horse ends in its own stall at the off", () => {
    const plan = preOffPlan(replay.horses, 1200, replay.laneCount);
    const m = new FieldMotion(replay, { preOff: plan });
    const mid = m.stateAt((POST_FROM + LOAD_FROM) / 2).map((s) => ({ ...s }));
    const centre = mid.reduce((x, s) => x + s.x, 0) / mid.length;
    expect(Math.abs(centre - (1200 - 30))).toBeLessThan(6);
    for (const s of mid) {
      expect(s.gait).toBe("canter");
      expect(s.anim).toBe("easeup");
      expect(s.lane).toBeGreaterThanOrEqual(0);
      expect(s.lane).toBeLessThanOrEqual(replay.laneCount - 1);
    }
    expect(postCentre(plan, LOAD_FROM) - postCentre(plan, POST_FROM)).toBeCloseTo(7 * (LOAD_FROM - POST_FROM), 6);
    // In the bays before the off, standing exactly where the race starts.
    const before = m.stateAt(-0.3).map((s) => ({ ...s }));
    const start = new FieldMotion(replay).stateAt(0);
    before.forEach((s, i) => {
      expect(s.anim).toBe("break");
      expect(s.frame).toBe(0);
      expect(s.x).toBeCloseTo(start[i]!.x, 9);
      expect(s.lane).toBeCloseTo(start[i]!.lane, 9);
    });
    // Live before any frame: each horse's lane is its stall.
    const live = new FieldMotion(header, { preOff: plan }).stateAt(-0.3);
    live.forEach((s, i) => expect(s.lane).toBe(replay.horses[i]!.gate - 1));
  });

  it("loads one at a time: waiting behind the stalls, led in, then in", () => {
    const plan = preOffPlan(replay.horses, 1200, replay.laneCount);
    let prevLoaded = 0;
    for (let t = LOAD_FROM; t < 0; t += 0.05) {
      const ld = loadingAt(plan, t);
      expect(ld.loaded).toBeGreaterThanOrEqual(prevLoaded);
      prevLoaded = ld.loaded;
      for (let h = 0; h < plan.order.length; h++) {
        const s = preOffRunner(plan, h, t, { x: 0, lane: h }, {} as RunnerState);
        expect(s.x).toBeLessThanOrEqual(1e-9);
        expect(s.x).toBeGreaterThanOrEqual(-8);
      }
    }
    expect(loadingAt(plan, SETTLE_AT).loaded).toBe(plan.order.length);
    expect(loadingAt(plan, LOAD_FROM).loaded).toBe(0);
  });

  it("every field size (1-24) is fully loaded at least a second before the off", () => {
    for (let n = 1; n <= 24; n++) {
      const plan = preOffPlan(Array.from({ length: n }, (_, i) => ({ gate: i + 1 })), 1200);
      expect(loadingAt(plan, -1).loaded).toBe(n);
      for (const at of plan.loadAt) {
        expect(at).toBeGreaterThanOrEqual(LOAD_FROM);
        expect(at + WALK_IN_S).toBeLessThanOrEqual(-1);
      }
    }
  });

  it("the director frames the field going down to post, then the stalls, and the race as before", () => {
    const d = new Director();
    const runners = replay.horses.map((h) => ({ id: h.horseId, x: 1170 }));
    const inp = { t: -14, runners, trackLengthM: 1200, winnerTime: 70, photoFinish: false, newEvents: [], highlightId: null, preOff: "post" as const };
    expect(d.update(inp).shot.type).toBe("topost");
    expect(d.intent).toEqual({ kind: "field" });
    expect(d.update({ ...inp, t: -9.8, preOff: "loading", runners: runners.map((r) => ({ ...r, x: -7 })) }).shot.type).toBe("gate");
    expect(d.update({ ...inp, t: -0.2, preOff: null, runners: runners.map((r) => ({ ...r, x: 0 })) }).shot.type).toBe("gate");
  });
});

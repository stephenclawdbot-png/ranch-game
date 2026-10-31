import { describe, expect, it } from "vitest";
import { CLOSING_M, CLOSING_UNSEEN_S, Director, FINAL_FURLONG_M, FINISH_ON_LEADERS_M, KEEP_WITH_LEADER_M, MAX_UNSEEN_S, MIN_SHOT_S, type ShotType } from "./director";
import { fakeReplay } from "./dev/fakeReplay";
import { createReplaySampler, replayTiming } from "./sampleReplay";

function run(seed: number, highlight: string | null, photoFinish = true, compact = false) {
  const replay = fakeReplay({ horses: 10, seed, distanceM: 1600, photoFinish });
  const timing = replayTiming(replay);
  const sample = createReplaySampler(replay);
  const d = new Director();
  d.compact = compact;
  d.reset(-1.5);
  const changes: { t: number; type: ShotType; subject: string | null; toGo: number }[] = [];
  let unseenMax = 0;
  let lastSeen = 0;
  let evIdx = 0;
  const dt = 1 / 30;
  for (let t = -1.5; t < timing.duration + 3; t += dt) {
    const s = sample(Math.max(0, t));
    const runners = s.map((x) => ({ id: x.horseId, x: x.x / 1000 }));
    const newEvents = [];
    while (evIdx < replay.events.length && replay.events[evIdx]!.tick / replay.tickHz <= t) newEvents.push(replay.events[evIdx++]!);
    const input = { t, runners, trackLengthM: replay.trackLengthMm / 1000, winnerTime: timing.winnerTime, photoFinish: replay.result.photoFinish, newEvents, highlightId: highlight };
    const { shot, changed } = d.update(input);
    if (changed) changes.push({ t, type: shot.type, subject: shot.subject, toGo: replay.trackLengthMm / 1000 - Math.max(...runners.map((r) => r.x)) });
    if (highlight && t > 1 && t < timing.winnerTime) {
      if (d.shows(highlight, input)) lastSeen = t;
      unseenMax = Math.max(unseenMax, t - lastSeen);
    }
  }
  return { changes, unseenMax, timing, replay };
}

describe("broadcast director (side-on only)", () => {
  it("only ever uses side-on framings", () => {
    for (const seed of [3, 7, 11]) {
      const { changes } = run(seed, "h9");
      for (const c of changes) expect(["gate", "establish", "close", "pack", "judge", "post", "wide"]).toContain(c.type);
    }
  });

  it("starts at the gate, shows the whole field, tracks close, uses the judge's line for a photo, holds the post", () => {
    const { changes } = run(7, "h9");
    const types = changes.map((c) => c.type);
    expect(types[0]).toBe("establish");
    expect(types).toContain("close");
    expect(types).toContain("pack");
    expect(types).toContain("judge");
    expect(types[types.length - 1]).toBe("post");
  });

  it("holds each framing for a while (no restless re-framing)", () => {
    const { changes } = run(11, "h4");
    for (let i = 1; i < changes.length; i++) {
      const phase = ["judge", "post"].includes(changes[i]!.type) || changes[i - 1]!.type === "gate" || changes[i]!.toGo < CLOSING_M;
      if (!phase) expect(changes[i]!.t - changes[i - 1]!.t).toBeGreaterThanOrEqual(MIN_SHOT_S - 1e-6);
    }
  });

  it("never leaves the player's horse out of frame for more than ~10 s (also compact)", () => {
    for (const seed of [3, 5, 9]) {
      expect(run(seed, "h9", false).unseenMax).toBeLessThanOrEqual(MAX_UNSEEN_S + 0.5);
      expect(run(seed, "h9", false, true).unseenMax).toBeLessThanOrEqual(MAX_UNSEEN_S + 0.5);
    }
  });

  it("emits a shared intent and survives a view rebuild (no restart unless time jumps)", async () => {
    const { intentOf } = await import("./director");
    expect(intentOf({ type: "establish", subject: null })).toEqual({ kind: "field" });
    expect(intentOf({ type: "close", subject: "h3" })).toEqual({ kind: "group", subject: "h3" });
    expect(intentOf({ type: "judge", subject: null })).toEqual({ kind: "line" });
    expect(intentOf({ type: "post", subject: "h1" })).toEqual({ kind: "pullup", subject: "h1" });
    const d = new Director();
    const runners = [{ id: "h1", x: 100 }, { id: "h2", x: 98 }];
    const base = { runners, trackLengthM: 1200, winnerTime: Infinity, photoFinish: false, newEvents: [], highlightId: null };
    for (let t = 0; t < 30; t += 0.1) d.update({ ...base, t });
    const before = d.shot;
    d.update({ ...base, t: 30.05 }); // a new scene draws its first frame: same shot
    expect(d.shot).toEqual(before);
    d.update({ ...base, t: 5 }); // a seek back: direction restarts
    expect(d.shot.since).toBe(5);
  });

  it("the post shot follows the winner", () => {
    const d = new Director();
    const runners = [{ id: "h1", x: 1250 }, { id: "h2", x: 1240 }];
    const base = { runners, trackLengthM: 1200, winnerTime: 70, photoFinish: false, newEvents: [], highlightId: null, winnerId: "h2" };
    for (let t = 69; t < 75; t += 0.1) d.update({ ...base, t });
    expect(d.shot).toMatchObject({ type: "post", subject: "h2" });
  });
});

describe("closing-stage framing rules", () => {
  /** Runs the director through a race; counts rule breaks in the closing stages. */
  function closing(seed: number, pick: (order: string[]) => string | null, compact = false, spread = 1) {
    const replay = fakeReplay({ horses: 10, seed, distanceM: 1200, photoFinish: false, spread });
    const timing = replayTiming(replay);
    const sample = createReplaySampler(replay);
    const order = replay.result.finishOrder.map((f) => f.horseId);
    const hl = pick(order);
    const d = new Director();
    d.compact = compact;
    let evIdx = 0;
    let unseen = 0;
    let unseenMax = 0;
    let violations = 0;
    const L = replay.trackLengthMm / 1000;
    for (let t = 0; t < timing.winnerTime; t += 1 / 30) {
      const runners = sample(t).map((x) => ({ id: x.horseId, x: x.x / 1000 }));
      const newEvents = [];
      while (evIdx < replay.events.length && replay.events[evIdx]!.tick / replay.tickHz <= t) newEvents.push(replay.events[evIdx++]!);
      const input = { t, runners, trackLengthM: L, winnerTime: timing.winnerTime, photoFinish: false, newEvents, highlightId: hl };
      d.update(input);
      const lead = runners.reduce((a, b) => (b.x > a.x ? b : a));
      const toGo = L - lead.x;
      if (toGo < FINAL_FURLONG_M && toGo > 0) {
        const lookingAtMe = d.shot.type === "close" && d.shot.subject === hl && hl !== null;
        for (const r of runners) if (lead.x - r.x <= KEEP_WITH_LEADER_M && !lookingAtMe && !d.mustFrame.includes(r.id)) violations++;
      }
      if (hl && toGo < CLOSING_M && toGo > FINISH_ON_LEADERS_M) {
        unseen = d.shows(hl, input) ? 0 : unseen + 1 / 30;
        unseenMax = Math.max(unseenMax, unseen);
      }
    }
    return { violations, unseenMax };
  }

  it("in the final furlong everything within two lengths of the leader is in the framing", () => {
    for (const seed of [3, 5, 9, 13]) expect(closing(seed, () => null).violations).toBe(0);
  });

  it("never holds a shot that hides your horse in the closing stages (near the lead, mid-pack, tailed off; phone too)", () => {
    for (const seed of [3, 5, 9]) {
      for (const pos of [1, 4, 9]) {
        for (const compact of [false, true]) {
          const r = closing(seed, (o) => o[pos]!, compact, 3);
          expect(r.unseenMax).toBeLessThanOrEqual(CLOSING_UNSEEN_S + 0.2);
        }
      }
    }
  });

  it("a seek into the final furlong frames the leaders at once (no establishing shot first)", () => {
    const d = new Director();
    const runners = [{ id: "h1", x: 1100 }, { id: "h2", x: 1098 }, { id: "h3", x: 1060 }];
    d.update({ t: 66, runners, trackLengthM: 1200, winnerTime: 72, photoFinish: false, newEvents: [], highlightId: "h2" });
    expect(d.shot).toMatchObject({ type: "close", subject: null });
    expect(d.mustFrame.sort()).toEqual(["h1", "h2"]);
  });

  it("a forced replay shot holds whatever the race does", () => {
    const d = new Director();
    d.force({ type: "replay", subject: "h2" });
    const runners = [{ id: "h1", x: 1190 }, { id: "h2", x: 1189 }];
    const base = { runners, trackLengthM: 1200, winnerTime: 70, photoFinish: true, newEvents: [], highlightId: "h1" };
    for (let t = 60; t < 75; t += 0.1) d.update({ ...base, t });
    expect(d.shot).toMatchObject({ type: "replay", subject: "h2" });
    expect(d.intent).toEqual({ kind: "replay", subject: "h2" });
    d.force(null);
    d.update({ ...base, t: 75.1 });
    expect(d.shot.type).toBe("post");
  });
});

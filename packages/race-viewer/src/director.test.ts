import { describe, expect, it } from "vitest";
import { Director, MAX_UNSEEN_S, MIN_SHOT_S, type ShotType } from "./director";
import { fakeReplay } from "./dev/fakeReplay";
import { createReplaySampler, replayTiming } from "./sampleReplay";

function run(seed: number, highlight: string | null, photoFinish = true, compact = false) {
  const replay = fakeReplay({ horses: 10, seed, distanceM: 1600, photoFinish });
  const timing = replayTiming(replay);
  const sample = createReplaySampler(replay);
  const d = new Director();
  d.compact = compact;
  d.reset(-1.5);
  const changes: { t: number; type: ShotType; subject: string | null }[] = [];
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
    if (changed) changes.push({ t, type: shot.type, subject: shot.subject });
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
      for (const c of changes) expect(["gate", "close", "pack", "judge", "post"]).toContain(c.type);
    }
  });

  it("starts at the gate, tracks close, uses the judge's line for a photo, holds the post", () => {
    const { changes } = run(7, "h9");
    const types = changes.map((c) => c.type);
    expect(types[0]).toBe("close");
    expect(types).toContain("pack");
    expect(types).toContain("judge");
    expect(types[types.length - 1]).toBe("post");
  });

  it("holds each framing for a while (no restless re-framing)", () => {
    const { changes } = run(11, "h4");
    for (let i = 1; i < changes.length; i++) {
      const phase = ["judge", "post"].includes(changes[i]!.type) || changes[i - 1]!.type === "gate";
      if (!phase) expect(changes[i]!.t - changes[i - 1]!.t).toBeGreaterThanOrEqual(MIN_SHOT_S - 1e-6);
    }
  });

  it("never leaves the player's horse out of frame for more than ~10 s (also compact)", () => {
    for (const seed of [3, 5, 9]) {
      expect(run(seed, "h9", false).unseenMax).toBeLessThanOrEqual(MAX_UNSEEN_S + 0.5);
      expect(run(seed, "h9", false, true).unseenMax).toBeLessThanOrEqual(MAX_UNSEEN_S + 0.5);
    }
  });
});

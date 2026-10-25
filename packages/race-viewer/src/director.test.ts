import { describe, expect, it } from "vitest";
import { Director, MAX_UNSEEN_S, MIN_SHOT_S, type ShotType } from "./director";
import { fakeReplay } from "./dev/fakeReplay";
import { createReplaySampler, replayTiming } from "./sampleReplay";

function run(seed: number, highlight: string | null, photoFinish = true) {
  const replay = fakeReplay({ horses: 10, seed, distanceM: 1600, photoFinish });
  const timing = replayTiming(replay);
  const sample = createReplaySampler(replay);
  const d = new Director();
  d.reset(-1.5);
  const cuts: { t: number; type: ShotType; subject: string | null }[] = [];
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
    const { shot, cut } = d.update(input);
    if (cut) cuts.push({ t, type: shot.type, subject: shot.subject });
    if (highlight && t > 1 && t < timing.winnerTime) {
      if (d.shows(highlight, input)) lastSeen = t;
      unseenMax = Math.max(unseenMax, t - lastSeen);
    }
  }
  return { cuts, unseenMax, timing, replay };
}

describe("broadcast director", () => {
  it("opens on the gate, establishes with an aerial, uses the rail cam in the final furlong and the judge cam for a photo", () => {
    const { cuts, timing } = run(7, "h9");
    const types = cuts.map((c) => c.type);
    expect(types[0]).toBe("close");
    expect(types).toContain("aerial");
    expect(types).toContain("headon");
    expect(types).toContain("rail");
    expect(types).toContain("judge");
    const aerial = cuts.find((c) => c.type === "aerial")!;
    expect(aerial.t).toBeLessThan(timing.winnerTime * 0.4);
  });

  it("never cuts more than once per ~3 s outside forced cuts", () => {
    const { cuts } = run(11, "h4");
    for (let i = 1; i < cuts.length; i++) {
      const forced = ["judge", "post"].includes(cuts[i]!.type) || cuts[i - 1]!.type === "gate";
      if (!forced) expect(cuts[i]!.t - cuts[i - 1]!.t).toBeGreaterThanOrEqual(MIN_SHOT_S - 1e-6);
    }
  });

  it("never leaves the player's horse unseen for more than ~10 s", () => {
    for (const seed of [3, 5, 9]) {
      const { unseenMax } = run(seed, "h9", false);
      expect(unseenMax).toBeLessThanOrEqual(MAX_UNSEEN_S + 0.5);
    }
  });

  it("shots last a few seconds (no strobing)", () => {
    const { cuts } = run(21, "h2");
    const avg = (cuts[cuts.length - 1]!.t - cuts[0]!.t) / Math.max(1, cuts.length - 1);
    expect(avg).toBeGreaterThan(3.5);
    expect(avg).toBeLessThan(12);
  });
});

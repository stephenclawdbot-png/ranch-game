import { describe, expect, it } from "vitest";
import type { LiveRaceFeed, RaceReplay } from "@thoroughbred/shared";
import { fakeReplay } from "../dev/fakeReplay";
import { finalePlan } from "./plan";
import { officialHandoff } from "./live";

const r = fakeReplay({ horses: 8, seed: 3, distanceM: 1000, photoFinish: true });
const dt = r.sampleEvery / r.tickHz;
const last = r.frames.length - 1;

/** A feed whose official replay throws if its result is read before `allowed()` says so. */
function feedAt(edge: number, withFinal: boolean, allowed: () => boolean): Pick<LiveRaceFeed, "final" | "liveEdgeFrame" | "header"> {
  const guarded = new Proxy(r, {
    get(target, key) {
      if ((key === "result" || key === "seed") && !allowed()) throw new Error("spoiler: result read before the broadcast reached it");
      return Reflect.get(target, key);
    },
  }) as RaceReplay;
  return {
    header: { version: 1, engineVersion: r.engineVersion, race: r.race, seedCommitment: r.seedCommitment, tickHz: r.tickHz, sampleEvery: r.sampleEvery, trackLengthMm: r.trackLengthMm, laneCount: r.laneCount, horses: r.horses },
    liveEdgeFrame: edge,
    final: withFinal ? guarded : null,
  };
}

describe("live -> official hand-off (no spoilers)", () => {
  it("no result while the race is still being broadcast", () => {
    for (let edge = 0; edge < last; edge += 37) {
      const feed = feedAt(edge, false, () => false);
      expect(officialHandoff(feed, edge * dt)).toBeNull();
    }
  });

  it("a viewer behind the live edge (rewound) gets no result, even once the feed has it", () => {
    let reached = false;
    const feed = feedAt(last, true, () => reached);
    for (let t = 0; t < last * dt - dt * 1.5; t += 1.7) expect(officialHandoff(feed, t)).toBeNull();
    reached = true;
    const fin = officialHandoff(feed, last * dt);
    expect(fin).not.toBeNull();
    // Only now is the finale built (it reads the official result).
    const plan = finalePlan(fin!);
    expect(plan.photo).toBe(true);
    expect(plan.startAt).toBeGreaterThan(plan.winnerTime);
  });
});

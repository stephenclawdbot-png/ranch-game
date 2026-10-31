import { describe, expect, it } from "vitest";
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";
import { fakeReplay } from "../dev/fakeReplay";
import { createReplaySampler } from "../sampleReplay";
import { stageLandmarks } from "../stage/buildRaceStage";
import { BATTLE_WITHIN_MM, battleAt, distanceMarker } from "./battle";

const L = 1_200_000;
const s = (horseId: string, x: number, finished = false) => ({ horseId, x, finished });

describe("battleAt", () => {
  it("two or three horses within half a length in the final 200 m", () => {
    expect(battleAt([s("a", L - 150_000), s("b", L - 150_900), s("c", L - 152_000)], L)).toEqual({ horseIds: ["a", "b"], behindMm: [0, 900] });
    expect(battleAt([s("a", L - 150_000), s("b", L - 150_300), s("c", L - 151_100), s("d", L - 151_150)], L)!.horseIds).toEqual(["a", "b", "c"]);
  });

  it("nothing before the final 200 m, when the leader is clear, or once the leader is home", () => {
    expect(battleAt([s("a", L - 250_000), s("b", L - 250_100)], L)).toBeNull();
    expect(battleAt([s("a", L - 100_000), s("b", L - 100_000 - BATTLE_WITHIN_MM - 1)], L)).toBeNull();
    expect(battleAt([s("a", L, true), s("b", L - 200)], L)).toBeNull();
  });

  it("reads only the samples at the playhead (a photo-finish replay shows it before the line)", () => {
    const r = fakeReplay({ horses: 8, seed: 3, distanceM: 1200, photoFinish: true });
    const sample = createReplaySampler(r);
    const w = r.result.winningTimeUs / 1e6;
    expect(battleAt(sample(w - 0.3), r.trackLengthMm)).not.toBeNull();
    expect(battleAt(sample(w - 40), r.trackLengthMm)).toBeNull();
    expect(HORSE_LENGTH_MM / 2).toBe(BATTLE_WITHIN_MM);
  });
});

describe("distanceMarker", () => {
  const lm = stageLandmarks(1200, 8);
  const markers = [...lm.poles, ...lm.boards];
  it("names the next pole or board ahead of the leader, colour-coded like the stage", () => {
    const m = distanceMarker(markers, 500, 1200);
    expect(m.label).toBe("3f");
    expect(m.colour).toBe(lm.poles.find((p) => p.label === "3f")!.colour);
    expect(m.toGoM).toBe(700);
    expect(m.finalFurlong).toBe(false);
    const f = distanceMarker(markers, 1050, 1200);
    expect(f.label).toBe("100");
    expect(f.finalFurlong).toBe(true);
    expect(distanceMarker(markers, 1150, 1200).label).toBe("");
  });
});

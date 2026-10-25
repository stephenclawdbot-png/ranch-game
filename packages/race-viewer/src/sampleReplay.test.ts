import { describe, expect, it } from "vitest";
import { RaceReplaySchema, type RaceReplay } from "@thoroughbred/shared";
import { createReplaySampler, replayTiming, sampleReplay } from "./sampleReplay";
import { commentaryAt, distanceToGoM, lengthsLabel, standingsAt } from "./timeline";
import { fakeReplay } from "./dev/fakeReplay";

const appearance = {
  coat: "bay" as const,
  face: "none" as const,
  legs: ["none", "none", "none", "none"] as ["none", "none", "none", "none"],
  silks: { primary: "#111111", secondary: "#ffffff", pattern: "solid" as const, cap: "#ff0000" },
};
const hash = "a".repeat(64);

/** Two horses, 10 Hz frames (tickHz 20, sampleEvery 2), constant speeds. */
function tinyReplay(): RaceReplay {
  // A: 20 m/s, B: 10 m/s; frame dt = 0.1 s. Track 4 m: A finishes at 0.2 s.
  const frames = [
    [0, 0, 20000, 1000, 0, 1000, 10000, 1000],
    [2000, 0, 20000, 990, 1000, 1500, 10000, 995],
    [4000, 0, 20000, 980, 2000, 2000, 10000, 990],
    [4000, 0, 0, 980, 3000, 2000, 10000, 985],
    [4000, 0, 0, 980, 4000, 2000, 10000, 980],
  ];
  return {
    version: 1,
    engineVersion: "test",
    race: {
      id: "r",
      name: "Test",
      distanceM: 800,
      surface: "turf",
      weather: "clear",
      going: "good",
      raceClass: "maiden",
      postTimeMs: 0,
      purse: 0,
    },
    seedCommitment: hash,
    seed: hash,
    tickHz: 20,
    sampleEvery: 2,
    trackLengthMm: 4000,
    laneCount: 2,
    horses: [
      { horseId: "A", name: "Alpha", gate: 1, tactic: "front", appearance },
      { horseId: "B", name: "Bravo", gate: 2, tactic: "closer", appearance },
    ],
    frames,
    totalTicks: 8,
    events: [
      { tick: 0, type: "start", text: "Off" },
      { tick: 4, type: "finish", horseId: "A", text: "Alpha wins" },
    ],
    result: {
      finishOrder: [
        { horseId: "A", position: 1, finishTimeUs: 200_000, marginMm: 0, marginLabel: "", prize: 0 },
        { horseId: "B", position: 2, finishTimeUs: 400_000, marginMm: 2000, marginLabel: "1", prize: 0 },
      ],
      winningTimeUs: 200_000,
      photoFinish: false,
      resultHash: hash,
    },
  };
}

describe("sampleReplay", () => {
  it("interpolates between frames", () => {
    const r = tinyReplay();
    const [a, b] = sampleReplay(r, 0.05);
    expect(a!.x).toBeCloseTo(1000, 6);
    expect(b!.x).toBeCloseTo(500, 6);
    expect(b!.lane).toBeCloseTo(1.25, 6);
    expect(a!.energy).toBeCloseTo(995, 6);
    expect(a!.finished).toBe(false);
  });

  it("is exact on frames and clamps at the last frame", () => {
    const r = tinyReplay();
    expect(sampleReplay(r, 0.1)[1]!.x).toBe(1000);
    const end = sampleReplay(r, 99);
    expect(end[0]!.x).toBe(4000);
    expect(end[1]!.x).toBe(4000);
    expect(end.every((s) => s.finished)).toBe(true);
    const start = sampleReplay(r, -5);
    expect(start[0]!.x).toBe(0);
    expect(start[0]!.position).toBe(1); // tie broken by index
  });

  it("never overshoots a segment, even with inconsistent speeds", () => {
    const r = tinyReplay();
    // Frame 2->3: A clamped at 4000 with speed 20000 at frame 2: Hermite must not pass 4000.
    for (let t = 0.2; t <= 0.3; t += 0.01) expect(sampleReplay(r, t)[0]!.x).toBeLessThanOrEqual(4000);
  });

  it("ranks live by distance and finished horses by the official result", () => {
    const r = tinyReplay();
    const mid = sampleReplay(r, 0.15);
    expect(mid.find((s) => s.horseId === "A")!.position).toBe(1);
    // Swap the official order: B listed as winner; once both finished, result order wins.
    r.result.finishOrder = [
      { ...r.result.finishOrder[1]!, position: 1, finishTimeUs: 100_000 },
      { ...r.result.finishOrder[0]!, position: 2, finishTimeUs: 200_000 },
    ];
    const end = sampleReplay(r, 0.4);
    expect(end.find((s) => s.horseId === "B")!.position).toBe(1);
    expect(end.find((s) => s.horseId === "A")!.position).toBe(2);
  });

  it("finished flag follows result finish times", () => {
    const r = tinyReplay();
    expect(sampleReplay(r, 0.19)[0]!.finished).toBe(false);
    expect(sampleReplay(r, 0.2)[0]!.finished).toBe(true);
    expect(sampleReplay(r, 0.3)[1]!.finished).toBe(false);
  });

  it("reuses the output array", () => {
    const r = tinyReplay();
    const s = createReplaySampler(r);
    const out = s(0.05);
    expect(s(0.1, out)).toBe(out);
    expect(out[0]!.x).toBe(2000);
  });

  it("timing", () => {
    const t = replayTiming(tinyReplay());
    expect(t.frameDt).toBeCloseTo(0.1);
    expect(t.lastFrameTime).toBeCloseTo(0.4);
    expect(t.duration).toBeCloseTo(0.4);
    expect(t.winnerTime).toBeCloseTo(0.2);
  });
});

describe("timeline helpers", () => {
  it("commentary returns spoken events newest first", () => {
    const r = tinyReplay();
    expect(commentaryAt(r, 0.1).map((e) => e.text)).toEqual(["Off"]);
    expect(commentaryAt(r, 0.25).map((e) => e.text)).toEqual(["Alpha wins", "Off"]);
    expect(commentaryAt(r, 100)).toEqual([]);
  });

  it("standings + distance to go", () => {
    const r = tinyReplay();
    const s = sampleReplay(r, 0.1);
    const rows = standingsAt(r, s);
    expect(rows.map((x) => x.horseId)).toEqual(["A", "B"]);
    expect(rows[1]!.gapLabel).toBe(lengthsLabel(1000));
    expect(distanceToGoM(r, s)).toBeCloseTo(2);
  });
});

describe("fakeReplay", () => {
  it("produces a schema-valid, plausible replay with a close finish", () => {
    const r = fakeReplay({ horses: 10, distanceM: 1200, seed: 3 });
    expect(RaceReplaySchema.safeParse(r).success).toBe(true);
    expect(r.horses).toHaveLength(10);
    const winSec = r.result.winningTimeUs / 1e6;
    expect(1200 / winSec).toBeGreaterThan(14);
    expect(1200 / winSec).toBeLessThan(19);
    expect(r.result.photoFinish).toBe(true);
    expect(r.events.some((e) => e.type === "final_furlong")).toBe(true);
    const end = sampleReplay(r, 999);
    expect(end.every((s) => s.finished)).toBe(true);
  });
});

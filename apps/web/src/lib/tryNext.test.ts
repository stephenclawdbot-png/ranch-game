import { describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { MAX_TIPS, freshnessPeakDays, tryNext, type TryNextInput } from "./tryNext";

const stats = { speed: 650, stamina: 650, burst: 650, durability: 650, adaptability: 500, temperament: 650 };
const course = (name: string) => gc.courseByName(name)!;

function input(over: Omit<Partial<TryNextInput>, "analysis"> & { analysis?: Partial<TryNextInput["analysis"]> } = {}): TryNextInput {
  const { analysis, ...rest } = over;
  return {
    analysis: { position: 6, fieldSize: 12, pace: "even", runningLine: [6, 6, 6, 6], tactic: "front", ...analysis },
    horse: { sex: "filly", stats, style: "front", preferredDistanceM: 1200, preferredSurface: "turf" },
    race: { distanceM: 1200, surface: "turf", going: "good" },
    course: null,
    gate: 0,
    weightLb: null,
    fieldWeightsLb: [],
    atOff: null,
    ...rest,
  };
}
const ids = (i: TryNextInput) => tryNext(i).map((t) => t.id);
const text = (i: TryNextInput, id: string) => tryNext(i).find((t) => t.id === id)?.text ?? "";

describe("try next: one suggestion per finding", () => {
  it("nothing to suggest on an ideal day", () => {
    expect(tryNext(input())).toEqual([]);
  });

  it("trip, surface and going", () => {
    expect(text(input({ race: { distanceM: 2400, surface: "turf", going: "good" } }), "trip")).toMatch(/2,400 m looked beyond her best \(1,200 m\): a shorter trip may suit/);
    expect(text(input({ horse: { ...input().horse, preferredDistanceM: 2400 }, race: { distanceM: 1000, surface: "turf", going: "good" } }), "trip")).toMatch(/worth trying further/);
    expect(text(input({ race: { distanceM: 1200, surface: "dirt", going: "good" } }), "surface")).toMatch(/Dirt isn't her surface: turf may suit better/);
    expect(text(input({ race: { distanceM: 1200, surface: "turf", going: "heavy" } }), "going")).toContain(gc.RACE_EXTRAS.soft_shoes.label.toLowerCase());
  });

  it("plan against natural style", () => {
    expect(text(input({ analysis: { tactic: "closer" } }), "plan")).toMatch(/Held up for a late run, but she's a natural front-runner: her own style may suit better/);
  });

  it("course character: Saltmarsh's straight, Kestrel's bends, Harrowgate's hill", () => {
    const salt = input({ course: course("Saltmarsh"), analysis: { tactic: "front", runningLine: [1, 1, 2, 6] } });
    expect(text(salt, "course")).toBe("Saltmarsh's long straight suits closers; she was ridden from the front: stalker or closer is worth trying there.");
    const kes = input({ course: course("Kestrel Downs"), horse: { ...input().horse, style: "closer" }, analysis: { tactic: "closer", runningLine: [11, 10, 9, 7] } });
    expect(text(kes, "course")).toMatch(/^Kestrel Downs' tight turns make it hard to come from behind; .*front-runner or stalker is worth trying there/);
    const har = input({ course: course("Harrowgate"), analysis: { runningLine: [2, 2, 3, 8] } });
    expect(text(har, "course")).toMatch(/Harrowgate's uphill finish is a stamina test and she faded late/);
    // a course that backs the plan ridden: no "own style" nag
    const backs = input({ course: course("Saltmarsh"), analysis: { tactic: "closer" } });
    expect(ids(backs)).not.toContain("plan");
  });

  it("pace and position", () => {
    expect(text(input({ analysis: { pace: "fast", runningLine: [1, 1, 2, 7] } }), "pace")).toMatch(/went fast.*\(stalker\)/);
    expect(text(input({ horse: { ...input().horse, style: "closer" }, analysis: { tactic: "closer", pace: "slow", runningLine: [11, 11, 10, 8] } }), "pace")).toMatch(/slow pace/);
  });

  it("fatigue and freshness at the off, from the condition rules", () => {
    expect(text(input({ atOff: { fatigue: 700, hoursSinceHardWork: 100 } }), "fatigue")).toContain(`under ${gc.TIRED_THRESHOLD}`);
    const peak = freshnessPeakDays();
    expect(peak).toMatchObject({ from: 3, to: 5 });
    expect(text(input({ atOff: { fatigue: 0, hoursSinceHardWork: 48 } }), "freshness")).toBe(`Ran 2 days after hard work: her peak is ${peak.from}-${peak.to} days after, worth giving her that long.`);
    expect(ids(input({ atOff: { fatigue: 0, hoursSinceHardWork: 96 } }))).not.toContain("freshness"); // at the peak
    expect(text(input({ atOff: { fatigue: 0, hoursSinceHardWork: 24 * 9 } }), "freshness")).toMatch(/past the 3-5 day peak/);
  });

  it("the draw on tight bends and weight carried", () => {
    expect(text(input({ course: course("Kestrel Downs"), gate: 12 }), "draw")).toMatch(/Drawn 12 of 12 on Kestrel Downs' tight bends/);
    expect(ids(input({ course: course("Ashcombe"), gate: 12 }))).not.toContain("draw");
    expect(text(input({ weightLb: 140, fieldWeightsLb: [130, 131, 129] }), "weight")).toMatch(/Carried 10 lb more than the field average/);
    expect(ids(input({ weightLb: 133, fieldWeightsLb: [130, 131, 129] }))).not.toContain("weight");
  });
});

describe("try next: ranking and honesty", () => {
  const messy = input({
    race: { distanceM: 2400, surface: "dirt", going: "heavy" },
    course: course("Saltmarsh"),
    gate: 12,
    weightLb: 140,
    fieldWeightsLb: [128, 130],
    analysis: { tactic: "closer", pace: "fast", runningLine: [1, 1, 2, 9] },
    atOff: { fatigue: 600, hoursSinceHardWork: 30 },
  });

  it("at most three, the biggest first, deterministic", () => {
    const tips = tryNext(messy);
    expect(tips).toHaveLength(MAX_TIPS);
    for (let k = 1; k < tips.length; k++) expect(tips[k - 1]!.weight).toBeGreaterThanOrEqual(tips[k]!.weight);
    expect(tryNext(messy)).toEqual(tips);
  });

  it("never certain, and nothing after a win", () => {
    for (const t of tryNext(messy)) {
      expect(t.text).toMatch(/may |worth /);
      expect(t.text).not.toMatch(/\bwill\b|\bdefinitely\b|\bmust\b/);
    }
    expect(tryNext({ ...messy, analysis: { ...messy.analysis, position: 1 } })).toEqual([]);
  });

  it("uses only what the owner can see: no condition tips without the owner's own numbers", () => {
    const seen = ids({ ...messy, atOff: null });
    expect(seen).not.toContain("fatigue");
    expect(seen).not.toContain("freshness");
  });
});

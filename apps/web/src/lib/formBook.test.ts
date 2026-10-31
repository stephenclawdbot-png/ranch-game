import { describe, expect, it } from "vitest";
import type { FormLineView, SplitsView } from "./types";
import { avgLengthsText, behindText, bestWorstText, bucketLabel, drawText, jockeyText, lengthsText, logEntryText, raceTimeText, ratingText, weightText } from "./formBook";

const line = (over: Partial<FormLineView> = {}): FormLineView => ({
  raceId: "r1",
  horseId: "h1",
  status: "settled",
  postTimeMs: Date.UTC(2026, 10, 2, 12),
  raceName: "Saltmarsh Maiden",
  raceClass: "maiden",
  kind: "live",
  course: "Saltmarsh",
  distanceM: 2000,
  surface: "turf",
  going: "soft",
  fieldSize: 10,
  gate: 4,
  tactic: "closer",
  intensity: null,
  extras: [],
  jockey: { tier: "apprentice", name: null },
  weightLb: null,
  extraWeightLb: null,
  fatigue: null,
  freshness: null,
  purse: 1000,
  ratingBefore: 52,
  result: { position: 4, beatenMm: 7800, marginLabel: "1 1/4", winningTimeUs: 125_430_000, timeUs: 126_270_000, ratingAfter: 50, prize: 0 },
  ...over,
});

describe("form book text", () => {
  it("writes beaten distances the racing way", () => {
    expect(lengthsText(0, 1)).toBe("won");
    expect(lengthsText(100)).toBe("nose");
    expect(lengthsText(500)).toBe("hd");
    expect(lengthsText(1000)).toBe("nk");
    expect(lengthsText(1800)).toBe("3/4 L");
    expect(lengthsText(7800)).toBe("3 1/4 L");
    expect(lengthsText(24_000)).toBe("10 L");
    expect(lengthsText(null)).toBe("—");
    expect(avgLengthsText(3600)).toBe("1.5 L");
    expect(avgLengthsText(null)).toBe("—");
  });

  it("writes times, gaps, draw, weight, jockey and rating", () => {
    expect(raceTimeText(125_430_000)).toBe("2:05.43");
    expect(raceTimeText(72_345_678)).toBe("1:12.35");
    expect(raceTimeText(null)).toBe("—");
    expect(behindText(126_270_000, 125_430_000)).toBe("+0.84 s");
    expect(behindText(125_430_000, 125_430_000)).toBeNull();
    expect(drawText({ gate: 4, fieldSize: 10 })).toBe("4/10");
    expect(drawText({ gate: null, fieldSize: 10 })).toBe("—");
    expect(weightText({ weightLb: 131, extraWeightLb: 5 })).toBe("131 lb (+5)");
    expect(weightText({ weightLb: null, extraWeightLb: null })).toBe("—");
    expect(jockeyText({ tier: "top", name: null })).toBe("Top jockey");
    expect(jockeyText({ tier: "top", name: "Ada Quick" })).toBe("Ada Quick");
    expect(jockeyText({ tier: null, name: null })).toBe("—");
    expect(ratingText(52, 55)).toBe("52 → 55 (+3)");
    expect(ratingText(52, null)).toBe("52");
  });

  it("names buckets and the best and worst condition", () => {
    expect(bucketLabel("distance", "staying")).toBe("Long");
    expect(bucketLabel("rest", "3_6_days")).toBe("3–6 days");
    expect(bucketLabel("course", "Kestrel Downs")).toBe("Kestrel Downs");
    const b = (key: string, w: number, s: number, t: number, runs: number, avg: number) => ({ key, wins: w, seconds: s, thirds: t, runs, avgBeatenMm: avg, small: false });
    const splits: SplitsView = {
      total: b("all", 2, 1, 1, 7, 3000),
      groups: [],
      best: { dimension: "going", bucket: b("good", 2, 1, 0, 3, 400) },
      worst: { dimension: "going", bucket: b("soft", 0, 0, 1, 4, 9600) },
      minRuns: 3,
    };
    expect(bestWorstText(splits)).toEqual({
      best: "good ground, 2-1-0 from 3, beaten 0.2 L on average",
      worst: "soft ground, 0-0-1 from 4, beaten 4.0 L on average",
    });
    expect(bestWorstText({ ...splits, best: null, worst: null })).toBeNull();
  });

  it("writes log entries, with no result for a race still to run", () => {
    expect(logEntryText({ kind: "race", data: {}, line: line() }).title).toBe("4th in the Saltmarsh Maiden, beaten 3 1/4 L");
    expect(logEntryText({ kind: "race", data: {}, line: line() }).detail).toContain("OR 52 → 50 (-2)");
    expect(logEntryText({ kind: "race", data: {}, line: line({ result: { position: 1, beatenMm: 0, marginLabel: "neck", winningTimeUs: 1, timeUs: 1, ratingAfter: 55, prize: 600 } }) }).title).toBe(
      "Won the Saltmarsh Maiden by a neck",
    );
    const pending = logEntryText({ kind: "race", data: {}, line: line({ status: "running", result: null }) });
    expect(pending.title).toBe("Running in the Saltmarsh Maiden");
    expect(pending.detail).not.toMatch(/OR|beaten|credits/);
    const t = logEntryText(
      { kind: "training", data: { workout: "speed_work", label: "Speed work", session: 2, cost: 90, gains: { speed: 22, burst: 9 }, fatigueBefore: 100, fatigueAfter: 360, overworked: false, injured: false } },
      true,
    );
    expect(t.title).toBe("Speed work (session 2)");
    expect(t.detail).toBe("Speed +2.2%, Burst +0.9% · fatigue Fresh → Tired (100 → 360‰) · 90 credits");
    expect(logEntryText({ kind: "training", data: { label: "Rest", gains: {}, fatigueBefore: 400, fatigueAfter: 200 } }).detail).toBe("no gains (rest) · fatigue Tired → Ready");
    expect(logEntryText({ kind: "lease_start", data: { owner: "Oak Yard", lessee: "Hoops Hall", termDays: 7, ownerSharePct: 40 } }).detail).toBe("owner Oak Yard · 7 days · owner's purse share 40%");
    expect(logEntryText({ kind: "unknown_kind", data: {} }).title).toBe("unknown_kind");
  });
});

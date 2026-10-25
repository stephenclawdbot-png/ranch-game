/**
 * Balance and realism. These run hundreds of races with fixed seeds, so results are exact and
 * reproducible; thresholds are the design targets, not tuned-to-pass numbers.
 */
import { describe, expect, it } from "vitest";
import type { RunningStyle } from "@thoroughbred/shared";
import { simulateRace } from "./index";
import { makeInput, seedFor, typicalField, type EntryOpts } from "./test-fixtures";

const STYLES: RunningStyle[] = ["front", "stalker", "closer"];

describe("realistic times", () => {
  const ranges: Array<[number, number, number]> = [
    [1000, 57, 61],
    [1600, 94, 100],
    [2400, 146, 154],
  ];
  for (const [d, lo, hi] of ranges) {
    it(`${d} m winning time averages ${lo}-${hi} s`, () => {
      let sum = 0;
      let fieldSum = 0;
      let fieldN = 0;
      const N = 40;
      for (let s = 0; s < N; s++) {
        const r = simulateRace(makeInput(typicalField(10, d), { distanceM: d, seed: seedFor(10_000 + s) }));
        sum += r.result.winningTimeUs;
        for (const f of r.result.finishOrder) {
          fieldSum += f.finishTimeUs;
          fieldN++;
        }
        // Average speed of the winner stays in a believable band (15-18 m/s).
        const mps = (d * 1e6) / r.result.winningTimeUs;
        expect(mps).toBeGreaterThan(15);
        expect(mps).toBeLessThan(18);
      }
      const avg = sum / N / 1e6;
      expect(avg).toBeGreaterThan(lo);
      expect(avg).toBeLessThan(hi);
      // The whole field is not wildly slower than the winner (a typical field spans a few seconds).
      expect(fieldSum / fieldN / 1e6 - avg).toBeLessThan(4);
    });
  }
});

describe("ability matters, but upsets happen", () => {
  it("a 900-rated horse beats a 500-rated field most of the time, not always", () => {
    let wins = 0;
    const N = 300;
    for (let s = 0; s < N; s++) {
      const field: EntryOpts[] = [{ stats: 900, style: STYLES[s % 3]!, preferredDistanceM: 1600 }];
      for (let k = 0; k < 7; k++) field.push({ stats: 500, style: STYLES[k % 3]!, preferredDistanceM: 1600 });
      const rot = s % 8;
      const entries = field.map((e, i) => ({ ...e, gate: ((i + rot) % 8) + 1 }));
      const r = simulateRace(makeInput(entries, { seed: seedFor(20_000 + s) }));
      if (r.result.finishOrder[0]!.horseId === "h1") wins++;
    }
    const share = wins / N;
    expect(share).toBeGreaterThan(0.6);
    expect(share).toBeLessThan(0.99);
  });

  it("a 700 horse beats a 650 field often but far from always", () => {
    let wins = 0;
    const N = 200;
    for (let s = 0; s < N; s++) {
      const field: EntryOpts[] = [{ stats: 700, style: "stalker" }];
      for (let k = 0; k < 7; k++) field.push({ stats: 650, style: STYLES[k % 3]! });
      const r = simulateRace(makeInput(field, { seed: seedFor(30_000 + s) }));
      if (r.result.finishOrder[0]!.horseId === "h1") wins++;
    }
    // Fair share would be 12.5%.
    expect(wins / N).toBeGreaterThan(0.15);
    expect(wins / N).toBeLessThan(0.6);
  });
});

describe("no dominant tactic among equal horses", () => {
  for (const n of [6, 9, 12]) {
    it(`1600 m, ${n} equal horses, tactics split evenly`, () => {
      const wins: Record<RunningStyle, number> = { front: 0, stalker: 0, closer: 0 };
      const N = 300;
      for (let s = 0; s < N; s++) {
        const field: EntryOpts[] = [];
        for (let k = 0; k < n; k++) field.push({ stats: 650, style: STYLES[k % 3]!, tactic: STYLES[k % 3]! });
        // Rotate gates so no tactic always gets the rail.
        const entries = field.map((e, i) => ({ ...e, gate: ((i + s) % n) + 1 }));
        const r = simulateRace(makeInput(entries, { seed: seedFor(40_000 + s) }));
        const idx = Number(r.result.finishOrder[0]!.horseId.slice(1)) - 1;
        wins[STYLES[idx % 3]!]++;
      }
      for (const t of STYLES) {
        expect(wins[t] / N, `${t} share`).toBeGreaterThan(0.12);
        expect(wins[t] / N, `${t} share`).toBeLessThan(0.6);
      }
    });
  }

  it("a tactic matching the horse's natural style helps a little", () => {
    let matchedWins = 0;
    const N = 200;
    for (let s = 0; s < N; s++) {
      // Two identical stalkers by nature; one is ridden as a stalker, the other as a closer.
      const field: EntryOpts[] = [
        { stats: 650, style: "stalker", tactic: "stalker" },
        { stats: 650, style: "closer", tactic: "stalker" },
      ];
      const entries = field.map((e, i) => ({ ...e, gate: ((i + s) % 2) + 1 }));
      const r = simulateRace(makeInput(entries, { seed: seedFor(50_000 + s) }));
      if (r.result.finishOrder[0]!.horseId === "h1") matchedWins++;
    }
    expect(matchedWins / N).toBeGreaterThan(0.5);
    expect(matchedWins / N).toBeLessThan(0.85);
  });
});

describe("conditions", () => {
  it("heavy going is slower than firm; surface specialists benefit", () => {
    let firm = 0;
    let heavy = 0;
    let specialistWins = 0;
    const N = 60;
    for (let s = 0; s < N; s++) {
      const field = typicalField(8, 1600);
      firm += simulateRace(makeInput(field, { going: "firm", seed: seedFor(60_000 + s) })).result.winningTimeUs;
      heavy += simulateRace(makeInput(field, { going: "heavy", seed: seedFor(60_000 + s) })).result.winningTimeUs;
      const turf: EntryOpts[] = [
        { stats: { adaptability: 300 }, preferredSurface: "turf", style: "stalker" },
        { stats: { adaptability: 300 }, preferredSurface: "dirt", style: "stalker" },
      ];
      const entries = turf.map((e, i) => ({ ...e, gate: ((i + s) % 2) + 1 }));
      const r = simulateRace(makeInput(entries, { surface: "turf", seed: seedFor(61_000 + s) }));
      if (r.result.finishOrder[0]!.horseId === "h1") specialistWins++;
    }
    expect(heavy / N - firm / N).toBeGreaterThan(3e6); // > 3 s slower over a mile
    expect(specialistWins / N).toBeGreaterThan(0.6);
  });

  it("staying power matters more as distance grows", () => {
    const share = (d: number) => {
      let wins = 0;
      const N = 120;
      for (let s = 0; s < N; s++) {
        const field: EntryOpts[] = [
          { stats: { stamina: 900, speed: 600 }, preferredDistanceM: 2400, style: "stalker" },
          { stats: { stamina: 400, speed: 700 }, preferredDistanceM: 1200, style: "stalker" },
        ];
        const entries = field.map((e, i) => ({ ...e, gate: ((i + s) % 2) + 1 }));
        const r = simulateRace(makeInput(entries, { distanceM: d, seed: seedFor(70_000 + s) }));
        if (r.result.finishOrder[0]!.horseId === "h1") wins++;
      }
      return wins / N;
    };
    const sprint = share(1000);
    const route = share(2800);
    expect(route).toBeGreaterThan(sprint + 0.3);
    expect(sprint).toBeLessThan(0.5);
    expect(route).toBeGreaterThan(0.6);
  });
});

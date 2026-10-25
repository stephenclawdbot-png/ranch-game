/**
 * Balance regression bands for the rival pool and the scheduled races (see docs/balance.md).
 * Fixed slots, so the numbers are exact; bands are the design targets.
 */
import { describe, expect, it } from "vitest";
import type { RaceClass } from "@thoroughbred/shared";
import { HOUSE_STABLES, RIVAL_POOL, starterHorses } from "./demoData";
import { getRaceInput, raceRating } from "./races";
import { feel, groupBy, mean, runScheduled, simPlayerId, type RaceStats } from "./sim";

const SLOTS = 480; // one day of the 3-minute schedule
const CLASSES: RaceClass[] = ["maiden", "novice", "handicap", "listed", "graded"];
const idealRating = (h: (typeof RIVAL_POOL)[number]) => raceRating(h, h.style, { distanceM: h.preferredDistanceM, surface: h.preferredSurface, going: "good" });

const races: RaceStats[] = [];
const fieldRating = new Map<RaceClass, number[]>();
for (let slot = 0; slot < SLOTS; slot++) {
  races.push(runScheduled(slot));
  const input = getRaceInput(`s-${slot}`);
  const arr = fieldRating.get(input.race.raceClass) ?? [];
  for (const e of input.entries) arr.push(idealRating(e.horse));
  fieldRating.set(input.race.raceClass, arr);
}

describe("scheduled races", () => {
  it("classes are ordered in strength (maiden < novice < handicap < listed < graded)", () => {
    const means = CLASSES.map((c) => mean(fieldRating.get(c) ?? []));
    for (let i = 1; i < means.length; i++) expect(means[i]!, CLASSES[i]).toBeGreaterThan(means[i - 1]! + 20);
  });

  it("starters are maiden/novice level: below the handicap field average", () => {
    const starters = Array.from({ length: 20 }, (_, p) => starterHorses(simPlayerId(2000 + p))).flat();
    const starterMean = mean(starters.map(idealRating));
    expect(starterMean).toBeLessThan(mean(fieldRating.get("handicap")!));
    expect(starterMean).toBeGreaterThan(mean(fieldRating.get("maiden")!) - 60);
  });

  it("no rival horse or house stable dominates the results board", () => {
    const byHorse = [...groupBy(races, (r) => r.winnerId).values()].map((xs) => xs.length / races.length);
    expect(Math.max(...byHorse)).toBeLessThan(0.08);
    const owner = new Map(RIVAL_POOL.map((h) => [h.id, h.ownerId]));
    const byStable = [...groupBy(races, (r) => owner.get(r.winnerId)).values()].map((xs) => xs.length / races.length);
    expect(byStable.length).toBe(HOUSE_STABLES.length);
    expect(Math.max(...byStable)).toBeLessThan(0.22);
    expect(Math.min(...byStable)).toBeGreaterThan(0.05);
  });

  it("handicaps are competitive: many different winners, favourites beaten often", () => {
    const hcaps = races.filter((r) => r.config.raceClass === "handicap");
    expect(new Set(hcaps.map((r) => r.winnerId)).size).toBeGreaterThan(hcaps.length * 0.2);
    expect(feel(hcaps).favouriteWin).toBeLessThan(0.35);
  });

  it("feel: favourite ~25-35%, close finishes, closers can come from behind", () => {
    const f = feel(races);
    expect(f.favouriteWin).toBeGreaterThan(0.18);
    expect(f.favouriteWin).toBeLessThan(0.4);
    expect(f.medianMarginL).toBeGreaterThan(0.8);
    expect(f.medianMarginL).toBeLessThan(3);
    expect(f.comeback).toBeGreaterThan(0.05);
    for (const t of ["front", "stalker", "closer"] as const) expect(f.winnerTactic[t]!, t).toBeGreaterThan(0.15);
  });

  it("purses rise with class", () => {
    const purse = CLASSES.map((c) => mean(races.filter((r) => r.config.raceClass === c).map((r) => r.config.purse)));
    for (let i = 1; i < purse.length; i++) expect(purse[i]!).toBeGreaterThan(purse[i - 1]!);
  });
});

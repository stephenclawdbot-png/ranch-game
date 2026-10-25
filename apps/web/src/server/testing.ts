/**
 * Test fixtures: deterministic races straight from game-core Club runners and the engine,
 * with no database (for the pure broadcast / feed / analysis tests).
 */
import * as gc from "@thoroughbred/game-core";
import type { RaceConfig, RaceInput, RaceReplay } from "@thoroughbred/shared";
import { deriveSeed, simulateRace } from "@thoroughbred/racing-engine";

export function fixtureInput(label: string, postTimeMs: number, opts: { runners?: number; distanceM?: number } = {}): RaceInput {
  const n = opts.runners ?? 10;
  const distanceM = opts.distanceM ?? 1400;
  const race: RaceConfig = { id: `fixture-${label}`, name: `Fixture ${label}`, distanceM, surface: "turf", weather: "clear", going: "good", raceClass: "handicap", postTimeMs, purse: 4000 };
  const seed = deriveSeed("fixture-secret", label);
  const entries = Array.from({ length: n }, (_, i) => {
    const horse = gc.clubRunner(seed, { id: `h${i + 1}`, strength: 560 + ((i * 37) % 120), distanceM, surface: "turf" });
    return { gate: i + 1, tactic: horse.style, horse };
  });
  return { race, entries, seed };
}

export function fixtureReplay(label: string, postTimeMs: number, opts: { runners?: number; distanceM?: number } = {}): RaceReplay {
  return simulateRace(fixtureInput(label, postTimeMs, opts));
}

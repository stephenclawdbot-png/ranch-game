/**
 * Onboarding (§10): a starter stable of 3 modest, race-ready horses (Club-bred, never
 * tradeable), a guaranteed-competitive first maiden (we pick a fair *field*; the race itself
 * is simulated honestly), and a day-2 gift foal from the Club's broodmare.
 */
import type { Horse, RaceConfig, RaceEntry, Silks } from "@thoroughbred/shared";
import type { Breed, HorseState, Rarity } from "./types";
import { generateFoundationGenome, preferredDistanceM, preferredSurface } from "./genome";
import { CARE_TO_RACING, createHorseState } from "./lifecycle";
import { clubRunner, meanStat } from "./field";
import { dayIndex } from "./time";
import { Rng, seedFrom } from "./rng";

const STARTER_NAMES = ["First Light", "Lucky Penny", "Brave Heart", "Quiet Storm", "Paper Moon", "Copper Kettle", "Little Comet", "Hope Springs", "Fair Wind", "Bright Idea", "Steady On", "Open Gate"];

export interface StarterInput {
  ownerId: string;
  /** Stable-level seed (e.g. deriveSeed(secret, "starter:"+ownerId)). */
  seed: string;
  nowMs: number;
  season: number;
  idPrefix?: string;
}

/** Three modest starters: a sprinter (Quarter Horse), a miler (Thoroughbred), a stayer (Arabian). */
export const STARTER_PLAN: { breed: Breed; rarity: Rarity; sex: "colt" | "filly" }[] = [
  { breed: "quarterHorse", rarity: "common", sex: "colt" },
  { breed: "thoroughbred", rarity: "uncommon", sex: "filly" },
  { breed: "arabian", rarity: "common", sex: "colt" },
];

export function createStarterStable(input: StarterInput): HorseState[] {
  const rng = new Rng(`${input.seed}|starter-names`);
  const names = [...STARTER_NAMES];
  return STARTER_PLAN.map((p, i) => {
    const name = names.splice(rng.int(names.length), 1)[0]!;
    const genome = generateFoundationGenome(seedFrom("starter", input.seed, i), { season: input.season, rarity: p.rarity, breed: p.breed });
    return createHorseState({
      id: `${input.idPrefix ?? input.ownerId}-starter-${i + 1}`,
      name,
      sex: p.sex,
      ownerId: input.ownerId,
      sireId: null,
      damId: null,
      generation: 0,
      genome,
      bornAtMs: input.nowMs,
      bornSeason: input.season,
      location: "stable",
      binding: "club_bred",
      careSessions: CARE_TO_RACING,
    });
  });
}

/** Club strength relative to the player's horse (permille of its mean stat). */
export const FIRST_MAIDEN_STRENGTH: readonly [number, number] = [920, 1010];
export const FIRST_MAIDEN_RUNNERS = 6;

/**
 * The first maiden: trip and surface suit the player's horse, and the Club field is drawn
 * slightly below to level with it, so the horse is competitive — but the race is a normal,
 * honest simulation and can be lost.
 */
export function firstMaidenRace(player: Horse, state: HorseState, seed: string, postTimeMs: number): { race: RaceConfig; entries: RaceEntry[] } {
  const rng = new Rng(`${seed}|first-maiden`);
  const distanceM = Math.max(1000, Math.min(2400, preferredDistanceM(state.genome)));
  const surface = preferredSurface(state.genome);
  const level = meanStat(player);
  const entries: RaceEntry[] = [{ gate: 1, tactic: player.style, horse: player }];
  for (let i = 0; i < FIRST_MAIDEN_RUNNERS - 1; i++) {
    const strength = Math.round((level * rng.range(FIRST_MAIDEN_STRENGTH[0], FIRST_MAIDEN_STRENGTH[1])) / 1000);
    const h = clubRunner(seed, { id: `maiden-club-${i + 1}`, strength, spread: 40, distanceM, surface });
    entries.push({ gate: i + 2, tactic: h.style, horse: h });
  }
  // Shuffle gates so the player's horse is not always on the rail.
  const gates = entries.map((_, i) => i + 1);
  for (let i = gates.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [gates[i], gates[j]] = [gates[j]!, gates[i]!];
  }
  const shuffled = entries.map((e, i) => ({ ...e, gate: gates[i]! }));
  return {
    race: { id: `first-maiden-${state.id}`, name: "Welcome Maiden Stakes", distanceM, surface, weather: "clear", going: "good", raceClass: "maiden", postTimeMs, purse: 600 },
    entries: shuffled,
  };
}

/** The gift foal arrives from the player's second real day on (any later day is fine). */
export function giftFoalDue(accountCreatedAtMs: number, nowMs: number, alreadyGiven: boolean): boolean {
  return !alreadyGiven && dayIndex(nowMs) >= dayIndex(accountCreatedAtMs) + 1;
}

export function createGiftFoal(input: StarterInput & { name: string }): HorseState {
  const rng = new Rng(`${input.seed}|gift`);
  const genome = generateFoundationGenome(seedFrom("gift-foal", input.seed), { season: input.season, rarity: rng.chance(400) ? "uncommon" : "common" });
  return createHorseState({
    id: `${input.idPrefix ?? input.ownerId}-gift-foal`,
    name: input.name,
    sex: rng.chance(500) ? "colt" : "filly",
    ownerId: input.ownerId,
    sireId: null,
    damId: null,
    generation: 0,
    genome,
    bornAtMs: input.nowMs,
    bornSeason: input.season,
    location: "stable",
    binding: "club_bred",
  });
}

/** Default stable silks if the player skips the editor. */
export const DEFAULT_SILKS: Silks = { primary: "#1d3557", secondary: "#f1faee", pattern: "hoops", cap: "#e63946" };

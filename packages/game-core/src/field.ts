/**
 * Club (AI) runners for fixed fields: the Daily Cup field, quick-race fill-ins and the
 * onboarding maiden. They are honest horses — plain stat lines, no hidden modifiers — whose
 * strength is chosen when the field is built (we choose the field, never the result).
 */
import type { Horse, RunningStyle, Silks, Surface } from "@thoroughbred/shared";
import { STAT_KEYS, type StatRecord } from "./types";
import { generateFoundationGenome } from "./genome";
import { appearanceOf } from "./coat";
import { Rng, clampInt } from "./rng";

export const CLUB_OWNER_ID = "club";

const CLUB_SILKS: Silks[] = [
  { primary: "#1f4e79", secondary: "#f2f2f2", pattern: "hoops", cap: "#1f4e79" },
  { primary: "#7a1f1f", secondary: "#e8c547", pattern: "sash", cap: "#e8c547" },
  { primary: "#2e6b3a", secondary: "#ffffff", pattern: "stripes", cap: "#2e6b3a" },
  { primary: "#4b2e83", secondary: "#c9b037", pattern: "chevron", cap: "#4b2e83" },
  { primary: "#333333", secondary: "#d94f30", pattern: "diamonds", cap: "#d94f30" },
  { primary: "#b5651d", secondary: "#1a1a1a", pattern: "quartered", cap: "#1a1a1a" },
  { primary: "#0f7c80", secondary: "#f5e6c8", pattern: "stars", cap: "#f5e6c8" },
  { primary: "#9c2a5b", secondary: "#ffffff", pattern: "solid", cap: "#ffffff" },
];

const NAMES_A = ["Silver", "Morning", "Copper", "River", "Velvet", "Northern", "Golden", "Quiet", "Midnight", "Lucky", "Harbour", "Autumn", "Iron", "Paper", "Summer", "Wild"];
const NAMES_B = ["Lark", "Ember", "Comet", "Willow", "Echo", "Arrow", "Meadow", "Banner", "Rumour", "Spark", "Harmony", "Tide", "Promise", "Sonnet", "Gale", "Crown"];

export function clubHorseName(rng: Rng): string {
  return `${rng.pick(NAMES_A)} ${rng.pick(NAMES_B)}`;
}

export interface ClubRunnerOptions {
  id: string;
  /** Target mean current stat (0..1000). */
  strength: number;
  /** Spread of individual stats around the strength. */
  spread?: number;
  distanceM: number;
  surface: Surface;
  style?: RunningStyle;
}

/** One Club runner as a shared `Horse` (race-ready snapshot). */
export function clubRunner(seed: string, o: ClubRunnerOptions): Horse {
  const rng = new Rng(`${seed}|club|${o.id}`);
  const spread = o.spread ?? 60;
  const stats = {} as StatRecord<number>;
  for (const k of STAT_KEYS) stats[k] = clampInt(o.strength + rng.normal() * (spread / 2), 50, 1000);
  const g = generateFoundationGenome(`${seed}|look|${o.id}`, { season: 1 });
  return {
    id: o.id,
    name: clubHorseName(rng),
    sex: rng.chance(500) ? "colt" : "filly",
    age: 3,
    stage: "prime",
    generation: 0,
    ownerId: CLUB_OWNER_ID,
    sireId: null,
    damId: null,
    stats,
    preferredDistanceM: clampInt(Math.round((o.distanceM + rng.range(-200, 200)) / 50) * 50, 800, 4000),
    preferredSurface: rng.chance(750) ? o.surface : rng.pick<Surface>(["turf", "dirt", "synthetic"]),
    style: o.style ?? rng.pick<RunningStyle>(["front", "stalker", "closer"]),
    appearance: appearanceOf(g, { racingAge: true, starts: 10, retired: false }, rng.pick(CLUB_SILKS)),
    record: { starts: 0, wins: 0, places: 0, shows: 0, earnings: 0 },
  };
}

/** Mean of the six stats of a snapshot. */
export function meanStat(h: Pick<Horse, "stats">): number {
  return Math.round(STAT_KEYS.reduce((s, k) => s + h.stats[k], 0) / STAT_KEYS.length);
}

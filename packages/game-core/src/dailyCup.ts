/**
 * Daily Cup: one seeded race per day, open for 24 hours, one entry (a "Cup Run") per player
 * per day. Every entry is simulated against the same fixed Club field with the same seed and
 * the same gate, so everyone faces identical conditions and luck — a time trial against the
 * same rivals. Ranked by the entrant's finish time.
 *
 * The Cup does not count as a career start, is unrated and leaves the horse untouched
 * (no fatigue, no injury): a fair daily habit, not a grind.
 *
 * game-core does not depend on the engine: pass `simulateRace` from @thoroughbred/racing-engine.
 */
import type { Horse, RaceInput, RaceReplay, RunningStyle, SimulateRace, Surface } from "@thoroughbred/shared";
import { MS_PER_DAY } from "./time";
import { clubRunner } from "./field";
import { DISTANCES, DIVISIONS } from "./seasons";
import { DAILY_CUP_CREDITS } from "./economy";
import { Rng, commitSeed, deriveSeed } from "./rng";

export const CUP_FIELD_SIZE = 7;
/** The entrant always starts from this gate. */
export const CUP_ENTRANT_GATE = 4;
export const CUP_ENTRANT_ID = "cup-entrant";
/** Club field strength (mean current stat). */
export const CUP_FIELD_STRENGTH = 470;

export interface DailyCupDay {
  day: number;
  seed: string;
  seedCommitment: string;
  distanceM: number;
  surface: Surface;
  going: RaceInput["race"]["going"];
  weather: RaceInput["race"]["weather"];
  field: Horse[];
  opensAtMs: number;
  closesAtMs: number;
}

/** The Cup for a real day. The seed is committed at open and revealed after close. */
export function dailyCupDay(serverSecret: string, day: number): DailyCupDay {
  const seed = deriveSeed(serverSecret, `daily-cup:${day}`);
  const rng = new Rng(`${seed}|cup-conditions`);
  const div = rng.pick(DIVISIONS);
  const distanceM = rng.pick(DISTANCES[div]);
  const surface = rng.pick<Surface>(["turf", "dirt", "synthetic"]);
  const weather = rng.pick<RaceInput["race"]["weather"]>(["clear", "clear", "overcast", "rain", "dusk"]);
  const going = surface === "synthetic" ? "good" : weather === "rain" ? "soft" : rng.chance(200) ? "firm" : "good";
  const field: Horse[] = [];
  const styles: RunningStyle[] = ["front", "front", "stalker", "stalker", "stalker", "closer", "closer"];
  for (let i = 0; i < CUP_FIELD_SIZE; i++) {
    field.push(clubRunner(seed, { id: `cup-${day}-${i}`, strength: CUP_FIELD_STRENGTH + rng.range(-40, 60), distanceM, surface, style: styles[i] }));
  }
  return { day, seed, seedCommitment: commitSeed(seed), distanceM, surface, going, weather, field, opensAtMs: day * MS_PER_DAY, closesAtMs: (day + 1) * MS_PER_DAY };
}

/** Build the RaceInput for one Cup Run (the entrant's snapshot gets a fixed id and gate). */
export function cupRaceInput(cup: DailyCupDay, entrant: Horse, tactic: RunningStyle): RaceInput {
  const gates = [1, 2, 3, 5, 6, 7, 8];
  return {
    race: {
      id: `daily-cup-${cup.day}`,
      name: "Daily Cup",
      distanceM: cup.distanceM,
      surface: cup.surface,
      weather: cup.weather,
      going: cup.going,
      raceClass: "listed",
      postTimeMs: cup.opensAtMs,
      purse: 0,
    },
    entries: [
      { gate: CUP_ENTRANT_GATE, tactic, horse: { ...entrant, id: CUP_ENTRANT_ID } },
      ...cup.field.map((h, i) => ({ gate: gates[i]!, tactic: h.style, horse: h })),
    ],
    seed: cup.seed,
  };
}

export interface CupRun {
  finishTimeUs: number;
  position: number;
  replay: RaceReplay;
}

export function runDailyCup(cup: DailyCupDay, entrant: Horse, tactic: RunningStyle, simulate: SimulateRace): CupRun {
  const replay = simulate(cupRaceInput(cup, entrant, tactic));
  const me = replay.result.finishOrder.find((f) => f.horseId === CUP_ENTRANT_ID)!;
  return { finishTimeUs: me.finishTimeUs, position: me.position, replay };
}

export type CupBlock = "already_entered" | "closed" | "not_open";

export function cupEntryBlock(cup: DailyCupDay, nowMs: number, alreadyEnteredToday: boolean): CupBlock | null {
  if (nowMs < cup.opensAtMs) return "not_open";
  if (nowMs >= cup.closesAtMs) return "closed";
  if (alreadyEnteredToday) return "already_entered";
  return null;
}

export interface CupEntry {
  ownerId: string;
  horseId: string;
  finishTimeUs: number;
  position: number;
  enteredAtMs: number;
}

export interface CupStanding extends CupEntry {
  rank: number;
  /** 0 = best, 1000 = worst. */
  percentile: number;
  cupPoints: number;
  badge: "gold" | "silver" | "bronze" | "top10" | "finisher";
}

/** Rank by time (then position vs the field, then who entered first). */
export function rankCup(entries: readonly CupEntry[]): CupStanding[] {
  const sorted = [...entries].sort((a, b) => a.finishTimeUs - b.finishTimeUs || a.position - b.position || a.enteredAtMs - b.enteredAtMs || (a.ownerId < b.ownerId ? -1 : 1));
  const n = sorted.length;
  return sorted.map((e, i) => {
    const percentile = n <= 1 ? 0 : Math.floor((i * 1000) / (n - 1));
    const badge = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : percentile <= 100 ? "top10" : "finisher";
    const cupPoints = Math.max(1, 50 - Math.floor(percentile / 20)) + (e.position === 1 ? 10 : 0);
    return { ...e, rank: i + 1, percentile, cupPoints, badge };
  });
}

/** Credits for taking part (ranked rewards are cosmetic + cup points; verified accounts only). */
export const CUP_PARTICIPATION_CREDITS = DAILY_CUP_CREDITS;

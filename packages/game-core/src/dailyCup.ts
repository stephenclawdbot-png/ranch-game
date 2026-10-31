/**
 * Daily Cup: one seeded race per day, open for 24 hours, one entry (a "Cup Run") per player
 * per day. Every entry is simulated against the same fixed Club field with the same seed and
 * the same gate, so everyone faces identical conditions and luck — a time trial against the
 * same rivals. Ranked by the entrant's finish time.
 *
 * The Cup does not count as a career start, is unrated and leaves the horse untouched
 * (no fatigue, no injury): a fair daily habit, not a grind.
 *
 * The trip and going rotate by weekday (cupRotation), identical for every player and announced
 * on /cup the day before; the field, gates and luck stay seeded per day as they were.
 *
 * game-core does not depend on the engine: pass `simulateRace` from @thoroughbred/racing-engine.
 */
import type { Horse, RaceInput, RaceReplay, RunningStyle, SimulateRace, Surface } from "@thoroughbred/shared";
import { MS_PER_DAY, type SeasonClock } from "./time";
import { clubRunner } from "./field";
import { DISTANCES, DIVISIONS, type Division } from "./seasons";
import { climateSeasonOfDay, yearSeasonOf, type YearSeason } from "./climate";
import { DAILY_CUP_CREDITS } from "./economy";
import { Rng, commitSeed, deriveSeed, seedFrom } from "./rng";

export const CUP_FIELD_SIZE = 7;
/** The entrant always starts from this gate. */
export const CUP_ENTRANT_GATE = 4;
export const CUP_ENTRANT_ID = "cup-entrant";
/** Club field strength (mean current stat). */
export const CUP_FIELD_STRENGTH = 470;

/**
 * From this UTC day (2026-11-09, a Monday) the Cup's trip and going rotate by weekday
 * (`cupRotation` below); days before it keep the rng-picked conditions their published runs
 * were simulated and ranked under, so past boards and replays still reconstruct exactly.
 */
export const CUP_ROTATION_FROM_DAY = 20_766;

/** The Cup's division by weekday (0 = Monday): every week runs the whole trip range. */
const CUP_WEEKDAY_DIVISIONS: readonly Division[] = ["sprint", "mile", "middle", "staying", "sprint", "middle", "staying"];
/** The Cup's surface by weekday (0 = Monday): mostly turf, dirt twice, the all-weather once. */
const CUP_WEEKDAY_SURFACES: readonly Surface[] = ["turf", "dirt", "turf", "synthetic", "dirt", "turf", "turf"];
/** The Cup's turf going by time of year: as the courses ride then (climate.ts SEASON_CLIMATE). */
const CUP_SEASON_GOING: Record<YearSeason, RaceInput["race"]["going"]> = { spring: "good", summer: "firm", autumn: "soft", winter: "heavy" };
/** Weather that agrees with the going (rain never on firm; clear never on heavy). */
const CUP_GOING_WEATHER: Record<RaceInput["race"]["going"], readonly RaceInput["race"]["weather"][]> = {
  firm: ["clear", "clear", "overcast"],
  good: ["clear", "clear", "overcast", "dusk"],
  soft: ["overcast", "overcast", "rain"],
  heavy: ["rain", "rain", "overcast"],
};

/**
 * The day's Cup conditions, identical for every player: no secret in this, so /cup can announce
 * tomorrow's trip and going before the day's Cup secret even exists. The division is fixed by
 * weekday (sprint to staying over any seven days), the trip within it steps on one each week
 * (`day / 7` mod its trips); the going is the time of year's on turf, good on the all-weather,
 * heavy only on winter dirt; the weather is drawn (seeded by the day alone) from what agrees
 * with the going. `clock` sets the season epoch for the time of year — the web app passes the
 * deployment's (RULES.seasonEpochMs).
 */
export function cupRotation(
  day: number,
  clock: SeasonClock = { epochMs: 0 },
): { distanceM: number; surface: Surface; going: RaceInput["race"]["going"]; weather: RaceInput["race"]["weather"] } {
  const dow = (((day + 3) % 7) + 7) % 7; // 0 = Monday
  const division = CUP_WEEKDAY_DIVISIONS[dow]!;
  const trips = DISTANCES[division];
  const distanceM = trips[(((Math.floor(day / 7) % trips.length) + trips.length) % trips.length)]!;
  const surface = CUP_WEEKDAY_SURFACES[dow]!;
  const yearSeason = yearSeasonOf(climateSeasonOfDay(clock, day));
  const going = surface === "synthetic" ? "good" : surface === "dirt" ? (yearSeason === "winter" ? "heavy" : "good") : CUP_SEASON_GOING[yearSeason];
  const weather = new Rng(seedFrom("cup-weather", day)).pick(CUP_GOING_WEATHER[going]);
  return { distanceM, surface, going, weather };
}

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

/**
 * The Cup for a real day. The seed is committed at open and revealed after close. From
 * `CUP_ROTATION_FROM_DAY` on, the conditions are the weekday rotation (`cupRotation`); earlier
 * days keep the rng-picked conditions they were published with.
 */
export function dailyCupDay(serverSecret: string, day: number, clock?: SeasonClock): DailyCupDay {
  const seed = deriveSeed(serverSecret, `daily-cup:${day}`);
  const rng = new Rng(`${seed}|cup-conditions`);
  let distanceM: number;
  let surface: Surface;
  let weather: RaceInput["race"]["weather"];
  let going: RaceInput["race"]["going"];
  if (day >= CUP_ROTATION_FROM_DAY) {
    ({ distanceM, surface, going, weather } = cupRotation(day, clock));
  } else {
    const div = rng.pick(DIVISIONS);
    distanceM = rng.pick(DISTANCES[div]);
    surface = rng.pick<Surface>(["turf", "dirt", "synthetic"]);
    weather = rng.pick<RaceInput["race"]["weather"]>(["clear", "clear", "overcast", "rain", "dusk"]);
    going = surface === "synthetic" ? "good" : weather === "rain" ? "soft" : rng.chance(200) ? "firm" : "good";
  }
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

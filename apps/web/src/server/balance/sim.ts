/**
 * Balance harness: runs races through the REAL demo data, race generation and engine,
 * and boils each replay down to the numbers the balance reports and tests need.
 *
 * Used by apps/web/src/server/balance.test.ts (regression bands) and tools/balance/*.report.ts
 * (full Monte Carlo reports). Server/test-only; nothing in the app imports it.
 */
import type { Horse, RaceConfig, RaceInput, RaceReplay, RunningStyle } from "@thoroughbred/shared";
import { FRAME_STRIDE, PHOTO_FINISH_MM } from "@thoroughbred/shared";
import { simulateRace } from "../engine";
import { starterArchetypes, starterHorses, type Archetype } from "../demoData";
import { createQuickRace, getRaceInput, raceRating } from "../races";

export const TACTICS: readonly RunningStyle[] = ["front", "stalker", "closer"];
/** A fixed "now" so quick-race ids (post times) are reproducible. */
export const SIM_NOW_MS = Date.UTC(2026, 9, 25, 12, 0, 0);

/** Deterministic, valid player id for the k-th simulated player. */
export function simPlayerId(k: number): string {
  return `sim${k.toString(36).padStart(8, "0")}`;
}

export interface RaceStats {
  config: RaceConfig;
  fieldSize: number;
  winnerId: string;
  winnerTactic: RunningStyle;
  /** 1-based rank of the winner by pre-race rating (1 = favourite). */
  winnerRatingRank: number;
  /** Did the top-rated horse win? */
  favouriteWon: boolean;
  /** Margin first to second (mm). */
  winMarginMm: number;
  photo: boolean;
  /** Winner's position (1-based) when the leader had covered 75% of the trip. */
  winnerPosAt75: number;
  /** Winner was 5th or worse at 75% of the trip. */
  comeback: boolean;
  durationMs: number;
  /** horseId -> finishing position */
  positions: Map<string, number>;
  prizes: Map<string, number>;
  ratings: Map<string, number>;
}

export function analyze(input: RaceInput, replay: RaceReplay): RaceStats {
  const order = replay.result.finishOrder;
  const winnerId = order[0]!.horseId;
  const ratings = new Map<string, number>();
  for (const e of input.entries) ratings.set(e.horse.id, raceRating(e.horse, e.tactic, input.race));
  const sorted = [...ratings.entries()].sort((a, b) => b[1] - a[1]);
  const winnerRatingRank = sorted.findIndex(([id]) => id === winnerId) + 1;

  // Position at 75% of the trip, from the frames (gate order = replay.horses order).
  const n = replay.horses.length;
  const L = replay.trackLengthMm;
  const wIdx = replay.horses.findIndex((h) => h.horseId === winnerId);
  let winnerPosAt75 = 1;
  for (const f of replay.frames) {
    let lead = 0;
    for (let i = 0; i < n; i++) lead = Math.max(lead, f[i * FRAME_STRIDE]!);
    if (lead * 4 >= L * 3) {
      const wd = f[wIdx * FRAME_STRIDE]!;
      let ahead = 0;
      for (let i = 0; i < n; i++) if (f[i * FRAME_STRIDE]! > wd) ahead++;
      winnerPosAt75 = ahead + 1;
      break;
    }
  }
  const winnerTactic = input.entries.find((e) => e.horse.id === winnerId)!.tactic;
  return {
    config: input.race,
    fieldSize: n,
    winnerId,
    winnerTactic,
    winnerRatingRank,
    favouriteWon: winnerRatingRank === 1,
    winMarginMm: order[1]?.marginMm ?? 0,
    photo: (order[1]?.marginMm ?? Infinity) < PHOTO_FINISH_MM,
    winnerPosAt75,
    comeback: winnerPosAt75 >= 5,
    durationMs: Math.ceil((replay.totalTicks * 1000) / replay.tickHz),
    positions: new Map(order.map((f) => [f.horseId, f.position])),
    prizes: new Map(order.map((f) => [f.horseId, f.prize])),
    ratings,
  };
}

export interface QuickSample extends RaceStats {
  playerId: string;
  horseIndex: number;
  horse: Horse;
  archetype: Archetype;
  tactic: RunningStyle;
  natural: boolean;
  position: number;
  prize: number;
  /** 1-based rank of the player's horse by rating within the field. */
  playerRatingRank: number;
  surfaceMatch: boolean;
  /** race distance - preferred distance (m). */
  distDelta: number;
}

/** Enter one quick race exactly as POST /api/races/quick would, and run it. */
export function runQuick(playerId: string, horseIndex: number, tactic: RunningStyle, nonce: string): QuickSample {
  const { raceId } = createQuickRace({ playerId, horseIndex, tactic }, SIM_NOW_MS, nonce);
  const input = getRaceInput(raceId);
  const replay = simulateRace(input);
  const st = analyze(input, replay);
  const horse = starterHorses(playerId)[horseIndex]!;
  const sortedRatings = [...st.ratings.entries()].sort((a, b) => b[1] - a[1]);
  return {
    ...st,
    playerId,
    horseIndex,
    horse,
    archetype: starterArchetypes(playerId)[horseIndex]!,
    tactic,
    natural: tactic === horse.style,
    position: st.positions.get(horse.id)!,
    prize: st.prizes.get(horse.id)!,
    playerRatingRank: sortedRatings.findIndex(([id]) => id === horse.id) + 1,
    surfaceMatch: horse.preferredSurface === input.race.surface,
    distDelta: input.race.distanceM - horse.preferredDistanceM,
  };
}

/** Nonce for the i-th simulated race (valid per the quick-race id schema). */
export function simNonce(i: number, salt = 0): string {
  return `n${(i * 7919 + salt * 104729).toString(36).padStart(7, "0")}`;
}

export function runScheduled(slot: number): RaceStats {
  const input = getRaceInput(`s-${slot}`);
  return analyze(input, simulateRace(input));
}

// ---------------------------------------------------------------------------
// Small stats helpers
// ---------------------------------------------------------------------------

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function groupBy<T, K>(xs: readonly T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/**
 * Horse "profile": every per-race constant the simulation needs, derived once from
 * stats + race conditions with integer arithmetic only.
 *
 * Units: speeds in mm/s, accelerations in mm/s per tick, energy in micro-units
 * (1_000_000 = full tank, frames report energy / 1000 as permille), factors in permille.
 */
import type { RaceConfig, RaceEntry, RunningStyle } from "@thoroughbred/shared";
import type { Rng } from "./prng";

export const TICK_HZ = 20;
export const SAMPLE_EVERY = 2;
export const US_PER_TICK = 50_000;
export const ENERGY_MAX = 1_000_000;
/** Hard cap: 10 minutes of simulated time. */
export const MAX_TICKS = TICK_HZ * 600;

// --- Pace -------------------------------------------------------------------
/** Par cruising speed (mm/s) of a 650-rated horse at 1000 m on good going. */
const PAR_AT_1000 = 16_920;
/** Par slows by PAR_SLOPE mm/s for every 1000 m of extra distance. */
const PAR_SLOPE = 800;
/** Cruise speed gained per stat point of speed above 650 (mm/s per 100 points). */
const SPEED_PER_100 = 95;

const GOING_ADJ: Record<RaceConfig["going"], number> = { firm: 120, good: 0, soft: -320, heavy: -680 };
const GOING_HORSE_PEN: Record<RaceConfig["going"], number> = { firm: 0, good: 0, soft: 140, heavy: 300 };

// --- Tactics ----------------------------------------------------------------
export const KICK_BASE_M: Record<RunningStyle, number> = { front: 300, stalker: 420, closer: 660 };
/** Kick intensity per tactic (permille of the gap between cruise and top speed). */
export const KICK_STRENGTH: Record<RunningStyle, number> = { front: 800, stalker: 1000, closer: 1000 };

export interface Profile {
  /** Comfortable cruising speed today (includes day form + conditions), mm/s. */
  cruise: number;
  /** Flat-out speed with a full tank, mm/s. */
  top: number;
  /** Speed a fully spent horse fades to, mm/s. */
  floor: number;
  /** Acceleration from the gate (mm/s per tick). */
  accStart: number;
  /** Acceleration once near/above cruise (mm/s per tick). */
  accRun: number;
  /** Energy drain multiplier, permille. */
  drainMul: number;
  /** Kick begins at this many mm to go. */
  kickAtMm: number;
  /** Kick strength permille. */
  kickStrength: number;
  /** Amplitude of the per-segment pace noise, mm/s. */
  segAmp: number;
  /** Ticks after the start before the horse breaks. */
  reactTicks: number;
  slowStart: boolean;
  /** Preferred lateral position (milli-lanes). */
  prefLane: number;
  /** Keen early (low temperament) drain multiplier, permille, applied in the first quarter. */
  keenMul: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function parSpeed(race: RaceConfig): number {
  const d = race.distanceM;
  return PAR_AT_1000 - Math.trunc(((d - 1000) * PAR_SLOPE) / 1000) + Math.trunc((Math.max(0, d - 2400) * 250) / 1000) + GOING_ADJ[race.going];
}

/**
 * Build the profile. `form` is the horse's "form" PRNG stream; draws happen in a fixed order.
 */
export function buildProfile(entry: RaceEntry, race: RaceConfig, laneMax: number, form: Rng): Profile {
  const s = entry.horse.stats;
  const h = entry.horse;
  const D = race.distanceM;
  const adaptGap = 1000 - s.adaptability; // 0 = fully adaptable
  const temperGap = 1000 - s.temperament; // 0 = perfectly composed

  // Conditions.
  let cruise = parSpeed(race) + Math.trunc(((s.speed - 650) * SPEED_PER_100) / 100);
  if (h.preferredSurface !== race.surface) cruise -= 110 + Math.trunc((260 * adaptGap) / 1000);
  cruise -= Math.trunc((GOING_HORSE_PEN[race.going] * adaptGap) / 1000);
  const distDelta = D - h.preferredDistanceM;
  if (distDelta < 0) cruise -= Math.trunc((-distDelta * (1100 - s.adaptability)) / 6_000);

  // Tactic vs natural style.
  const matched = h.style === entry.tactic;
  cruise += matched ? 40 : -40;

  // Day form: the main source of upsets. Composed horses are more consistent.
  let formAmp = 450 + Math.trunc((temperGap * 35) / 100);
  if (race.weather === "rain") formAmp += Math.trunc(formAmp / 4);
  cruise += form.tri(formAmp);

  const top = cruise + 800 + Math.trunc(s.burst);
  const floor = Math.trunc((cruise * (840 + Math.trunc(s.durability / 20))) / 1000);

  // Energy economy.
  // Stamina barely matters in a sprint and dominates in a staying race.
  const stamMul = 1000 + Math.trunc(((650 - s.stamina) * Math.trunc(((D - 500) * 2) / 5)) / 1000);
  const distMul = distDelta > 0 ? 1000 + Math.trunc((distDelta * (1100 - s.adaptability)) / 3000) : 1000;
  const durMul = 1000 + Math.trunc((500 - s.durability) / 10);
  const tacMul = matched ? 980 : 1020;
  let drainMul = stamMul;
  drainMul = Math.trunc((drainMul * distMul) / 1000);
  drainMul = Math.trunc((drainMul * durMul) / 1000);
  drainMul = Math.trunc((drainMul * tacMul) / 1000);
  drainMul = clamp(drainMul, 450, 2500);

  const distScale = clamp(1000 + Math.trunc((D - 1600) / 4), 820, 1400);
  const kickAtMm = KICK_BASE_M[entry.tactic] * distScale;

  let segAmp = 140 + Math.trunc(temperGap / 5);
  if (race.weather === "rain") segAmp += Math.trunc(segAmp / 4);

  // Gate break.
  let reactTicks = 2 + form.int(4) + Math.trunc(temperGap / 250);
  const slowStart = form.chance(15 + Math.trunc(temperGap / 10));
  if (slowStart) reactTicks += form.range(6, 14);

  // Lateral preference: most want the rail, some are happy a little wider.
  const prefLane = Math.min(laneMax, form.int(3) * 500);

  const keenMul = s.temperament < 500 ? 1000 + Math.trunc((500 - s.temperament) / 2) : 1000;

  return {
    cruise,
    top,
    floor,
    accStart: 200 + Math.trunc(s.burst / 5),
    accRun: 15 + Math.trunc(s.burst / 30),
    drainMul,
    kickAtMm,
    kickStrength: KICK_STRENGTH[entry.tactic],
    segAmp,
    reactTicks,
    slowStart,
    prefLane,
    keenMul,
  };
}

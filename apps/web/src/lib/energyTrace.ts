/**
 * A horse's energy over the race, read straight from the replay frames the client already has
 * (FRAME_FIELD.energy: the engine's tank, 0..1000 permille, sampled every few ticks). Nothing is
 * modelled or smoothed here: each point is the frame at which the horse reached that part of the
 * trip. Pure and deterministic, for the Why card's energy line.
 */
import { FRAME_FIELD, FRAME_STRIDE, type RaceReplay } from "@thoroughbred/shared";
import { formatDistance } from "./format";

/** Points along the trip, start and line included (every 1/24th: thirds and halves fall on a point). */
export const ENERGY_POINTS = 24;
/**
 * "Running on empty": the engine calls a horse up with the leaders tiring once its tank is below
 * 70 000 of 1 000 000 (racing-engine simulate.ts), which is 70 in the frames' 0..1000.
 */
export const ENERGY_LOW = 70;
/** A low point this close to the line isn't "ran out": nearly every horse crosses the line almost empty. */
const LOW_MIN_TO_GO_M = 25;

export interface EnergyTrace {
  /** Energy 0..1000 at each 1/ENERGY_POINTS of the trip (index 0 = the off, last = the line). */
  mine: number[];
  /** The field's median at the same points of the trip (the other runners). */
  field: number[];
  /** Metres still to run when the tank first fell to ENERGY_LOW or below; null if it never did before the last few metres. */
  lowWithM: number | null;
  distanceM: number;
}

function at(replay: RaceReplay, f: number, h: number, field: keyof typeof FRAME_FIELD): number {
  return replay.frames[f]![h * FRAME_STRIDE + FRAME_FIELD[field]]!;
}

/** Horse h's energy at each point of the trip (one pass: distance only grows). */
function samples(replay: RaceReplay, h: number): number[] {
  const L = replay.trackLengthMm;
  const out: number[] = [];
  let f = 0;
  const last = replay.frames.length - 1;
  for (let k = 0; k <= ENERGY_POINTS; k++) {
    const mm = Math.floor((k * L) / ENERGY_POINTS);
    while (f < last && at(replay, f, h, "distanceMm") < mm) f++;
    out.push(at(replay, f, h, "energy"));
  }
  return out;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/** The energy line for one runner, or null when it isn't in the replay (or there are no frames). */
export function energyTrace(replay: RaceReplay, horseId: string): EnergyTrace | null {
  const h = replay.horses.findIndex((x) => x.horseId === horseId);
  if (h < 0 || replay.frames.length === 0) return null;
  const all = replay.horses.map((_, i) => samples(replay, i));
  const others = all.filter((_, i) => i !== h);
  const field = all[h]!.map((_, k) => median(others.map((o) => o[k]!)));
  // The first frame (before the line) at which the tank was low, and how far there was still to go.
  const L = replay.trackLengthMm;
  let lowWithM: number | null = null;
  for (let f = 0; f < replay.frames.length; f++) {
    const d = at(replay, f, h, "distanceMm");
    if (d >= L) break;
    if (at(replay, f, h, "energy") <= ENERGY_LOW) {
      const toGo = Math.round((L - d) / 1000);
      lowWithM = toGo >= LOW_MIN_TO_GO_M ? toGo : null;
      break;
    }
  }
  return { mine: all[h]!, field, lowWithM, distanceM: replay.race.distanceM };
}

const pct = (e: number) => `${Math.round(e / 10)}%`;

/** "50 m" steps for the words (the engine's own metres, rounded for reading). */
function roundM(m: number): number {
  return m >= 200 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
}

/** One plain sentence on how the tank ran (shown under the line). */
export function energyHeadline(t: EnergyTrace, name: string): string {
  const end = t.mine[t.mine.length - 1]!;
  if (t.lowWithM !== null) return `${name} ran low on energy with ${formatDistance(roundM(t.lowWithM))} to go.`;
  if (end >= 150) return `${name} still had ${pct(end)} left at the line: energy to spare.`;
  return `${name} used up the tank at about the right time, like most of the field.`;
}

/** The whole line in words: the text equivalent of the chart (screen readers, and for anyone who prefers words). */
export function energySummary(t: EnergyTrace, name: string): string {
  const n = t.mine.length - 1;
  const third = t.mine[Math.round(n / 3)]!;
  const twoThirds = t.mine[Math.round((2 * n) / 3)]!;
  const end = t.mine[n]!;
  const fieldEnd = t.field[n]!;
  return (
    `${name}'s energy: ${pct(t.mine[0]!)} at the off, ${pct(third)} a third of the way, ${pct(twoThirds)} two-thirds of the way and ${pct(end)} at the finish ` +
    `(a typical rival had ${pct(t.field[Math.round((2 * n) / 3)]!)} two-thirds of the way and ${pct(fieldEnd)} at the finish). ` +
    energyHeadline(t, name)
  );
}

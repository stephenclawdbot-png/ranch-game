/**
 * HUD helpers for the closing stages (pure): the "battle" for the lead and the distance
 * readout. Both read only the samples at the playhead (frames up to it), never the result.
 */
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";
import type { HorseSample } from "../sampleReplay";

/** The battle graphic shows inside this distance from the line (m)... */
export const BATTLE_FROM_M = 200;
/** ...when the leaders are within this much of each other (half a length, mm). */
export const BATTLE_WITHIN_MM = HORSE_LENGTH_MM / 2;
/** The HUD clears down to essentials inside the final furlong (m). */
export const FINAL_FURLONG_M = 201.168;

export interface Battle {
  /** 2 or 3 horses, leader first. */
  horseIds: string[];
  /** Distance behind the leader (mm) for each. */
  behindMm: number[];
}

/** Two or three horses within half a length of the leader in the final 200 m, else null. */
export function battleAt(samples: readonly Pick<HorseSample, "horseId" | "x" | "finished">[], trackLengthMm: number): Battle | null {
  if (samples.length < 2) return null;
  const byX = [...samples].sort((a, b) => b.x - a.x);
  const lead = byX[0]!;
  // Before the final 200 m, or once the leader is home (the line decides it then).
  if (lead.finished || lead.x >= trackLengthMm || trackLengthMm - lead.x > BATTLE_FROM_M * 1000) return null;
  const group = [lead];
  for (let i = 1; i < Math.min(3, byX.length); i++) {
    const s = byX[i]!;
    if (lead.x - s.x <= BATTLE_WITHIN_MM) group.push(s);
    else break;
  }
  if (group.length < 2) return null;
  return { horseIds: group.map((s) => s.horseId), behindMm: group.map((s) => lead.x - s.x) };
}

/** Battle gap as racing words, in lengths. */
export function battleGapLabel(mm: number): string {
  if (mm <= 0) return "";
  if (mm < 150) return "nose";
  if (mm < 400) return "sh head";
  if (mm < 700) return "head";
  if (mm < 1200) return "neck";
  return "½L";
}

export interface DistanceMarker {
  /** "3f", "200", "100" or "" (no marker ahead / at the line). */
  label: string;
  /** Plate colour of that marker. */
  colour: string;
  /** Metres from the leader to the line. */
  toGoM: number;
  /** Inside the final furlong (the HUD clears down). */
  finalFurlong: boolean;
}

/** The next marker ahead of the leader (the poles and boards both views plant from the stage). */
export function distanceMarker(
  markers: readonly { x: number; label: string; colour: string }[],
  leaderXM: number,
  trackLengthM: number,
): DistanceMarker {
  const toGoM = Math.max(0, trackLengthM - leaderXM);
  let best: { x: number; label: string; colour: string } | null = null;
  for (const m of markers) if (m.x > leaderXM + 0.01 && (!best || m.x < best.x)) best = m;
  return { label: best?.label ?? "", colour: best?.colour ?? "#d71920", toGoM, finalFurlong: toGoM > 0 && toGoM <= FINAL_FURLONG_M };
}

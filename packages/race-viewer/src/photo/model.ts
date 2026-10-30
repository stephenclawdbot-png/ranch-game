/**
 * Photo-finish model (pure, deterministic): who is in the photograph, where each horse
 * crossed the line, how fast and in which lane, and the judge's verdict.
 *
 * Margins are the official ones: the engine stores each finisher's distance behind the
 * horse directly ahead (`marginMm`) and its racing label (`marginLabel`: nose, short head,
 * head, neck, 1/2, 3/4, 1, 1 1/4 ... dist) on the result, so the photograph always agrees
 * with the result board. The only thing added here is the dead heat: two horses whose
 * crossing times are equal at the game's timing resolution (1 us) share the placing.
 */
import { FRAME_FIELD, FRAME_STRIDE, HORSE_LENGTH_MM, type HorseAppearance, type RaceReplay } from "@thoroughbred/shared";

/** Result times are integer microseconds; closer than this is a dead heat. */
export const TIMING_RESOLUTION_US = 1;
/** Label used for a dead heat in place of the engine's margin label. */
export const DEAD_HEAT = "dead heat";

export interface PhotoRunner {
  horseId: string;
  name: string;
  gate: number;
  appearance: HorseAppearance;
  /** Placing; dead-heaters share it. */
  position: number;
  /** Nose on the line, us from the start (the official finish time). */
  crossingUs: number;
  /** Speed at the line, mm/s (from the last frame before the line). */
  speedMmS: number;
  /** Lateral position at the line, milli-lanes from the rail. */
  laneMilli: number;
  /** Distance behind the horse directly ahead in the photo, mm (0 for the leader and dead heats). */
  marginMm: number;
  /** "" for the winner, DEAD_HEAT, or the engine's label ("short head", "neck", "1 1/2"...). */
  marginLabel: string;
  deadHeat: boolean;
  /** Sum of margins back to the winner, mm. */
  behindWinnerMm: number;
}

export interface PhotoFinishModel {
  raceId: string;
  raceName: string;
  distanceM: number;
  postTimeMs: number;
  /** In crossing order (ties by official position). */
  runners: PhotoRunner[];
  /** True when the official result called a photograph (first two within a nose). */
  photograph: boolean;
  /** The judge's line runs from the winner's nose to the runner-up's nose. */
  judge: { fromUs: number; toUs: number; label: string };
  /** "1st Silver Bramble by a short head from Golden Mile; a neck back to Quiet Riot" */
  verdict: string;
}

export interface PhotoFinishOptions {
  /** Minimum finishers shown (default 4). */
  count?: number;
  /** Also include everyone within this many mm of the winner (default 1.5 lengths). */
  withinMm?: number;
  /** Hard cap on runners in the photograph (default 8). */
  max?: number;
}

/** Margin label as words: "short head" -> "a short head", "1 1/2" -> "1 1/2 lengths". */
export function marginPhrase(label: string): string {
  switch (label) {
    case "":
      return "";
    case DEAD_HEAT:
      return "a dead heat";
    case "nose":
    case "short head":
    case "head":
    case "neck":
      return `a ${label}`;
    case "1/2":
      return "half a length";
    case "3/4":
      return "three-quarters of a length";
    case "1":
      return "a length";
    case "dist":
      return "a distance";
    default:
      return `${label} lengths`;
  }
}

/** Speed and lane at the moment of crossing, read from the stored frames. */
export function lineState(replay: Pick<RaceReplay, "frames" | "tickHz" | "sampleEvery" | "trackLengthMm">, h: number, crossingUs: number): { speedMmS: number; laneMilli: number } | null {
  const frames = replay.frames;
  if (frames.length === 0) return null;
  const o = h * FRAME_STRIDE;
  // Frame index at the crossing time, then step back to the last frame before the line
  // (distances are clamped at the line after it, and the speed decays as the horse eases).
  const fAt = (crossingUs * replay.tickHz) / (replay.sampleEvery * 1_000_000);
  let f = Math.min(frames.length - 1, Math.max(0, Math.floor(fAt)));
  while (f > 0 && (frames[f]![o + FRAME_FIELD.distanceMm] ?? 0) >= replay.trackLengthMm) f--;
  const a = frames[f]!;
  const b = frames[Math.min(frames.length - 1, f + 1)]!;
  const u = Math.min(1, Math.max(0, fAt - f));
  const la = a[o + FRAME_FIELD.laneMilli] ?? 0;
  const lb = b[o + FRAME_FIELD.laneMilli] ?? la;
  const speed = a[o + FRAME_FIELD.speedMmS] ?? 0;
  if (!(speed > 0)) return null;
  return { speedMmS: speed, laneMilli: Math.round(la + (lb - la) * u) };
}

/** Group runners by placing for the verdict: [[dead-heaters...], [next], ...]. */
function placings(runners: PhotoRunner[]): PhotoRunner[][] {
  const out: PhotoRunner[][] = [];
  for (const r of runners) {
    const last = out[out.length - 1];
    if (last && r.deadHeat) last.push(r);
    else out.push([r]);
  }
  return out;
}

function names(group: PhotoRunner[]): string {
  const n = group.map((r) => r.name);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

export function verdictLine(runners: PhotoRunner[]): string {
  const groups = placings(runners);
  const first = groups[0];
  if (!first) return "";
  const parts: string[] = [];
  const second = groups[1];
  if (first.length > 1) {
    parts.push(`Dead heat for 1st: ${names(first)}`);
    if (second) parts.push(`${marginPhrase(second[0]!.marginLabel)} back to ${names(second)}`);
  } else if (second) {
    parts.push(`1st ${first[0]!.name} by ${marginPhrase(second[0]!.marginLabel)} from ${names(second)}${second.length > 1 ? " (dead heat for 2nd)" : ""}`);
  } else {
    parts.push(`1st ${first[0]!.name}`);
  }
  for (let g = 2; g < groups.length; g++) {
    const grp = groups[g]!;
    parts.push(`${marginPhrase(grp[0]!.marginLabel)} back to ${names(grp)}${grp.length > 1 ? " (dead heat)" : ""}`);
  }
  return parts.join("; ");
}

const FALLBACK_SPEED_MM_S = 16_000;

export function photoFinishModel(replay: RaceReplay, opts: PhotoFinishOptions = {}): PhotoFinishModel {
  const count = opts.count ?? 4;
  const withinMm = opts.withinMm ?? Math.round(HORSE_LENGTH_MM * 1.5);
  const max = opts.max ?? 8;
  const index = new Map(replay.horses.map((h, i) => [h.horseId, i]));
  const order = [...replay.result.finishOrder].sort((a, b) => a.finishTimeUs - b.finishTimeUs || a.position - b.position);

  const runners: PhotoRunner[] = [];
  let behind = 0;
  let position = 1;
  for (let k = 0; k < order.length; k++) {
    const rec = order[k]!;
    const h = index.get(rec.horseId);
    if (h === undefined) continue;
    const horse = replay.horses[h]!;
    const prev = runners[runners.length - 1];
    const deadHeat = !!prev && rec.finishTimeUs - prev.crossingUs < TIMING_RESOLUTION_US;
    const marginMm = prev && !deadHeat ? rec.marginMm : 0;
    behind += marginMm;
    if (prev && !deadHeat) position = k + 1;
    if (runners.length >= max || (runners.length >= count && behind > withinMm)) break;
    const line = lineState(replay, h, rec.finishTimeUs);
    runners.push({
      horseId: rec.horseId,
      name: horse.name,
      gate: horse.gate,
      appearance: horse.appearance,
      position,
      crossingUs: rec.finishTimeUs,
      speedMmS: line?.speedMmS ?? FALLBACK_SPEED_MM_S,
      laneMilli: line?.laneMilli ?? Math.max(0, horse.gate - 1) * 1000,
      marginMm,
      marginLabel: !prev ? "" : deadHeat ? DEAD_HEAT : rec.marginLabel,
      deadHeat,
      behindWinnerMm: behind,
    });
  }

  const w = runners[0];
  const r2 = runners[1];
  return {
    raceId: replay.race.id,
    raceName: replay.race.name,
    distanceM: replay.race.distanceM,
    postTimeMs: replay.race.postTimeMs,
    runners,
    photograph: replay.result.photoFinish,
    judge: { fromUs: w?.crossingUs ?? 0, toUs: r2?.crossingUs ?? w?.crossingUs ?? 0, label: r2 ? r2.marginLabel : "" },
    verdict: verdictLine(runners),
  };
}

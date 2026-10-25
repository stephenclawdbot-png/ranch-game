/**
 * Post-race "why" analysis from the replay frames: pace, sectionals (early / middle / late
 * thirds), running positions and lengths beaten — explained in plain language.
 * Pure and deterministic: the same replay always gives the same story.
 */
import { FRAME_FIELD, FRAME_STRIDE, HORSE_LENGTH_MM, type RaceReplay, type RunningStyle } from "@thoroughbred/shared";
import { fitCheck, type Fit } from "./aptitude";
import { ordinal } from "./format";
import type { Horse } from "@thoroughbred/shared";

export type PaceLabel = "fast" | "even" | "slow";
export type Segment = "early" | "middle" | "late";

export interface Sectional {
  segment: Segment;
  /** This horse's time for the segment, seconds. */
  timeS: number;
  /** Rank of this time in the field (1 = fastest). */
  rank: number;
  /** 0..1 where 1 = fastest in the field, 0 = slowest (for bars). */
  score: number;
}

export interface RaceAnalysis {
  horseId: string;
  position: number;
  fieldSize: number;
  /** Lengths behind the winner (0 for the winner). */
  lengthsBehind: number;
  pace: PaceLabel;
  /** Field median late-third time / early-third time. Higher = they went off too fast and slowed. */
  paceRatio: number;
  /** Positions at 25 / 50 / 75 % of the trip and at the finish, e.g. [8, 6, 4, 3]. */
  runningLine: number[];
  sectionals: Sectional[];
  fits: Fit[];
  tactic: RunningStyle;
  /** One or two plain sentences. */
  summary: string;
}

/** Pace thresholds on the median early/late speed ratio (calibrated on the demo engine). */
export const PACE_FAST = 0.965;
export const PACE_SLOW = 0.905;

function dist(replay: RaceReplay, f: number, h: number): number {
  return replay.frames[f]![h * FRAME_STRIDE + FRAME_FIELD.distanceMm]!;
}

/** Seconds from the off until horse `h` first reaches `mm` (linear between frames). */
export function crossTimeS(replay: RaceReplay, h: number, mm: number): number {
  const frameS = replay.sampleEvery / replay.tickHz;
  for (let f = 1; f < replay.frames.length; f++) {
    const d1 = dist(replay, f, h);
    if (d1 >= mm) {
      const d0 = dist(replay, f - 1, h);
      const k = d1 === d0 ? 0 : (mm - d0) / (d1 - d0);
      return (f - 1 + k) * frameS;
    }
  }
  return (replay.frames.length - 1) * frameS;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Rank of each horse by distance covered at the first frame where the leader passes `mm`. */
function positionsWhenLeaderAt(replay: RaceReplay, mm: number): number[] {
  const n = replay.horses.length;
  let f = 0;
  for (; f < replay.frames.length; f++) {
    let lead = 0;
    for (let h = 0; h < n; h++) lead = Math.max(lead, dist(replay, f, h));
    if (lead >= mm) break;
  }
  f = Math.min(f, replay.frames.length - 1);
  const order = Array.from({ length: n }, (_, h) => h).sort((a, b) => dist(replay, f, b) - dist(replay, f, a));
  const pos = new Array<number>(n);
  order.forEach((h, i) => (pos[h] = i + 1));
  return pos;
}

const STYLE_NOUN: Record<RunningStyle, string> = { front: "front-runner", stalker: "stalker", closer: "closer" };

function lengthsText(l: number): string {
  if (l < 0.1) return "a nose";
  if (l < 0.35) return "a head";
  if (l < 0.6) return "a neck";
  if (l < 1) return "under a length";
  const r = Math.round(l * 2) / 2;
  return `${r % 1 ? `${Math.floor(r)}½` : r} ${r === 1 ? "length" : "lengths"}`;
}

export function analyseRace(
  replay: RaceReplay,
  horseId: string,
  horse: Pick<Horse, "stats" | "style" | "preferredDistanceM" | "preferredSurface">,
  tactic: RunningStyle,
): RaceAnalysis | null {
  const h = replay.horses.findIndex((x) => x.horseId === horseId);
  const rec = replay.result.finishOrder.find((f) => f.horseId === horseId);
  if (h < 0 || !rec) return null;
  const L = replay.trackLengthMm;
  const n = replay.horses.length;
  const finishS = new Map(replay.result.finishOrder.map((f) => [f.horseId, f.finishTimeUs / 1e6]));

  // Sectionals in thirds for every horse.
  const segs = replay.horses.map((x, i) => {
    const t1 = crossTimeS(replay, i, L / 3);
    const t2 = crossTimeS(replay, i, (2 * L) / 3);
    const t3 = finishS.get(x.horseId) ?? crossTimeS(replay, i, L);
    return [t1, t2 - t1, t3 - t2] as const;
  });
  const segNames: Segment[] = ["early", "middle", "late"];
  const sectionals: Sectional[] = segNames.map((segment, s) => {
    const times = segs.map((x) => x[s]!);
    const mine = times[h]!;
    const rank = 1 + times.filter((t) => t < mine).length;
    const lo = Math.min(...times);
    const hi = Math.max(...times);
    return { segment, timeS: mine, rank, score: hi === lo ? 1 : (hi - mine) / (hi - lo) };
  });

  const paceRatio = median(segs.map((x) => x[2])) / median(segs.map((x) => x[0]));
  const pace: PaceLabel = paceRatio >= PACE_FAST ? "fast" : paceRatio <= PACE_SLOW ? "slow" : "even";

  const runningLine = [0.25, 0.5, 0.75].map((p) => positionsWhenLeaderAt(replay, p * L)[h]!);
  runningLine.push(rec.position);

  const lengthsBehind =
    replay.result.finishOrder.filter((f) => f.position <= rec.position && f.position > 1).reduce((a, f) => a + f.marginMm, 0) / HORSE_LENGTH_MM;

  const fits = fitCheck(horse, tactic, replay.race);

  // --- the story -------------------------------------------------------------
  const parts: string[] = [];
  const result =
    rec.position === 1
      ? `Won${replay.result.finishOrder[1] ? ` by ${lengthsText(replay.result.finishOrder[1].marginMm / HORSE_LENGTH_MM)}` : ""}.`
      : `Finished ${ordinal(rec.position)} of ${n}, ${lengthsText(lengthsBehind)} behind the winner.`;
  parts.push(result);

  const early = runningLine[0]!;
  const handy = early <= Math.max(2, Math.ceil(n / 4));
  const back = early > Math.ceil(n / 2);
  if (pace === "fast") {
    parts.push(
      handy
        ? "They went off fast and racing up with the pace cost energy late on."
        : "They went off fast, which set it up for horses coming from behind.",
    );
  } else if (pace === "slow") {
    parts.push(
      back
        ? "The early pace was slow, so the leaders had plenty left and it was hard to make up ground."
        : "The early pace was slow, which suited horses near the front.",
    );
  } else {
    parts.push("The pace was even, a fair test.");
  }
  const best = [...sectionals].sort((a, b) => a.rank - b.rank)[0]!;
  if (best.rank <= 3) parts.push(`Ran the ${best.rank === 1 ? "fastest" : `${ordinal(best.rank)}-fastest`} ${best.segment} section.`);
  const poor = fits.filter((f) => f.level === "poor");
  if (poor.length) parts.push(`Against: ${poor.map((f) => `${f.label.toLowerCase()} (${f.detail})`).join(", ")}.`);
  else if (fits.every((f) => f.level === "good")) parts.push("Conditions suited.");
  if (tactic !== horse.style) parts.push(`Ridden as a ${STYLE_NOUN[tactic]}; natural ${STYLE_NOUN[horse.style]}.`);

  return {
    horseId,
    position: rec.position,
    fieldSize: n,
    lengthsBehind,
    pace,
    paceRatio,
    runningLine,
    sectionals,
    fits,
    tactic,
    summary: parts.join(" "),
  };
}

export { lengthsText };

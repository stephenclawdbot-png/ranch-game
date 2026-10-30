/**
 * Crafted photo-finish replays (dev pages and tests): each runner holds a constant speed
 * and lane through the line and crosses at an exact time, so margins can be set precisely.
 * Margins are computed the engine's way (time gap x the trailing horse's speed at the line).
 */
import { FRAME_STRIDE, type Coat, type RaceReplay, type ReplayHorse, type SilkPattern } from "@thoroughbred/shared";

export interface CraftedRunner {
  name: string;
  /** Nose on the line, us from the start. */
  crossingUs: number;
  speedMmS?: number;
  laneMilli?: number;
  coat?: Coat;
  silks?: { primary: string; secondary: string; cap: string; pattern: SilkPattern };
}

export interface CraftedRace {
  name?: string;
  distanceM?: number;
  postTimeMs?: number;
  runners: CraftedRunner[];
  /** The game's margin vocabulary (racing-engine `marginLabel`). */
  marginLabel: (mm: number) => string;
}

const COATS: Coat[] = ["bay", "chestnut", "grey", "black", "dark_bay", "palomino"];
const SILKS: { primary: string; secondary: string; cap: string; pattern: SilkPattern }[] = [
  { primary: "#1d3f8f", secondary: "#f2c230", cap: "#f2c230", pattern: "hoops" },
  { primary: "#c8102e", secondary: "#ffffff", cap: "#c8102e", pattern: "solid" },
  { primary: "#0f6b3a", secondary: "#f4f0e6", cap: "#f4f0e6", pattern: "chevron" },
  { primary: "#5b2a86", secondary: "#f28c28", cap: "#5b2a86", pattern: "quartered" },
  { primary: "#111111", secondary: "#e9e4d4", cap: "#d4202f", pattern: "sash" },
  { primary: "#f2c230", secondary: "#1d1d1b", cap: "#1d1d1b", pattern: "stripes" },
];

const TICK_HZ = 20;
const SAMPLE_EVERY = 2;
const HEX = "0123456789abcdef";

export function craftPhotoReplay(spec: CraftedRace): RaceReplay {
  const distanceM = spec.distanceM ?? 1200;
  const L = distanceM * 1000;
  const runners = spec.runners.map((r, i) => ({ ...r, speedMmS: r.speedMmS ?? 16_500, laneMilli: r.laneMilli ?? i * 1000 }));
  const horses: ReplayHorse[] = runners.map((r, i) => ({
    horseId: `h${i + 1}`,
    name: r.name,
    gate: i + 1,
    tactic: "stalker",
    appearance: { coat: r.coat ?? COATS[i % COATS.length]!, face: "star", legs: ["none", "sock", "none", "none"], silks: r.silks ?? SILKS[i % SILKS.length]! },
  }));
  const lastUs = Math.max(...runners.map((r) => r.crossingUs));
  const frameUs = (SAMPLE_EVERY * 1_000_000) / TICK_HZ;
  const nFrames = Math.ceil(lastUs / frameUs) + 10;
  const frames: number[][] = [];
  for (let f = 0; f < nFrames; f++) {
    const t = f * frameUs;
    const row: number[] = [];
    for (const r of runners) {
      const d = Math.min(L, Math.max(0, Math.round(L - (r.speedMmS * (r.crossingUs - t)) / 1_000_000)));
      row.push(d, r.laneMilli, r.speedMmS, 500);
    }
    frames.push(row);
  }
  const order = runners.map((_, i) => i).sort((a, b) => runners[a]!.crossingUs - runners[b]!.crossingUs || a - b);
  const finishOrder = order.map((i, k) => {
    const marginMm = k === 0 ? 0 : Math.floor(((runners[i]!.crossingUs - runners[order[k - 1]!]!.crossingUs) * runners[i]!.speedMmS) / 1_000_000);
    return { horseId: horses[i]!.horseId, position: k + 1, finishTimeUs: runners[i]!.crossingUs, marginMm, marginLabel: k === 0 ? "" : spec.marginLabel(marginMm), prize: 0 };
  });
  return {
    version: 1,
    engineVersion: "crafted",
    race: { id: "photo-crafted", name: spec.name ?? "The Photo Stakes", distanceM, surface: "turf", weather: "clear", going: "good", raceClass: "handicap", postTimeMs: spec.postTimeMs ?? Date.UTC(2026, 9, 30, 14, 30), purse: 0 },
    seedCommitment: HEX[0]!.repeat(64),
    seed: HEX[1]!.repeat(64),
    tickHz: TICK_HZ,
    sampleEvery: SAMPLE_EVERY,
    trackLengthMm: L,
    laneCount: Math.max(runners.length, 1 + Math.ceil(Math.max(...runners.map((r) => r.laneMilli)) / 1000)),
    horses,
    frames,
    totalTicks: nFrames * SAMPLE_EVERY,
    events: [],
    result: { finishOrder, winningTimeUs: runners[order[0]!]!.crossingUs, photoFinish: (finishOrder[1]?.marginMm ?? Infinity) < 150, resultHash: HEX[2]!.repeat(64) },
  };
}

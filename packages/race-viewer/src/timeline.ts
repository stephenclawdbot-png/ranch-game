/** Pure HUD helpers derived from a replay + samples. No rendering here. */
import { HORSE_LENGTH_MM, type RaceEvent, type RaceReplay } from "@thoroughbred/shared";

/** The parts of a replay (or a live broadcast) the HUD helpers read. */
export interface TimelineSource {
  tickHz: number;
  trackLengthMm: number;
  horses: RaceReplay["horses"];
  events: ReadonlyArray<RaceEvent>;
  /** Absent while live: gaps are shown in lengths instead of official margins. */
  result?: RaceReplay["result"] | null;
}
import type { HorseSample } from "./sampleReplay";

export function eventTimeSec(replay: Pick<TimelineSource, "tickHz">, ev: RaceEvent): number {
  return ev.tick / replay.tickHz;
}

/** Events already "spoken" by time t, newest first, limited to the last `windowSec`. */
export function commentaryAt(replay: Pick<TimelineSource, "tickHz" | "events">, t: number, windowSec = 6, max = 2): RaceEvent[] {
  const out: RaceEvent[] = [];
  for (let i = replay.events.length - 1; i >= 0 && out.length < max; i--) {
    const ev = replay.events[i]!;
    const et = eventTimeSec(replay, ev);
    if (et > t) continue;
    if (t - et > windowSec) break;
    out.push(ev);
  }
  return out;
}

export interface StandingRow {
  index: number;
  horseId: string;
  name: string;
  gate: number;
  position: number;
  finished: boolean;
  /** "+1.5L" behind the leader, a result margin once finished, "" for the leader. */
  gapLabel: string;
  primary: string;
  secondary: string;
}

export function lengthsLabel(mm: number): string {
  const l = mm / HORSE_LENGTH_MM;
  if (l < 0.05) return "nose";
  if (l < 0.25) return "head";
  if (l < 10) return `+${(Math.round(l * 2) / 2).toFixed(1).replace(/\.0$/, "")}L`;
  return `+${Math.round(l)}L`;
}

export function standingsAt(replay: Pick<TimelineSource, "horses" | "result">, samples: HorseSample[]): StandingRow[] {
  const sorted = [...samples].sort((a, b) => a.position - b.position);
  const leader = sorted[0];
  const marginByHorse = new Map((replay.result?.finishOrder ?? []).map((f) => [f.horseId, f.marginLabel]));
  return sorted.map((s) => {
    const h = replay.horses[s.index]!;
    let gapLabel = "";
    if (s.position > 1 && leader) {
      if (s.finished && marginByHorse.has(s.horseId)) gapLabel = marginByHorse.get(s.horseId)!;
      else if (s.finished && s.finishTimeSec !== null && leader.finishTimeSec !== null)
        // Live, no official margins yet: estimate from the crossing-time gap (~16 m/s).
        gapLabel = s.finishTimeSec - leader.finishTimeSec < 0.03 ? "photo" : lengthsLabel(Math.max(0, s.finishTimeSec - leader.finishTimeSec) * 16000);
      else gapLabel = lengthsLabel(Math.max(0, leader.x - s.x));
    }
    return {
      index: s.index,
      horseId: s.horseId,
      name: h.name,
      gate: h.gate,
      position: s.position,
      finished: s.finished,
      gapLabel,
      primary: h.appearance.silks.primary,
      secondary: h.appearance.silks.secondary,
    };
  });
}

/** Metres left for the leader (0 once the leader is home). */
export function distanceToGoM(replay: Pick<TimelineSource, "trackLengthMm">, samples: HorseSample[]): number {
  let best = 0;
  for (const s of samples) best = Math.max(best, s.x);
  return Math.max(0, (replay.trackLengthMm - best) / 1000);
}

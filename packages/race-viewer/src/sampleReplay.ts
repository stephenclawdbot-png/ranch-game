/**
 * Pure replay sampling. The viewer never decides results: finish state and order
 * after the line come from `replay.result`; positions in between come from frames.
 */
import { FRAME_FIELD, FRAME_STRIDE, type RaceReplay } from "@thoroughbred/shared";

export interface HorseSample {
  /** Index into replay.horses (and the per-frame horse order). */
  index: number;
  horseId: string;
  /** Distance from the start, mm (float, interpolated). */
  x: number;
  /** Lateral position in lanes from the rail (float, 0 = rail). */
  lane: number;
  /** Speed, mm/s (float). */
  speed: number;
  /** Energy, 0..1000. */
  energy: number;
  /** True once the replay result says this horse has crossed the line. */
  finished: boolean;
  /** Live rank, 1-based. Finished horses keep their official position. */
  position: number;
  /** Official finish time in seconds, or null if the horse is not in the result. */
  finishTimeSec: number | null;
}

export interface ReplayTiming {
  /** Seconds between stored frames. */
  frameDt: number;
  /** Time (s) of the last stored frame: sampling clamps here. */
  lastFrameTime: number;
  /** Race duration shown to the user (s): the later of totalTicks and lastFrameTime. */
  duration: number;
  /** Winner's official time (s). */
  winnerTime: number;
  /** Last official finish time (s). */
  lastFinishTime: number;
}

export function replayTiming(replay: RaceReplay): ReplayTiming {
  const frameDt = replay.sampleEvery / replay.tickHz;
  const lastFrameTime = Math.max(0, (replay.frames.length - 1) * frameDt);
  const times = replay.result.finishOrder.map((f) => f.finishTimeUs / 1e6);
  const winnerTime = replay.result.winningTimeUs / 1e6 || (times.length ? Math.min(...times) : lastFrameTime);
  const lastFinishTime = times.length ? Math.max(...times) : lastFrameTime;
  const duration = Math.min(lastFrameTime, Math.max(lastFinishTime, replay.totalTicks / replay.tickHz));
  return { frameDt, lastFrameTime, duration: duration > 0 ? duration : lastFrameTime, winnerTime, lastFinishTime };
}

/** Cubic Hermite between two frames, clamped to the segment so it never overshoots. */
function hermite(p0: number, v0: number, p1: number, v1: number, dt: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const p = h00 * p0 + h10 * dt * v0 + h01 * p1 + h11 * dt * v1;
  const lo = Math.min(p0, p1);
  const hi = Math.max(p0, p1);
  return p < lo ? lo : p > hi ? hi : p;
}

export type ReplaySampler = (timeSec: number, out?: HorseSample[]) => HorseSample[];

/** Precomputes lookups once; the returned function is cheap enough to call per frame. */
export function createReplaySampler(replay: RaceReplay): ReplaySampler {
  const n = replay.horses.length;
  const timing = replayTiming(replay);
  const finish = new Map<string, { pos: number; t: number }>();
  for (const f of replay.result.finishOrder) finish.set(f.horseId, { pos: f.position, t: f.finishTimeUs / 1e6 });
  const finishPos = replay.horses.map((h) => finish.get(h.horseId)?.pos ?? Number.POSITIVE_INFINITY);
  const finishT = replay.horses.map((h) => finish.get(h.horseId)?.t ?? null);
  const frames = replay.frames;
  const order = new Array<number>(n);

  return (timeSec, out = []) => {
    const t = Math.min(Math.max(Number.isFinite(timeSec) ? timeSec : 0, 0), timing.lastFrameTime);
    const fpos = timing.frameDt > 0 ? t / timing.frameDt : 0;
    const f0 = Math.min(Math.floor(fpos), Math.max(frames.length - 1, 0));
    const f1 = Math.min(f0 + 1, frames.length - 1);
    const u = f1 === f0 ? 0 : fpos - f0;
    const a = frames[f0] ?? [];
    const b = frames[f1] ?? a;
    out.length = n;
    for (let h = 0; h < n; h++) {
      const o = h * FRAME_STRIDE;
      const d0 = a[o + FRAME_FIELD.distanceMm] ?? 0;
      const d1 = b[o + FRAME_FIELD.distanceMm] ?? d0;
      const v0 = a[o + FRAME_FIELD.speedMmS] ?? 0;
      const v1 = b[o + FRAME_FIELD.speedMmS] ?? v0;
      const l0 = a[o + FRAME_FIELD.laneMilli] ?? 0;
      const l1 = b[o + FRAME_FIELD.laneMilli] ?? l0;
      const e0 = a[o + FRAME_FIELD.energy] ?? 0;
      const e1 = b[o + FRAME_FIELD.energy] ?? e0;
      const ft = finishT[h] ?? null;
      const s: HorseSample = out[h] ?? ({} as HorseSample);
      s.index = h;
      s.horseId = replay.horses[h]!.horseId;
      s.x = hermite(d0, v0, d1, v1, timing.frameDt, u);
      s.lane = (l0 + (l1 - l0) * u) / 1000;
      s.speed = v0 + (v1 - v0) * u;
      s.energy = e0 + (e1 - e0) * u;
      s.finished = ft !== null ? t >= ft - 1e-9 : s.x >= replay.trackLengthMm;
      s.finishTimeSec = ft;
      s.position = 0;
      out[h] = s;
      order[h] = h;
    }
    order.sort((i, j) => {
      const si = out[i]!;
      const sj = out[j]!;
      if (si.finished && sj.finished) return finishPos[i]! - finishPos[j]! || i - j;
      if (si.finished !== sj.finished) return si.finished ? -1 : 1;
      return sj.x - si.x || i - j;
    });
    for (let r = 0; r < n; r++) out[order[r]!]!.position = r + 1;
    return out;
  };
}

/** One-off sample of every horse at `timeSec` (clamped to the replay). */
export function sampleReplay(replay: RaceReplay, timeSec: number): HorseSample[] {
  return createReplaySampler(replay)(timeSec);
}

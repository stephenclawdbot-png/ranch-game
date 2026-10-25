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

/**
 * What the sampler needs. A full `RaceReplay` satisfies it; a live broadcast passes its
 * header plus the frames received so far (the array may grow between calls) and no result.
 */
export interface SampleSource {
  horses: ReadonlyArray<{ horseId: string }>;
  frames: ReadonlyArray<ReadonlyArray<number>>;
  tickHz: number;
  sampleEvery: number;
  trackLengthMm: number;
  /** Official result; when absent (live), finishing comes from frames only. */
  result?: RaceReplay["result"] | null;
}

/** Interpolated time (s) at which horse h first reached the line, from frames; null if not yet. */
export function crossingTimeFromFrames(src: SampleSource, h: number): number | null {
  const frames = src.frames;
  const L = src.trackLengthMm;
  const dt = src.sampleEvery / src.tickHz;
  const o = h * FRAME_STRIDE + FRAME_FIELD.distanceMm;
  const n = frames.length;
  if (n === 0 || (frames[n - 1]![o] ?? 0) < L) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((frames[mid]![o] ?? 0) >= L) hi = mid;
    else lo = mid + 1;
  }
  if (lo === 0) return 0;
  // Distances are clamped at the line after finishing, so extrapolate from the
  // last pre-line frame's speed instead of interpolating to the clamped value.
  const prev = frames[lo - 1]!;
  const d0 = prev[o] ?? 0;
  const v0 = prev[h * FRAME_STRIDE + FRAME_FIELD.speedMmS] ?? 0;
  const d1 = frames[lo]![o] ?? L;
  const u = v0 > 0 ? (L - d0) / (v0 * dt) : d1 > d0 ? (L - d0) / (d1 - d0) : 1;
  return (lo - 1 + Math.min(1, Math.max(0, u))) * dt;
}

/** Precomputes lookups once; the returned function is cheap enough to call per frame. */
export function createReplaySampler(replay: SampleSource): ReplaySampler {
  const n = replay.horses.length;
  const frameDt = replay.sampleEvery / replay.tickHz;
  const result = replay.result ?? null;
  const finish = new Map<string, { pos: number; t: number }>();
  if (result) for (const f of result.finishOrder) finish.set(f.horseId, { pos: f.position, t: f.finishTimeUs / 1e6 });
  const finishPos = replay.horses.map((h) => finish.get(h.horseId)?.pos ?? Number.POSITIVE_INFINITY);
  const finishT: (number | null)[] = replay.horses.map((h) => finish.get(h.horseId)?.t ?? null);
  const order = new Array<number>(n);

  return (timeSec, out = []) => {
    // Read by property each call: a live source may replace or grow its array.
    const frames = replay.frames;
    // Live sources grow: the clamp follows the frames received so far.
    const lastFrameTime = Math.max(0, (frames.length - 1) * frameDt);
    const t = Math.min(Math.max(Number.isFinite(timeSec) ? timeSec : 0, 0), lastFrameTime);
    const fpos = frameDt > 0 ? t / frameDt : 0;
    const f0 = Math.min(Math.floor(fpos), Math.max(frames.length - 1, 0));
    const f1 = Math.min(f0 + 1, Math.max(frames.length - 1, 0));
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
      // Without a result, the crossing time is derived from frames (cached once known).
      if (!result && finishT[h] === null && (b[o + FRAME_FIELD.distanceMm] ?? 0) >= replay.trackLengthMm) finishT[h] = crossingTimeFromFrames(replay, h);
      const ft = finishT[h] ?? null;
      const s: HorseSample = out[h] ?? ({} as HorseSample);
      s.index = h;
      s.horseId = replay.horses[h]!.horseId;
      s.x = hermite(d0, v0, d1, v1, frameDt, u);
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
      if (si.finished && sj.finished) {
        if (result) return finishPos[i]! - finishPos[j]! || i - j;
        return (si.finishTimeSec ?? 0) - (sj.finishTimeSec ?? 0) || i - j;
      }
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

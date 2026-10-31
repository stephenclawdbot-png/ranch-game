/**
 * Shared runner motion (pure, deterministic): where each horse is, how fast, in which gait
 * and which animation strip/frame both views draw. Trackside and the 3D view read the same
 * state, so a horse is cantering in one exactly when it is cantering in the other.
 *
 * Up to its own finish a horse's x is the replay's x, untouched. After the line the engine
 * has no motion (the stored distance is clamped at the post), so the run-out is synthesised
 * here from the speed at the line, deterministically:
 *
 *   gallop out, easing at ~0.8 m/s^2 down to a canter (7 m/s), the jockey sitting up,
 *   then 0.9 m/s^2 down to a trot (4 m/s), 0.8 m/s^2 to a walk (1.6 m/s), and the walk
 *   dies away over ~8 s. From 17 m/s that is ~19 s and ~175 m to the walk.
 *
 * The winner's jockey celebrates (stands in the irons, arm up) while cantering. A horse that
 * suffered an injury in the race is pulled up instead (2.4 m/s^2, the pull-up strip; nothing
 * graphic). In the last ~300 m every runner is ridden out (drive strip); the leaders of a close
 * finish (within ~1 length 7 m out) lunge for the line. Leaving the stalls plays the break.
 */
import { FRAME_FIELD, FRAME_STRIDE, HORSE_LENGTH_MM } from "@thoroughbred/shared";
import { createReplaySampler, type HorseSample, type ReplaySampler, type SampleSource } from "../sampleReplay";
import { strideLengthM } from "../scene/horse/gait";
import { preOffRunner, type PreOffPlan } from "./preoff";

export type Gait = "gallop" | "drive" | "canter" | "trot" | "walk" | "stand";
/** Animation strip (art: race/horse-<anim>.png; "idle" = race/horse-idle.png). */
export type AnimId = "idle" | "break" | "gallop" | "drive" | "lunge" | "easeup" | "celebrate" | "pullup";

/** Frames per strip (manifest). */
export const ANIM_FRAMES: Record<AnimId, number> = { idle: 14, break: 8, gallop: 12, drive: 12, lunge: 6, easeup: 13, celebrate: 11, pullup: 10 };

export interface RunnerState {
  /** Distance from the start (m). */
  x: number;
  /** Lanes out from the inner rail. */
  lane: number;
  /** Ground speed (m/s). */
  speed: number;
  gait: Gait;
  /** Stride phase (continuous; frac = position in the stride). */
  phase: number;
  anim: AnimId;
  /** Frame of `anim` to draw. */
  frame: number;
}

export interface FinishInfo {
  /** Race distance (m). */
  L: number;
  /** Time this horse crossed the line (s), null while it hasn't. */
  finishT: number | null;
  /** Speed at the line (m/s). */
  finishSpeed: number;
  /** Stride phase at the line. */
  phaseAtLine: number;
  winner: boolean;
  /** Time the lunge started (s), null = no lunge. */
  lungeT: number | null;
  injured: boolean;
}

/** Run-out model constants (m/s, m/s^2). */
export const RUNOUT = {
  canter: 7,
  trot: 4,
  walk: 1.6,
  /** Deceleration from the line speed down to the canter. */
  decel: 0.8,
  toTrot: 0.9,
  toWalk: 0.8,
  walkFade: 0.2,
  injuredDecel: 2.4,
} as const;

/** Gait thresholds (m/s). */
export const GAIT_AT = { gallop: 9, canter: 5.5, trot: 2.5, walk: 0.15 } as const;

/** The drive (hands-and-heels) strip over the final metres. */
export const DRIVE_FROM_M = 300;
/** The lunge starts this far out, for the leaders of a close finish. */
export const LUNGE_FROM_M = 7;
/** "Close": leaders within this much of each other there. */
export const LUNGE_WITHIN_M = HORSE_LENGTH_MM / 1000;
/** Leaving the stalls: break frames over the first metres. */
export const BREAK_M = 2.4;

interface Seg {
  v0: number;
  v1: number;
  a: number;
}

function segments(v0: number, injured: boolean): Seg[] {
  if (injured) return [{ v0, v1: 0, a: RUNOUT.injuredDecel }];
  const out: Seg[] = [];
  const steps: [number, number][] = [
    [RUNOUT.canter, RUNOUT.decel],
    [RUNOUT.trot, RUNOUT.toTrot],
    [RUNOUT.walk, RUNOUT.toWalk],
    [0, RUNOUT.walkFade],
  ];
  let v = v0;
  for (const [to, a] of steps) {
    if (v <= to) continue;
    out.push({ v0: v, v1: to, a });
    v = to;
  }
  return out;
}

/** Distance (m) and speed (m/s) `dt` seconds after the line, from line speed `v0`. */
export function postLine(v0: number, dt: number, injured = false): { d: number; v: number } {
  let d = 0;
  let left = Math.max(0, dt);
  for (const s of segments(v0, injured)) {
    const T = (s.v0 - s.v1) / s.a;
    if (left <= T) {
      const v = s.v0 - s.a * left;
      return { d: d + ((s.v0 + v) / 2) * left, v };
    }
    d += ((s.v0 + s.v1) / 2) * T;
    left -= T;
  }
  return { d, v: 0 };
}

/** Seconds from the line until the horse is down to `v` (Infinity if never). */
export function timeToSpeed(v0: number, v: number, injured = false): number {
  let t = 0;
  for (const s of segments(v0, injured)) {
    if (v >= s.v1 && v <= s.v0) return t + (s.v0 - v) / s.a;
    t += (s.v0 - s.v1) / s.a;
  }
  return v <= 0 ? t : 0;
}

export function gaitFor(speed: number): Gait {
  if (speed >= GAIT_AT.gallop) return "gallop";
  if (speed >= GAIT_AT.canter) return "canter";
  if (speed >= GAIT_AT.trot) return "trot";
  if (speed >= GAIT_AT.walk) return "walk";
  return "stand";
}

/** Stride length used to drive the frame cadence at a speed. */
export function cadenceStride(speed: number, racing: boolean): number {
  return strideLengthM(racing ? Math.max(speed, 6) : speed);
}

/** Post-line stride phase (strides since the line) by numeric integration, cached per v0. */
const PHASE_DT = 0.05;
const PHASE_MAX_S = 60;
const phaseCache = new Map<string, Float32Array>();
function postPhaseTable(v0: number, injured: boolean): Float32Array {
  const key = `${v0.toFixed(3)}|${injured ? 1 : 0}`;
  let tab = phaseCache.get(key);
  if (tab) return tab;
  const n = Math.ceil(PHASE_MAX_S / PHASE_DT) + 1;
  tab = new Float32Array(n);
  let p = 0;
  let prev = postLine(v0, 0, injured);
  for (let i = 1; i < n; i++) {
    const cur = postLine(v0, i * PHASE_DT, injured);
    const v = (prev.v + cur.v) / 2;
    if (v > 0.01) p += (cur.d - prev.d) / cadenceStride(v, v >= GAIT_AT.gallop);
    tab[i] = p;
    prev = cur;
  }
  if (phaseCache.size > 256) phaseCache.clear();
  phaseCache.set(key, tab);
  return tab;
}

function postPhase(v0: number, dt: number, injured: boolean): number {
  const tab = postPhaseTable(v0, injured);
  const f = Math.min(tab.length - 1.001, Math.max(0, dt / PHASE_DT));
  const i = Math.floor(f);
  return tab[i]! + (tab[i + 1]! - tab[i]!) * (f - i);
}

const frac = (p: number) => p - Math.floor(p);
const loopFrame = (phase: number, frames: readonly number[]) => frames[Math.floor(frac(phase) * frames.length) % frames.length]!;
const CANTER_FRAMES = [6, 7, 8, 9] as const;
const TROT_FRAMES = [10, 11, 12, 11] as const;

/**
 * One runner at race time `t`. `sample` is the replay sample (mm, mm/s), `phase` its stride
 * phase from the frames (racing part), `finish` what is known about its finish.
 */
export function runnerState(sample: Pick<HorseSample, "x" | "lane" | "speed">, t: number, finish: FinishInfo, phase = 0, out: RunnerState = {} as RunnerState): RunnerState {
  const L = finish.L;
  const ft = finish.finishT;
  out.lane = sample.lane;
  if (ft !== null && t > ft) {
    // ---- after the line: the synthesised run-out ----
    const dt = t - ft;
    const v0 = finish.finishSpeed;
    const pl = postLine(v0, dt, finish.injured);
    out.x = L + pl.d;
    out.speed = pl.v;
    out.phase = finish.phaseAtLine + postPhase(v0, dt, finish.injured);
    out.gait = gaitFor(pl.v);
    if (finish.injured) {
      const stop = timeToSpeed(v0, 0, true);
      out.anim = "pullup";
      out.frame = dt < 0.5 ? Math.floor(dt * 10) : Math.min(9, 5 + Math.floor(((dt - 0.5) / Math.max(0.5, stop - 0.5)) * 5));
      return out;
    }
    if (finish.lungeT !== null && dt < 0.35) {
      out.anim = "lunge";
      out.frame = 5;
      return out;
    }
    if (finish.winner) {
      if (dt < 0.7) {
        out.anim = "easeup";
        out.frame = Math.min(6, Math.floor(dt * 10));
      } else if (pl.v >= GAIT_AT.trot) {
        out.anim = "celebrate";
        out.frame = Math.floor(frac(out.phase / 2) * ANIM_FRAMES.celebrate) % ANIM_FRAMES.celebrate;
      } else if (pl.v >= GAIT_AT.walk) {
        out.anim = "easeup";
        out.frame = loopFrame(out.phase, TROT_FRAMES);
      } else {
        out.anim = "idle";
        out.frame = Math.floor(dt * 6) % ANIM_FRAMES.idle;
      }
      return out;
    }
    if (dt < 1.6) {
      out.anim = "gallop";
      out.frame = Math.floor(frac(out.phase) * ANIM_FRAMES.gallop) % ANIM_FRAMES.gallop;
    } else if (dt < 2.6) {
      out.anim = "easeup";
      out.frame = Math.min(9, Math.floor((dt - 1.6) * 10));
    } else if (pl.v >= GAIT_AT.canter) {
      out.anim = "easeup";
      out.frame = loopFrame(out.phase, CANTER_FRAMES);
    } else if (pl.v >= GAIT_AT.walk) {
      out.anim = "easeup";
      out.frame = loopFrame(out.phase, TROT_FRAMES);
    } else {
      out.anim = "idle";
      out.frame = Math.floor(dt * 6) % ANIM_FRAMES.idle;
    }
    return out;
  }
  // ---- racing: the replay's own x, untouched ----
  out.x = sample.x / 1000;
  out.speed = t < 0 ? 0 : sample.speed / 1000;
  out.phase = phase;
  if (t < 0 || (out.x <= 0 && out.speed <= 0)) {
    out.gait = "stand";
    out.anim = "break";
    out.frame = 0;
    return out;
  }
  if (out.x < BREAK_M) {
    out.gait = "gallop";
    out.anim = "break";
    out.frame = Math.min(7, Math.floor((out.x / BREAK_M) * 8));
    return out;
  }
  if (finish.lungeT !== null && t >= finish.lungeT) {
    out.gait = "drive";
    out.anim = "lunge";
    out.frame = Math.min(5, Math.floor((t - finish.lungeT) * 12));
    return out;
  }
  const drive = L - out.x <= DRIVE_FROM_M;
  out.gait = drive ? "drive" : gaitFor(out.speed) === "gallop" || out.speed > 0 ? "gallop" : "stand";
  out.anim = drive ? "drive" : "gallop";
  out.frame = Math.floor(frac(phase) * 12) % 12;
  return out;
}

export interface FieldMotionOptions {
  /** Horses that suffered an injury in the race (pulled up after the line). */
  injured?: ReadonlySet<string>;
  /** The build-up before the off (stage/preoff.ts); null = standing in the stalls before 0. */
  preOff?: PreOffPlan | null;
}

interface PerHorse {
  finish: FinishInfo;
  /** Cumulative stride phase at each stored frame. */
  phaseAt: number[];
  /** Lunge decided (lungeT set or ruled out). */
  lungeKnown: boolean;
}

/**
 * The whole field over time: wraps the replay sampler, keeps each horse's stride phase from
 * the frames (deterministic, scrub-safe) and its finish info, and returns RunnerStates.
 * Live sources (growing frames, no result) work: finishing and the winner come from frames,
 * and the winner celebrates only once it is clear (or the official result says so).
 */
export class FieldMotion {
  samples: HorseSample[] = [];
  private sampler: ReplaySampler;
  private scratch: HorseSample[] = [];
  private horses: PerHorse[];
  private L: number;
  private frameDt: number;

  constructor(
    private src: SampleSource,
    private opts: FieldMotionOptions = {},
  ) {
    this.sampler = createReplaySampler(src);
    this.L = src.trackLengthMm / 1000;
    this.frameDt = src.sampleEvery / src.tickHz;
    this.horses = src.horses.map((h) => ({
      finish: { L: this.L, finishT: null, finishSpeed: 8, phaseAtLine: 0, winner: false, lungeT: null, injured: !!opts.injured?.has(h.horseId) },
      phaseAt: [],
      lungeKnown: false,
    }));
  }

  /** The race is official: re-read finishing and the winner from the result. */
  setSource(src: SampleSource): void {
    this.src = src;
    this.sampler = createReplaySampler(src);
    for (const h of this.horses) {
      h.finish.finishT = null;
      h.finish.winner = false;
      h.lungeKnown = false;
      h.finish.lungeT = null;
    }
  }

  /** Turn the build-up before the off on (a plan) or off (null: standing in the stalls). */
  setPreOff(plan: PreOffPlan | null): void {
    this.opts = { ...this.opts, preOff: plan };
  }

  /** Is race time t inside the build-up (the scenes draw it, the cameras follow it)? */
  preOffAt(t: number): boolean {
    return !!this.opts.preOff && t < 0;
  }

  setInjured(ids: ReadonlySet<string>): void {
    this.opts = { ...this.opts, injured: ids };
    this.src.horses.forEach((h, i) => (this.horses[i]!.finish.injured = ids.has(h.horseId)));
  }

  private extendPhase(h: number): void {
    const frames = this.src.frames;
    const tab = this.horses[h]!.phaseAt;
    const o = h * FRAME_STRIDE;
    const D = FRAME_FIELD.distanceMm;
    const V = FRAME_FIELD.speedMmS;
    if (tab.length === 0 && frames.length) tab.push(((h * 0.37) % 1) + 0.01);
    for (let k = tab.length; k < frames.length; k++) {
      const a = frames[k - 1]!;
      const b = frames[k]!;
      const dx = ((b[o + D] ?? 0) - (a[o + D] ?? 0)) / 1000;
      const v = ((a[o + V] ?? 0) + (b[o + V] ?? 0)) / 2000;
      tab.push(tab[k - 1]! + Math.max(0, dx) / cadenceStride(v, true));
    }
  }

  /** Racing stride phase at time t (frames, linear within a frame segment). */
  private racingPhase(h: number, t: number, xM: number): number {
    this.extendPhase(h);
    const tab = this.horses[h]!.phaseAt;
    const frames = this.src.frames;
    if (!tab.length) return 0;
    const k = Math.min(tab.length - 1, Math.max(0, Math.floor(Math.max(0, t) / this.frameDt)));
    const o = h * FRAME_STRIDE + FRAME_FIELD.distanceMm;
    const x0 = (frames[k]![o] ?? 0) / 1000;
    if (k + 1 >= tab.length) return tab[k]!;
    const x1 = (frames[k + 1]![o] ?? 0) / 1000;
    if (x1 <= x0) return tab[k]!;
    const u = Math.min(1, Math.max(0, (xM - x0) / (x1 - x0)));
    return tab[k]! + (tab[k + 1]! - tab[k]!) * u;
  }

  private winnerIndex(t: number): number {
    const res = this.src.result;
    if (res && res.finishOrder.length) return this.src.horses.findIndex((h) => h.horseId === res.finishOrder[0]!.horseId);
    // Live: the first frame-derived crossing, once it is clear (nobody else within 0.15 s;
    // a closer finish waits for the official result: 10 Hz frames cannot split a nose).
    let best = -1;
    let bt = Infinity;
    let second = Infinity;
    this.horses.forEach((p, i) => {
      const f = p.finish.finishT;
      if (f === null) return;
      if (f < bt) {
        second = bt;
        bt = f;
        best = i;
      } else if (f < second) second = f;
    });
    if (best < 0) return -1;
    if (second - bt < 0.15) return -1;
    return t - bt >= 0.15 || second < Infinity ? best : -1;
  }

  /** Time (s) horse h first reached x (m), by bisection on the sampler over [0, tHi]. */
  private timeAtX(h: number, xM: number, tHi: number): number {
    let lo = 0;
    let hi = tHi;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if ((this.sampler(mid, this.scratch)[h]!.x ?? 0) / 1000 >= xM) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  private decideLunge(h: number, t: number): void {
    const p = this.horses[h]!;
    p.lungeKnown = true;
    const tl = this.timeAtX(h, this.L - LUNGE_FROM_M, t);
    const s = this.sampler(tl, this.scratch);
    let front = -Infinity;
    let second = -Infinity;
    for (const r of s) {
      const x = r.x / 1000;
      if (x > front) {
        second = front;
        front = x;
      } else if (x > second) second = x;
    }
    const me = s[h]!.x / 1000;
    if (front - second <= LUNGE_WITHIN_M && front - me <= LUNGE_WITHIN_M) p.finish.lungeT = tl;
  }

  /** Every runner's state at race time t (`out` is reused). */
  stateAt(t: number, out: RunnerState[] = []): RunnerState[] {
    const tS = Math.max(0, t);
    this.samples = this.sampler(tS, this.samples);
    const n = this.horses.length;
    const pre = this.opts.preOff;
    if (pre && t < 0) {
      // Before the off: the build-up, ending exactly where each horse starts the race (its
      // lane from the first frame, or its stall before any frame has arrived).
      const haveFrames = this.src.frames.length > 0;
      out.length = n;
      for (let h = 0; h < n; h++) {
        const s = this.samples[h]!;
        const start = { x: s.x / 1000, lane: haveFrames ? s.lane : (this.src.horses[h]!.gate ?? h + 1) - 1 };
        out[h] = preOffRunner(pre, h, t, start, out[h] ?? ({} as RunnerState));
      }
      return out;
    }
    for (let h = 0; h < n; h++) {
      const p = this.horses[h]!;
      const s = this.samples[h]!;
      if (p.finish.finishT === null && s.finishTimeSec !== null) {
        const f = s.finishTimeSec;
        const before = this.sampler(Math.max(0, f - 0.05), this.scratch)[h]!;
        p.finish.finishT = f;
        p.finish.finishSpeed = Math.min(20, Math.max(6, before.speed / 1000));
        p.finish.phaseAtLine = this.racingPhase(h, f, this.L);
        this.samples = this.sampler(tS, this.samples);
      }
      if (!p.lungeKnown && t > 0 && this.samples[h]!.x / 1000 >= this.L - LUNGE_FROM_M) this.decideLunge(h, tS);
    }
    const w = this.winnerIndex(tS);
    for (let h = 0; h < n; h++) this.horses[h]!.finish.winner = h === w;
    out.length = n;
    for (let h = 0; h < n; h++) {
      const s = this.samples[h]!;
      const p = this.horses[h]!;
      const racing = p.finish.finishT === null || tS <= p.finish.finishT;
      const ph = racing ? this.racingPhase(h, tS, s.x / 1000) : 0;
      out[h] = runnerState(s, t, p.finish, ph, out[h] ?? ({} as RunnerState));
    }
    return out;
  }

  finishInfo(h: number): Readonly<FinishInfo> {
    return this.horses[h]!.finish;
  }

  /** Index of the horse whose finish we celebrate (-1 = not yet known). */
  winner(): number {
    return this.horses.findIndex((p) => p.finish.winner);
  }

  /** Last time any runner is still moving after the line (s), for the run-out length. */
  runoutEnd(): number {
    let end = 0;
    for (const p of this.horses) if (p.finish.finishT !== null) end = Math.max(end, p.finish.finishT + timeToSpeed(p.finish.finishSpeed, 0, p.finish.injured));
    return end;
  }
}

/** Horses the replay's events say were injured (none emitted by the current engine). */
export function injuredFromEvents(events: ReadonlyArray<{ type: string; horseId?: string }>): Set<string> {
  const out = new Set<string>();
  for (const e of events) if ((e.type === "injury" || e.type === "pulled_up") && e.horseId) out.add(e.horseId);
  return out;
}

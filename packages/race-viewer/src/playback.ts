/**
 * Playback clock (pure, no DOM). Owns race time; the scene and HUD only read it.
 *
 * Two ways to drive it:
 *  - live: race time follows the wall clock, `(now - startAtMs) / 1000 - lag`.
 *    `lag` grows only during the photo-finish slow-mo and freeze, so a live viewer
 *    falls a couple of seconds behind at the line and never skips anything.
 *  - local: race time advances by real dt x speed (after pause, scrub, speed change).
 *
 * Race time may run past `duration` (up to `duration + RUNOUT_SEC`) so horses can
 * pull up after the line; the HUD clamps what it shows.
 */
import { type RaceReplay } from "@thoroughbred/shared";
import { createReplaySampler, replayTiming } from "./sampleReplay";

export const PLAYBACK_RATES = [0.5, 1, 2, 4] as const;
/** Extra seconds of pull-up animation after the last horse finishes. */
export const RUNOUT_SEC = 6;
/** Pre-roll (s) before the off when playing a replay without a start time. */
export const PRE_ROLL_SEC = 1.6;
export const SLOWMO_RATE = 0.3;
export const PHOTO_FREEZE_SEC = 1.4;
/** Slow-mo starts when the leader is this close to the line (m). */
const SLOWMO_FROM_M = 14;
/** ...and ends this long after the winner's official time (s). */
const SLOWMO_AFTER_S = 0.25;

export interface PlaybackOptions {
  startAtMs?: number;
  autoplay?: boolean;
  /** Start at this race time instead (local mode). */
  initialTimeSec?: number;
}

export interface ClockFrame {
  /** Race time (s). Negative = before the off. */
  time: number;
  /** True while the photo-finish freeze holds the picture. */
  frozen: boolean;
  /** 0..1 white flash at the start of the photo freeze. */
  flash: number;
  /** True during the photo-finish slow-mo. */
  slowmo: boolean;
}

/** Race time (s) at which the leader first gets within `metres` of the line, or null. */
export function timeLeaderReaches(replay: RaceReplay, metresToGo: number): number | null {
  const timing = replayTiming(replay);
  const sample = createReplaySampler(replay);
  const goal = replay.trackLengthMm - metresToGo * 1000;
  const lead = (t: number) => sample(t).reduce((m, s) => Math.max(m, s.x), 0);
  if (lead(timing.lastFrameTime) < goal) return null;
  let lo = 0;
  let hi = timing.lastFrameTime;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (lead(mid) >= goal) hi = mid;
    else lo = mid;
  }
  return hi;
}

export class PlaybackClock {
  readonly duration: number;
  readonly winnerTime: number;
  readonly startAtMs: number | undefined;
  private slowFrom: number | null;
  private slowTo: number;
  time = 0;
  playing: boolean;
  rate = 1;
  live: boolean;
  private lag = 0;
  private freezeLeft = 0;
  private flashLeft = 0;
  /** Photo freeze already shown during this pass through the finish. */
  private photoDone = false;

  constructor(replay: RaceReplay, opts: PlaybackOptions = {}, nowMs = Date.now()) {
    const timing = replayTiming(replay);
    this.duration = timing.duration;
    this.winnerTime = timing.winnerTime;
    this.startAtMs = opts.startAtMs;
    this.slowFrom = replay.result.photoFinish ? timeLeaderReaches(replay, SLOWMO_FROM_M) : null;
    this.slowTo = this.winnerTime + SLOWMO_AFTER_S;
    this.playing = opts.autoplay ?? true;
    this.live = false;
    if (opts.initialTimeSec !== undefined) {
      this.time = opts.initialTimeSec;
      this.photoDone = this.time > this.winnerTime;
    } else if (opts.startAtMs !== undefined) {
      const wall = (nowMs - opts.startAtMs) / 1000;
      if (wall >= this.duration) {
        // Already over: open on the result, settled, with replay controls.
        this.time = this.duration + RUNOUT_SEC;
        this.playing = false;
        this.photoDone = true;
      } else {
        this.live = this.playing;
        this.time = wall;
        this.photoDone = wall > this.winnerTime;
      }
    } else {
      this.time = this.playing ? -PRE_ROLL_SEC : 0;
    }
  }

  get ended(): boolean {
    return this.time >= this.duration;
  }

  /** Can "go live" (a start time exists and the race isn't over on the wall clock). */
  canGoLive(nowMs = Date.now()): boolean {
    return this.startAtMs !== undefined && (nowMs - this.startAtMs) / 1000 < this.duration + RUNOUT_SEC;
  }

  private inSlowmo(t: number): boolean {
    return this.slowFrom !== null && t >= this.slowFrom && t < this.slowTo;
  }

  /** Advance by `dt` real seconds. */
  tick(dt: number, nowMs = Date.now()): ClockFrame {
    dt = Math.max(0, Math.min(dt, 0.25));
    const end = this.duration + RUNOUT_SEC;
    let frozen = false;
    if (this.freezeLeft > 0 && this.playing) {
      this.freezeLeft = Math.max(0, this.freezeLeft - dt);
      if (this.live) this.lag += dt;
      frozen = true;
    } else if (this.live && this.startAtMs !== undefined) {
      const prev = this.time;
      if (this.inSlowmo(prev)) this.lag += dt * (1 - SLOWMO_RATE);
      this.time = Math.min(end, (nowMs - this.startAtMs) / 1000 - this.lag);
      this.checkPhoto(prev);
      if (this.time >= end) this.live = false;
    } else if (this.playing) {
      const prev = this.time;
      const k = this.inSlowmo(prev) ? SLOWMO_RATE : 1;
      this.time = Math.min(end, this.time + dt * this.rate * k);
      this.checkPhoto(prev);
      if (this.time >= end) this.playing = false;
    }
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    return {
      time: this.time,
      frozen: frozen || this.freezeLeft > 0,
      flash: this.flashLeft / 0.5,
      slowmo: this.inSlowmo(this.time) && (this.playing || this.live),
    };
  }

  private checkPhoto(prev: number): void {
    if (this.slowFrom === null || this.photoDone) return;
    if (prev < this.winnerTime && this.time >= this.winnerTime) {
      this.photoDone = true;
      if (this.live) this.lag += this.time - this.winnerTime;
      this.time = this.winnerTime;
      this.freezeLeft = PHOTO_FREEZE_SEC;
      this.flashLeft = 0.5;
    }
  }

  play(): void {
    if (this.time >= this.duration + RUNOUT_SEC - 1e-6 || this.ended) this.restart();
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
    this.live = false;
    this.freezeLeft = 0;
  }

  toggle(): void {
    if (this.playing || this.live) this.pause();
    else this.play();
  }

  seek(t: number): void {
    this.live = false;
    this.freezeLeft = 0;
    this.time = Math.max(0, Math.min(t, this.duration));
    this.photoDone = this.time >= this.winnerTime;
  }

  restart(): void {
    this.live = false;
    this.freezeLeft = 0;
    this.photoDone = false;
    this.time = -PRE_ROLL_SEC * 0.6;
    this.playing = true;
  }

  setRate(r: number): void {
    if (this.live) {
      this.live = false;
      this.playing = true;
    }
    this.rate = r;
  }

  goLive(nowMs = Date.now()): void {
    if (!this.canGoLive(nowMs)) return;
    this.live = true;
    this.playing = true;
    this.rate = 1;
    this.lag = 0;
    this.freezeLeft = 0;
    const wall = (nowMs - this.startAtMs!) / 1000;
    this.photoDone = wall > this.winnerTime;
    this.time = wall;
  }
}

// ---------------------------------------------------------------------------
// Live broadcast clock
// ---------------------------------------------------------------------------

/** What the live clock reads from a LiveRaceFeed (structural, for tests). */
export interface LiveClockSource {
  /** Wall-clock ms (client clock) at which frame 0 is shown. */
  broadcastStartMs: number;
  /** Highest frame index received (-1 before the off). */
  liveEdgeFrame: number;
  frameDt: number;
}

/**
 * Live playback: the playhead follows the broadcast clock, may be paused or rewound,
 * may catch up at up to 4x after a rewind, but can never pass the live edge
 * (= min(wall clock, last received frame)). No duration / result is known.
 */
export class LiveClock {
  time: number;
  playing: boolean;
  /** Following the broadcast clock at the live edge. */
  live: boolean;
  rate = 1;
  /** True while the wall clock has run ahead of the received frames (holding). */
  buffering = false;

  constructor(
    private src: LiveClockSource,
    autoplay = true,
    nowMs = Date.now(),
  ) {
    this.playing = autoplay;
    this.live = autoplay;
    this.time = autoplay ? this.edge(nowMs) : Math.min(0, this.edge(nowMs));
  }

  /** Broadcast-clock time (s); negative before the off. */
  wallTime(nowMs = Date.now()): number {
    return (nowMs - this.src.broadcastStartMs) / 1000;
  }

  /** Time of the last received frame (s); -Infinity before any frame. */
  dataEdge(): number {
    return this.src.liveEdgeFrame < 0 ? Number.NEGATIVE_INFINITY : this.src.liveEdgeFrame * this.src.frameDt;
  }

  /** Furthest the playhead may go right now. */
  edge(nowMs = Date.now()): number {
    const w = this.wallTime(nowMs);
    // Before the off the countdown runs on the wall clock alone.
    if (w < 0) return w;
    return Math.max(0, Math.min(w, this.dataEdge()));
  }

  get ended(): boolean {
    return false;
  }

  canGoLive(): boolean {
    return true;
  }

  tick(dt: number, nowMs = Date.now()): ClockFrame {
    dt = Math.max(0, Math.min(dt, 0.25));
    const edge = this.edge(nowMs);
    const wall = this.wallTime(nowMs);
    if (this.live) {
      this.time = edge;
      this.rate = 1;
    } else if (this.playing) {
      this.time = Math.min(edge, this.time + dt * this.rate);
      // Caught up: rejoin the live broadcast.
      if (this.time >= edge - 1e-6 && this.rate >= 1) {
        this.live = true;
        this.rate = 1;
      }
    } else {
      this.time = Math.min(this.time, edge);
    }
    this.buffering = this.live && wall > 0 && wall - this.dataEdge() > this.src.frameDt * 2.5;
    return { time: this.time, frozen: false, flash: 0, slowmo: false };
  }

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
    this.live = false;
  }

  toggle(): void {
    if (this.playing || this.live) this.pause();
    else this.play();
  }

  /** Rewind/scrub: only within what has already been broadcast. */
  seek(t: number, nowMs = Date.now()): void {
    const edge = this.edge(nowMs);
    this.live = false;
    this.time = Math.max(Math.min(0, edge), Math.min(t, edge));
  }

  restart(nowMs = Date.now()): void {
    this.seek(0, nowMs);
    this.playing = true;
  }

  /** Faster than 1x only to catch up after a rewind (capped at the edge in tick()). */
  setRate(r: number): void {
    if (this.live) return;
    this.rate = Math.min(4, Math.max(0.5, r));
  }

  goLive(nowMs = Date.now()): void {
    this.live = true;
    this.playing = true;
    this.rate = 1;
    this.time = this.edge(nowMs);
  }
}

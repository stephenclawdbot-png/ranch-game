/**
 * Playback clock (pure, no DOM). Owns race time; the scene and HUD only read it.
 *
 * Two ways to drive it:
 *  - live: race time follows the wall clock, `(now - startAtMs) / 1000`.
 *  - local: race time advances by real dt x speed (after pause, scrub, speed change).
 *
 * The race itself always plays at the chosen speed, through the line: the photograph and the
 * slow-motion replay are part of the finale after the line (finale/), the same for a live
 * broadcast and a replay.
 *
 * Race time may run past `duration` (to `runoutEnd`: at least RUNOUT_SEC after the last
 * finisher and POST_RACE_SEC after the winner) so horses can ease down after the line
 * (stage/motion.ts); the HUD clamps what it shows.
 */
import { type RaceReplay } from "@thoroughbred/shared";
import { createReplaySampler, replayTiming } from "./sampleReplay";

export const PLAYBACK_RATES = [0.5, 1, 2, 4] as const;
/** Extra seconds of run-out animation after the last horse finishes... */
export const RUNOUT_SEC = 8;
/** ...and after the winner (the ease-down to a walk takes ~15-20 s). */
export const POST_RACE_SEC = 22;
/** Live: how long the clock may run past the last data frame once every runner is home. */
export const LIVE_RUNOUT_SEC = POST_RACE_SEC + 8;
/** Pre-roll (s) before the off when playing a replay without a start time. */
export const PRE_ROLL_SEC = 1.6;

export interface PlaybackOptions {
  startAtMs?: number;
  autoplay?: boolean;
  /** Start at this race time instead (local mode). */
  initialTimeSec?: number;
}

export interface ClockFrame {
  /** Race time (s). Negative = before the off. */
  time: number;
  /** Hold the picture (the clocks never freeze the race now; kept for the scenes' frame input). */
  frozen: boolean;
  /** 0..1 white flash (unused by the clocks). */
  flash: number;
  /** Slow motion (the finale's replay shows its own badge). */
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
  /** Race time at which the run-out animation is over and playback stops. */
  readonly runoutEnd: number;
  readonly startAtMs: number | undefined;
  time = 0;
  playing: boolean;
  rate = 1;
  live: boolean;

  constructor(replay: RaceReplay, opts: PlaybackOptions = {}, nowMs = Date.now()) {
    const timing = replayTiming(replay);
    this.duration = timing.duration;
    this.winnerTime = timing.winnerTime;
    this.runoutEnd = Math.max(this.duration + RUNOUT_SEC, this.winnerTime + POST_RACE_SEC);
    this.startAtMs = opts.startAtMs;
    this.playing = opts.autoplay ?? true;
    this.live = false;
    if (opts.initialTimeSec !== undefined) {
      this.time = opts.initialTimeSec;
    } else if (opts.startAtMs !== undefined) {
      const wall = (nowMs - opts.startAtMs) / 1000;
      if (wall >= this.duration) {
        // Already over: open on the result, settled, with replay controls.
        this.time = this.runoutEnd;
        this.playing = false;
      } else {
        this.live = this.playing;
        this.time = wall;
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
    return this.startAtMs !== undefined && (nowMs - this.startAtMs) / 1000 < this.runoutEnd;
  }

  /** Advance by `dt` real seconds. */
  tick(dt: number, nowMs = Date.now()): ClockFrame {
    dt = Math.max(0, Math.min(dt, 0.25));
    const end = this.runoutEnd;
    if (this.live && this.startAtMs !== undefined) {
      this.time = Math.min(end, (nowMs - this.startAtMs) / 1000);
      if (this.time >= end) this.live = false;
    } else if (this.playing) {
      this.time = Math.min(end, this.time + dt * this.rate);
      if (this.time >= end) this.playing = false;
    }
    return { time: this.time, frozen: false, flash: 0, slowmo: false };
  }

  play(): void {
    if (this.time >= this.runoutEnd - 1e-6 || this.ended) this.restart();
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

  seek(t: number): void {
    this.live = false;
    this.time = Math.max(0, Math.min(t, this.duration));
  }

  restart(): void {
    this.live = false;
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
    this.time = (nowMs - this.startAtMs!) / 1000;
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
  /**
   * True once every runner is home in the frames received (the server sends no frames after
   * the last finisher). The clock then keeps running past the data edge, for the run-out
   * (stage/motion.ts extrapolates finished horses), until the final result arrives.
   */
  readonly allFinished?: boolean;
}

/**
 * Live playback: the playhead follows the broadcast clock, may be paused or rewound,
 * may catch up at up to 4x after a rewind, but can never pass the live edge
 * (= min(wall clock, last received frame)). No duration / result is known. Once every runner
 * is home in the received frames, the edge follows the wall clock on past the last frame
 * (up to LIVE_RUNOUT_SEC): finished horses ease down, nothing new is revealed, no freeze.
 */
export class LiveClock {
  time: number;
  playing: boolean;
  /** Following the broadcast clock at the live edge. */
  live: boolean;
  rate = 1;
  /** True while the wall clock has run ahead of the received frames (holding). */
  buffering = false;
  private starvedFor = 0;

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
    const data = this.dataEdge();
    if (this.src.allFinished && Number.isFinite(data)) return Math.max(0, Math.min(w, data + LIVE_RUNOUT_SEC));
    return Math.max(0, Math.min(w, data));
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
    // Only flag buffering when holding persists (polling jitter is normal).
    const starved = this.live && wall > 0 && !this.src.allFinished && wall - this.dataEdge() > 0.5;
    this.starvedFor = starved ? this.starvedFor + dt : 0;
    this.buffering = this.starvedFor > 0.6;
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

/**
 * Perf report maths, pure (no DOM): frame times -> fps numbers. The viewer's render loop
 * keeps frame times in a fixed ring buffer and only allocates here, when a report is sent.
 *
 * The report is the real-device performance baseline (visual research 2026-11-01, V-00): one
 * per mounted viewer, sent as the `race_perf` telemetry event and summarised on the admin page
 * (docs/perf-baseline.md says how to read it).
 */
import type { RenderQuality, ViewMode } from "./types";

/** Which race layout the report was measured on (V-01 phone layout, V-02 close-up finish). */
export type PerfLayout = "wide" | "phone" | "phone-closeup";

export interface PerfReport {
  /** 1000 / median frame ms, rounded. */
  fps: number;
  /** 1000 / p95 frame ms, rounded. */
  fpsLow: number;
  /** 1000 / p99 frame ms, rounded (the hitches a player feels). */
  fps99: number;
  /** The viewer's own JS work per frame (scene update + draw calls issued), median and p99, ms (1 decimal). */
  workMs: number;
  workP99: number;
  /** Share of frames (%) slower than 33.4 ms (missed the 30 fps phone budget) and 16.8 ms (the 60 fps desktop budget). */
  over33: number;
  over17: number;
  /** Final render quality at report time. */
  quality: RenderQuality;
  /** Auto-downgrade fired during this mount. */
  downgraded: boolean;
  /** Seconds of playback when the auto-downgrade fired (-1: it never did). */
  downgradeSec: number;
  view: ViewMode;
  layout: PerfLayout;
  /** Number of frame times the fps numbers were computed from. */
  frames: number;
}

export interface PerfExtras {
  /** JS work per frame (ms), the same ring buffer convention as the frame times. */
  work?: ArrayLike<number>;
  downgradeSec?: number;
  layout?: PerfLayout;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Sorted copy + percentile; called once per mounted viewer, never per frame. */
export function perfReport(frameTimes: ArrayLike<number>, quality: RenderQuality, downgraded: boolean, view: ViewMode, extras: PerfExtras = {}): PerfReport {
  const n = frameTimes.length;
  const sorted = Array.from(frameTimes).sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * (n - 1)))] ?? 0;
  // Even counts average the two middle samples (the plain median).
  const median = n === 0 ? 0 : n % 2 ? at(0.5) : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const p95 = at(0.95);
  const p99 = at(0.99);
  const fps = (ms: number) => (ms > 0 ? Math.round(1000 / ms) : 0);
  const share = (ms: number) => (n ? round1((100 * sorted.filter((v) => v > ms).length) / n) : 0);
  const work = Array.from(extras.work ?? []).sort((a, b) => a - b);
  const wAt = (q: number) => work[Math.min(work.length - 1, Math.floor(q * (work.length - 1)))] ?? 0;
  return {
    fps: fps(median),
    fpsLow: fps(p95),
    fps99: fps(p99),
    workMs: round1(wAt(0.5)),
    workP99: round1(wAt(0.99)),
    over33: share(33.4),
    over17: share(16.8),
    quality,
    downgraded,
    downgradeSec: downgraded && extras.downgradeSec !== undefined ? Math.round(extras.downgradeSec) : -1,
    view,
    layout: extras.layout ?? "wide",
    frames: n,
  };
}

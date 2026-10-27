/**
 * Perf report maths, pure (no DOM): frame times -> fps numbers. The viewer's render loop
 * keeps frame times in a fixed ring buffer and only allocates here, when a report is sent.
 */
import type { RenderQuality, ViewMode } from "./types";

export interface PerfReport {
  /** 1000 / median frame ms, rounded. */
  fps: number;
  /** 1000 / p95 frame ms, rounded. */
  fpsLow: number;
  /** Final render quality at report time. */
  quality: RenderQuality;
  /** Auto-downgrade fired during this mount. */
  downgraded: boolean;
  view: ViewMode;
  /** Number of frame times the fps numbers were computed from. */
  frames: number;
}

/** Sorted copy + percentile; called once per mounted viewer, never per frame. */
export function perfReport(frameTimes: ArrayLike<number>, quality: RenderQuality, downgraded: boolean, view: ViewMode): PerfReport {
  const n = frameTimes.length;
  const sorted = Array.from(frameTimes).sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * (n - 1)))] ?? 0;
  // Even counts average the two middle samples (the plain median).
  const median = n === 0 ? 0 : n % 2 ? at(0.5) : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const p95 = at(0.95);
  const fps = (ms: number) => (ms > 0 ? Math.round(1000 / ms) : 0);
  return { fps: fps(median), fpsLow: fps(p95), quality, downgraded, view, frames: n };
}
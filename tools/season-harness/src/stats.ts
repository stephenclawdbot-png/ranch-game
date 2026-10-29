/** Small numeric helpers for the metrics and the report (no dependencies). */

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: readonly number[]): number {
  return xs.length ? sum(xs) / xs.length : 0;
}

/** Nearest-rank percentile (p in 0..100) of an unsorted list; 0 for an empty list. */
export function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[rank]!;
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface Dist {
  n: number;
  median: number;
  p90: number;
  max: number;
  mean: number;
}

export function dist(xs: readonly number[]): Dist {
  return { n: xs.length, median: round1(median(xs)), p90: percentile(xs, 90), max: xs.length ? Math.max(...xs) : 0, mean: round1(mean(xs)) };
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Share as a percentage with one decimal (0 when the denominator is 0). */
export function pct(n: number, d: number): number {
  return d > 0 ? round1((100 * n) / d) : 0;
}

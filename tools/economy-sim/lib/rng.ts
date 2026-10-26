/**
 * Fast seeded PRNG for Monte Carlo runs (sfc32 seeded from a string hash).
 * The game itself uses sha256-seeded xoshiro (game-core rng.ts); that is too slow for
 * millions of draws, and the sim does not need to reproduce game seeds, only to be
 * reproducible itself: the same seed string always gives the same tables.
 */
export class SimRng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  constructor(seed: string) {
    // xmur3 string hash -> 4 x 32-bit state
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    const next = () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i++) this.float();
  }

  /** Uniform [0, 1). */
  float(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  /** Standard normal (Box-Muller, cached pair). */
  normal(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = this.float();
    const v = this.float();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.float();
    } while (p > L);
    return k - 1;
  }

  binomial(n: number, p: number): number {
    let k = 0;
    for (let i = 0; i < n; i++) if (this.float() < p) k++;
    return k;
  }

  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)]!;
  }
}

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) * (v - m), 0) / (xs.length - 1));
}

export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i]!;
}

/** Pearson correlation. */
export function corr(xs: readonly number[], ys: readonly number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Spearman rank correlation. */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  const rank = (v: readonly number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  return corr(rank(xs), rank(ys));
}

export function gini(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const total = s.reduce((a, b) => a + b, 0);
  if (!n || total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * s[i]!;
  return (2 * cum) / (n * total) - (n + 1) / n;
}

/** R^2 of an OLS fit of y on the given regressor columns (an intercept is added). */
export function rSquared(y: readonly number[], cols: readonly (readonly number[])[]): number {
  const n = y.length;
  const k = cols.length + 1;
  const X = (i: number, j: number) => (j === 0 ? 1 : cols[j - 1]![i]!);
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) A[a]![b]! += X(i, a) * X(i, b);
      A[a]![k]! += X(i, a) * y[i]!;
    }
  }
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const d = A[c]![c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let j = c; j <= k; j++) A[c]![j]! /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      for (let j = c; j <= k; j++) A[r]![j]! -= f * A[c]![j]!;
    }
  }
  const beta = A.map((row) => row[k]!);
  const my = mean(y);
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (let j = 0; j < k; j++) f += beta[j]! * X(i, j);
    ssr += (y[i]! - f) * (y[i]! - f);
    sst += (y[i]! - my) * (y[i]! - my);
  }
  return sst > 0 ? 1 - ssr / sst : 0;
}

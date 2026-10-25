/**
 * Small, dependency-free deterministic PRNG for demo data and race scheduling.
 * (The race simulation itself uses the engine's own seeded RNG — this one only
 * decides *who* runs and *what* the card looks like.)
 *
 * cyrb128 string hash -> sfc32 generator. Pure 32-bit integer maths, so results
 * are identical on every JS runtime.
 */

export function hashString(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export interface Rng {
  /** Uniform 32-bit unsigned integer. */
  u32(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Float in [0, 1). Only for non-critical cosmetic choices. */
  float(): number;
  pick<T>(items: readonly T[]): T;
  /** Weighted pick; weights are non-negative integers. */
  weighted<T>(items: readonly (readonly [T, number])[]): T;
  chance(numerator: number, denominator: number): boolean;
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: string): Rng {
  let [a, b, c, d] = hashString(seed);
  const u32 = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  // Warm up so similar seeds diverge.
  for (let i = 0; i < 12; i++) u32();

  const int = (min: number, max: number): number => {
    if (max < min) throw new Error(`bad range ${min}..${max}`);
    const span = max - min + 1;
    return min + (u32() % span);
  };
  const rng: Rng = {
    u32,
    int,
    float: () => u32() / 4294967296,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick from empty list");
      return items[int(0, items.length - 1)]!;
    },
    weighted: (items) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let roll = int(0, total - 1);
      for (const [item, w] of items) {
        if (roll < w) return item;
        roll -= w;
      }
      return items[items.length - 1]![0];
    },
    chance: (n, dnm) => int(0, dnm - 1) < n,
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
  return rng;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

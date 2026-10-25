/**
 * xoshiro128** — 32-bit integer PRNG implemented with Math.imul and bit ops only,
 * so it produces identical sequences in every JS engine.
 */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(bytes: Uint8Array) {
    const w = (o: number) => (((bytes[o] ?? 0) | ((bytes[o + 1] ?? 0) << 8) | ((bytes[o + 2] ?? 0) << 16) | ((bytes[o + 3] ?? 0) << 24)) >>> 0);
    this.s0 = w(0);
    this.s1 = w(4);
    this.s2 = w(8);
    this.s3 = w(12);
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 0x9e3779b9;
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    const s1 = this.s1;
    const r = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return r;
  }

  /** Uniform integer in [0, n). n must be in [1, 2^20]. */
  int(n: number): number {
    return Math.floor((this.nextU32() * n) / 4294967296);
  }

  /** Uniform integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  /** True with probability permille/1000. */
  chance(permille: number): boolean {
    return this.int(1000) < permille;
  }

  /** Triangular integer in [-amp, amp] (sum of two uniforms), mean 0. */
  tri(amp: number): number {
    if (amp <= 0) return 0;
    return this.range(0, amp) + this.range(0, amp) - amp;
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

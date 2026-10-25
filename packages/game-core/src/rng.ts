/**
 * Deterministic randomness. Seeds are strings or 64-hex values; everything is derived with
 * sha256 / HMAC-SHA256 (@noble/hashes) and drawn from xoshiro128** built with Math.imul only,
 * so the same seed gives the same numbers in Node and every browser.
 *
 * No Math.random, no Date, no transcendental functions (only + - * / floor sqrt).
 */
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

const SEED_RE = /^[0-9a-f]{64}$/;

export function isSeedHex(s: string): boolean {
  return typeof s === "string" && SEED_RE.test(s);
}

/** sha256 over the 32 raw seed bytes (identical to racing-engine `commitSeed`). Publish before reveal. */
export function commitSeed(seedHex: string): string {
  if (!isSeedHex(seedHex)) throw new Error("seed must be 64 lowercase hex characters");
  return bytesToHex(sha256(hexToBytes(seedHex)));
}

/** HMAC-SHA256(secret, label) hex (identical to racing-engine `deriveSeed`). */
export function deriveSeed(secret: string, label: string): string {
  if (typeof secret !== "string" || secret.length === 0) throw new Error("deriveSeed: secret must be a non-empty string");
  return bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(label)));
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/** Combine parts into a 64-hex seed: sha256(JSON.stringify(["tb-gc", ...parts])). */
export function seedFrom(...parts: (string | number | boolean | null)[]): string {
  return sha256Hex(JSON.stringify(["tb-gc", ...parts]));
}

/** FNV-1a 32-bit over a string. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SQRT3 = 1.7320508075688772;

/** xoshiro128** PRNG. */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  /** `seed` is a 64-hex seed or any string (hashed). */
  constructor(seed: string) {
    const bytes = isSeedHex(seed) ? sha256(hexToBytes(seed)) : sha256(utf8ToBytes(seed));
    const w = (o: number) => ((bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! << 24)) >>> 0);
    this.s0 = w(0);
    this.s1 = w(4);
    this.s2 = w(8);
    this.s3 = w(12);
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 0x9e3779b9;
  }

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

  /** Uniform float in [0, 1). */
  float(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** Uniform integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  /** True with probability permille / 1000. */
  chance(permille: number): boolean {
    return this.int(1000) < permille;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick from empty list");
    return items[this.int(items.length)]!;
  }

  /** Approximately standard normal (Irwin–Hall of 4 uniforms, bounded to ±3.46). */
  normal(): number {
    const s = this.float() + this.float() + this.float() + this.float();
    return (s - 2) * SQRT3;
  }

  /** Weighted index: weights are non-negative integers. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) throw new Error("weighted: total weight must be positive");
    let r = this.int(total);
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Rounded and clamped; never returns -0 (keeps values JSON round-trip exact). */
export const clampInt = (v: number, lo: number, hi: number): number => clamp(Math.round(v), lo, hi) + 0;

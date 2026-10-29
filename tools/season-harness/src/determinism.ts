/**
 * Reproducible runs. The game draws its secret randomness from Node's CSPRNG: race seeds
 * (packages/db crypto.ts newSeed), starter and pregnancy seeds, device tokens, Story race
 * conditions (game.ts `rand`), and Postgres `gen_random_uuid()` inside PGlite. The harness
 * swaps every one of those sources for a single seeded xoshiro stream (game-core Rng) before
 * any game code runs, so the same HARNESS_SEED replays the same season.
 *
 * Nothing in the game changes: `node:crypto`'s exports are patched on the module object and
 * re-synced to ESM importers with `syncBuiltinESMExports()`, and `globalThis.crypto`'s
 * `getRandomValues` (Web Crypto, which PGlite's WASM runtime and game.ts use) is replaced.
 * This only ever happens inside the harness process; never import this from game code.
 */
import nodeCrypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { Rng, seedFrom } from "@thoroughbred/game-core";

let installed: string | null = null;

/** Fills `bytes` from the stream. */
function fill(rng: Rng, bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i += 4) {
    const v = rng.nextU32();
    for (let k = 0; k < 4 && i + k < bytes.length; k++) bytes[i + k] = (v >>> (8 * k)) & 0xff;
  }
}

function asBytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/**
 * Replaces the process's random sources with one seeded stream. Idempotent per seed; a second
 * call with another seed throws (one season per process).
 */
export function installDeterministicRandom(seed: string): void {
  if (installed === seed) return;
  if (installed !== null) throw new Error(`deterministic random already installed with seed ${installed}`);
  installed = seed;
  const rng = new Rng(seedFrom("season-harness", "crypto", seed));
  const c = nodeCrypto as unknown as Record<string, unknown>;

  c.randomBytes = (size: number, cb?: (err: Error | null, buf: Buffer) => void) => {
    const buf = Buffer.alloc(size);
    fill(rng, buf);
    if (cb) {
      queueMicrotask(() => cb(null, buf));
      return undefined;
    }
    return buf;
  };
  c.randomFillSync = <T extends ArrayBufferView>(view: T, offset = 0, size?: number): T => {
    const bytes = asBytes(view);
    fill(rng, bytes.subarray(offset, size === undefined ? undefined : offset + size));
    return view;
  };
  c.randomUUID = () => {
    const b = new Uint8Array(16);
    fill(rng, b);
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Buffer.from(b).toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  c.randomInt = (a: number, b?: number) => {
    const [lo, hi] = b === undefined ? [0, a] : [a, b];
    return lo + Math.floor(rng.float() * (hi - lo));
  };
  const getRandomValues = <T extends ArrayBufferView | null>(view: T): T => {
    if (view) fill(rng, asBytes(view));
    return view;
  };
  const web = nodeCrypto.webcrypto as unknown as { getRandomValues: unknown };
  web.getRandomValues = getRandomValues;
  if (globalThis.crypto && globalThis.crypto !== (web as unknown)) {
    Object.defineProperty(globalThis.crypto, "getRandomValues", { value: getRandomValues, configurable: true, writable: true });
  }
  syncBuiltinESMExports();
  // Anything that still reaches for Math.random gets the same stream.
  Math.random = () => rng.float();
}

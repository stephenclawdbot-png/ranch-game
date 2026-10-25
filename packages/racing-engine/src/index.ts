/**
 * @thoroughbred/racing-engine — deterministic, integer-only race simulation.
 *
 * Pure functions only: no Date, no Math.random, no Node or DOM APIs.
 */
import { RaceInputSchema, type RaceInput, type RaceReplay } from "@thoroughbred/shared";
import { commitSeed, deriveSeed } from "./hash";
import { ENGINE_VERSION, canonicalResult, runRace } from "./simulate";
import { sha256Hex } from "./hash";

export { ENGINE_VERSION, commitSeed, deriveSeed };
export { marginLabel, splitPurse, PRIZE_SPLIT_PCT } from "./results";
export { TICK_HZ, SAMPLE_EVERY } from "./model";

/**
 * Simulate a race. Same input (in any entry order) always yields the same replay.
 * Throws on schema-invalid input, duplicate gates or duplicate horse ids.
 */
export function simulateRace(input: RaceInput): RaceReplay {
  const parsed = RaceInputSchema.parse(input);
  return runRace(parsed);
}

/**
 * Re-simulate `input` and check the replay: same engine version, seed, commitment,
 * result (order, times, margins, prizes, hash), total ticks and frames.
 */
export function verifyReplay(input: RaceInput, replay: RaceReplay): boolean {
  try {
    if (replay.engineVersion !== ENGINE_VERSION) return false;
    if (replay.seed !== input.seed) return false;
    if (replay.seedCommitment !== commitSeed(input.seed)) return false;
    // The replay's own claims must hash to its resultHash.
    if (sha256Hex(canonicalResult(replay.seed, replay.result.finishOrder)) !== replay.result.resultHash) return false;
    const fresh = simulateRace(input);
    if (fresh.result.resultHash !== replay.result.resultHash) return false;
    if (JSON.stringify(fresh.result) !== JSON.stringify(replay.result)) return false;
    if (fresh.totalTicks !== replay.totalTicks) return false;
    if (fresh.frames.length !== replay.frames.length) return false;
    for (let f = 0; f < fresh.frames.length; f++) {
      const a = fresh.frames[f]!;
      const b = replay.frames[f];
      if (!b || a.length !== b.length) return false;
      for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

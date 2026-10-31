/**
 * @thoroughbred/racing-engine — deterministic, integer-only race simulation.
 *
 * Pure functions only: no Date, no Math.random, no Node or DOM APIs.
 */
import { RaceInputSchema, type RaceInput, type RaceReplay } from "@thoroughbred/shared";
import { commitSeed, deriveSeed, mixSeedEntropy } from "./hash";
import { COURSE_ENGINE_VERSION, ENGINE_VERSION, KIT_ENGINE_VERSION, LEGACY_ENGINE_VERSION, canonicalResult, engineVersionFor, runRace } from "./simulate";
import { sha256Hex } from "./hash";

export { ENGINE_VERSION, COURSE_ENGINE_VERSION, KIT_ENGINE_VERSION, LEGACY_ENGINE_VERSION, engineVersionFor, commitSeed, deriveSeed, mixSeedEntropy };
export { BATTLE_AHEAD_MM, BATTLE_BASE, BATTLE_BEHIND_MM, BATTLE_FROM_MM, BATTLE_GRIT, BATTLE_TEMPER, PACK_CARRY, PACK_PULL, battleResponse, jockeyBattle, packCarried, packPull } from "./simulate";
export { DRAMA_FORM_PERMILLE } from "./model";
export {
  BEND_LANE_LOSS_MM,
  GRADIENT_DRAIN,
  BEND_PASS_CUT,
  STRAIGHT_EASE_MAX,
  STRAIGHT_EASE_PER_100M,
  STRAIGHT_REF_M,
  bendGeometry,
  courseLayout,
  type Bend,
  type CourseLayout,
} from "./course";
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
 * Re-simulate `input` and check the replay: the engine version its entries run under, seed, commitment,
 * result (order, times, margins, prizes, hash), total ticks and frames.
 */
export function verifyReplay(input: RaceInput, replay: RaceReplay): boolean {
  try {
    // Races without kit, course or model run (and hash) as before: older replays stay verifiable.
    const course = input.course ?? null;
    if (replay.engineVersion !== engineVersionFor(input.entries, course, input.model)) return false;
    if (replay.seed !== input.seed) return false;
    if (replay.seedCommitment !== commitSeed(input.seed)) return false;
    // The replay's own claims must hash to its resultHash.
    // A 1.3.0 result also seals the course profile: a swapped course fails here.
    if (sha256Hex(canonicalResult(replay.seed, replay.result.finishOrder, replay.engineVersion, course)) !== replay.result.resultHash) return false;
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

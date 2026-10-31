/**
 * The three radio casters (Kokoro voices, British English) and the per-race pick: one caster
 * calls a whole race, chosen from the race id alone, so every viewer of the race hears the
 * same voice (live, replay, quick races and story races alike).
 */
import { hash32 } from "../phrases";

export interface Caster {
  /** The voice id (clip folders, name clips). */
  id: string;
  /** How the caster is introduced in the UI. */
  name: string;
}

export const CASTERS: readonly Caster[] = [
  { id: "bm_george", name: "George" },
  { id: "bm_lewis", name: "Lewis" },
  { id: "bm_daniel", name: "Daniel" },
];

export const CASTER_IDS: readonly string[] = CASTERS.map((c) => c.id);

/** The caster for a race (or a quick race): deterministic from its id. */
export function pickCaster(raceId: string): Caster {
  return CASTERS[hash32(`caster|${raceId}`) % CASTERS.length]!;
}

/**
 * Race-day extras on the entry sheet: shared by the server (entryOptions) and the client
 * (the Extras step) so both name a combination the same way.
 */
import { RACE_EXTRA_KEYS, type RaceExtraKey } from "@thoroughbred/game-core";
import type { RideIntensity } from "./types";

/** Key of the injury risk for a ride and a set of extras ("normal|physio+vet_check"). */
export function raceDayRiskKey(intensity: RideIntensity, extras: readonly RaceExtraKey[]): string {
  return `${intensity}|${RACE_EXTRA_KEYS.filter((k) => extras.includes(k)).join("+")}`;
}

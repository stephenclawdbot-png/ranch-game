/**
 * "What if" mode: the viewer playing a counterfactual re-run of a settled race (same seed, one
 * change to one runner). It is never a result, so nothing official is staged: no finale
 * (photograph, weighed in, the placed horses' cards), no results card, and the race call drops
 * the photograph and the judge's result readout. A "WHAT IF" badge stays on the stage throughout.
 */
import type { CallLine } from "./call/buildRaceCall";

/** The badge text on the stage (both views). */
export const WHAT_IF_BADGE = "What if · not official";

/** Call kinds that only belong to an official result. */
const OFFICIAL_CALLS: ReadonlySet<CallLine["kind"]> = new Set(["photo", "result"]);

/** The finale and results card as a what-if allows them (both off in what-if mode). */
export function whatIfFlags(whatIf: boolean, wanted: { finale: boolean; resultsCard: boolean }): { finale: boolean; resultsCard: boolean } {
  return whatIf ? { finale: false, resultsCard: false } : wanted;
}

/** The race call without the photograph and the result readout (what-if mode). */
export function whatIfCall(lines: readonly CallLine[]): CallLine[] {
  return lines.filter((l) => !OFFICIAL_CALLS.has(l.kind));
}

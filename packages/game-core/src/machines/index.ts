/**
 * The registry of server / persisted state machines (docs/state-machines.md). Every lifecycle
 * stored in a status / stage / outcome column is declared once here with `defineMachine`; db
 * services check each move against it (packages/db/src/machines.ts `checkMove`), tests prove the
 * database enums and CHECK constraints hold exactly these states, and the diagrams in the doc are
 * generated from this file (BAKE_MACHINES=1, machines.test.ts).
 */
import type { Machine } from "@thoroughbred/shared";
import { horseCareerMachine, horseStageMachine, pregnancyMachine } from "./horse";
import { jockeyContractMachine, jockeyOfferMachine, jockeyStageMachine } from "./jockeys";
import { leaseMachine, listingMachine, usdgBidMachine, usdgListingMachine, usdgOrderMachine } from "./market";
import { betaRewardMachine, chainOrderMachine, feedbackMachine, poolEpochMachine, pushDeliveryMachine, seasonMachine } from "./ops";
import { raceCardPhaseMachine, raceClaimMachine, raceEntryMachine, raceMachine } from "./race";
import { racePickMachine, realToteRaceMachine, toteBetMachine } from "./wagers";

export * from "./horse";
export * from "./jockeys";
export * from "./market";
export * from "./ops";
export * from "./race";
export * from "./wagers";

/** Every server / persisted machine, keyed by its name (reading order of the doc). */
export const SERVER_MACHINES = {
  race: raceMachine,
  raceEntry: raceEntryMachine,
  raceClaim: raceClaimMachine,
  raceCardPhase: raceCardPhaseMachine,
  horseCareer: horseCareerMachine,
  horseStage: horseStageMachine,
  pregnancy: pregnancyMachine,
  listing: listingMachine,
  lease: leaseMachine,
  usdgListing: usdgListingMachine,
  usdgBid: usdgBidMachine,
  usdgOrder: usdgOrderMachine,
  jockeyStage: jockeyStageMachine,
  jockeyContract: jockeyContractMachine,
  jockeyOffer: jockeyOfferMachine,
  toteBet: toteBetMachine,
  racePick: racePickMachine,
  realToteRace: realToteRaceMachine,
  chainOrder: chainOrderMachine,
  poolEpoch: poolEpochMachine,
  betaReward: betaRewardMachine,
  feedback: feedbackMachine,
  pushDelivery: pushDeliveryMachine,
  season: seasonMachine,
} as const;

export type ServerMachineName = keyof typeof SERVER_MACHINES;

/**
 * The generated part of docs/state-machines.md: per machine, where it lives, its states (with the
 * one-line description) and a Mermaid diagram. Deterministic: same registry, same text.
 */
export function machinesMarkdown(machines: readonly Machine<string>[]): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const out: string[] = [];
  for (const m of machines) {
    out.push(`### ${m.name}`, "", `Stored in: ${m.storedIn ?? "not stored"}.`, "", "| State | Kind | Meaning |", "|---|---|---|");
    for (const s of m.states) {
      const kind = [m.initialStates.includes(s) ? "initial" : "", m.isTerminal(s) ? "terminal" : ""].filter(Boolean).join(", ") || "-";
      const moves = m.next(s);
      const meaning = `${m.describe?.[s] ?? ""}${moves.length ? ` Next: ${moves.join(", ")}.` : ""}`.trim();
      out.push(`| \`${s}\` | ${kind} | ${cell(meaning)} |`);
    }
    out.push("", "```mermaid", m.toMermaid(), "```", "");
  }
  return out.join("\n");
}

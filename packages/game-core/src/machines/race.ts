/**
 * Race lifecycles (docs/state-machines.md): the race row, its entries, the claims lodged on its
 * runners, and the phase a race card shows (derived from the clock, never stored).
 */
import { defineMachine, type StateOf } from "@thoroughbred/shared";

/** races.status (pgEnum race_status). Written by db services/races.ts only. */
export const raceMachine = defineMachine({
  name: "race",
  storedIn: "races.status (pgEnum race_status)",
  states: ["open", "locked", "settled", "cancelled"],
  initial: "open",
  terminal: ["settled", "cancelled"],
  transitions: {
    open: ["locked", "cancelled"],
    locked: ["settled", "cancelled"],
  },
  describe: {
    open: "Taking entries until entriesCloseAt; no field yet.",
    locked: "Field frozen at the lock (gates drawn, house horses filled, fieldHash published); waiting to run.",
    settled: "Simulated, purses paid, seed revealed (the result is public once the broadcast is over).",
    cancelled: "Called off (no player runner) or abandoned; entries, fees, claims and bets refunded.",
  },
});
export type RaceStatus = StateOf<typeof raceMachine>;

/** race_entries.status (pgEnum entry_status). A scratched horse can never re-enter the same race. */
export const raceEntryMachine = defineMachine({
  name: "raceEntry",
  storedIn: "race_entries.status (pgEnum entry_status)",
  states: ["entered", "scratched"],
  initial: "entered",
  terminal: ["scratched"],
  transitions: { entered: ["scratched"] },
  describe: {
    entered: "In the race (a player entry holds a stable entry and race-locks the horse).",
    scratched: "Withdrawn before the lock (or a mare found in foal at the lock); everything refunded.",
  },
});
export type RaceEntryStatus = StateOf<typeof raceEntryMachine>;

/**
 * race_claims.status (text + CHECK race_claims_status). services/claiming.ts: lodged until the
 * lock, the seeded draw picks one claim per horse, the race settles the drawn claim.
 */
export const raceClaimMachine = defineMachine({
  name: "raceClaim",
  storedIn: "race_claims.status (text, CHECK race_claims_status)",
  states: ["lodged", "drawn", "lost", "claimed", "void", "refunded"],
  initial: "lodged",
  terminal: ["lost", "claimed", "void", "refunded"],
  transitions: {
    lodged: ["drawn", "lost", "refunded"],
    drawn: ["claimed", "void", "refunded"],
  },
  describe: {
    lodged: "Price held in escrow; waiting for the lock.",
    drawn: "Won the claiming draw at the lock; the horse moves when the race settles.",
    lost: "Lost the draw to another claim on the same horse; refunded.",
    claimed: "Settled: the horse moved to the claimant, the old owner was paid (less the fee).",
    void: "Drawn but could not complete (fatal injury, no free stall, horse gone); refunded.",
    refunded: "The horse was scratched or the race called off or abandoned; refunded.",
  },
});
export type RaceClaimStatus = StateOf<typeof raceClaimMachine>;

/**
 * The phase a race card shows (RaceCard.status in the web app). Derived from the clock on every
 * read (raceCardPhaseAt), never stored: it only ever moves forward as time passes, and a reader who
 * looks rarely can skip phases (open straight to live, or to finished).
 */
export const raceCardPhaseMachine = defineMachine({
  name: "raceCardPhase",
  storedIn: "derived (game-core raceCardPhaseAt, used by apps/web server/game.ts)",
  states: ["open", "closed", "live", "finished"],
  initial: "open",
  terminal: ["finished"],
  transitions: {
    open: ["closed", "live", "finished"],
    closed: ["live", "finished"],
    live: ["finished"],
  },
  describe: {
    open: "Before entriesCloseAt and no field locked: entries open.",
    closed: "Entries closed or field locked, before post time: waiting for the off.",
    live: "From post time until the finish has been broadcast (no result may leak).",
    finished: "The finish has been broadcast: the result can be revealed.",
  },
});
export type RaceCardPhase = StateOf<typeof raceCardPhaseMachine>;

/** The race card phase at `nowMs` (pure; the broadcast-over test is the caller's, from live.ts). */
export function raceCardPhaseAt(input: { nowMs: number; postTimeMs: number; entriesCloseAtMs: number; fieldLocked: boolean; broadcastOver: boolean }): RaceCardPhase {
  if (input.nowMs < input.postTimeMs) return input.fieldLocked || input.nowMs >= input.entriesCloseAtMs ? "closed" : "open";
  return input.broadcastOver ? "finished" : "live";
}

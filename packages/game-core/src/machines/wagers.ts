/** Picks and pools (docs/state-machines.md): free picks, the play-money tote, the real-money pool mirror. */
import { defineMachine, type StateOf } from "@thoroughbred/shared";

/** tote_bets.status (pgEnum tote_bet_status). services/tote.ts; every settle is `WHERE status = 'open'`. */
export const toteBetMachine = defineMachine({
  name: "toteBet",
  storedIn: "tote_bets.status (pgEnum tote_bet_status)",
  states: ["open", "won", "lost", "returned", "void"],
  initial: "open",
  terminal: ["won", "lost", "returned", "void"],
  transitions: { open: ["won", "lost", "returned", "void"] },
  describe: {
    open: "Stake held in escrow until the race settles.",
    won: "Settled: the horse won (or placed) and the pool paid out.",
    lost: "Settled: the selection did not win (or place).",
    returned: "Settled with no winner in the pool: the stake came back.",
    void: "Refunded: the horse was scratched, the race abandoned, or the pool voided (void_reason).",
  },
});
export type ToteBetStatus = StateOf<typeof toteBetMachine>;

/** race_picks.outcome (text + CHECK race_picks_outcome). services/picks.ts scores each pick once. */
export const racePickMachine = defineMachine({
  name: "racePick",
  storedIn: "race_picks.outcome (text, CHECK race_picks_outcome)",
  states: ["open", "won", "lost", "void"],
  initial: "open",
  terminal: ["won", "lost", "void"],
  transitions: { open: ["won", "lost", "void"] },
  describe: {
    open: "Picked; waiting for the result to be public.",
    won: "The pick won: points scored.",
    lost: "The pick did not win.",
    void: "The race was called off or the pick did not run.",
  },
});
export type RacePickOutcome = StateOf<typeof racePickMachine>;

/**
 * real_tote_races.status (text + CHECK real_tote_races_status): a mirror of the TotePools contract
 * (services/realTote.ts records chain events in order) plus the server's own "abandoned" (the race
 * had to run on its server seed, so the market must be voided and refunded on chain).
 */
export const realToteRaceMachine = defineMachine({
  name: "realToteRace",
  storedIn: "real_tote_races.status (text, CHECK real_tote_races_status)",
  states: ["pending", "open", "entropy_locked", "sealed", "abandoned", "result_posted", "finalized", "void"],
  initial: "pending",
  terminal: ["finalized", "void"],
  transitions: {
    pending: ["open", "abandoned", "void"],
    open: ["entropy_locked", "abandoned", "void"],
    entropy_locked: ["sealed", "abandoned", "void"],
    sealed: ["result_posted", "abandoned", "void"],
    result_posted: ["finalized", "abandoned", "void"],
    abandoned: ["void"],
  },
  describe: {
    pending: "Flagged for a real-money pool; the market is not created on chain yet.",
    open: "MarketCreated: bets accepted until the market closes.",
    entropy_locked: "EntropyLocked: betting closed, the entropy block chosen.",
    sealed: "EntropySealed: the entropy is known; the race runs on the final seed.",
    abandoned: "The race ran on its server seed: the market must be voided (refunds).",
    result_posted: "ResultPosted: in the challenge window (attest or correct).",
    finalized: "MarketFinalized: winners can claim.",
    void: "MarketVoided (or never opened): stakes refundable.",
  },
});
export type RealToteRaceStatus = StateOf<typeof realToteRaceMachine>;

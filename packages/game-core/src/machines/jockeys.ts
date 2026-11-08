/** Jockey lifecycles (docs/state-machines.md, docs/design/jockeys.md). */
import { defineMachine, type StateOf } from "@thoroughbred/shared";

/**
 * jockeys.stage (text, no CHECK): jockeyStageAt(bornAt, now), refreshed by the jockey maintenance.
 * Time only moves forward, so the stage does too; a late maintenance run can skip prime. Retirement
 * is separate (retirement_announced_at, retired_at).
 */
export const jockeyStageMachine = defineMachine({
  name: "jockeyStage",
  storedIn: "jockeys.stage (text), from jockeyStageAt(bornAt, now)",
  states: ["apprentice", "prime", "veteran"],
  initial: ["apprentice", "prime", "veteran"],
  terminal: ["veteran"],
  transitions: {
    apprentice: ["prime", "veteran"],
    prime: ["veteran"],
  },
  describe: {
    apprentice: "Early career: claims weight off handicap marks.",
    prime: "The middle of the riding career.",
    veteran: "Late career; retirement is announced, then happens, from here.",
  },
});
export type JockeyStageState = StateOf<typeof jockeyStageMachine>;

/** jockey_contracts.status (text + CHECK jockey_contracts_status; one active contract per jockey). */
export const jockeyContractMachine = defineMachine({
  name: "jockeyContract",
  storedIn: "jockey_contracts.status (text, CHECK jockey_contracts_status)",
  states: ["active", "ended"],
  initial: "active",
  terminal: ["ended"],
  transitions: { active: ["ended"] },
  describe: {
    active: "The jockey rides for the stable; wages are paid weekly.",
    ended: "Ended at a transfer window, by a buyout, or by retirement (ended_why).",
  },
});
export type JockeyContractStatus = StateOf<typeof jockeyContractMachine>;

/**
 * jockey_offers.status (text + CHECK jockey_offers_status). One row per (week, jockey, stable): a
 * withdrawn offer is reopened in place when the stable offers again in the same window.
 */
export const jockeyOfferMachine = defineMachine({
  name: "jockeyOffer",
  storedIn: "jockey_offers.status (text, CHECK jockey_offers_status)",
  states: ["open", "won", "lost", "withdrawn"],
  initial: "open",
  terminal: ["won", "lost"],
  transitions: {
    open: ["won", "lost", "withdrawn"],
    withdrawn: ["open"],
  },
  describe: {
    open: "Waiting for the window to run; the signing fee is in escrow.",
    won: "The jockey chose this offer at the window: the contract started, the fee burned.",
    lost: "The jockey chose elsewhere (or nobody); the fee came back.",
    withdrawn: "Taken back before the window; the fee came back (can be offered again this week).",
  },
});
export type JockeyOfferStatus = StateOf<typeof jockeyOfferMachine>;

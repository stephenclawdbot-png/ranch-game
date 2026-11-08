/**
 * Operations lifecycles (docs/state-machines.md): seasons, ETH checkout orders, prize-pool epochs,
 * beta rewards, tester feedback and push deliveries.
 */
import { defineMachine, type StateOf } from "@thoroughbred/shared";

/**
 * seasons.status (pgEnum season_status). Today a season row is only ever inserted as "active"
 * (services/competition.ts) and the current season is found by date, never by status.
 */
export const seasonMachine = defineMachine({
  name: "season",
  storedIn: "seasons.status (pgEnum season_status)",
  states: ["upcoming", "active", "closed"],
  initial: ["upcoming", "active"],
  terminal: ["closed"],
  transitions: { upcoming: ["active"], active: ["closed"] },
  describe: {
    upcoming: "Declared but not started (not written by any code path today).",
    active: "The season in play (rows are inserted active).",
    closed: "Finished (not written by any code path today; seasons end by date).",
  },
});
export type SeasonStatus = StateOf<typeof seasonMachine>;

/**
 * chain_orders.status (text + CHECK chain_orders_status): the ETH checkout (db services/betaMoney.ts,
 * driven by apps/web server/chain/checkout.ts). The chain is the truth: a payment that confirms
 * after the quote expired still pays the order.
 */
export const chainOrderMachine = defineMachine({
  name: "chainOrder",
  storedIn: "chain_orders.status (text, CHECK chain_orders_status)",
  states: ["quoted", "submitted", "paid", "fulfilled", "expired", "rejected"],
  initial: "quoted",
  terminal: ["fulfilled", "rejected"],
  transitions: {
    quoted: ["submitted", "paid", "expired", "rejected"],
    submitted: ["quoted", "paid", "expired", "rejected"],
    expired: ["submitted", "paid", "rejected"],
    paid: ["fulfilled"],
  },
  describe: {
    quoted: "Price quoted and signed (EIP-712); waiting for the buyer's transaction.",
    submitted: "The wallet returned a tx hash; waiting for confirmations (a wrong hash goes back to quoted).",
    paid: "Payment verified on chain; the pack pulls are being granted (retried until done).",
    fulfilled: "Every pull granted, once.",
    expired: "The quote deadline passed unpaid (a late valid payment still pays it).",
    rejected: "The transaction failed or did not pay this order.",
  },
});
export type ChainOrderStatus = StateOf<typeof chainOrderMachine>;

/** pool_epochs.status (text + CHECK pool_epochs_status). */
export const poolEpochMachine = defineMachine({
  name: "poolEpoch",
  storedIn: "pool_epochs.status (text, CHECK pool_epochs_status)",
  states: ["draft", "posted", "cancelled"],
  initial: "draft",
  terminal: ["posted", "cancelled"],
  transitions: { draft: ["posted", "cancelled"] },
  describe: {
    draft: "Allocations computed; the Merkle root is not on chain yet.",
    posted: "The root is on chain (verified against the contract): final.",
    cancelled: "Dropped before posting.",
  },
});
export type PoolEpochStatus = StateOf<typeof poolEpochMachine>;

/** beta_rewards.status (text + CHECK beta_rewards_status; paid needs a tx hash). Admin-driven. */
export const betaRewardMachine = defineMachine({
  name: "betaReward",
  storedIn: "beta_rewards.status (text, CHECK beta_rewards_status)",
  states: ["pending", "approved", "paid", "void"],
  initial: "pending",
  terminal: ["paid"],
  transitions: {
    pending: ["approved", "void"],
    approved: ["pending", "paid", "void"],
    void: ["pending"],
  },
  describe: {
    pending: "Earned; waiting for an admin.",
    approved: "Approved for the next manual payout (CSV export).",
    paid: "Paid on chain (tx hash recorded): final.",
    void: "Not paid (can be set back to pending).",
  },
});
export type BetaRewardStatus = StateOf<typeof betaRewardMachine>;

/** feedback.status (text + CHECK feedback_status). Admin-driven; resolved can be reopened. */
export const feedbackMachine = defineMachine({
  name: "feedback",
  storedIn: "feedback.status (text, CHECK feedback_status)",
  states: ["new", "resolved"],
  initial: "new",
  transitions: { new: ["resolved"], resolved: ["new"] },
  describe: {
    new: "Sent by a tester; not handled yet.",
    resolved: "Handled by an admin (resolved_at set); can be reopened.",
  },
});
export type FeedbackStatus = StateOf<typeof feedbackMachine>;

/**
 * push_deliveries.status (text, no CHECK): one row per inbox item considered for a push. The row is
 * inserted "pending" (the claim that makes delivery happen at most once), then gets its outcome.
 */
export const pushDeliveryMachine = defineMachine({
  name: "pushDelivery",
  storedIn: "push_deliveries.status (text)",
  states: ["pending", "sent", "failed", "off", "device_off", "quiet", "cap", "duplicate", "stale", "held"],
  initial: "pending",
  terminal: ["sent", "failed", "off", "device_off", "quiet", "cap", "duplicate", "stale", "held"],
  transitions: { pending: ["sent", "failed", "off", "device_off", "quiet", "cap", "duplicate", "stale", "held"] },
  describe: {
    pending: "Claimed for delivery by this run.",
    sent: "Delivered to at least one device.",
    failed: "Every device refused it.",
    off: "The player switched this kind of alert off.",
    device_off: "No device subscribed.",
    quiet: "Inside the player's quiet hours.",
    cap: "Over the daily cap.",
    duplicate: "A newer or already-sent alert covers it.",
    stale: "No longer useful (race off, already watched, Story race).",
    held: "Came out of a race whose result the player has not watched yet (no spoiler).",
  },
});
export type PushDeliveryStatus = StateOf<typeof pushDeliveryMachine>;
/** A push delivery's outcome (every state but the claim). */
export type PushOutcome = Exclude<PushDeliveryStatus, "pending">;

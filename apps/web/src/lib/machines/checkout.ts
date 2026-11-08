/**
 * Premium Pack checkout in ETH (PremiumCheckout). Practice mode (T-USDG) is a plain submit flow.
 *
 *   idle -> quoting -> quoted (price held, countdown; re-quotes once when it expires)
 *        -> paying (the wallet) -> confirming (the server checks the chain) -> done
 *
 * Every wait ends: a quote or a confirm call gives up after the API timeout; confirming stops
 * after a few minutes with "your order is saved, reload later" (it resumes on the next visit);
 * the wallet step ends when the wallet answers (the player can always reject there).
 */
import { defineMachine } from "@thoroughbred/shared";

export const CHECKOUT_MACHINE = defineMachine({
  name: "checkout",
  storedIn: "PremiumCheckout phase (apps/web/src/components/chain/PremiumCheckout.tsx)",
  states: ["idle", "quoting", "quoted", "paying", "confirming", "done"],
  initial: "idle",
  transitions: {
    idle: ["quoting", "confirming"],
    quoting: ["quoted", "idle"],
    quoted: ["quoting", "paying"],
    paying: ["confirming", "quoted", "idle"],
    confirming: ["done", "idle"],
    done: ["idle"],
  },
  describe: {
    idle: "Quantity and Buy. An order paid before a reload resumes straight into confirming.",
    quoting: "Getting a price (Getting a price…). Back to idle with the error if it fails or times out.",
    quoted: "Exact wei held for 5 minutes with a countdown; re-quotes once when it runs out.",
    paying: "Waiting for the wallet (Confirm in your wallet…). A rejection goes back to the quote (or idle if it expired).",
    confirming: "Paid; the server verifies it on-chain. Gives up after a few minutes: the order is saved and resumes on reload.",
    done: "Delivered; Buy another goes back to idle.",
  },
});

export type CheckoutPhase = (typeof CHECKOUT_MACHINE.states)[number];

/** How long the confirming loop keeps asking before it tells the player to come back later. */
export const CONFIRM_GIVE_UP_MS = 4 * 60_000;

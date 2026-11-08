/**
 * Market lifecycles (docs/state-machines.md): credit listings and lease offers, leases, and the
 * USDG market (listings, auction bids, orders).
 */
import { defineMachine, type StateOf } from "@thoroughbred/shared";

/**
 * pgEnum listing_status, shared by market_listings (credits market, services/market.ts) and
 * horse_lease_listings (lease offers, services/leasing.ts; "sold" = taken, lease_id set).
 */
export const listingMachine = defineMachine({
  name: "listing",
  storedIn: "market_listings.status and horse_lease_listings.status (pgEnum listing_status)",
  states: ["active", "sold", "cancelled", "expired"],
  initial: "active",
  terminal: ["sold", "cancelled", "expired"],
  transitions: { active: ["sold", "cancelled", "expired"] },
  describe: {
    active: "On offer (a credits listing market-locks the horse) until expiresAt.",
    sold: "Bought, or for a lease offer taken (the lease row exists).",
    cancelled: "Withdrawn by the owner, or the horse stopped being eligible (retired, Club trim).",
    expired: "Reached expiresAt unsold; the horse is unlocked.",
  },
});
export type ListingStatus = StateOf<typeof listingMachine>;

/** horse_leases.status (text + CHECK horse_leases_status; ended_at is set exactly when ended). */
export const leaseMachine = defineMachine({
  name: "lease",
  storedIn: "horse_leases.status (text, CHECK horse_leases_status)",
  states: ["active", "ended"],
  initial: "active",
  terminal: ["ended"],
  transitions: { active: ["ended"] },
  describe: {
    active: "The lessee races the horse under the agreed terms.",
    ended: "Home with its owner (term, returned early, injured, retired or died: end_reason).",
  },
});
export type LeaseStatus = StateOf<typeof leaseMachine>;

/**
 * usdg_listings.status (text + CHECK usdg_listings_status). Fixed price: active -> sold | cancelled
 * | expired (a reservation keeps it active). Auction: active -> closed (the top bidder is offered
 * the horse) -> sold | unsold, or straight to unsold when no bidder is eligible.
 */
export const usdgListingMachine = defineMachine({
  name: "usdgListing",
  storedIn: "usdg_listings.status (text, CHECK usdg_listings_status)",
  states: ["active", "closed", "sold", "cancelled", "expired", "unsold"],
  initial: "active",
  terminal: ["sold", "cancelled", "expired", "unsold"],
  transitions: {
    active: ["closed", "sold", "cancelled", "expired", "unsold"],
    closed: ["sold", "unsold"],
  },
  describe: {
    active: "On offer (fixed price, or an auction taking bids until endsAt).",
    closed: "Auction over: a bidder has a payment window (offerOrderId).",
    sold: "Paid on chain (or in practice T-USDG) and the horse moved.",
    cancelled: "Withdrawn by the seller.",
    expired: "Fixed price: reached endsAt with no live order.",
    unsold: "Auction ended with no eligible bidder left.",
  },
});
export type UsdgListingStatus = StateOf<typeof usdgListingMachine>;

/** usdg_bids.status (text + CHECK usdg_bids_status). */
export const usdgBidMachine = defineMachine({
  name: "usdgBid",
  storedIn: "usdg_bids.status (text, CHECK usdg_bids_status)",
  states: ["active", "offered", "won", "defaulted", "void"],
  initial: "active",
  terminal: ["won", "defaulted", "void"],
  transitions: {
    active: ["offered", "void"],
    offered: ["won", "defaulted"],
  },
  describe: {
    active: "A signed bid standing on an auction.",
    offered: "Won the close: a sale order with a payment window exists.",
    won: "Paid; the horse moved to the bidder.",
    defaulted: "Did not pay in the window (the bidder is barred for a while).",
    void: "The bidder became ineligible, or defaulted on another of their bids.",
  },
});
export type UsdgBidStatus = StateOf<typeof usdgBidMachine>;

/**
 * usdg_orders.status (text + CHECK usdg_orders_status): registration, sale and stud orders. An
 * expired order still becomes paid when a valid on-chain payment confirms late (the chain is the
 * truth; fulfilment then decides whether the horse can still move).
 */
export const usdgOrderMachine = defineMachine({
  name: "usdgOrder",
  storedIn: "usdg_orders.status (text, CHECK usdg_orders_status)",
  states: ["pending", "paid", "fulfilled", "expired"],
  initial: "pending",
  terminal: ["fulfilled"],
  transitions: {
    pending: ["paid", "expired"],
    expired: ["paid"],
    paid: ["fulfilled"],
  },
  describe: {
    pending: "Signed for the wallet (tx_hash set once submitted); waiting for the chain.",
    paid: "Payment verified; fulfilment pending or stuck (needs an admin: error says why).",
    fulfilled: "Done once: registered, horse moved, or covering made.",
    expired: "Deadline (plus grace) passed with no payment seen; a late valid payment still pays it.",
  },
});
export type UsdgOrderStatus = StateOf<typeof usdgOrderMachine>;

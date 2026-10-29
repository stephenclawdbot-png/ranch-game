/**
 * The USDG horse market (docs/usdg-market.md), DB side: registration rules, credits-listing
 * refusal, fixed-price reservations, fulfilment idempotency, linked accounts, auctions (close,
 * non-payer bar, fallback to the next bidder) and the horse locks.
 */
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { fraudEvents, horses, packPulls, raceEntries, races, usdgBids, usdgListings, usdgOrders, type HorseRow } from "../schema";
import { recordAccountSignal } from "../services/accounts";
import { linkVerifiedWallet } from "../services/betaMoney";
import { tradeStatus } from "../services/economyViews";
import { listHorse } from "../services/market";
import { createRace, enterRace } from "../services/races";
import {
  closeUsdgAuctions,
  delistUsdg,
  expireUsdgListings,
  expireUsdgOrder,
  fulfilUsdgOrder,
  getUsdgOrder,
  isUsdgRegistered,
  listUsdg,
  markUsdgOrderSubmitted,
  placeUsdgBid,
  quoteUsdgRegistration,
  quoteUsdgSale,
  usdgBarredUntil,
  usdgBoard,
  usdgOrdersNeedingAttention,
  usdgRegistrationStatus,
  usdgResaleLock,
  USDG_ORDER_GRACE_MS,
  type UsdgChainRef,
} from "../services/usdgMarket";
import { at, DAY, getHorseRow, makeHorse, makeSeller, memoryDb, MIN, newPlayer, settledAll, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const USD = gc.USDG_UNIT;
const POLICY = gc.DEFAULT_USDG_POLICY;
const CHAIN: UsdgChainRef = { chainId: 31337, market: "0x00000000000000000000000000000000004d4b54", token: "0x0000000000000000000000000000000000005d6e" };
const HOUR = 60 * MIN;
const txHash = () => `0x${randomBytes(32).toString("hex")}`;
const wallet = () => `0x${randomBytes(20).toString("hex")}`;

type Player = Awaited<ReturnType<typeof newPlayer>> & { wallet: string | null };

async function player(opts: { wallet?: boolean } = {}): Promise<Player> {
  const p = await newPlayer(h.db, { credits: 50_000 });
  let w: string | null = null;
  if (opts.wallet !== false) {
    w = wallet();
    await linkVerifiedWallet(h.db, { accountId: p.accountId, address: w, now: T0 });
  }
  return { ...p, wallet: w };
}

let raceNo = 0;
async function giveLiveStarts(horse: HorseRow, stableId: string, n: number, kind: "scheduled" | "quick" = "scheduled"): Promise<void> {
  for (let i = 0; i < n; i++) {
    const postTime = new Date(T0.getTime() - (++raceNo + 1) * HOUR);
    const race = await createRace(h.db, { kind, name: `USDG history ${raceNo}`, raceClass: "maiden", conditions: {}, postTime, entriesCloseAt: new Date(postTime.getTime() - MIN) });
    await h.db.update(races).set({ status: "settled" }).where(eq(races.id, race.id));
    await h.db.insert(raceEntries).values({ raceId: race.id, horseId: horse.id, stableId, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
  }
  await h.db.update(horses).set({ starts: sql`${horses.starts} + ${n}` }).where(eq(horses.id, horse.id));
}

/** A racing-age horse with 5 Live starts, owned by `p`. */
async function eligibleHorse(p: Player, overrides: Partial<HorseRow> = {}): Promise<HorseRow> {
  const horse = await makeHorse(h.db, p.stableId, { origin: "bred", ...overrides });
  await giveLiveStarts(horse, p.stableId, POLICY.minLiveStarts);
  return getHorseRow(h.db, horse.id);
}

/** Registers a horse end to end (quote, chain says paid, fulfil). */
async function registered(p: Player, overrides: Partial<HorseRow> = {}): Promise<HorseRow> {
  const horse = await eligibleHorse(p, overrides);
  const order = await quoteUsdgRegistration(h.db, { accountId: p.accountId, horseId: horse.id, termsAccepted: true, chain: CHAIN, now: T0 }, POLICY);
  await fulfilUsdgOrder(h.db, { orderId: order.orderId, txHash: txHash(), now: T0 }, POLICY);
  return getHorseRow(h.db, horse.id);
}

const reg = (p: Player, horseId: string, terms = true) => quoteUsdgRegistration(h.db, { accountId: p.accountId, horseId, termsAccepted: terms, chain: CHAIN, now: T0 }, POLICY);

describe("registration", () => {
  it("quotes the fee once (a second click gets the same order), and fulfils once", async () => {
    const p = await player();
    const horse = await eligibleHorse(p);
    const st = await usdgRegistrationStatus(h.db, { accountId: p.accountId, horseId: horse.id, now: T0 }, POLICY);
    expect(st.checks.every((c) => c.ok)).toBe(true);
    expect(st.liveStarts).toBe(5);
    const o = await reg(p, horse.id);
    expect(o).toMatchObject({ kind: "registration", status: "pending", price: 2 * USD, fee: 2 * USD, wallet: p.wallet, horseRef: gc.usdgHorseRef(horse.id) });
    expect(o.deadline.getTime() - T0.getTime()).toBe(POLICY.quoteTtlMs);
    expect((await reg(p, horse.id)).orderId).toBe(o.orderId);
    expect((await usdgRegistrationStatus(h.db, { accountId: p.accountId, horseId: horse.id, now: T0 }, POLICY)).openOrder?.orderId).toBe(o.orderId);

    const tx = txHash();
    await markUsdgOrderSubmitted(h.db, { orderId: o.orderId, accountId: p.accountId, txHash: tx, now: T0 });
    const results = await settledAll([0, 1, 2].map(() => fulfilUsdgOrder(h.db, { orderId: o.orderId, txHash: tx, now: at(MIN) }, POLICY)));
    expect(results.errors).toEqual([]);
    expect(results.ok.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(results.ok.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await isUsdgRegistered(h.db, horse.id)).toBe(true);
    await expect(reg(p, horse.id)).rejects.toThrow(/already registered/);
    // Another tx hash can't claim the same order.
    await expect(fulfilUsdgOrder(h.db, { orderId: o.orderId, txHash: txHash(), now: at(MIN) }, POLICY)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("never fulfils an order the server didn't create", async () => {
    await expect(fulfilUsdgOrder(h.db, { orderId: txHash(), txHash: txHash(), now: T0 }, POLICY)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("enforces every requirement: Live starts, racing age, bound, starter, gift, Premium pull, Legacy Farm, wallet, terms, owner", async () => {
    const p = await player();
    const block = async (horseId: string, who = p, terms = true) => {
      try {
        await reg(who, horseId, terms);
      } catch (e) {
        return (e as { details?: { requirement?: string } }).details?.requirement;
      }
      return null;
    };
    const fewStarts = await makeHorse(h.db, p.stableId, { origin: "bred" });
    await giveLiveStarts(fewStarts, p.stableId, 4);
    await giveLiveStarts(fewStarts, p.stableId, 3, "quick"); // Story/quick starts don't count
    expect(await block(fewStarts.id)).toBe("live_starts");
    expect(await block((await eligibleHorse(p, { careSessions: 3 })).id)).toBe("racing_age");
    expect(await block((await eligibleHorse(p, { bound: true })).id)).toBe("not_bound");
    expect(await block((await eligibleHorse(p, { origin: "starter" })).id)).toBe("not_starter_or_gift");
    expect(await block((await eligibleHorse(p, { origin: "gift" })).id)).toBe("not_starter_or_gift");
    const pulled = await eligibleHorse(p, { origin: "pack" });
    await h.db.insert(packPulls).values({ accountId: p.accountId, packType: "premium", pullIndex: 1, seedCommitment: "x", seedReveal: "y", rarity: "rare", horseId: pulled.id, price: 0, free: false, weekStart: "2026-11-02", seasonNumber: 1, idempotencyKey: `usdg-test:${pulled.id}` });
    expect(await block(pulled.id)).toBe("not_premium_pull");
    const farm = await eligibleHorse(p, { careerStatus: "pasture", retirementReason: "choice", retiredAt: T0, pasturedAt: T0 });
    expect(await block(farm.id)).toBe("not_legacy_farm");
    const ok = await eligibleHorse(p);
    expect(await block(ok.id, p, false)).toBe("terms");
    const noWallet = await player({ wallet: false });
    const theirs = await eligibleHorse(noWallet);
    expect(await block(theirs.id, noWallet)).toBe("wallet");
    expect(await block(ok.id, noWallet)).toBe("owned");
    // A Premium pull's foal is fine (only the pulled horse itself is excluded).
    const foal = await eligibleHorse(p, { origin: "bred", damId: pulled.id });
    expect(await block(foal.id)).toBeNull();
  });

  it("a horse entered in a race or listed for credits can't register", async () => {
    const p = await player();
    await makeSeller(h.db, p.accountId, p.stableId);
    const runner = await eligibleHorse(p);
    const race = await createRace(h.db, { kind: "quick", name: "USDG lock race", raceClass: "maiden", conditions: {}, postTime: at(10 * MIN), entriesCloseAt: at(9 * MIN) });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: runner.id, tactic: "front", now: T0 });
    await expect(reg(p, runner.id)).rejects.toMatchObject({ details: { requirement: "not_in_race" } });
    const listed = await eligibleHorse(p);
    const floor = gc.listingFloor((await import("../gameCore")).toHorseState(listed));
    await listHorse(h.db, { accountId: p.accountId, horseId: listed.id, price: floor, now: T0 });
    await expect(reg(p, listed.id)).rejects.toMatchObject({ details: { requirement: "not_listed" } });
  });

  it("a registered horse trades only for USDG: the credits market refuses it", async () => {
    const p = await player();
    await makeSeller(h.db, p.accountId, p.stableId);
    const horse = await registered(p);
    await expect(listHorse(h.db, { accountId: p.accountId, horseId: horse.id, price: 1_000_000, now: T0 })).rejects.toMatchObject({ code: "USDG_ONLY" });
    expect((await tradeStatus(h.db, horse, T0)).lock).toBe("usdg_only");
  });
});

describe("fixed-price sale", () => {
  it("reserves the lot for one buyer, delivers once, unlocks the horse, and applies the resale lock", async () => {
    const seller = await player();
    const horse = await registered(seller);
    await expect(listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: POLICY.minPrice - 1, duration: 7, now: T0 }, POLICY)).rejects.toMatchObject({ code: "PRICE_BELOW_FLOOR" });
    await expect(listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 25 * USD, duration: 5, now: T0 }, POLICY)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const listing = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 25 * USD, duration: 7, now: T0 }, POLICY);
    expect((await getHorseRow(h.db, horse.id)).lockKind).toBe("market");
    // Listed horses don't race.
    const race = await createRace(h.db, { kind: "quick", name: "USDG listed race", raceClass: "maiden", conditions: {}, postTime: at(10 * MIN), entriesCloseAt: at(9 * MIN) });
    await expect(enterRace(h.db, { accountId: seller.accountId, raceId: race.id, horseId: horse.id, tactic: "front", now: T0 })).rejects.toMatchObject({ code: "HORSE_LOCKED" });
    await expect(listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 25 * USD, duration: 7, now: T0 }, POLICY)).rejects.toMatchObject({ code: "HORSE_LOCKED" });
    await expect(quoteUsdgSale(h.db, { accountId: seller.accountId, listingId: listing.id, chain: CHAIN, now: T0 }, POLICY)).rejects.toMatchObject({ code: "CANNOT_BUY_OWN" });

    const buyer = await player();
    const other = await player();
    const noWallet = await player({ wallet: false });
    await expect(quoteUsdgSale(h.db, { accountId: noWallet.accountId, listingId: listing.id, chain: CHAIN, now: T0 }, POLICY)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    const order = await quoteUsdgSale(h.db, { accountId: buyer.accountId, listingId: listing.id, chain: CHAIN, now: T0 }, POLICY);
    expect(order).toMatchObject({ kind: "sale", price: 25 * USD, fee: 1_250_000, sellerWallet: seller.wallet, wallet: buyer.wallet, horseRef: gc.usdgHorseRef(horse.id) });
    expect((await quoteUsdgSale(h.db, { accountId: buyer.accountId, listingId: listing.id, chain: CHAIN, now: at(MIN) }, POLICY)).orderId).toBe(order.orderId);
    await expect(quoteUsdgSale(h.db, { accountId: other.accountId, listingId: listing.id, chain: CHAIN, now: at(MIN) }, POLICY)).rejects.toMatchObject({ code: "LISTING_NOT_ACTIVE" });
    await expect(delistUsdg(h.db, { accountId: seller.accountId, listingId: listing.id, now: at(MIN) })).rejects.toMatchObject({ code: "LISTING_NOT_ACTIVE" });

    const tx = txHash();
    await markUsdgOrderSubmitted(h.db, { orderId: order.orderId, accountId: buyer.accountId, txHash: tx, now: at(MIN) });
    expect((await usdgOrdersNeedingAttention(h.db, { now: at(MIN) })).map((o) => o.orderId)).toContain(order.orderId);
    const [r1, r2] = await Promise.all([fulfilUsdgOrder(h.db, { orderId: order.orderId, txHash: tx, now: at(2 * MIN) }, POLICY), fulfilUsdgOrder(h.db, { orderId: order.orderId, txHash: tx, now: at(2 * MIN) }, POLICY)]);
    expect([r1.duplicate, r2.duplicate].sort()).toEqual([false, true]);
    const after = await getHorseRow(h.db, horse.id);
    expect(after.ownerStableId).toBe(buyer.stableId);
    expect(after.lockKind).toBeNull();
    const [l] = await h.db.select().from(usdgListings).where(eq(usdgListings.id, listing.id));
    expect(l!.status).toBe("sold");
    expect(await isUsdgRegistered(h.db, horse.id)).toBe(true); // registration follows the horse

    // Resale lock: the buyer can't relist for 72 h.
    await expect(listUsdg(h.db, { accountId: buyer.accountId, horseId: horse.id, kind: "fixed", price: 30 * USD, duration: 7, now: at(3 * MIN) }, POLICY)).rejects.toMatchObject({ code: "RESALE_LOCKED" });
    expect(await usdgResaleLock(h.db, { horseId: horse.id, ownerStableId: buyer.stableId, ownerAccountId: buyer.accountId, now: at(3 * DAY + 3 * MIN) })).toBeNull();
    await listUsdg(h.db, { accountId: buyer.accountId, horseId: horse.id, kind: "fixed", price: 30 * USD, duration: 3, now: at(3 * DAY + 3 * MIN) }, POLICY);
  });

  it("a reservation that lapses frees the lot for the next buyer; an expired listing returns the horse", async () => {
    const seller = await player();
    const horse = await registered(seller);
    const listing = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 5 * USD, duration: 3, now: T0 }, POLICY);
    const a = await player();
    const b = await player();
    const o = await quoteUsdgSale(h.db, { accountId: a.accountId, listingId: listing.id, chain: CHAIN, now: T0 }, POLICY);
    // Not yet past deadline + grace: nothing happens.
    expect((await expireUsdgOrder(h.db, { orderId: o.orderId, now: new Date(o.deadline.getTime() + USDG_ORDER_GRACE_MS - 1) }, POLICY)).expired).toBe(false);
    const late = new Date(o.deadline.getTime() + USDG_ORDER_GRACE_MS + 1);
    expect((await expireUsdgOrder(h.db, { orderId: o.orderId, now: late }, POLICY)).expired).toBe(true);
    expect((await getUsdgOrder(h.db, o.orderId))!.status).toBe("expired");
    const o2 = await quoteUsdgSale(h.db, { accountId: b.accountId, listingId: listing.id, chain: CHAIN, now: late }, POLICY);
    expect(o2.accountId).toBe(b.accountId);
    expect((await expireUsdgOrder(h.db, { orderId: o2.orderId, now: new Date(o2.deadline.getTime() + USDG_ORDER_GRACE_MS + 1) }, POLICY)).expired).toBe(true);
    // A buyer reserves just before the listing ends: it doesn't expire under them...
    const endsAt = new Date(T0.getTime() + 3 * DAY);
    const o3 = await quoteUsdgSale(h.db, { accountId: a.accountId, listingId: listing.id, chain: CHAIN, now: new Date(endsAt.getTime() - MIN) }, POLICY);
    expect(await expireUsdgListings(h.db, { now: new Date(endsAt.getTime() + MIN) })).toBe(0);
    // ...and when their order lapses, the listing expires and the horse goes home.
    await expireUsdgOrder(h.db, { orderId: o3.orderId, now: new Date(o3.deadline.getTime() + USDG_ORDER_GRACE_MS + 1) }, POLICY);
    const end = new Date(o3.deadline.getTime() + USDG_ORDER_GRACE_MS + 1);
    const [l] = await h.db.select().from(usdgListings).where(eq(usdgListings.id, listing.id));
    expect(l!.status).toBe("expired");
    expect((await getHorseRow(h.db, horse.id)).lockKind).toBeNull();
    // A fixed listing without bids or orders can be taken down.
    const again = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 5 * USD, duration: 3, now: end }, POLICY);
    await delistUsdg(h.db, { accountId: seller.accountId, listingId: again.id, now: end });
    expect((await getHorseRow(h.db, horse.id)).lockKind).toBeNull();
  });

  it("refuses linked accounts (buy and bid), and records a fraud event", async () => {
    const seller = await player();
    const alt = await player();
    await recordAccountSignal(h.db, { accountId: seller.accountId, kind: "device", value: "same-laptop" });
    await recordAccountSignal(h.db, { accountId: alt.accountId, kind: "device", value: "same-laptop" });
    const horse = await registered(seller);
    const fixed = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 9 * USD, duration: 3, now: T0 }, POLICY);
    await expect(quoteUsdgSale(h.db, { accountId: alt.accountId, listingId: fixed.id, chain: CHAIN, now: T0 }, POLICY)).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    await delistUsdg(h.db, { accountId: seller.accountId, listingId: fixed.id, now: T0 });
    const auction = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "auction", price: 9 * USD, duration: 24, now: T0 }, POLICY);
    await expect(placeUsdgBid(h.db, { accountId: alt.accountId, listingId: auction.id, amount: 9 * USD, nonce: "1", signature: "0xaa", signer: alt.wallet!, now: T0 }, POLICY)).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    const events = await h.db.select().from(fraudEvents).where(and(eq(fraudEvents.accountId, alt.accountId), eq(fraudEvents.kind, "linked_trade_blocked")));
    expect(events.length).toBe(2);
  });
});

describe("auctions", () => {
  const bid = (p: Player, listingId: string, amount: number, now = at(MIN), signer = p.wallet!) =>
    placeUsdgBid(h.db, { accountId: p.accountId, listingId, amount, nonce: String(randomBytes(4).readUInt32BE()), signature: `0x${randomBytes(65).toString("hex")}`, signer, now }, POLICY);

  it("closes to the top bidder; a non-payer is barred and the next bidder is offered the horse at their own bid", async () => {
    const seller = await player();
    const horse = await registered(seller);
    await expect(listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "auction", price: 10 * USD, duration: 12, now: T0 }, POLICY)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const auction = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "auction", price: 10 * USD, duration: 24, now: T0 }, POLICY);
    const [a, b, c] = [await player(), await player(), await player()];
    await expect(bid(a, auction.id, 9 * USD)).rejects.toMatchObject({ code: "PRICE_BELOW_FLOOR" });
    await expect(bid(a, auction.id, 10 * USD, at(MIN), b.wallet!)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" }); // signed by someone else's wallet
    await expect(bid(seller, auction.id, 10 * USD)).rejects.toMatchObject({ code: "CANNOT_BUY_OWN" });
    await bid(a, auction.id, 10 * USD);
    await expect(bid(b, auction.id, 10_400_000)).rejects.toMatchObject({ code: "PRICE_BELOW_FLOOR", details: { minNext: 10_500_000 } });
    await bid(b, auction.id, 11 * USD);
    await bid(a, auction.id, 12 * USD, at(2 * MIN));
    await bid(c, auction.id, 13 * USD, at(3 * MIN));
    await expect(delistUsdg(h.db, { accountId: seller.accountId, listingId: auction.id, now: at(4 * MIN) })).rejects.toThrow(/with bids/);
    const board = await usdgBoard(h.db, { now: at(5 * MIN) });
    expect(board.find((r) => r.listing.id === auction.id)).toMatchObject({ bestBid: 13 * USD, bidCount: 4 });

    // Before the end nothing closes; at the end the top bidder (c) is offered the horse.
    expect((await closeUsdgAuctions(h.db, { now: at(23 * HOUR), chain: CHAIN }, POLICY)).offered).toHaveLength(0);
    const end = at(24 * HOUR);
    await expect(bid(a, auction.id, 20 * USD, end)).rejects.toMatchObject({ code: "LISTING_EXPIRED" });
    const closed = await closeUsdgAuctions(h.db, { now: end, chain: CHAIN }, POLICY);
    const offerC = closed.offered.find((o) => o.listingId === auction.id)!;
    expect(offerC).toMatchObject({ accountId: c.accountId, price: 13 * USD, fee: 650_000, wallet: c.wallet });
    expect(offerC.deadline.getTime() - end.getTime()).toBe(POLICY.paymentWindowMs);
    expect((await getHorseRow(h.db, horse.id)).lockKind).toBe("market"); // still locked while offered

    // c doesn't pay: after the window (+ grace) c defaults and is barred; a is offered at 12.
    const lapse = new Date(offerC.deadline.getTime() + USDG_ORDER_GRACE_MS + 1);
    const res = await expireUsdgOrder(h.db, { orderId: offerC.orderId, now: lapse }, POLICY);
    expect(res.expired).toBe(true);
    expect(res.next).toMatchObject({ accountId: a.accountId, price: 12 * USD });
    expect((await usdgBarredUntil(h.db, { accountId: c.accountId, now: lapse }, POLICY))!.getTime()).toBe(lapse.getTime() + POLICY.nonPayerBarMs);
    const [cBid] = await h.db.select().from(usdgBids).where(and(eq(usdgBids.listingId, auction.id), eq(usdgBids.accountId, c.accountId)));
    expect(cBid!.status).toBe("defaulted");

    // a pays: the horse moves; idempotent.
    const tx = txHash();
    await markUsdgOrderSubmitted(h.db, { orderId: res.next!.orderId, accountId: a.accountId, txHash: tx, now: lapse });
    expect((await fulfilUsdgOrder(h.db, { orderId: res.next!.orderId, txHash: tx, now: lapse }, POLICY)).status).toBe("fulfilled");
    expect((await fulfilUsdgOrder(h.db, { orderId: res.next!.orderId, txHash: tx, now: lapse }, POLICY)).duplicate).toBe(true);
    expect((await getHorseRow(h.db, horse.id)).ownerStableId).toBe(a.stableId);
    // A late payment from c's lapsed order can't take the horse back: recorded, not delivered.
    const stuck = await fulfilUsdgOrder(h.db, { orderId: offerC.orderId, txHash: txHash(), now: lapse }, POLICY);
    expect(stuck.status).toBe("paid");
    expect((await getHorseRow(h.db, horse.id)).ownerStableId).toBe(a.stableId);

    // c can't bid on another auction for 7 days.
    const s2 = await player();
    const h2 = await registered(s2);
    const other = await listUsdg(h.db, { accountId: s2.accountId, horseId: h2.id, kind: "auction", price: 1 * USD, duration: 48, now: lapse }, POLICY);
    await expect(bid(c, other.id, 2 * USD, lapse)).rejects.toMatchObject({ code: "USDG_BARRED" });
    await bid(c, other.id, 2 * USD, new Date(lapse.getTime() + POLICY.nonPayerBarMs + 1)).catch((e) => expect(e).toMatchObject({ code: "LISTING_EXPIRED" }));
  });

  it("no bids, or every bidder defaults: unsold, the horse goes home", async () => {
    const seller = await player();
    const horse = await registered(seller);
    const empty = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "auction", price: 3 * USD, duration: 24, now: T0 }, POLICY);
    expect((await closeUsdgAuctions(h.db, { now: at(24 * HOUR), chain: CHAIN }, POLICY)).unsold).toBeGreaterThanOrEqual(1);
    expect((await h.db.select().from(usdgListings).where(eq(usdgListings.id, empty.id)))[0]!.status).toBe("unsold");
    expect((await getHorseRow(h.db, horse.id)).lockKind).toBeNull();

    const t1 = at(25 * HOUR);
    const second = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "auction", price: 3 * USD, duration: 24, now: t1 }, POLICY);
    const only = await player();
    await bid(only, second.id, 3 * USD, t1);
    const closeAt = new Date(t1.getTime() + 24 * HOUR);
    const { offered } = await closeUsdgAuctions(h.db, { now: closeAt, chain: CHAIN }, POLICY);
    const o = offered.find((x) => x.listingId === second.id)!;
    const res = await expireUsdgOrder(h.db, { orderId: o.orderId, now: new Date(o.deadline.getTime() + USDG_ORDER_GRACE_MS + 1) }, POLICY);
    expect(res.next).toBeNull();
    expect((await h.db.select().from(usdgListings).where(eq(usdgListings.id, second.id)))[0]!.status).toBe("unsold");
    expect((await getHorseRow(h.db, horse.id)).lockKind).toBeNull();
    const [row] = await h.db.select().from(usdgOrders).where(eq(usdgOrders.orderId, o.orderId));
    expect(row!.status).toBe("expired");
  });

  it("skips a bidder who became linked to the seller after bidding", async () => {
    const seller = await player();
    const horse = await registered(seller);
    const auction = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "auction", price: 4 * USD, duration: 24, now: T0 }, POLICY);
    const honest = await player();
    const alt = await player();
    await bid(honest, auction.id, 4 * USD);
    await bid(alt, auction.id, 6 * USD);
    await recordAccountSignal(h.db, { accountId: seller.accountId, kind: "ip_hash", value: "shared-ip-later" });
    await recordAccountSignal(h.db, { accountId: alt.accountId, kind: "ip_hash", value: "shared-ip-later" });
    const { offered } = await closeUsdgAuctions(h.db, { now: at(24 * HOUR), chain: CHAIN }, POLICY);
    expect(offered.find((o) => o.listingId === auction.id)).toMatchObject({ accountId: honest.accountId, price: 4 * USD });
  });
});

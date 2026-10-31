/**
 * Practice identity (services/practiceIdentity.ts, docs/usdg-market.md "Practice identity"), DB
 * side. The real derivation (HMAC + secp256k1) lives in apps/web; here a stand-in resolver maps an
 * account to a fixed address, which is all the DB rules see.
 *
 * - In practice mode a tester without a wallet gets the grant, registers, lists, bids, buys, pays a
 *   stud fee and bets T-USDG under the practice address.
 * - Linking a real wallet afterwards: same balance, no second grant, a practice-address bid is still
 *   offered at the close, a practice-address listing still sells; new rows use the real wallet.
 * - Outside practice mode (or with no resolver) the identity doesn't exist: marketWalletOf is
 *   exactly verifiedWalletOf.
 * - Real-chain orders and real-money helpers never carry or return a practice address.
 */
import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { horses, ledgerTransactions, raceEntries, races, usdgBids, usdgListings, usdgOrders, type HorseRow } from "../schema";
import { accountForWallet, linkVerifiedWallet, verifiedWalletOf } from "../services/betaMoney";
import { claimOwner, ensureReferralCode, recordReferral, referralPlan } from "../services/affiliates";
import {
  holdsMarketAddress,
  marketIdentityOf,
  marketWalletOf,
  orderWalletOf,
  practiceAddressOf,
  setPracticeAddressResolver,
  USDG_PRACTICE_MARKET,
} from "../services/practiceIdentity";
import { createRace, enterRace } from "../services/races";
import { confirmToteAdult, placeToteBet } from "../services/tote";
import { closeUsdgAuctions, listUsdg, placeUsdgBid, quoteUsdgRegistration, quoteUsdgSale, type UsdgChainRef } from "../services/usdgMarket";
import { grantPracticeUsdg, payUsdgOrderPractice, practiceUsdgBalance, USDG_PRACTICE_TOKEN } from "../services/usdgPractice";
import { quoteUsdgStud, setUsdgStudFee } from "../services/usdgStud";
import { at, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
const fakeAddress = (accountId: string) => `0x${createHash("sha256").update(`fake-practice:${accountId}`).digest("hex").slice(0, 40)}`;

beforeAll(async () => {
  h = await memoryDb();
  setPracticeAddressResolver((accountId) => fakeAddress(accountId));
});
afterAll(async () => {
  setPracticeAddressResolver(null);
  vi.unstubAllEnvs();
  await h.close();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const USD = gc.USDG_UNIT;
const HOUR = 60 * MIN;
const ON = { USDG_MODE: "practice" };
const POLICY = gc.DEFAULT_USDG_POLICY;
const GRANT = gc.PRACTICE_USDG_GRANT;
const PRACTICE: UsdgChainRef = { chainId: 46630, market: USDG_PRACTICE_MARKET, token: USDG_PRACTICE_TOKEN };
const REAL: UsdgChainRef = { chainId: 46630, market: "0x00000000000000000000000000000000004d4b54", token: "0x0000000000000000000000000000000000005d6e" };
const retired = { careerStatus: "retired" as const, retirementReason: "choice" as const, retiredAt: T0 };
const practiceOn = () => vi.stubEnv("USDG_MODE", "practice");

async function tester() {
  const p = await newPlayer(h.db, { credits: 50_000 });
  await h.db.execute(`update stables set stall_slots = 24 where id = '${p.stableId}'`);
  return p;
}
type Tester = Awaited<ReturnType<typeof tester>>;

let raceNo = 0;
/** A horse with the Live starts registration needs. */
async function withStarts(p: Tester, overrides: Partial<HorseRow> = {}): Promise<HorseRow> {
  const horse = await makeHorse(h.db, p.stableId, { origin: "bred", ...overrides });
  for (let i = 0; i < POLICY.minLiveStarts; i++) {
    const postTime = new Date(T0.getTime() - (++raceNo + 1) * HOUR);
    const race = await createRace(h.db, { kind: "scheduled", name: `Identity history ${raceNo}`, raceClass: "maiden", conditions: {}, postTime, entriesCloseAt: new Date(postTime.getTime() - MIN) });
    await h.db.update(races).set({ status: "settled" }).where(eq(races.id, race.id));
    await h.db.insert(raceEntries).values({ raceId: race.id, horseId: horse.id, stableId: p.stableId, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
  }
  await h.db.update(horses).set({ starts: sql`greatest(${horses.starts}, ${POLICY.minLiveStarts})` }).where(eq(horses.id, horse.id));
  return horse;
}

/** Registered by paying the fee in T-USDG; the order carries `wallet` (the practice address by default). */
async function registered(p: Tester, overrides: Partial<HorseRow> = {}, wallet = fakeAddress(p.accountId), now = T0): Promise<HorseRow> {
  const horse = await withStarts(p, overrides);
  const reg = await quoteUsdgRegistration(h.db, { accountId: p.accountId, horseId: horse.id, termsAccepted: true, chain: PRACTICE, now }, POLICY);
  expect(reg.wallet.toLowerCase()).toBe(wallet.toLowerCase());
  expect((await payUsdgOrderPractice(h.db, { orderId: reg.orderId, accountId: p.accountId, now }, POLICY)).status).toBe("fulfilled");
  return getHorseRow(h.db, horse.id);
}

let nonce = 0;
const bid = (p: Tester, listingId: string, amount: number, signer: string, now: Date) =>
  placeUsdgBid(h.db, { accountId: p.accountId, listingId, amount, nonce: String(++nonce), signature: `0x${randomBytes(65).toString("hex")}`, signer, now }, POLICY);

describe("outside practice mode the practice identity does not exist", () => {
  it("marketWalletOf is exactly verifiedWalletOf (null without a wallet), whatever is registered", async () => {
    const none = await tester();
    const linked = await tester();
    const wallet = `0x${randomBytes(20).toString("hex")}`;
    await linkVerifiedWallet(h.db, { accountId: linked.accountId, address: wallet, now: T0 });
    for (const env of [{}, { USDG_MODE: "live" }, { USDG_MODE: "mock" }, { USDG_MODE: "Practice" }, { USDG_MODE: "off" }]) {
      expect(practiceAddressOf(none.accountId, env)).toBeNull();
      expect(await marketWalletOf(h.db, none.accountId, env)).toBeNull();
      expect(await marketIdentityOf(h.db, none.accountId, env)).toBeNull();
      expect(await marketWalletOf(h.db, linked.accountId, env)).toBe(await verifiedWalletOf(h.db, linked.accountId));
      expect(await holdsMarketAddress(h.db, none.accountId, fakeAddress(none.accountId), env)).toBe(false);
      await expect(grantPracticeUsdg(h.db, { accountId: none.accountId, now: T0, env })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    }
    // process.env unset too: the market refuses a wallet-less seller as before.
    const horse = await makeHorse(h.db, none.stableId, { origin: "bred" });
    await expect(quoteUsdgRegistration(h.db, { accountId: none.accountId, horseId: horse.id, termsAccepted: true, chain: PRACTICE, now: T0 }, POLICY)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    expect(await practiceUsdgBalance(h.db, none.accountId)).toBe(0);
  });

  it("without a resolver (no server secret) practice mode falls back to wallets only", async () => {
    const none = await tester();
    setPracticeAddressResolver(null);
    try {
      expect(practiceAddressOf(none.accountId, ON)).toBeNull();
      expect(await marketWalletOf(h.db, none.accountId, ON)).toBeNull();
      await expect(grantPracticeUsdg(h.db, { accountId: none.accountId, now: T0, env: ON })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    } finally {
      setPracticeAddressResolver((accountId) => fakeAddress(accountId));
    }
  });
});

describe("practice mode: a tester without a wallet", () => {
  it("gets the grant, registers, lists, buys, bids, wins, pays a stud fee and bets T-USDG", async () => {
    practiceOn();
    const seller = await tester();
    const buyer = await tester();
    const bidder = await tester();
    for (const p of [seller, buyer, bidder]) {
      expect(await verifiedWalletOf(h.db, p.accountId)).toBeNull();
      expect(await marketIdentityOf(h.db, p.accountId)).toEqual({ kind: "practice", address: fakeAddress(p.accountId) });
      expect(await grantPracticeUsdg(h.db, { accountId: p.accountId, now: T0, env: ON })).toEqual({ granted: true, balance: GRANT });
    }
    // Fixed price.
    const horse = await registered(seller);
    const listing = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 30 * USD, duration: 7, now: T0 }, POLICY);
    expect(listing.sellerWallet).toBe(fakeAddress(seller.accountId));
    const order = await quoteUsdgSale(h.db, { accountId: buyer.accountId, listingId: listing.id, chain: PRACTICE, now: T0 }, POLICY);
    expect(order).toMatchObject({ wallet: fakeAddress(buyer.accountId), sellerWallet: fakeAddress(seller.accountId) });
    expect((await payUsdgOrderPractice(h.db, { orderId: order.orderId, accountId: buyer.accountId, now: at(MIN) }, POLICY)).status).toBe("fulfilled");
    expect((await getHorseRow(h.db, horse.id)).ownerStableId).toBe(buyer.stableId);
    expect(await practiceUsdgBalance(h.db, buyer.accountId)).toBe(GRANT - 30 * USD);

    // Auction: the bid is signed by the practice address (apps/web signs it); the winner pays.
    const lot = await registered(seller);
    const auction = await listUsdg(h.db, { accountId: seller.accountId, horseId: lot.id, kind: "auction", price: 10 * USD, duration: 24, now: T0 }, POLICY);
    await expect(bid(bidder, auction.id, 12 * USD, fakeAddress(buyer.accountId), at(MIN))).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await bid(bidder, auction.id, 12 * USD, fakeAddress(bidder.accountId), at(MIN));
    const closed = await closeUsdgAuctions(h.db, { now: at(25 * HOUR), chain: PRACTICE }, POLICY);
    const won = closed.offered.find((o) => o.listingId === auction.id)!;
    expect(won).toMatchObject({ accountId: bidder.accountId, wallet: fakeAddress(bidder.accountId) });
    expect((await payUsdgOrderPractice(h.db, { orderId: won.orderId, accountId: bidder.accountId, now: at(25 * HOUR + MIN) }, POLICY)).status).toBe("fulfilled");
    expect(await practiceUsdgBalance(h.db, bidder.accountId)).toBe(GRANT - 12 * USD);

    // Stud fee: owner and payer both without wallets.
    const stallion = await registered(seller, { sex: "male", ...retired });
    await setUsdgStudFee(h.db, { accountId: seller.accountId, horseId: stallion.id, fee: 20 * USD, now: T0 }, POLICY);
    const mare = await makeHorse(h.db, buyer.stableId, { sex: "female", ...retired });
    const stud = await quoteUsdgStud(h.db, { accountId: buyer.accountId, sireId: stallion.id, damId: mare.id, chain: PRACTICE, now: at(2 * MIN) }, POLICY);
    expect(stud).toMatchObject({ wallet: fakeAddress(buyer.accountId), sellerWallet: fakeAddress(seller.accountId) });
    const sellerBefore = await practiceUsdgBalance(h.db, seller.accountId);
    expect((await payUsdgOrderPractice(h.db, { orderId: stud.orderId, accountId: buyer.accountId, now: at(3 * MIN) }, POLICY)).status).toBe("fulfilled");
    expect((await practiceUsdgBalance(h.db, seller.accountId)) - sellerBefore).toBe(19 * USD);

    // Tote: a T-USDG bet.
    const race = await createRace(h.db, {
      kind: "scheduled",
      name: "Identity tote",
      raceClass: "handicap",
      conditions: { minRating: 0, maxRating: 140, distanceM: 1400, surface: "turf" },
      postTime: at(10 * MIN),
      entriesCloseAt: at(9 * MIN),
      purse: 3_000,
      maxRunners: 12,
      targetRunners: 4,
    });
    const runners = [];
    for (let i = 0; i < 4; i++) {
      const o = await newPlayer(h.db);
      const rh = await makeHorse(h.db, o.stableId, { rating: 30 });
      await enterRace(h.db, { accountId: o.accountId, raceId: race.id, horseId: rh.id, tactic: "stalker", now: T0 });
      runners.push(rh.id);
    }
    await confirmToteAdult(h.db, { accountId: bidder.accountId, now: T0 });
    const before = await practiceUsdgBalance(h.db, bidder.accountId);
    await placeToteBet(h.db, { accountId: bidder.accountId, raceId: race.id, horseId: runners[0]!, pool: "win", currency: "TUSDG", stake: 2 * gc.TOTE_USDG_UNIT, clientKey: "identity-tote-1", now: at(5 * MIN), env: ON }, { dbClock: false });
    expect(await practiceUsdgBalance(h.db, bidder.accountId)).toBe(before - 2 * gc.TOTE_USDG_UNIT);
  });

  it("linking a real wallet later: same balance, no second grant, practice-address rows stay valid, new rows use the wallet", async () => {
    practiceOn();
    const seller = await tester();
    const bidder = await tester();
    const rival = await tester();
    for (const p of [seller, bidder, rival]) await grantPracticeUsdg(h.db, { accountId: p.accountId, now: T0, env: ON });
    const lot = await registered(seller);
    const auction = await listUsdg(h.db, { accountId: seller.accountId, horseId: lot.id, kind: "auction", price: 10 * USD, duration: 24, now: T0 }, POLICY);
    await bid(rival, auction.id, 10 * USD, fakeAddress(rival.accountId), at(MIN));
    await bid(bidder, auction.id, 15 * USD, fakeAddress(bidder.accountId), at(2 * MIN));
    const balanceBefore = await practiceUsdgBalance(h.db, bidder.accountId);

    // The bidder and the seller link real wallets mid-auction.
    const bidderWallet = `0x${randomBytes(20).toString("hex")}`;
    const sellerWallet = `0x${randomBytes(20).toString("hex")}`;
    await linkVerifiedWallet(h.db, { accountId: bidder.accountId, address: bidderWallet, now: at(3 * MIN) });
    await linkVerifiedWallet(h.db, { accountId: seller.accountId, address: sellerWallet, now: at(3 * MIN) });
    expect(await marketIdentityOf(h.db, bidder.accountId)).toEqual({ kind: "wallet", address: await verifiedWalletOf(h.db, bidder.accountId) });
    // No second grant: the grant is keyed by account, not by wallet.
    expect(await grantPracticeUsdg(h.db, { accountId: bidder.accountId, now: at(4 * MIN), env: ON })).toEqual({ granted: false, balance: balanceBefore });
    const grants = (await h.db.select().from(ledgerTransactions)).filter((t) => t.idempotencyKey === `usdg-practice:grant:${bidder.accountId}`);
    expect(grants).toHaveLength(1);
    // Both identities are the account's own while practice mode is on.
    expect(await holdsMarketAddress(h.db, bidder.accountId, fakeAddress(bidder.accountId))).toBe(true);
    expect(await holdsMarketAddress(h.db, bidder.accountId, bidderWallet)).toBe(true);
    expect(await holdsMarketAddress(h.db, bidder.accountId, fakeAddress(rival.accountId))).toBe(false);
    // New bids must come from the real wallet now; the practice address can't sign new ones.
    await expect(bid(bidder, auction.id, 20 * USD, fakeAddress(bidder.accountId), at(4 * MIN))).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });

    // The practice-address bid still wins at the close and is paid from the same balance.
    const closed = await closeUsdgAuctions(h.db, { now: at(25 * HOUR), chain: PRACTICE }, POLICY);
    const won = closed.offered.find((o) => o.listingId === auction.id)!;
    expect(won).toMatchObject({ accountId: bidder.accountId, price: 15 * USD });
    const sellerBefore = await practiceUsdgBalance(h.db, seller.accountId);
    expect((await payUsdgOrderPractice(h.db, { orderId: won.orderId, accountId: bidder.accountId, now: at(25 * HOUR + MIN) }, POLICY)).status).toBe("fulfilled");
    expect(await practiceUsdgBalance(h.db, bidder.accountId)).toBe(balanceBefore - 15 * USD);
    expect((await practiceUsdgBalance(h.db, seller.accountId)) - sellerBefore).toBe(15 * USD - gc.usdgFee(15 * USD, POLICY.feeBps));
    expect((await getHorseRow(h.db, lot.id)).ownerStableId).toBe(bidder.stableId);
    const [bidRow] = await h.db.select().from(usdgBids).where(eq(usdgBids.listingId, auction.id)).orderBy(sql`${usdgBids.amount} desc`).limit(1);
    expect(bidRow!.status).toBe("won");

    // New registrations and listings are under the real wallet.
    const plain = await registered(seller, {}, sellerWallet, at(26 * HOUR));
    const fresh = await listUsdg(h.db, { accountId: seller.accountId, horseId: plain.id, kind: "fixed", price: 5 * USD, duration: 7, now: at(26 * HOUR) }, POLICY);
    expect(fresh.sellerWallet.toLowerCase()).toBe(sellerWallet);
  });

  it("a practice-address listing still sells after the seller links a wallet (practice orders pay the account)", async () => {
    practiceOn();
    const seller = await tester();
    const buyer = await tester();
    for (const p of [seller, buyer]) await grantPracticeUsdg(h.db, { accountId: p.accountId, now: T0, env: ON });
    const horse = await registered(seller);
    const listing = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 20 * USD, duration: 7, now: T0 }, POLICY);
    await linkVerifiedWallet(h.db, { accountId: seller.accountId, address: `0x${randomBytes(20).toString("hex")}`, now: at(MIN) });
    const sellerBefore = await practiceUsdgBalance(h.db, seller.accountId);
    const order = await quoteUsdgSale(h.db, { accountId: buyer.accountId, listingId: listing.id, chain: PRACTICE, now: at(2 * MIN) }, POLICY);
    expect((await payUsdgOrderPractice(h.db, { orderId: order.orderId, accountId: buyer.accountId, now: at(3 * MIN) }, POLICY)).status).toBe("fulfilled");
    expect((await practiceUsdgBalance(h.db, seller.accountId)) - sellerBefore).toBe(19 * USD);
  });
});

describe("real money never sees a practice address", () => {
  it("a real-chain order needs verified wallets: the buyer's, and the seller's current one", async () => {
    practiceOn();
    const seller = await tester();
    const buyer = await tester();
    await grantPracticeUsdg(h.db, { accountId: seller.accountId, now: T0, env: ON });
    const horse = await registered(seller);
    const listing = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 20 * USD, duration: 7, now: T0 }, POLICY);
    // The orders' wallet for a real market: verified only.
    expect(await orderWalletOf(h.db, buyer.accountId, REAL.market)).toBeNull();
    expect(await orderWalletOf(h.db, buyer.accountId, PRACTICE.market)).toBe(fakeAddress(buyer.accountId));
    await expect(quoteUsdgSale(h.db, { accountId: buyer.accountId, listingId: listing.id, chain: REAL, now: at(MIN) }, POLICY)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    // Even a buyer with a real wallet can't pay a lot listed under a practice address on-chain.
    await linkVerifiedWallet(h.db, { accountId: buyer.accountId, address: `0x${randomBytes(20).toString("hex")}`, now: at(MIN) });
    await expect(quoteUsdgSale(h.db, { accountId: buyer.accountId, listingId: listing.id, chain: REAL, now: at(2 * MIN) }, POLICY)).rejects.toMatchObject({ code: "NOT_ELIGIBLE", message: expect.stringContaining("seller's wallet") });
    // A real registration for a wallet-less account is refused (every other requirement met).
    const noWallet = await tester();
    const own = await withStarts(noWallet);
    await expect(quoteUsdgRegistration(h.db, { accountId: noWallet.accountId, horseId: own.id, termsAccepted: true, chain: REAL, now: at(MIN) }, POLICY)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    const real = await h.db.select().from(usdgOrders).where(eq(usdgOrders.marketAddress, REAL.market));
    for (const o of real) {
      expect([o.wallet, o.sellerWallet].map((a) => a?.toLowerCase())).not.toContain(fakeAddress(buyer.accountId));
      expect([o.wallet, o.sellerWallet].map((a) => a?.toLowerCase())).not.toContain(fakeAddress(seller.accountId));
    }
    // A real auction close skips a practice-address seller (unsold), never offering a real order to it.
    const lot = await registered(seller);
    const auction = await listUsdg(h.db, { accountId: seller.accountId, horseId: lot.id, kind: "auction", price: 10 * USD, duration: 24, now: T0 }, POLICY);
    await bid(buyer, auction.id, 10 * USD, (await verifiedWalletOf(h.db, buyer.accountId))!, at(MIN));
    const closed = await closeUsdgAuctions(h.db, { now: at(25 * HOUR), chain: REAL }, POLICY);
    expect(closed.offered.find((o) => o.listingId === auction.id)).toBeUndefined();
    const [after] = await h.db.select().from(usdgListings).where(eq(usdgListings.id, auction.id));
    expect(after!.status).toBe("unsold");
  });

  it("verifiedWalletOf, accountForWallet and the affiliate helpers ignore practice identities", async () => {
    practiceOn();
    const p = await tester();
    const addr = fakeAddress(p.accountId);
    expect(await marketWalletOf(h.db, p.accountId)).toBe(addr);
    expect(await verifiedWalletOf(h.db, p.accountId)).toBeNull();
    expect(await accountForWallet(h.db, addr)).toBeNull();
    await expect(claimOwner(h.db, { accountId: p.accountId, now: T0 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    // p (no wallet, practice identity only) invited a buyer: no commission can go to the practice address.
    const buyer = await tester();
    await recordReferral(h.db, { accountId: buyer.accountId, code: await ensureReferralCode(h.db, p.accountId), now: T0 });
    await linkVerifiedWallet(h.db, { accountId: buyer.accountId, address: `0x${randomBytes(20).toString("hex")}`, now: T0 });
    const plan = await referralPlan(h.db, { buyerAccountId: buyer.accountId, buyerWallet: (await verifiedWalletOf(h.db, buyer.accountId))!, usdCents: 499, now: T0 });
    expect(plan.ref1).toBeNull();
    expect(plan.dropped.find((d) => d.accountId === p.accountId)?.reason).toBe("no verified wallet");
  });
});

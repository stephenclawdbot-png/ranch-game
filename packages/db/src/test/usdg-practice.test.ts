/**
 * Practice T-USDG (docs/usdg-market.md "Practice mode"), DB side: the one-off grant (wallet
 * required, idempotent), the separate ledger currency (never mixed with credits, credits views
 * unaffected), practice payments moving exact amounts (registration fee to the burn, sale and
 * auction price to the seller minus the 5 % fee burned, stud fee to the stallion owner minus the
 * fee) atomically with fulfilment, refusals before anything moves (insufficient balance, a real
 * order, an undeliverable covering rolls back), and the end-of-beta reset (dry run vs apply).
 */
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { horses, inboxItems, ledgerAccounts, raceEntries, races, usdgBids, usdgListings, usdgOrders, usdgRegistrations, type HorseRow } from "../schema";
import { linkVerifiedWallet } from "../services/betaMoney";
import { stableFinances } from "../services/finances";
import { getBalance, ledgerHealth, playerLedgerAccountId, post } from "../services/ledger";
import { createRace } from "../services/races";
import { closeUsdgAuctions, expireUsdgOrder, getUsdgOrder, listUsdg, placeUsdgBid, quoteUsdgRegistration, quoteUsdgSale, USDG_ORDER_GRACE_MS, type UsdgChainRef } from "../services/usdgMarket";
import {
  USDG_PRACTICE_MARKET,
  USDG_PRACTICE_TOKEN,
  assertPracticeFunds,
  grantPracticeUsdg,
  payUsdgOrderPractice,
  practiceLedgerAccountId,
  practiceSystemAccountId,
  practiceUsdgBalance,
  resetPracticeUsdg,
  topUpPracticeUsdg,
} from "../services/usdgPractice";
import { quoteUsdgStud, setUsdgStudFee } from "../services/usdgStud";
import { at, DAY, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const USD = gc.USDG_UNIT;
const ON = { USDG_MODE: "practice" };
const POLICY = gc.DEFAULT_USDG_POLICY;
const GRANT = gc.PRACTICE_USDG_GRANT;
const PRACTICE: UsdgChainRef = { chainId: 46630, market: USDG_PRACTICE_MARKET, token: USDG_PRACTICE_TOKEN };
const REAL: UsdgChainRef = { chainId: 46630, market: "0x00000000000000000000000000000000004d4b54", token: "0x0000000000000000000000000000000000005d6e" };
const HOUR = 60 * MIN;
const retired = { careerStatus: "retired" as const, retirementReason: "choice" as const, retiredAt: T0 };

type Player = Awaited<ReturnType<typeof newPlayer>> & { wallet: string };

async function player(opts: { grant?: boolean } = {}): Promise<Player> {
  const p = await newPlayer(h.db, { credits: 50_000 });
  await h.db.execute(`update stables set stall_slots = 24 where id = '${p.stableId}'`);
  const wallet = `0x${randomBytes(20).toString("hex")}`;
  await linkVerifiedWallet(h.db, { accountId: p.accountId, address: wallet, now: T0 });
  if (opts.grant !== false) await grantPracticeUsdg(h.db, { accountId: p.accountId, now: T0, env: ON });
  return { ...p, wallet };
}

let raceNo = 0;
async function withStarts(horse: HorseRow, stableId: string): Promise<void> {
  for (let i = 0; i < POLICY.minLiveStarts; i++) {
    const postTime = new Date(T0.getTime() - (++raceNo + 1) * HOUR);
    const race = await createRace(h.db, { kind: "scheduled", name: `Practice history ${raceNo}`, raceClass: "maiden", conditions: {}, postTime, entriesCloseAt: new Date(postTime.getTime() - MIN) });
    await h.db.update(races).set({ status: "settled" }).where(eq(races.id, race.id));
    await h.db.insert(raceEntries).values({ raceId: race.id, horseId: horse.id, stableId, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
  }
  await h.db.update(horses).set({ starts: sql`greatest(${horses.starts}, ${POLICY.minLiveStarts})` }).where(eq(horses.id, horse.id));
}

/** A horse registered by paying the fee in T-USDG. */
async function registered(p: Player, overrides: Partial<HorseRow> & { sex?: "male" | "female" } = {}): Promise<HorseRow> {
  const horse = await makeHorse(h.db, p.stableId, { origin: "bred", ...overrides });
  await withStarts(horse, p.stableId);
  const reg = await quoteUsdgRegistration(h.db, { accountId: p.accountId, horseId: horse.id, termsAccepted: true, chain: PRACTICE, now: T0 }, POLICY);
  expect((await payUsdgOrderPractice(h.db, { orderId: reg.orderId, accountId: p.accountId, now: T0 }, POLICY)).status).toBe("fulfilled");
  return getHorseRow(h.db, horse.id);
}

const burnBalance = async () => {
  const [r] = await h.db.select({ b: ledgerAccounts.balance }).from(ledgerAccounts).where(eq(ledgerAccounts.id, await practiceSystemAccountId(h.db, "burn")));
  return Number(r?.b ?? 0);
};

describe("the practice grant", () => {
  it("needs a verified wallet, is granted once per account (100 T-USDG), and never touches credits", async () => {
    const p = await newPlayer(h.db, { credits: 5_000 });
    await expect(grantPracticeUsdg(h.db, { accountId: p.accountId, now: T0, env: ON })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await linkVerifiedWallet(h.db, { accountId: p.accountId, address: `0x${randomBytes(20).toString("hex")}`, now: T0 });
    // Outside practice mode no T-USDG is ever created.
    for (const env of [{}, { USDG_MODE: "live" }, { USDG_MODE: "PRACTICE" }]) await expect(grantPracticeUsdg(h.db, { accountId: p.accountId, now: T0, env })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(0);
    expect(await grantPracticeUsdg(h.db, { accountId: p.accountId, now: T0, env: ON })).toEqual({ granted: true, balance: GRANT });
    expect(await grantPracticeUsdg(h.db, { accountId: p.accountId, now: at(DAY), env: ON })).toEqual({ granted: false, balance: GRANT });
    const both = await Promise.all([grantPracticeUsdg(h.db, { accountId: p.accountId, now: T0, env: ON }), grantPracticeUsdg(h.db, { accountId: p.accountId, now: T0, env: ON })]);
    expect(both.every((r) => !r.granted)).toBe(true);
    expect(GRANT).toBe(100 * USD);
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(GRANT);
    expect(await getBalance(h.db, p.accountId)).toBe(5_000);
    // The credits views still see one credits account (they'd break on a second player row).
    const fin = await stableFinances(h.db, { stableId: p.stableId, period: "all_time", now: at(DAY) });
    expect(fin).toBeTruthy();
    expect((await ledgerHealth(h.db)).driftedAccounts).toEqual([]);
  });

  it("T-USDG can't be converted to or from credits: a transaction mixing currencies is refused", async () => {
    const p = await player();
    const credits = await playerLedgerAccountId(h.db, p.accountId);
    const practice = await practiceLedgerAccountId(h.db, p.accountId);
    await expect(
      post(h.db, {
        idempotencyKey: `mix:${p.accountId}`,
        kind: "test_mix",
        postings: [
          { ledgerAccountId: practice, amount: -USD },
          { ledgerAccountId: credits, amount: USD },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(GRANT);
  });

  it("admin top-up: bounded, idempotent per key", async () => {
    const p = await player();
    expect(await topUpPracticeUsdg(h.db, { accountId: p.accountId, amount: 50 * USD, idempotencyKey: "t1", actor: null, now: T0, env: ON })).toEqual({ duplicate: false, balance: GRANT + 50 * USD });
    expect(await topUpPracticeUsdg(h.db, { accountId: p.accountId, amount: 50 * USD, idempotencyKey: "t1", actor: null, now: T0, env: ON })).toEqual({ duplicate: true, balance: GRANT + 50 * USD });
    await expect(topUpPracticeUsdg(h.db, { accountId: p.accountId, amount: gc.PRACTICE_USDG_TOPUP_MAX + 1, idempotencyKey: "t2", actor: null, now: T0, env: ON })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("practice payments", () => {
  it("registration: the fee goes to the practice burn and the horse is registered", async () => {
    const p = await player();
    const burn0 = await burnBalance();
    const horse = await registered(p);
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(GRANT - POLICY.registrationFee);
    expect((await burnBalance()) - burn0).toBe(POLICY.registrationFee);
    const [reg] = await h.db.select().from(usdgRegistrations).where(eq(usdgRegistrations.horseId, horse.id));
    expect(reg).toBeTruthy();
  });

  it("fixed price: the buyer pays exactly the price, the seller gets price - 5 %, the fee is burned; idempotent", async () => {
    const seller = await player();
    const buyer = await player();
    const horse = await registered(seller);
    const listing = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 40 * USD, duration: 7, now: T0 }, POLICY);
    const order = await quoteUsdgSale(h.db, { accountId: buyer.accountId, listingId: listing.id, chain: PRACTICE, now: T0 }, POLICY);
    const fee = gc.usdgFee(40 * USD, POLICY.feeBps);
    expect(fee).toBe(2 * USD);
    const [sellerBefore, burnBefore] = [await practiceUsdgBalance(h.db, seller.accountId), await burnBalance()];
    const r = await payUsdgOrderPractice(h.db, { orderId: order.orderId, accountId: buyer.accountId, now: at(MIN) }, POLICY);
    expect(r).toMatchObject({ status: "fulfilled", duplicate: false });
    expect(await practiceUsdgBalance(h.db, buyer.accountId)).toBe(GRANT - 40 * USD);
    expect((await practiceUsdgBalance(h.db, seller.accountId)) - sellerBefore).toBe(38 * USD);
    expect((await burnBalance()) - burnBefore).toBe(fee);
    expect((await getHorseRow(h.db, horse.id)).ownerStableId).toBe(buyer.stableId);
    // Paying again moves nothing.
    expect(await payUsdgOrderPractice(h.db, { orderId: order.orderId, accountId: buyer.accountId, now: at(2 * MIN) }, POLICY)).toMatchObject({ duplicate: true });
    expect(await practiceUsdgBalance(h.db, buyer.accountId)).toBe(GRANT - 40 * USD);
    const [note] = await h.db.select().from(inboxItems).where(eq(inboxItems.dedupeKey, `usdg-practice-sale:${order.orderId}`));
    expect(note?.title).toContain("38 T-USDG");
    expect(note?.title).not.toMatch(/(?<!T-)USDG|\$/);
    expect(await ledgerHealth(h.db)).toMatchObject({ totalPostings: 0, unbalancedTransactions: [], driftedAccounts: [], negativeAccounts: [] });
  });

  it("insufficient balance: refused before any hold (assertPracticeFunds) and at payment (nothing moves)", async () => {
    const seller = await player();
    const buyer = await player();
    const horse = await registered(seller);
    const listing = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 150 * USD, duration: 7, now: T0 }, POLICY);
    await expect(assertPracticeFunds(h.db, buyer.accountId, listing.price)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS", message: expect.stringContaining("T-USDG") });
    // Even if a quote exists (e.g. the balance dropped after it), payment refuses and moves nothing.
    const order = await quoteUsdgSale(h.db, { accountId: buyer.accountId, listingId: listing.id, chain: PRACTICE, now: T0 }, POLICY);
    await expect(payUsdgOrderPractice(h.db, { orderId: order.orderId, accountId: buyer.accountId, now: at(MIN) }, POLICY)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(await practiceUsdgBalance(h.db, buyer.accountId)).toBe(GRANT);
    expect((await getUsdgOrder(h.db, order.orderId))?.status).toBe("pending");
    expect((await getHorseRow(h.db, horse.id)).ownerStableId).toBe(seller.stableId);
  });

  it("a real-money order can't be paid with T-USDG; an expired order can't be paid", async () => {
    const p = await player();
    const horse = await makeHorse(h.db, p.stableId, { origin: "bred" });
    await withStarts(horse, p.stableId);
    const real = await quoteUsdgRegistration(h.db, { accountId: p.accountId, horseId: horse.id, termsAccepted: true, chain: REAL, now: T0 }, POLICY);
    await expect(payUsdgOrderPractice(h.db, { orderId: real.orderId, accountId: p.accountId, now: T0 }, POLICY)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const other = await makeHorse(h.db, p.stableId, { origin: "bred" });
    await withStarts(other, p.stableId);
    const o = await quoteUsdgRegistration(h.db, { accountId: p.accountId, horseId: other.id, termsAccepted: true, chain: PRACTICE, now: T0 }, POLICY);
    await expect(payUsdgOrderPractice(h.db, { orderId: o.orderId, accountId: p.accountId, now: at(POLICY.quoteTtlMs + 1) }, POLICY)).rejects.toMatchObject({ code: "LISTING_EXPIRED" });
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(GRANT);
  });

  it("auction: the winner pays their bid, the seller gets bid - 5 %, a non-payer's lapse offers the next bidder", async () => {
    const seller = await player();
    const a = await player();
    const b = await player();
    const horse = await registered(seller);
    const listing = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "auction", price: 10 * USD, duration: 24, now: T0 }, POLICY);
    let nonce = 0;
    const bidOf = (p: Player, amount: number) => placeUsdgBid(h.db, { accountId: p.accountId, listingId: listing.id, amount, nonce: String(++nonce), signature: `0x${randomBytes(65).toString("hex")}`, signer: p.wallet, now: at(MIN * nonce) }, POLICY);
    await bidOf(b, 10 * USD);
    await bidOf(a, 20 * USD);
    const closed = await closeUsdgAuctions(h.db, { now: at(25 * HOUR), chain: PRACTICE }, POLICY);
    expect(closed.offered[0]?.accountId).toBe(a.accountId);
    // A doesn't pay: the order lapses and B is offered the horse at B's bid.
    const lapse = await expireUsdgOrder(h.db, { orderId: closed.offered[0]!.orderId, now: at(25 * HOUR + POLICY.paymentWindowMs + USDG_ORDER_GRACE_MS + MIN) }, POLICY);
    expect(lapse.next?.accountId).toBe(b.accountId);
    const sellerBefore = await practiceUsdgBalance(h.db, seller.accountId);
    const burnBefore = await burnBalance();
    const payAt = at(25 * HOUR + POLICY.paymentWindowMs + USDG_ORDER_GRACE_MS + 2 * MIN);
    expect(await payUsdgOrderPractice(h.db, { orderId: lapse.next!.orderId, accountId: b.accountId, now: payAt }, POLICY)).toMatchObject({ status: "fulfilled" });
    expect(await practiceUsdgBalance(h.db, a.accountId)).toBe(GRANT);
    expect(await practiceUsdgBalance(h.db, b.accountId)).toBe(GRANT - 10 * USD);
    expect((await practiceUsdgBalance(h.db, seller.accountId)) - sellerBefore).toBe(9.5 * USD);
    expect((await burnBalance()) - burnBefore).toBe(0.5 * USD);
    expect((await getHorseRow(h.db, horse.id)).ownerStableId).toBe(b.stableId);
  });

  it("stud fee: the mare owner pays, the stallion owner gets fee - 5 %, the covering happens; an undeliverable covering charges nothing", async () => {
    const owner = await player();
    const stallion = await registered(owner, { sex: "male", ...retired });
    await setUsdgStudFee(h.db, { accountId: owner.accountId, horseId: stallion.id, fee: 30 * USD, now: T0 }, POLICY);
    const buyer = await player();
    const mare = await makeHorse(h.db, buyer.stableId, { sex: "female", ...retired });
    const order = await quoteUsdgStud(h.db, { accountId: buyer.accountId, sireId: stallion.id, damId: mare.id, chain: PRACTICE, now: T0 }, POLICY);
    const ownerBefore = await practiceUsdgBalance(h.db, owner.accountId);
    const burnBefore = await burnBalance();
    const r = await payUsdgOrderPractice(h.db, { orderId: order.orderId, accountId: buyer.accountId, now: at(MIN) }, POLICY);
    expect(r.status).toBe("fulfilled");
    expect(await practiceUsdgBalance(h.db, buyer.accountId)).toBe(GRANT - 30 * USD);
    expect((await practiceUsdgBalance(h.db, owner.accountId)) - ownerBefore).toBe(28.5 * USD);
    expect((await burnBalance()) - burnBefore).toBe(1.5 * USD);
    expect((await getUsdgOrder(h.db, order.orderId))?.breedingEventId).toBeTruthy();
    const [note] = await h.db.select().from(inboxItems).where(eq(inboxItems.dedupeKey, `usdg-stud-paid:${order.orderId}`));
    expect(note?.title).toContain("28.5 T-USDG");
    expect(note?.title).not.toContain("wallet");

    // A second mare booked, then the stallion goes to the Legacy Farm before she's paid for.
    const mare2 = await makeHorse(h.db, buyer.stableId, { sex: "female", ...retired });
    const o2 = await quoteUsdgStud(h.db, { accountId: buyer.accountId, sireId: stallion.id, damId: mare2.id, chain: PRACTICE, now: at(13 * HOUR) }, POLICY);
    {
      await h.db.update(horses).set({ careerStatus: "pasture", pasturedAt: at(13 * HOUR) }).where(eq(horses.id, stallion.id));
      const before = await practiceUsdgBalance(h.db, buyer.accountId);
      await expect(payUsdgOrderPractice(h.db, { orderId: o2.orderId, accountId: buyer.accountId, now: at(13 * HOUR + MIN) }, POLICY)).rejects.toMatchObject({ message: expect.stringContaining("Nothing was charged") });
      expect(await practiceUsdgBalance(h.db, buyer.accountId)).toBe(before);
      expect((await getUsdgOrder(h.db, o2.orderId))?.status).toBe("pending");
    }
  });
});

describe("end-of-beta reset", () => {
  it("dry run counts and changes nothing; apply drains balances, frees locked horses and deletes practice rows only", async () => {
    const seller = await player();
    const buyer = await player();
    const horse = await registered(seller);
    const listing = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 5 * USD, duration: 7, now: T0 }, POLICY);
    // A real (non-practice) registration must survive.
    const realOwner = await player();
    const realHorse = await makeHorse(h.db, realOwner.stableId, { origin: "bred" });
    await withStarts(realHorse, realOwner.stableId);
    const realOrder = await quoteUsdgRegistration(h.db, { accountId: realOwner.accountId, horseId: realHorse.id, termsAccepted: true, chain: REAL, now: T0 }, POLICY);

    const dry = await resetPracticeUsdg(h.db, { apply: false, now: at(DAY) });
    expect(dry.applied).toBe(false);
    expect(dry.accounts).toBeGreaterThan(0);
    expect(dry.openListings).toBeGreaterThan(0);
    expect(dry.registrations).toBeGreaterThan(0);
    expect(await practiceUsdgBalance(h.db, buyer.accountId)).toBe(GRANT);
    expect((await getHorseRow(h.db, horse.id)).lockKind).toBe("market");

    const done = await resetPracticeUsdg(h.db, { apply: true, now: at(DAY) });
    expect(done).toMatchObject({ ...dry, applied: true });
    expect(await practiceUsdgBalance(h.db, buyer.accountId)).toBe(0);
    expect(await practiceUsdgBalance(h.db, seller.accountId)).toBe(0);
    expect((await getHorseRow(h.db, horse.id)).lockKind).toBeNull();
    expect(await h.db.select().from(usdgListings).where(eq(usdgListings.id, listing.id))).toEqual([]);
    expect(await h.db.select().from(usdgOrders).where(eq(usdgOrders.marketAddress, USDG_PRACTICE_MARKET))).toEqual([]);
    expect(await h.db.select().from(usdgBids)).toEqual([]);
    expect(await getUsdgOrder(h.db, realOrder.orderId)).toBeTruthy();
    expect(await getBalance(h.db, buyer.accountId)).toBe(50_000);
    expect(await ledgerHealth(h.db)).toMatchObject({ totalPostings: 0, unbalancedTransactions: [], driftedAccounts: [], negativeAccounts: [] });
    // A second run finds nothing left.
    expect(await resetPracticeUsdg(h.db, { apply: false, now: at(2 * DAY) })).toMatchObject({ accounts: 0, orders: 0, listings: 0, registrations: 0 });
  });
});

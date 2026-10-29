/**
 * The USDG horse market end to end on the mock chain (WEB3_ENABLED off): register a horse
 * (requirements, signed RegistrationOrder, simulated payment, idempotent fulfilment), sell it at a
 * fixed price, and run an auction with wallet-signed bids, a non-paying winner, the fallback to
 * the next bidder and the non-payer bar. Also: config modes, horseRef parity with viem, and the
 * EVM signer producing orders HorseMarket would accept (recovers to the server key).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress, keccak256, recoverTypedDataAddress, toBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createAccount, createDb, gameCoreHooks, getHorse, insertHorse, linkVerifiedWallet, schema, stableOf, type DbHandle } from "@thoroughbred/db";
import * as gc from "@thoroughbred/game-core";
import { bidTypedData, registrationOrderFromJson, saleOrderFromJson, saleOrderTypedData } from "@/lib/chain/usdg";
import { marketView } from "../economy";
import type { Session } from "../session";
import { BetaConfigError } from "./config";
import { UsdgUnavailableError, bid, buyFixed, confirmUsdgOrder, listHorseForUsdg, mockPay, myOrder, registerHorse, usdgBackstop, usdgHorseView, usdgMarketView, type UsdgCtx } from "./usdg";
import { EvmUsdgChain, MockUsdgChain } from "./usdgChain";
import { MOCK_MARKET, MOCK_USDG, readUsdgConfig } from "./usdgConfig";

let h: DbHandle;
let ctx: UsdgCtx;
const T0 = new Date(Date.UTC(2026, 10, 3, 12, 0, 0));
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(T0.getTime() + ms);
const USD = gc.USDG_UNIT;
const POLICY = gc.DEFAULT_USDG_POLICY;

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
  const cfg = readUsdgConfig({});
  ctx = { db: h.db, chain: new MockUsdgChain(cfg.chainId, cfg.market, cfg.token), cfg, policy: POLICY };
});
afterAll(async () => {
  await h.close();
});

type Player = Session & { key: PrivateKeyAccount };
let n = 0;
async function player(): Promise<Player> {
  const acc = await createAccount(h.db, { stableName: `USDG ${++n}`, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
  const key = privateKeyToAccount(generatePrivateKey());
  await linkVerifiedWallet(h.db, { accountId: acc.accountId, address: key.address, now: T0 });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId), key };
}

let races = 0;
/** A bred, racing-age horse with `starts` settled Live starts. */
async function horseWithStarts(p: Player, starts = POLICY.minLiveStarts): Promise<string> {
  const spec = gameCoreHooks.starterHorse({ seed: `usdg-horse-${++races}`, index: 0, season: 1 });
  const id = await insertHorse(h.db, { stableId: p.stable.id, spec, origin: "bred", now: T0 });
  for (let i = 0; i < starts; i++) {
    const [race] = await h.db
      .insert(schema.races)
      .values({ kind: "scheduled", name: `Live ${races}-${i}`, raceClass: "maiden", conditions: {}, postTime: at(-DAY + i * MIN), entriesCloseAt: at(-DAY + i * MIN - 30_000), status: "settled", seed: "x", seedCommitment: "y" })
      .returning();
    await h.db.insert(schema.raceEntries).values({ raceId: race!.id, horseId: id, stableId: p.stable.id, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
  }
  await h.db.execute(`update horses set starts = ${starts} where id = '${id}'`);
  return id;
}

async function registeredHorse(p: Player): Promise<string> {
  const id = await horseWithStarts(p);
  const order = await registerHorse(ctx, p, { horseId: id, termsAccepted: true }, T0);
  expect((await mockPay(ctx, p, order.orderId, T0)).status).toBe("fulfilled");
  return id;
}

async function signBid(p: Player, listingId: string, amount: number, signer = p.key) {
  const nonce = BigInt(Math.floor(Math.random() * 1e12));
  const signature = await signer.signTypedData(bidTypedData({ listingId, amount: BigInt(amount), bidder: getAddress(signer.address), nonce }, ctx.chain.chainId, ctx.chain.market));
  return { listingId, amount, nonce: nonce.toString(), signature };
}

describe("config", () => {
  it("mock in dev/tests, off in production without web3 (unless USDG_MOCK_PAY), live needs the market address and keys", () => {
    expect(readUsdgConfig({}).mode).toBe("mock");
    expect(readUsdgConfig({}).market).toBe(MOCK_MARKET);
    expect(readUsdgConfig({ NODE_ENV: "production" }).mode).toBe("off");
    expect(readUsdgConfig({ NODE_ENV: "production", USDG_MOCK_PAY: "1" }).mode).toBe("mock");
    expect(readUsdgConfig({ NODE_ENV: "production", WEB3_ENABLED: "true" }).mode).toBe("off"); // no HORSE_MARKET_ADDRESS yet
    const market = "0x1111111111111111111111111111111111111111";
    expect(() => readUsdgConfig({ WEB3_ENABLED: "true", HORSE_MARKET_ADDRESS: market })).toThrow(BetaConfigError);
    const live = readUsdgConfig({ WEB3_ENABLED: "true", HORSE_MARKET_ADDRESS: market, ROBINHOOD_RPC_URL: "http://127.0.0.1:1", QUOTE_SIGNER_PRIVATE_KEY: generatePrivateKey() });
    expect(live).toMatchObject({ mode: "live", chainId: 46630, market: getAddress(market), token: "0x7E955252E15c84f5768B83c41a71F9eba181802F" });
  });

  it("horseRef: game-core's keccak equals viem's", () => {
    const id = "0b4c5d6e-1f20-4a3b-8c9d-0e1f2a3b4c5d";
    expect(gc.usdgHorseRef(id)).toBe(keccak256(toBytes(`posttime:horse:${id}`)));
  });

  it("the EVM signer signs SaleOrders that recover to the server key in HorseMarket's domain", async () => {
    const key = generatePrivateKey();
    const market = "0x2222222222222222222222222222222222222222";
    const evm = new EvmUsdgChain(readUsdgConfig({ WEB3_ENABLED: "true", HORSE_MARKET_ADDRESS: market, ROBINHOOD_RPC_URL: "http://127.0.0.1:1", QUOTE_SIGNER_PRIVATE_KEY: key }));
    const o = { orderId: `0x${"ab".repeat(32)}` as Hex, horseRef: gc.usdgHorseRef("x") as Hex, seller: getAddress(market), buyer: privateKeyToAccount(generatePrivateKey()).address, token: MOCK_USDG, price: 25n * 10n ** 6n, fee: 1_250_000n, deadline: 2_000_000_000n };
    const sig = await evm.signSale(o);
    expect(await recoverTypedDataAddress({ ...saleOrderTypedData(o, 46630, getAddress(market)), signature: sig })).toBe(privateKeyToAccount(key).address);
  });
});

describe("USDG market on the mock chain", () => {
  it("registration: checklist, signed order, simulated payment, idempotent; registered horses leave the credits market", async () => {
    const p = await player();
    const few = await horseWithStarts(p, 2);
    const v0 = await usdgHorseView(ctx, p, few, T0);
    expect(v0.checks.find((c) => c.key === "live_starts")).toMatchObject({ ok: false, label: `5 Live starts (2 of 5)` });
    await expect(registerHorse(ctx, p, { horseId: few, termsAccepted: true }, T0)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });

    const id = await horseWithStarts(p);
    expect((await usdgHorseView(ctx, p, id, T0)).checks.every((c) => c.ok)).toBe(true);
    await expect(registerHorse(ctx, p, { horseId: id, termsAccepted: false }, T0)).rejects.toThrow(/18 or over/);
    const order = await registerHorse(ctx, p, { horseId: id, termsAccepted: true }, T0);
    expect(order).toMatchObject({ kind: "registration", price: 2 * USD, fee: 2 * USD, mock: true, market: MOCK_MARKET });
    expect(order.signed?.order).toMatchObject({ owner: p.key.address, fee: "2000000", horseRef: gc.usdgHorseRef(id) });
    // A bogus tx hash doesn't settle it and is forgotten.
    const bogus = await confirmUsdgOrder(ctx, p, { orderId: order.orderId, txHash: `0x${"11".repeat(32)}` }, T0);
    expect(bogus.status).toBe("pending");
    const paid = await mockPay(ctx, p, order.orderId, T0);
    expect(paid).toMatchObject({ status: "fulfilled", duplicate: false });
    expect(await mockPay(ctx, p, order.orderId, T0)).toMatchObject({ status: "fulfilled", duplicate: true });
    const v1 = await usdgHorseView(ctx, p, id, T0);
    expect(v1.registered).not.toBeNull();
    expect(v1.listBlock).toBeNull();
    const credits = await marketView(h.db, p, T0);
    expect(credits.horses.find((x) => x.id === id)).toMatchObject({ lock: "usdg_only" });
  });

  it("fixed price: list, buy (signed SaleOrder with the fee split), pay, the horse moves", async () => {
    const seller = await player();
    const buyer = await player();
    const id = await registeredHorse(seller);
    const listing = await listHorseForUsdg(ctx, seller, { horseId: id, kind: "fixed", price: 25 * USD, duration: 7 }, T0);
    const board = await usdgMarketView(ctx, buyer, at(MIN));
    const lot = board.lots.find((l) => l.listingId === listing.listingId)!;
    expect(lot).toMatchObject({ kind: "fixed", price: 25 * USD, fee: 1_250_000, sellerReceives: 23_750_000, mine: false, reserved: false });
    expect(board.network).toMatchObject({ mode: "mock", testnet: true });
    expect(board.network.faucets?.usdg).toMatch(/paxos/);
    expect(board.policy).toMatchObject({ feeBps: 500, minLiveStarts: 5, paymentWindowHours: 24, nonPayerBarDays: 7 });

    const order = await buyFixed(ctx, buyer, listing.listingId, at(MIN));
    const sale = saleOrderFromJson(order.signed!.order);
    expect(sale).toMatchObject({ seller: seller.key.address, buyer: buyer.key.address, price: 25_000_000n, fee: 1_250_000n, horseRef: gc.usdgHorseRef(id) });
    expect((await usdgMarketView(ctx, seller, at(MIN))).mine[0]).toMatchObject({ reserved: true });
    // The wallet pays: the mock HorseMarket refuses another sender, then the buyer's payment settles.
    expect(() => (ctx.chain as MockUsdgChain).simulateSale(sale, { from: seller.key.address })).toThrow(/NotOrderBuyer/);
    expect((await mockPay(ctx, buyer, order.orderId, at(2 * MIN))).status).toBe("fulfilled");
    expect((await getHorse(h.db, id))!.ownerStableId).toBe(buyer.stable.id);
    expect((await myOrder(ctx, buyer, order.orderId, at(3 * MIN))).status).toBe("fulfilled");
    expect((await usdgHorseView(ctx, buyer, id, at(3 * MIN))).listBlock).toMatch(/Bought recently/);
  });

  it("auction: wallet-signed bids, close to the top bidder, a non-payer is barred and the next bidder buys", async () => {
    const seller = await player();
    const [a, b, c] = [await player(), await player(), await player()];
    const id = await registeredHorse(seller);
    const { listingId } = await listHorseForUsdg(ctx, seller, { horseId: id, kind: "auction", price: 10 * USD, duration: 24 }, T0);
    // A bid signed by a key other than the linked wallet is refused.
    const stranger = privateKeyToAccount(generatePrivateKey());
    await expect(bid(ctx, a, await signBid(a, listingId, 10 * USD, stranger), at(MIN))).rejects.toThrow(/linked wallet/);
    // A signature for a different amount doesn't verify.
    const signed = await signBid(a, listingId, 10 * USD);
    await expect(bid(ctx, a, { ...signed, amount: 11 * USD }, at(MIN))).rejects.toThrow(/linked wallet/);
    expect(await bid(ctx, a, signed, at(MIN))).toMatchObject({ best: 10 * USD, minNext: 10_500_000 });
    await expect(bid(ctx, a, signed, at(MIN))).rejects.toMatchObject({ code: "PRICE_BELOW_FLOOR" }); // a replay never beats itself
    await bid(ctx, b, await signBid(b, listingId, 12 * USD), at(2 * MIN));
    await bid(ctx, c, await signBid(c, listingId, 15 * USD), at(3 * MIN));
    const live = (await usdgMarketView(ctx, a, at(4 * MIN))).lots.find((l) => l.listingId === listingId)!;
    expect(live).toMatchObject({ bestBid: 15 * USD, bidCount: 3, myBestBid: 10 * USD, minNextBid: 15_750_000 });

    // The close (backstop / lazy tick): c is offered the horse at 15 with 24 h to pay.
    const end = at(24 * HOUR);
    expect((await usdgBackstop(ctx, end)).auctionsOffered).toBe(1);
    const cView = await usdgMarketView(ctx, c, end);
    const offer = cView.orders.find((o) => o.auction)!;
    expect(offer).toMatchObject({ price: 15 * USD, fee: 750_000, sellerReceives: 14_250_000 });
    expect(offer.deadlineMs - end.getTime()).toBe(POLICY.paymentWindowMs);
    expect(cView.lots.find((l) => l.listingId === listingId)).toMatchObject({ status: "closed", offeredToMe: true });

    // c never pays: after the window the backstop finds no payment, bars c, offers b at 12.
    const lapse = new Date(offer.deadlineMs + 3 * MIN);
    expect((await usdgBackstop(ctx, lapse)).expired).toBeGreaterThanOrEqual(1);
    const bOffer = (await usdgMarketView(ctx, b, lapse)).orders.find((o) => o.auction)!;
    expect(bOffer.price).toBe(12 * USD);
    expect((await usdgMarketView(ctx, c, lapse)).barredUntilMs).toBe(lapse.getTime() + POLICY.nonPayerBarMs);

    // b pays; the tab closed before confirming: reopening the market finds the payment by orderId.
    const tx = (ctx.chain as MockUsdgChain).simulateSale(saleOrderFromJson(bOffer.signed!.order));
    expect(tx).toMatch(/^0x[0-9a-f]{64}$/);
    const reopened = await usdgMarketView(ctx, b, new Date(lapse.getTime() + MIN));
    expect(reopened.orders.find((o) => o.orderId === bOffer.orderId)).toBeUndefined(); // fulfilled, no longer open
    expect((await getHorse(h.db, id))!.ownerStableId).toBe(b.stable.id);

    // c is barred from other auctions.
    const s2 = await player();
    const id2 = await registeredHorse(s2);
    const other = await listHorseForUsdg(ctx, s2, { horseId: id2, kind: "auction", price: USD, duration: 48 }, lapse);
    await expect(bid(ctx, c, await signBid(c, other.listingId, 2 * USD), lapse)).rejects.toMatchObject({ code: "USDG_BARRED" });
  });

  it("backstop: a payment nobody confirmed is found by orderId and settled; an unpaid quote expires", async () => {
    const p = await player();
    const id = await horseWithStarts(p);
    const order = await registerHorse(ctx, p, { horseId: id, termsAccepted: true }, T0);
    (ctx.chain as MockUsdgChain).simulateRegistration(registrationOrderFromJson(order.signed!.order));
    const later = new Date(order.deadlineMs + 3 * MIN);
    expect((await usdgBackstop(ctx, later)).settled).toBeGreaterThanOrEqual(1);
    expect((await usdgHorseView(ctx, p, id, later)).registered).not.toBeNull();

    const id2 = await horseWithStarts(p);
    const unpaid = await registerHorse(ctx, p, { horseId: id2, termsAccepted: true }, T0);
    await usdgBackstop(ctx, later);
    expect((await myOrder(ctx, p, unpaid.orderId, later)).status).toBe("expired");
    // The horse can register again with a fresh order.
    expect((await registerHorse(ctx, p, { horseId: id2, termsAccepted: true }, later)).orderId).not.toBe(unpaid.orderId);
  });

  it("is 'coming soon' when the market is off", async () => {
    const p = await player();
    const id = await horseWithStarts(p);
    const off: UsdgCtx = { ...ctx, cfg: { ...ctx.cfg, mode: "off" } };
    await expect(registerHorse(off, p, { horseId: id, termsAccepted: true }, T0)).rejects.toBeInstanceOf(UsdgUnavailableError);
    await expect(mockPay({ ...ctx, cfg: { ...ctx.cfg, mode: "live" } }, p, `0x${"00".repeat(32)}`, T0)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/**
 * Practice mode (USDG_MODE=practice, docs/usdg-market.md "Practice mode") at the server layer:
 * the config (no RPC, no signer, no token, whatever else is set), the one-off 100 T-USDG grant on
 * wallet sign-in / link, every USDG flow paid from the T-USDG balance (registration, fixed-price
 * buy, auction, USDG stud fee) with exact amounts, refusals before anything is held (no wallet,
 * short balance), Premium Packs bought with T-USDG (charged exactly, caps kept, no ETH quote),
 * every real-money path refused (ETH checkout, confirm, Prize Pool posting, commissions), the
 * admin top-up and the reset (dry run vs apply), and no chain / RPC / signer call at all:
 * every chain method is a spy that must never be called, and so is fetch.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  createAccount,
  createDb,
  gameCoreHooks,
  getChainOrder,
  getUsdgOrder,
  insertHorse,
  linkVerifiedWallet,
  practiceUsdgBalance,
  schema,
  stableOf,
  type DbHandle,
} from "@thoroughbred/db";
import * as gc from "@thoroughbred/game-core";
import { bidTypedData } from "@/lib/chain/usdg";
import { inviteView } from "./affiliates";
import { betaChain, MockBetaChain } from "./adapter";
import { CheckoutUnavailableError, checkoutBackstop, confirmCheckout, practiceCheckout, quoteCheckout, type CheckoutCtx } from "./checkout";
import { BetaConfigError, readBetaConfig } from "./config";
import { computeEpochDraft, postEpochWithServer } from "./pool";
import { practiceWording } from "./practice";
import { PriceService } from "./price";
import { linkWallet, siweAddress, walletChallenge } from "./wallet";
import {
  bid,
  bookUsdgStud,
  buyFixed,
  confirmUsdgOrder,
  listHorseForUsdg,
  mockPay,
  myOrder,
  practiceAdmin,
  practicePay,
  registerHorse,
  standAtStudForUsdg,
  usdgAdminView,
  usdgBackstop,
  usdgMarketView,
  type UsdgCtx,
} from "./usdg";
import { PracticeUsdgChain, usdgChain } from "./usdgChain";
import { PRACTICE_MARKET, readUsdgConfig } from "./usdgConfig";
import { packsView, pull } from "../economy";
import { walletAuthChallengeResponse, walletAuthVerifyResponse } from "../walletAuth";
import type { Session } from "../session";

const ON = { USDG_MODE: "practice" };
let h: DbHandle;
let ctx: UsdgCtx;
let cctx: CheckoutCtx;
let fetchSpy: MockInstance<typeof fetch>;
const chainSpies: ReturnType<typeof vi.spyOn>[] = [];

const T0 = new Date(Date.UTC(2026, 10, 3, 12, 0, 0)); // a Tuesday
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(T0.getTime() + ms);
const USD = gc.USDG_UNIT;
const POLICY = gc.DEFAULT_USDG_POLICY;
const GRANT = gc.PRACTICE_USDG_GRANT;

/** Every method of `obj` becomes a spy; the test asserts none was ever called. */
function spyAll(obj: object, methods: string[]) {
  for (const m of methods) chainSpies.push(vi.spyOn(obj as Record<string, () => unknown>, m as never));
}

beforeAll(async () => {
  vi.stubEnv("USDG_MODE", "practice");
  h = await createDb({ url: null, pglite: "memory" });
  const cfg = readUsdgConfig(ON);
  const chain = new PracticeUsdgChain(cfg.chainId, cfg.market, cfg.token);
  spyAll(chain, ["signSale", "signRegistration", "signStud", "verifyPayment", "findPaymentTx", "verifyBid", "marketState"]);
  ctx = { db: h.db, chain, cfg, policy: POLICY };
  const beta = new MockBetaChain(46630);
  spyAll(beta, ["signQuote", "verifyEthPurchase", "findPurchaseTx", "storeState", "poolState", "postEpoch", "epoch"]);
  const price = new PriceService({ source: "fixed:3000" });
  spyAll(price, ["get"]);
  cctx = { db: h.db, chain: beta, price, cfg: readBetaConfig(ON) };
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await h.close();
});
afterEach(() => {
  // No chain, no RPC, no signer, no price feed: not a single call, ever.
  for (const s of chainSpies) expect(s).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
});

type Player = Session & { key: PrivateKeyAccount };
let n = 0;
async function player(opts: { wallet?: boolean } = {}): Promise<Player> {
  const acc = await createAccount(h.db, { stableName: `Practice ${++n}`, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
  const key = privateKeyToAccount(generatePrivateKey());
  await h.db.execute(`update stables set stall_slots = 24 where account_id = '${acc.accountId}'`);
  if (opts.wallet !== false) await linkVerifiedWallet(h.db, { accountId: acc.accountId, address: key.address, now: T0 });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId), key };
}

let races = 0;
async function horseWithStarts(p: Player, extra = ""): Promise<string> {
  const spec = gameCoreHooks.starterHorse({ seed: `practice-horse-${++races}`, index: 0, season: 1 });
  const id = await insertHorse(h.db, { stableId: p.stable.id, spec, origin: "bred", now: T0 });
  for (let i = 0; i < POLICY.minLiveStarts; i++) {
    const [race] = await h.db
      .insert(schema.races)
      .values({ kind: "scheduled", name: `Live ${races}-${i}`, raceClass: "maiden", conditions: {}, postTime: at(-DAY + i * MIN), entriesCloseAt: at(-DAY + i * MIN - 30_000), status: "settled", seed: "x", seedCommitment: "y" })
      .returning();
    await h.db.insert(schema.raceEntries).values({ raceId: race!.id, horseId: id, stableId: p.stable.id, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
  }
  await h.db.execute(`update horses set starts = ${POLICY.minLiveStarts}${extra} where id = '${id}'`);
  return id;
}

async function registered(p: Player, extra = ""): Promise<string> {
  const id = await horseWithStarts(p, extra);
  const order = await registerHorse(ctx, p, { horseId: id, termsAccepted: true }, T0);
  expect(order).toMatchObject({ practice: true, signed: null });
  expect(await practicePay(ctx, p, order.orderId, T0)).toMatchObject({ status: "fulfilled" });
  return id;
}

const bal = (p: Player) => practiceUsdgBalance(h.db, p.accountId);
async function horseRow(horseId: string) {
  const r = await h.db.execute(`select owner_stable_id, lock_kind from horses where id = '${horseId}'`);
  return ((r as unknown as { rows: { owner_stable_id: string | null; lock_kind: string | null }[] }).rows ?? [])[0]!;
}
const ownerOf = async (horseId: string) => (await horseRow(horseId)).owner_stable_id;

describe("config", () => {
  it("practice wins over every live setting: no RPC, no signer, no real market, beta money off", () => {
    const live = { ...ON, WEB3_ENABLED: "true", HORSE_MARKET_ADDRESS: "0x1111111111111111111111111111111111111111", ROBINHOOD_RPC_URL: "http://127.0.0.1:1", QUOTE_SIGNER_PRIVATE_KEY: generatePrivateKey() };
    expect(readUsdgConfig(live)).toMatchObject({ mode: "practice", rpcUrl: null, signerKey: null, market: PRACTICE_MARKET });
    expect(readBetaConfig(live)).toMatchObject({ enabled: false, practice: true });
    expect(usdgChain(live)).toBeInstanceOf(PracticeUsdgChain);
    expect(betaChain(live)).toBeInstanceOf(MockBetaChain);
    // A near miss is an error, never real money by accident; other values are simply "not practice".
    expect(() => readBetaConfig({ USDG_MODE: "Practice" })).toThrow(BetaConfigError);
    expect(readBetaConfig({ USDG_MODE: "live" }).practice).toBe(false);
  });
});

describe("the one-off grant on wallet sign-in", () => {
  it("100 T-USDG once per account when the wallet is linked; again = nothing", async () => {
    const p = await player({ wallet: false });
    expect(await bal(p)).toBe(0);
    const beta = new MockBetaChain(46630);
    for (let i = 0; i < 2; i++) {
      const ch = await walletChallenge(h.db, p, { address: p.key.address, host: "beta.example", proto: "https", chainId: 46630, now: at(i * MIN) });
      expect(siweAddress(ch.message)).toBe(p.key.address);
      expect(ch.message).toContain("T-USDG is test money");
      await linkWallet(h.db, beta, p, { nonce: ch.nonce, signature: await p.key.signMessage({ message: ch.message }), now: at(i * MIN) });
    }
    expect(await bal(p)).toBe(GRANT);
    const grants = (await h.db.select().from(schema.ledgerTransactions)).filter((t) => t.idempotencyKey === `usdg-practice:grant:${p.accountId}`);
    expect(grants).toHaveLength(1);
    // The market view shows it, in T-USDG wording.
    const view = practiceWording(await usdgMarketView(ctx, p, T0));
    expect(view.practice).toEqual({ balance: GRANT, grant: GRANT });
    expect(view.network).toMatchObject({ mode: "practice", faucets: null, explorer: null });
    expect(JSON.stringify(view)).not.toMatch(/(?<![A-Za-z-])USDG\b/);
  });
});

describe("the grant on SIWE sign-in (/api/auth/wallet/verify)", () => {
  it("signing in with the wallet grants once; signing in again grants nothing", async () => {
    const p = await player(); // wallet linked earlier, before practice mode: nothing granted yet
    expect(await bal(p)).toBe(0);
    const env = { APP_HOSTS: "beta.example" };
    for (let i = 0; i < 2; i++) {
      const ch = (await (await walletAuthChallengeResponse(h.db, { address: p.key.address, host: "beta.example", proto: "https", ip: `7.7.7.${i}`, now: at(i * MIN), env })).json()) as { nonce: string; message: string };
      const res = await walletAuthVerifyResponse(h.db, { body: { nonce: ch.nonce, signature: await p.key.signMessage({ message: ch.message }) }, ip: `7.7.7.${i}`, session: null, now: at(i * MIN), env });
      expect(res.status).toBe(200);
    }
    expect(await bal(p)).toBe(GRANT);
  });
});

describe("USDG flows on the practice ledger", () => {
  it("a wallet is required; registration fee leaves the balance exactly; ETH/chain payment paths are refused", async () => {
    const nowallet = await player({ wallet: false });
    const h0 = await horseWithStarts(nowallet);
    await expect(registerHorse(ctx, nowallet, { horseId: h0, termsAccepted: true }, T0)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    expect(await bal(nowallet)).toBe(0);

    const p = await player();
    const id = await horseWithStarts(p);
    const order = await registerHorse(ctx, p, { horseId: id, termsAccepted: true }, T0);
    await expect(confirmUsdgOrder(ctx, p, { orderId: order.orderId, txHash: `0x${"11".repeat(32)}` }, T0)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(mockPay(ctx, p, order.orderId, T0)).rejects.toBeTruthy();
    expect(await practicePay(ctx, p, order.orderId, T0)).toMatchObject({ status: "fulfilled", duplicate: false });
    expect(await practicePay(ctx, p, order.orderId, T0)).toMatchObject({ duplicate: true });
    expect(await bal(p)).toBe(GRANT - POLICY.registrationFee);
  });

  it("fixed price: buyer pays the price, seller gets price - 5 %; a short balance is refused before the lot is held", async () => {
    const seller = await player();
    const buyer = await player();
    const poor = await player();
    const horse = await registered(seller);
    const sellerStart = await bal(seller);
    const listing = await listHorseForUsdg(ctx, seller, { horseId: horse, kind: "fixed", price: 60 * USD, duration: 7 }, T0);
    // Spend most of `poor`'s balance first so 60 T-USDG is out of reach.
    await registered(poor);
    await registered(poor);
    await practiceAdmin(ctx, { action: "topup", stable: poor.stable.name, amount: 1 * USD, key: `p-${poor.accountId}` }, T0);
    expect(await bal(poor)).toBe(GRANT - 2 * POLICY.registrationFee + USD);
    const drain = await listHorseForUsdg(ctx, seller, { horseId: await registered(seller), kind: "fixed", price: 50 * USD, duration: 7 }, T0);
    const d = await buyFixed(ctx, poor, drain.listingId, T0);
    await practicePay(ctx, poor, d.orderId, T0);
    expect(await bal(poor)).toBeLessThan(60 * USD);
    await expect(buyFixed(ctx, poor, listing.listingId, at(MIN))).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS", message: expect.stringContaining("T-USDG") });
    // Nothing held: the buyer can still take it.
    const order = await buyFixed(ctx, buyer, listing.listingId, at(2 * MIN));
    expect(order).toMatchObject({ practice: true, signed: null, mock: false });
    const sellerBefore = await bal(seller);
    expect(await practicePay(ctx, buyer, order.orderId, at(3 * MIN))).toMatchObject({ status: "fulfilled" });
    expect(await bal(buyer)).toBe(GRANT - 60 * USD);
    expect((await bal(seller)) - sellerBefore).toBe(57 * USD);
    expect(await ownerOf(horse)).toBe(buyer.stable.id);
    expect(sellerStart).toBe(GRANT - POLICY.registrationFee);
  });

  it("auction: the bid is a free EIP-712 signature checked locally; the winner pays from T-USDG at close", async () => {
    const seller = await player();
    const a = await player();
    const b = await player();
    const horse = await registered(seller);
    const listing = await listHorseForUsdg(ctx, seller, { horseId: horse, kind: "auction", price: 10 * USD, duration: 24 }, T0);
    const sign = async (p: Player, amount: number, nonce: bigint, signer = p.key) => ({
      listingId: listing.listingId,
      amount,
      nonce: nonce.toString(),
      signature: await signer.signTypedData(bidTypedData({ listingId: listing.listingId, amount: BigInt(amount), bidder: getAddress(p.key.address), nonce }, ctx.chain.chainId, ctx.chain.market)),
    });
    await expect(bid(ctx, a, await sign(a, 12 * USD, 1n, b.key), at(MIN))).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(bid(ctx, a, await sign(a, 101 * USD, 2n), at(MIN))).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    await bid(ctx, b, await sign(b, 10 * USD, 3n), at(MIN));
    await bid(ctx, a, await sign(a, 20 * USD, 4n), at(2 * MIN));
    const closeAt = at(25 * HOUR);
    expect((await usdgBackstop(ctx, closeAt)).auctionsOffered).toBeGreaterThanOrEqual(1);
    const won = (await usdgMarketView(ctx, a, closeAt)).orders.find((o) => o.horseId === horse)!;
    expect(won).toMatchObject({ auction: true, practice: true, price: 20 * USD });
    const sellerBefore = await bal(seller);
    expect(await practicePay(ctx, a, won.orderId, at(25 * HOUR + MIN))).toMatchObject({ status: "fulfilled" });
    expect(await bal(a)).toBe(GRANT - 20 * USD);
    expect(await bal(b)).toBe(GRANT);
    expect((await bal(seller)) - sellerBefore).toBe(19 * USD);
    expect(await ownerOf(horse)).toBe(a.stable.id);
  });

  it("USDG stud fee: paid in T-USDG to the stallion owner minus 5 %; a short balance is refused before the mare is booked", async () => {
    const owner = await player();
    const stallion = await registered(owner, ", sex = 'male', gelded = false, career_status = 'retired', retirement_reason = 'choice', retired_at = now()");
    await standAtStudForUsdg(ctx, owner, { horseId: stallion, fee: 40 * USD }, T0);
    const mareOf = async (p: Player) => {
      const spec = gameCoreHooks.starterHorse({ seed: `practice-mare-${++races}`, index: 0, season: 1 });
      const id = await insertHorse(h.db, { stableId: p.stable.id, spec, origin: "bred", now: T0 });
      await h.db.execute(`update horses set sex = 'female', gelded = false, career_status = 'retired', retirement_reason = 'choice', retired_at = now(), care_sessions = 40 where id = '${id}'`);
      return id;
    };
    const poor = await player();
    await practiceAdmin(ctx, { action: "reset", apply: false }, T0); // a dry run changes nothing
    expect(await bal(poor)).toBe(0); // not granted yet (no view opened)
    const poorMare = await mareOf(poor);
    await h.db.execute(`update testers set wallet_verified_at = null where account_id = '${poor.accountId}'`);
    await expect(bookUsdgStud(ctx, poor, { sireId: stallion, damId: poorMare }, T0)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });

    const buyer = await player();
    const damId = await mareOf(buyer);
    const order = await bookUsdgStud(ctx, buyer, { sireId: stallion, damId }, T0);
    expect(order).toMatchObject({ kind: "stud", practice: true, price: 40 * USD, fee: 2 * USD, signed: null });
    const ownerBefore = await bal(owner);
    expect(await practicePay(ctx, buyer, order.orderId, at(MIN))).toMatchObject({ status: "fulfilled", horseId: stallion });
    expect(await bal(buyer)).toBe(GRANT - 40 * USD);
    expect((await bal(owner)) - ownerBefore).toBe(38 * USD);
    expect((await myOrder(ctx, buyer, order.orderId, at(MIN))).status).toBe("fulfilled");

    // A second booking after the stallion's rest, from a buyer who can't cover 40 T-USDG: refused before anything is held.
    const rested = new Date(at(MIN).getTime() + gc.STUD_COOLDOWN_MS + MIN);
    const short = await player();
    const shortMare = await mareOf(short);
    const spend = await listHorseForUsdg(ctx, owner, { horseId: await registered(owner), kind: "fixed", price: 70 * USD, duration: 7 }, T0);
    await practicePay(ctx, short, (await buyFixed(ctx, short, spend.listingId, T0)).orderId, T0);
    await expect(bookUsdgStud(ctx, short, { sireId: stallion, damId: shortMare }, rested)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect((await horseRow(shortMare)).lock_kind).toBeNull();
    expect(await getUsdgOrder(h.db, order.orderId)).toBeTruthy();
  });
});

describe("Premium Packs in T-USDG", () => {
  it("charged exactly (1 T-USDG per USD), weekly and beta caps kept, insufficient balance refused before any pull, no ETH quote", async () => {
    const p = await player();
    const packs = await packsView(h.db, p, T0);
    expect(packs.premium.disabledReason).toBe("Pay with T-USDG below");
    await expect(pull(h.db, p, { packType: "premium", free: false, key: "x1" }, T0)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(quoteCheckout(cctx, p, { sku: "premium_pack", quantity: 1, country: null, now: T0 })).rejects.toBeInstanceOf(CheckoutUnavailableError);
    await expect(practiceCheckout(cctx, p, { sku: "premium_pack", quantity: 1, country: "BE", clientKey: "geo-1", now: T0 })).rejects.toMatchObject({ code: "geo_blocked" });

    const price = gc.practiceUsdgFromUsdCents(cctx.cfg.premiumUsdCents);
    expect(price).toBe(4_990_000);
    const r = await practiceCheckout(cctx, p, { sku: "premium_pack", quantity: 2, country: null, clientKey: "buy-001", now: T0 });
    expect(r).toMatchObject({ status: "fulfilled", duplicate: false, charged: 2 * price, balance: GRANT - 2 * price });
    expect(r.pullIds).toHaveLength(2);
    // A double tap is one purchase.
    expect(await practiceCheckout(cctx, p, { sku: "premium_pack", quantity: 2, country: null, clientKey: "buy-001", now: T0 })).toMatchObject({ duplicate: true, charged: 0, balance: GRANT - 2 * price });
    const order = await getChainOrder(h.db, r.orderId);
    expect(order).toMatchObject({ status: "fulfilled", priceWei: "0", ref1AccountId: null, ref2AccountId: null });
    await expect(confirmCheckout(cctx, p, { orderId: r.orderId, txHash: `0x${"22".repeat(32)}`, now: T0 })).rejects.toBeInstanceOf(CheckoutUnavailableError);
    // Weekly cap (5): 3 more is over.
    await expect(practiceCheckout(cctx, p, { sku: "premium_pack", quantity: 4, country: null, clientKey: "buy-002", now: T0 })).rejects.toMatchObject({ code: "PACK_LIMIT" });
    expect(await bal(p)).toBe(GRANT - 2 * price);

    // Insufficient balance: refused before any order or pull.
    const poor = await player();
    const spendTo = await practiceUsdgBalance(h.db, poor.accountId);
    expect(spendTo).toBe(0);
    await practiceCheckout(cctx, poor, { sku: "premium_pack", quantity: 1, country: null, clientKey: "poor-00", now: T0 }); // grants 100, spends 4.99
    const seller = await player();
    const big = await listHorseForUsdg(ctx, seller, { horseId: await registered(seller), kind: "fixed", price: 93 * USD, duration: 7 }, T0);
    await practicePay(ctx, poor, (await buyFixed(ctx, poor, big.listingId, T0)).orderId, T0);
    expect(await bal(poor)).toBeLessThan(price);
    const pullsBefore = (await h.db.select().from(schema.packPulls)).filter((x) => x.accountId === poor.accountId).length;
    await expect(practiceCheckout(cctx, poor, { sku: "premium_pack", quantity: 1, country: null, clientKey: "poor-01", now: T0 })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect((await h.db.select().from(schema.packPulls)).filter((x) => x.accountId === poor.accountId)).toHaveLength(pullsBefore);
    expect((await h.db.select().from(schema.chainOrders)).filter((o) => o.accountId === poor.accountId)).toHaveLength(1);
  });

  it("the beta lifetime cap still applies across weeks", async () => {
    const p = await player();
    await practiceAdmin(ctx, { action: "topup", stable: p.accountId, amount: 50 * USD, key: `life-${p.accountId}` }, T0);
    const per = Math.floor(gc.PREMIUM_BETA_LIFETIME_USD_CENTS / cctx.cfg.premiumUsdCents);
    let bought = 0;
    for (let week = 0; bought < per; week++) {
      const qty = Math.min(5, per - bought);
      await practiceCheckout(cctx, p, { sku: "premium_pack", quantity: qty, country: null, clientKey: `life-w${week}`, now: at(week * 7 * DAY) });
      bought += qty;
    }
    await expect(practiceCheckout(cctx, p, { sku: "premium_pack", quantity: 1, country: null, clientKey: "life-over", now: at(70 * DAY) })).rejects.toMatchObject({ code: "PACK_LIMIT" });
  });
});

describe("real-money paths in practice mode", () => {
  it("ETH checkout backstop, Prize Pool posting and affiliate commissions are off", async () => {
    const p = await player();
    expect(await checkoutBackstop(cctx, T0)).toEqual({ settled: 0, expired: 0, waiting: 0 });
    await expect(computeEpochDraft(cctx, { kind: "weekly", now: T0 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(postEpochWithServer(cctx, "00000000-0000-0000-0000-000000000000", T0)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    expect((await inviteView(h.db, cctx.chain, p, { origin: "https://beta.example", now: T0 })).practice).toBe(true);
    const usdgAdmin = await usdgAdminView(ctx);
    expect(usdgAdmin.market).toEqual({ practice: true });
  });
});

describe("admin", () => {
  it("top-up is idempotent per key; reset is a dry run unless applied", async () => {
    const p = await player();
    await usdgMarketView(ctx, p, T0); // lazy grant
    expect(await practiceAdmin(ctx, { action: "topup", stable: p.stable.name, amount: 5 * USD, key: "adm-1" }, T0)).toMatchObject({ topup: { duplicate: false, balance: GRANT + 5 * USD } });
    expect(await practiceAdmin(ctx, { action: "topup", stable: p.stable.name, amount: 5 * USD, key: "adm-1" }, T0)).toMatchObject({ topup: { duplicate: true } });
    await expect(practiceAdmin(ctx, { action: "topup", stable: "nobody here", amount: USD, key: "adm-2" }, T0)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const dry = (await practiceAdmin(ctx, { action: "reset", apply: false }, T0)) as { reset: { applied: boolean; accounts: number; packOrders: number } };
    expect(dry.reset.applied).toBe(false);
    expect(dry.reset.accounts).toBeGreaterThan(0);
    expect(await bal(p)).toBe(GRANT + 5 * USD);
    const done = (await practiceAdmin(ctx, { action: "reset", apply: true }, at(DAY))) as { reset: { applied: boolean; packOrders: number } };
    expect(done.reset).toMatchObject({ applied: true, packOrders: dry.reset.packOrders });
    expect(await bal(p)).toBe(0);
    expect((await h.db.select().from(schema.chainOrders)).length).toBe(0);
    // Grants are once per account: a reset doesn't re-grant.
    await usdgMarketView(ctx, p, at(DAY));
    expect(await bal(p)).toBe(0);
  });
});

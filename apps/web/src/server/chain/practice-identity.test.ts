/**
 * Practice identity at the server layer (practiceIdentity.ts, docs/usdg-market.md "Practice
 * identity"): the key derivation (HMAC of the account id with LOGIN_CODE_SECRET, a valid secp256k1
 * key, deterministic, never exposed), a tester WITHOUT a wallet in practice mode doing everything
 * T-USDG (grant on founding, register, list, buy, bid with a server signature, win, stud fee, packs,
 * tote), linking a real wallet afterwards (no second grant, same balance, the server-signed bid
 * still wins), the views never carrying the practice address, outside practice mode nothing
 * existing, and the real-money paths (ETH checkout, Prize Pool, affiliates) never seeing it. No
 * chain, RPC, signer or fetch call at all.
 */
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { getAddress, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createAccount,
  createDb,
  gameCoreHooks,
  getChainOrder,
  insertHorse,
  marketWalletOf,
  practiceUsdgBalance,
  schema,
  stableOf,
  verifiedWalletOf,
  type DbHandle,
} from "@thoroughbred/db";
import * as gc from "@thoroughbred/game-core";
import { bidTypedData } from "@/lib/chain/usdg";
import { inviteView } from "./affiliates";
import { MockBetaChain } from "./adapter";
import { CheckoutUnavailableError, practiceBalanceOf, practiceCheckout, quoteCheckout, type CheckoutCtx } from "./checkout";
import { readBetaConfig } from "./config";
import { myAllocations } from "./pool";
import { ensurePracticeGrant, marketIdentityKind } from "./practice";
import { practiceAddressFor, practiceIdentityEnabled, signTypedDataAsPractice } from "./practiceIdentity";
import { PriceService } from "./price";
import { linkWallet, walletChallenge } from "./wallet";
import { bid, bookUsdgStud, buyFixed, listHorseForUsdg, practicePay, registerHorse, standAtStudForUsdg, usdgBackstop, usdgHorseView, usdgMarketView, type UsdgCtx } from "./usdg";
import { PracticeUsdgChain } from "./usdgChain";
import { readUsdgConfig } from "./usdgConfig";
import type { Session } from "../session";

const SECRET = "s".repeat(48);
const ON = { USDG_MODE: "practice", LOGIN_CODE_SECRET: SECRET };
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

let h: DbHandle;
let ctx: UsdgCtx;
let cctx: CheckoutCtx;
let fetchSpy: MockInstance<typeof fetch>;
const chainSpies: ReturnType<typeof vi.spyOn>[] = [];

const T0 = new Date(Date.UTC(2026, 10, 3, 12, 0, 0));
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(T0.getTime() + ms);
const USD = gc.USDG_UNIT;
const POLICY = gc.DEFAULT_USDG_POLICY;
const GRANT = gc.PRACTICE_USDG_GRANT;

function spyAll(obj: object, methods: string[]) {
  for (const m of methods) chainSpies.push(vi.spyOn(obj as Record<string, () => unknown>, m as never));
}

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
  const cfg = readUsdgConfig(ON);
  const chain = new PracticeUsdgChain(cfg.chainId, cfg.market, cfg.token);
  spyAll(chain, ["signSale", "signRegistration", "signStud", "verifyPayment", "findPaymentTx", "verifyBid", "marketState"]);
  ctx = { db: h.db, chain, cfg, policy: POLICY };
  const beta = new MockBetaChain(46630);
  spyAll(beta, ["signQuote", "verifyEthPurchase", "findPurchaseTx", "storeState", "poolState", "postEpoch", "epoch", "claimOf"]);
  const price = new PriceService({ source: "fixed:3000" });
  spyAll(price, ["get"]);
  cctx = { db: h.db, chain: beta, price, cfg: readBetaConfig(ON) };
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
beforeEach(() => {
  vi.stubEnv("USDG_MODE", "practice");
  vi.stubEnv("LOGIN_CODE_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const s of chainSpies) expect(s).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
});
afterAll(async () => {
  await h.close();
});

let n = 0;
async function tester(): Promise<Session> {
  const acc = await createAccount(h.db, { stableName: `Identity ${++n}`, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
  await h.db.execute(`update stables set stall_slots = 24 where account_id = '${acc.accountId}'`);
  // What POST /api/account does in practice mode: the grant right away, no wallet.
  await ensurePracticeGrant(h.db, acc.accountId, T0);
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

let races = 0;
async function horseWithStarts(p: Session, extra = ""): Promise<string> {
  const spec = gameCoreHooks.starterHorse({ seed: `identity-horse-${++races}`, index: 0, season: 1 });
  const id = await insertHorse(h.db, { stableId: p.stable.id, spec, origin: "bred", now: T0 });
  for (let i = 0; i < POLICY.minLiveStarts; i++) {
    const [race] = await h.db
      .insert(schema.races)
      .values({ kind: "scheduled", name: `Identity ${races}-${i}`, raceClass: "maiden", conditions: {}, postTime: at(-DAY + i * MIN), entriesCloseAt: at(-DAY + i * MIN - 30_000), status: "settled", seed: "x", seedCommitment: "y" })
      .returning();
    await h.db.insert(schema.raceEntries).values({ raceId: race!.id, horseId: id, stableId: p.stable.id, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
  }
  await h.db.execute(`update horses set starts = ${POLICY.minLiveStarts}${extra} where id = '${id}'`);
  return id;
}

async function registered(p: Session, extra = ""): Promise<string> {
  const id = await horseWithStarts(p, extra);
  const order = await registerHorse(ctx, p, { horseId: id, termsAccepted: true }, T0);
  expect(order).toMatchObject({ practice: true, signed: null });
  expect(await practicePay(ctx, p, order.orderId, T0)).toMatchObject({ status: "fulfilled" });
  return id;
}

const bal = (p: Session) => practiceUsdgBalance(h.db, p.accountId);
const ownerOf = async (horseId: string) => {
  const r = await h.db.execute(`select owner_stable_id from horses where id = '${horseId}'`);
  return ((r as unknown as { rows: { owner_stable_id: string }[] }).rows ?? [])[0]!.owner_stable_id;
};

describe("the derivation", () => {
  it("is HMAC-SHA256(secret, 'post-time-practice-wallet:<account>') as a secp256k1 key: deterministic, per account, per secret", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const a = practiceAddressFor(id, ON)!;
    expect(a).toBe(getAddress(a));
    expect(practiceAddressFor(id, ON)).toBe(a);
    const k = BigInt(`0x${createHmac("sha256", SECRET).update(`post-time-practice-wallet:${id}`).digest("hex")}`);
    expect(k > 0n && k < N).toBe(true);
    expect(privateKeyToAccount(`0x${k.toString(16).padStart(64, "0")}`).address).toBe(a);
    expect(practiceAddressFor("22222222-2222-2222-2222-222222222222", ON)).not.toBe(a);
    expect(practiceAddressFor(id, { ...ON, LOGIN_CODE_SECRET: "t".repeat(48) })).not.toBe(a);
    // Domain-separated from the login code (same secret, different label).
    expect(createHmac("sha256", SECRET).update(`post-time-login:${id}`).digest("hex")).not.toBe(k.toString(16));
  });

  it("exists only in practice mode with a 32+ character secret", () => {
    const id = "33333333-3333-3333-3333-333333333333";
    for (const env of [{}, { LOGIN_CODE_SECRET: SECRET }, { USDG_MODE: "live", LOGIN_CODE_SECRET: SECRET }, { USDG_MODE: "Practice", LOGIN_CODE_SECRET: SECRET }, { USDG_MODE: "practice" }, { USDG_MODE: "practice", LOGIN_CODE_SECRET: "short" }]) {
      expect(practiceAddressFor(id, env)).toBeNull();
      expect(practiceIdentityEnabled(env)).toBe(false);
    }
    expect(practiceIdentityEnabled(ON)).toBe(true);
  });

  it("signs EIP-712 data for the account (recovers to its address) and refuses outside practice mode", async () => {
    const id = "44444444-4444-4444-4444-444444444444";
    const theBid = { listingId: "x", amount: 5n, bidder: practiceAddressFor(id, ON)!, nonce: 1n };
    const data = bidTypedData(theBid, ctx.chain.chainId, ctx.chain.market);
    const s = await signTypedDataAsPractice(id, data, ON);
    expect(await recoverTypedDataAddress({ ...data, signature: s.signature })).toBe(theBid.bidder);
    await expect(signTypedDataAsPractice(id, data, { LOGIN_CODE_SECRET: SECRET })).rejects.toThrow();
  });
});

describe("practice mode: a tester without a wallet", () => {
  it("gets 100 T-USDG on founding and trades as the stable; the views never carry the practice address", async () => {
    const p = await tester();
    const addr = practiceAddressFor(p.accountId)!;
    expect(await bal(p)).toBe(GRANT);
    expect(await ensurePracticeGrant(h.db, p.accountId, at(MIN))).toEqual({ granted: false, balance: GRANT });
    expect(await marketWalletOf(h.db, p.accountId)).toBe(addr);
    expect(await marketIdentityKind(h.db, p.accountId)).toBe("practice");
    const view = await usdgMarketView(ctx, p, T0);
    expect(view).toMatchObject({ wallet: null, identity: "practice", stableName: p.stable.name, practice: { balance: GRANT } });
    const horse = await horseWithStarts(p);
    const hv = await usdgHorseView(ctx, p, horse, T0);
    expect(hv).toMatchObject({ wallet: null, identity: "practice" });
    expect(hv.checks.find((c) => c.key === "wallet")).toMatchObject({ ok: true, label: expect.stringContaining("no wallet needed") });
    for (const json of [JSON.stringify(view), JSON.stringify(hv)]) expect(json.toLowerCase()).not.toContain(addr.toLowerCase().slice(2));
    expect(await practiceBalanceOf(cctx, p, T0)).toBe(GRANT);
  });

  it("registers, lists, buys, bids (server-signed), wins, pays a stud fee and buys packs", async () => {
    const seller = await tester();
    const buyer = await tester();
    const bidder = await tester();
    const rival = await tester();

    // Fixed price.
    const horse = await registered(seller);
    expect(await bal(seller)).toBe(GRANT - POLICY.registrationFee);
    const lot = await listHorseForUsdg(ctx, seller, { horseId: horse, kind: "fixed", price: 30 * USD, duration: 7 }, T0);
    const order = await buyFixed(ctx, buyer, lot.listingId, at(MIN));
    expect(order).toMatchObject({ practice: true, signed: null });
    expect(await practicePay(ctx, buyer, order.orderId, at(2 * MIN))).toMatchObject({ status: "fulfilled" });
    expect(await ownerOf(horse)).toBe(buyer.stable.id);
    expect(await bal(buyer)).toBe(GRANT - 30 * USD);

    // Auction: no signature from the client, the server signs for the practice identity; a signature sent anyway is ignored.
    const auctionHorse = await registered(seller);
    const auction = await listHorseForUsdg(ctx, seller, { horseId: auctionHorse, kind: "auction", price: 10 * USD, duration: 24 }, T0);
    const forged = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: "not a bid" });
    await bid(ctx, rival, { listingId: auction.listingId, amount: 10 * USD, nonce: "1", signature: null }, at(MIN));
    await bid(ctx, bidder, { listingId: auction.listingId, amount: 20 * USD, nonce: "2", signature: forged }, at(2 * MIN));
    const bids = (await h.db.select().from(schema.usdgBids)).filter((b) => b.listingId === auction.listingId);
    const mine = bids.find((b) => b.accountId === bidder.accountId)!;
    expect(mine.wallet).toBe(practiceAddressFor(bidder.accountId));
    expect(mine.signature).not.toBe(forged.toLowerCase());
    const theBid = { listingId: auction.listingId, amount: BigInt(20 * USD), bidder: getAddress(mine.wallet), nonce: 2n };
    expect(await recoverTypedDataAddress({ ...bidTypedData(theBid, ctx.chain.chainId, ctx.chain.market), signature: mine.signature as `0x${string}` })).toBe(practiceAddressFor(bidder.accountId));
    // Can't bid more than the balance.
    await expect(bid(ctx, rival, { listingId: auction.listingId, amount: 101 * USD, nonce: "3", signature: null }, at(3 * MIN))).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    const closeAt = at(25 * HOUR);
    await usdgBackstop(ctx, closeAt);
    const won = (await usdgMarketView(ctx, bidder, closeAt)).orders.find((o) => o.horseId === auctionHorse)!;
    expect(won).toMatchObject({ auction: true, practice: true, price: 20 * USD });
    expect(await practicePay(ctx, bidder, won.orderId, at(25 * HOUR + MIN))).toMatchObject({ status: "fulfilled" });
    expect(await ownerOf(auctionHorse)).toBe(bidder.stable.id);

    // Stud fee, owner and payer both without wallets.
    const stallion = await registered(seller, ", sex = 'male', gelded = false, career_status = 'retired', retirement_reason = 'choice', retired_at = now()");
    await standAtStudForUsdg(ctx, seller, { horseId: stallion, fee: 20 * USD }, T0);
    const spec = gameCoreHooks.starterHorse({ seed: `identity-mare-${++races}`, index: 0, season: 1 });
    const mare = await insertHorse(h.db, { stableId: buyer.stable.id, spec, origin: "bred", now: T0 });
    await h.db.execute(`update horses set sex = 'female', gelded = false, career_status = 'retired', retirement_reason = 'choice', retired_at = now(), care_sessions = 40 where id = '${mare}'`);
    const stud = await bookUsdgStud(ctx, buyer, { sireId: stallion, damId: mare }, T0);
    expect(stud).toMatchObject({ kind: "stud", practice: true, signed: null });
    const sellerBefore = await bal(seller);
    expect(await practicePay(ctx, buyer, stud.orderId, at(MIN))).toMatchObject({ status: "fulfilled", horseId: stallion });
    expect((await bal(seller)) - sellerBefore).toBe(19 * USD);

    // Premium Packs in T-USDG.
    const r = await practiceCheckout(cctx, rival, { sku: "premium_pack", quantity: 1, country: null, clientKey: "identity-pack-1", now: T0 });
    expect(r).toMatchObject({ status: "fulfilled", charged: gc.practiceUsdgFromUsdCents(cctx.cfg.premiumUsdCents) });
    const packOrder = await getChainOrder(h.db, r.orderId);
    // A practice pack order (placeholder store): the only place the practice address is stored besides market rows.
    expect(packOrder!.storeAddress).toBe("0x0000000000000000000000000000000000007e58");
  });
});

describe("linking a real wallet afterwards", () => {
  it("keeps the balance, gives no second grant, keeps the server-signed bid alive, and shows the wallet from then on", async () => {
    const seller = await tester();
    const p = await tester();
    const horse = await registered(seller);
    const auction = await listHorseForUsdg(ctx, seller, { horseId: horse, kind: "auction", price: 10 * USD, duration: 24 }, T0);
    await bid(ctx, p, { listingId: auction.listingId, amount: 15 * USD, nonce: "11", signature: null }, at(MIN));
    const before = await bal(p);

    // Link a wallet through the real SIWE flow.
    const key = privateKeyToAccount(generatePrivateKey());
    const ch = await walletChallenge(h.db, p, { address: key.address, host: "beta.example", proto: "https", chainId: 46630, now: at(2 * MIN) });
    await linkWallet(h.db, cctx.chain, p, { nonce: ch.nonce, signature: await key.signMessage({ message: ch.message }), now: at(2 * MIN) });
    expect(await verifiedWalletOf(h.db, p.accountId)).toBe(key.address);
    expect(await bal(p)).toBe(before);
    const grants = (await h.db.select().from(schema.ledgerTransactions)).filter((t) => t.idempotencyKey === `usdg-practice:grant:${p.accountId}`);
    expect(grants).toHaveLength(1);
    const view = await usdgMarketView(ctx, p, at(3 * MIN));
    expect(view).toMatchObject({ wallet: key.address, identity: "wallet" });
    // From now on a bid needs the wallet's own signature (no server signing for a wallet holder).
    await expect(bid(ctx, p, { listingId: auction.listingId, amount: 20 * USD, nonce: "12", signature: null }, at(4 * MIN))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const theBid = { listingId: auction.listingId, amount: BigInt(20 * USD), bidder: key.address, nonce: 13n };
    await bid(ctx, p, { listingId: auction.listingId, amount: 20 * USD, nonce: "13", signature: await key.signTypedData(bidTypedData(theBid, ctx.chain.chainId, ctx.chain.market)) }, at(5 * MIN));

    // The close offers the horse at the best bid; paid from the same balance.
    const closeAt = at(25 * HOUR);
    await usdgBackstop(ctx, closeAt);
    const won = (await usdgMarketView(ctx, p, closeAt)).orders.find((o) => o.horseId === horse)!;
    expect(won).toMatchObject({ price: 20 * USD });
    expect(await practicePay(ctx, p, won.orderId, at(25 * HOUR + MIN))).toMatchObject({ status: "fulfilled" });
    expect(await bal(p)).toBe(before - 20 * USD);
  });

  it("an earlier practice-address bid alone still wins after the link", async () => {
    const seller = await tester();
    const p = await tester();
    const horse = await registered(seller);
    const auction = await listHorseForUsdg(ctx, seller, { horseId: horse, kind: "auction", price: 10 * USD, duration: 24 }, T0);
    await bid(ctx, p, { listingId: auction.listingId, amount: 12 * USD, nonce: "21", signature: null }, at(MIN));
    const key = privateKeyToAccount(generatePrivateKey());
    const ch = await walletChallenge(h.db, p, { address: key.address, host: "beta.example", proto: "https", chainId: 46630, now: at(2 * MIN) });
    await linkWallet(h.db, cctx.chain, p, { nonce: ch.nonce, signature: await key.signMessage({ message: ch.message }), now: at(2 * MIN) });
    const closeAt = at(25 * HOUR);
    await usdgBackstop(ctx, closeAt);
    const won = (await usdgMarketView(ctx, p, closeAt)).orders.find((o) => o.horseId === horse);
    expect(won).toMatchObject({ price: 12 * USD, auction: true });
  });
});

describe("outside practice mode nothing changes", () => {
  it("no practice identity, no grant, the market asks for a wallet", async () => {
    vi.stubEnv("USDG_MODE", "");
    const acc = await createAccount(h.db, { stableName: `Identity live ${++n}`, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
    expect(practiceAddressFor(acc.accountId)).toBeNull();
    expect(await marketWalletOf(h.db, acc.accountId)).toBeNull();
    expect(await marketIdentityKind(h.db, acc.accountId)).toBeNull();
    expect(await ensurePracticeGrant(h.db, acc.accountId, T0)).toBeNull();
    expect(await practiceUsdgBalance(h.db, acc.accountId)).toBe(0);
  });
});

describe("real-money paths never see a practice address", () => {
  it("ETH checkout, the Prize Pool and affiliates use the verified wallet only, even while a practice identity exists", async () => {
    const p = await tester();
    expect(practiceAddressFor(p.accountId)).not.toBeNull();
    // Practice mode refuses the ETH quote outright...
    await expect(quoteCheckout(cctx, p, { sku: "premium_pack", quantity: 1, country: null, now: T0 })).rejects.toBeInstanceOf(CheckoutUnavailableError);
    // ...and an ETH-enabled config still demands a verified wallet (never quotes to the practice address).
    const live: CheckoutCtx = { ...cctx, cfg: { ...readBetaConfig({}), enabled: true, chainId: 46630 } };
    await expect(quoteCheckout(live, p, { sku: "premium_pack", quantity: 1, country: null, now: T0 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    expect((await myAllocations(cctx, p, T0)).wallet).toBeNull();
    expect((await inviteView(h.db, cctx.chain, p, { origin: "https://beta.example", now: T0 })).wallet).toBeNull();
    expect(await verifiedWalletOf(h.db, p.accountId)).toBeNull();
  });
});

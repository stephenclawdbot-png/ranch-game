/**
 * Beta money on the mock chain (WEB3 path without a node): SIWE wallet link, ETH quotes
 * (price, 5-min expiry, caps, geo, pricing outage), confirm + idempotent fulfilment, the
 * backstop, referral commissions, and a Prize Pool epoch (compute -> post -> allocations).
 * The same services run against a real Hardhat node in chain-e2e.test.ts (CHAIN_E2E=1).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  claimOwner,
  createAccount,
  createDb,
  earningsOf,
  ensureReferralCode,
  getChainOrder,
  listStableHorses,
  generateInviteCodes,
  recordPlayDay,
  recordReferral,
  schema,
  stableOf,
  type DbHandle,
} from "@thoroughbred/db";
import { MockBetaChain } from "./adapter";
import { CheckoutUnavailableError, checkoutBackstop, confirmCheckout, quoteCheckout, resumeOrders, type CheckoutCtx } from "./checkout";
import { readBetaConfig } from "./config";
import { computeEpochDraft, myAllocations, poolView, postEpochWithServer } from "./pool";
import { PriceService } from "./price";
import { linkWallet, siweAddress, walletChallenge } from "./wallet";
import { quoteFromJson } from "@/lib/chain/quote";
import type { Session } from "../session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 3, 12, 0, 0)); // a Tuesday
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;
const DAY = 86_400_000;

let chain: MockBetaChain;
let ctx: CheckoutCtx;

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
  chain = new MockBetaChain(31337);
  ctx = { db: h.db, chain, price: new PriceService({ source: "fixed:3000" }), cfg: { ...readBetaConfig({}), enabled: true, chainId: 31337 } };
});
afterAll(async () => {
  await h.close();
});

let n = 0;
async function player(): Promise<Session & { key: `0x${string}` }> {
  const acc = await createAccount(h.db, { stableName: `Beta ${++n}`, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId), key: generatePrivateKey() };
}

async function link(p: Session & { key: `0x${string}` }) {
  const acct = privateKeyToAccount(p.key);
  const ch = await walletChallenge(h.db, p, { address: acct.address, host: "beta.example", proto: "https", chainId: 31337, now: T0 });
  expect(siweAddress(ch.message)).toBe(acct.address);
  expect(ch.message).toMatch(/^beta\.example wants you to sign in with your Ethereum account:/);
  return linkWallet(h.db, chain, p, { nonce: ch.nonce, signature: await acct.signMessage({ message: ch.message }), now: T0 });
}

describe("wallet link (SIWE)", () => {
  it("verifies the signature against the signed message and rejects a wrong signer", async () => {
    const p = await player();
    const other = privateKeyToAccount(generatePrivateKey());
    const ch = await walletChallenge(h.db, p, { address: privateKeyToAccount(p.key).address, host: "beta.example", proto: "https", chainId: 31337, now: T0 });
    await expect(linkWallet(h.db, chain, p, { nonce: ch.nonce, signature: await other.signMessage({ message: ch.message }), now: T0 })).rejects.toThrow(/doesn't match/);
    // The nonce was consumed by the failed attempt: a replay can't reuse it.
    await expect(linkWallet(h.db, chain, p, { nonce: ch.nonce, signature: await privateKeyToAccount(p.key).signMessage({ message: ch.message }), now: T0 })).rejects.toThrow();
    const ok = await link(p);
    expect(ok.address).toBe(privateKeyToAccount(p.key).address);
  });
});

describe("ETH checkout (mock chain)", () => {
  it("is 'coming soon' while WEB3_ENABLED is off", async () => {
    const p = await player();
    await link(p);
    await expect(quoteCheckout({ ...ctx, cfg: { ...ctx.cfg, enabled: false } }, p, { sku: "premium_pack", quantity: 1, country: null, now: T0 })).rejects.toBeInstanceOf(CheckoutUnavailableError);
  });

  it("needs a verified wallet; blocks geo-restricted countries; pauses when pricing is unavailable", async () => {
    const p = await player();
    await expect(quoteCheckout(ctx, p, { sku: "premium_pack", quantity: 1, country: null, now: T0 })).rejects.toThrow(/Link your wallet/);
    await link(p);
    await expect(quoteCheckout(ctx, p, { sku: "premium_pack", quantity: 1, country: "BE", now: T0 })).rejects.toMatchObject({ code: "geo_blocked" });
    const down = new PriceService({ source: "coinbase,kraken", fetcher: async () => Promise.reject(new Error("down")), log: () => {} });
    await expect(quoteCheckout({ ...ctx, price: down }, p, { sku: "premium_pack", quantity: 1, country: null, now: T0 })).rejects.toMatchObject({ code: "pricing_unavailable" });
  });

  it("quotes $4.99 ≈ wei at the median price, valid 5 minutes; confirm fulfils once; pool gets 30%", async () => {
    const p = await player();
    await link(p);
    const q = await quoteCheckout(ctx, p, { sku: "premium_pack", quantity: 2, country: "GB", now: T0 });
    expect(q.usdCents).toBe(998);
    expect(BigInt(q.priceWei)).toBe(3_326_667_000_000_000n); // $9.98 / $3,000 = 0.0033266666... ETH, rounded up to a whole gwei
    expect(q.deadlineMs - T0.getTime()).toBe(5 * MIN);
    const quote = quoteFromJson(q.quote);
    expect(quote.deadline).toBe(BigInt((T0.getTime() + 5 * MIN) / 1000));
    expect(quote.ref1).toBe("0x0000000000000000000000000000000000000000");

    // Recover after a reload: the open quote is listed.
    expect((await resumeOrders(ctx, p, at(MIN))).map((o) => o.orderId)).toEqual([q.orderId]);

    const before = (await chain.poolState()).balanceWei;
    const tx = chain.simulatePurchase(quote);
    const res = await confirmCheckout(ctx, p, { orderId: q.orderId, txHash: tx, now: at(MIN) });
    expect(res.status).toBe("fulfilled");
    expect(res.status === "fulfilled" && res.pullIds.length).toBe(2);
    expect((await chain.poolState()).balanceWei - before).toBe((BigInt(q.priceWei) * 3000n) / 10_000n);
    const again = await confirmCheckout(ctx, p, { orderId: q.orderId, txHash: tx, now: at(2 * MIN) });
    expect(again).toMatchObject({ status: "fulfilled", duplicate: true });
    const row = await getChainOrder(h.db, q.orderId);
    expect(row?.poolShareWei).toBe(((BigInt(q.priceWei) * 3000n) / 10_000n).toString());
  });

  it("an expired quote can't be paid, and the backstop expires it", async () => {
    const p = await player();
    await link(p);
    const q = await quoteCheckout(ctx, p, { sku: "premium_pack", quantity: 1, country: null, now: T0 });
    const quote = quoteFromJson(q.quote);
    expect(() => chain.simulatePurchase(quote, { nowSec: quote.deadline + 1n })).toThrow(/OrderExpired/);
    await checkoutBackstop(ctx, at(5 * MIN + 30_000)); // within the grace minute
    expect((await getChainOrder(h.db, q.orderId))?.status).toBe("quoted");
    const r = await checkoutBackstop(ctx, at(7 * MIN));
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect((await getChainOrder(h.db, q.orderId))?.status).toBe("expired");
  });

  it("the backstop fulfils a paid order whose client never confirmed", async () => {
    const p = await player();
    await link(p);
    const q = await quoteCheckout(ctx, p, { sku: "premium_pack", quantity: 1, country: null, now: T0 });
    chain.simulatePurchase(quoteFromJson(q.quote));
    const r = await checkoutBackstop(ctx, at(10 * MIN));
    expect(r.settled).toBeGreaterThanOrEqual(1);
    expect((await getChainOrder(h.db, q.orderId))?.status).toBe("fulfilled");
  });

  it("weekly cap of 10 counts pulled packs AND open quotes; a tx for another order is rejected", async () => {
    const p = await player();
    await link(p);
    const a = await quoteCheckout(ctx, p, { sku: "premium_pack", quantity: 3, country: null, now: T0 });
    await quoteCheckout(ctx, p, { sku: "premium_pack", quantity: 3, country: null, now: T0 });
    const b = await quoteCheckout(ctx, p, { sku: "premium_pack", quantity: 3, country: null, now: T0 });
    await expect(quoteCheckout(ctx, p, { sku: "premium_pack", quantity: 2, country: null, now: T0 })).rejects.toThrow(/weekly limit/);
    // Once the open quotes expire, the cap frees up again.
    await quoteCheckout(ctx, p, { sku: "premium_pack", quantity: 2, country: null, now: at(6 * MIN) });
    const many = p;
    const txB = chain.simulatePurchase(quoteFromJson(b.quote));
    const wrong = await confirmCheckout(ctx, many, { orderId: a.orderId, txHash: txB, now: at(MIN) });
    expect(wrong.status).toBe("rejected");
  });
});

describe("affiliates in checkout (owner at the root)", () => {
  it("signs the inviter (L1) and upstream (L2) into the quote and records the paid commissions", async () => {
    const owner = await player();
    await link(owner);
    await claimOwner(h.db, { accountId: owner.accountId, now: T0 });
    const [root] = await generateInviteCodes(h.db, { count: 1 });
    const alice = await player();
    await link(alice);
    await recordReferral(h.db, { accountId: alice.accountId, code: root!, now: T0 });
    const bob = await player();
    await link(bob);
    await recordReferral(h.db, { accountId: bob.accountId, code: await ensureReferralCode(h.db, alice.accountId), now: T0 });
    const q = await quoteCheckout(ctx, bob, { sku: "premium_pack", quantity: 1, country: null, now: T0 });
    const quote = quoteFromJson(q.quote);
    expect(q.referral).toEqual({ level1: true, level2: true });
    expect(quote.ref1).toBe(privateKeyToAccount(alice.key).address);
    expect(quote.ref1Bps).toBe(1000);
    expect(quote.ref2).toBe(privateKeyToAccount(owner.key).address);
    expect(quote.ref2Bps).toBe(300);
    const tx = chain.simulatePurchase(quote);
    expect((await confirmCheckout(ctx, bob, { orderId: q.orderId, txHash: tx, now: at(MIN) })).status).toBe("fulfilled");
    const earn = [...(await earningsOf(h.db, alice.accountId)), ...(await earningsOf(h.db, owner.accountId))].filter((e) => e.orderId === q.orderId);
    expect(earn.map((e) => [e.level, e.inviterAccountId]).sort()).toEqual([
      [1, alice.accountId],
      [2, owner.accountId],
    ]);
    expect(BigInt(earn.find((e) => e.level === 1)!.amountWei)).toBe((quote.priceWei * 1000n) / 10_000n);

    // Outside the 3-month window: no referrers in the quote.
    const late = await quoteCheckout(ctx, bob, { sku: "premium_pack", quantity: 1, country: null, now: at(91 * DAY) });
    expect(late.referral).toEqual({ level1: false, level2: false });
  });
});

describe("Prize Pool epoch (mock chain)", () => {
  it("computes USD-capped allocations from cup points + activity, posts the root and serves claimable amounts", async () => {
    const week = "2026-11-02";
    chain.balanceWei += 10n ** 18n; // an owner top-up (fund()) so every paid rank clears the dust minimum
    const players = [await player(), await player(), await player()];
    for (const [i, p] of players.entries()) {
      await link(p);
      const horseId = (await listStableHorses(h.db, p.stable.id))[0]!.id;
      await h.db.insert(schema.dailyCupEntries).values({ day: "2026-11-04", accountId: p.accountId, horseId, snapshot: {}, points: 100 - i * 10 });
      for (let d = 0; d < 4; d++) await recordPlayDay(h.db, p.accountId, new Date(Date.UTC(2026, 10, 2 + d, 9)));
    }
    const view = await poolView(ctx, players[0]!, at(0));
    expect(view.standings.length).toBeGreaterThanOrEqual(3);
    expect(view.me?.eligible).toBe(true);
    expect(view.me?.projectedUsdCents).toBeGreaterThan(0);

    const now = new Date(Date.UTC(2026, 10, 10, 9)); // the following Tuesday
    const draft = await computeEpochDraft(ctx, { kind: "weekly", weekStart: week, now });
    expect(draft.epochId).toBe(1);
    expect(draft.allocations.length).toBeGreaterThanOrEqual(3);
    expect(BigInt(draft.totalWei) <= BigInt(draft.budgetWei)).toBe(true);
    for (const a of draft.allocations) expect(a.usdCents).toBeLessThanOrEqual(1_000); // $10 cap
    const posted = await postEpochWithServer(ctx, draft.draftId!, now);
    expect(posted.status).toBe("posted");
    expect((await chain.epoch(1))?.root).toBe(draft.root);

    const mine = await myAllocations(ctx, players[0]!, new Date(now.getTime() + 7 * DAY));
    expect(mine.allocations).toHaveLength(1);
    const a = mine.allocations[0]!;
    expect(BigInt(a.claimableWei)).toBeGreaterThan(0n);
    expect(BigInt(a.claimableWei)).toBeLessThan(BigInt(a.amountWei)); // half vested after 7 of 14 days
    const history = (await poolView(ctx, null, now)).history;
    expect(history[0]).toMatchObject({ epochId: 1, ethUsdMicros: 3_000_000_000 });
  });
});

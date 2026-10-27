/**
 * ETH checkout for Premium Packs (closed beta). Flow:
 *   quote   -> server checks (verified wallet, geo, weekly cap incl. open orders, the $50
 *              beta lifetime cap, stall, crop), prices USD -> wei with the median ETH/USD,
 *              picks eligible referrers, writes the order row FIRST, then signs an EIP-712
 *              EthQuote valid for 5 minutes.
 *   pay     -> the buyer's wallet sends purchaseWithEth with exactly priceWei.
 *   confirm -> the server verifies the receipt (our store's event, buyer, sku, quantity, exact
 *              amount, confirmations) and fulfils idempotently (prepaid pulls keyed by orderId).
 *   backstop-> cron re-checks submitted/paid orders and scans for paid quotes whose client
 *              never reported the tx. Unknown orderIds are never fulfilled.
 */
import type { Address, Hex } from "viem";
import { getAddress } from "viem";
import {
  BETA_SKUS,
  DomainError,
  clearOrderTx,
  createChainOrder,
  foalCropStatus,
  fulfilChainOrder,
  getChainOrder,
  getPackState,
  markOrderSubmitted,
  markOrderUnpaid,
  noteOrderError,
  occupancy,
  openChainOrders,
  ordersNeedingAttention,
  lockPremiumCheckout,
  premiumPacksLifetime,
  recordReferralEarnings,
  referralPlan,
  reservedPremiumPacks,
  runTx,
  seasonNumberAt,
  verifiedWalletOf,
  isDomainError,
  type BetaSku,
  type ChainOrderRow,
  type Db,
} from "@thoroughbred/db";
import { PREMIUM_BETA_LIFETIME_USD_CENTS } from "@thoroughbred/game-core";
import { ZERO_ADDRESS } from "@/lib/chain/chains";
import { quoteToJson, type EthQuote, type EthQuoteJson } from "@/lib/chain/quote";
import { skuId, type BetaChain } from "./adapter";
import type { BetaChainConfig } from "./config";
import { PriceUnavailableError, usdCentsToWeiCeil, type PriceService } from "./price";
import type { Session } from "../session";
import { trackEvent } from "../playtest";

export interface CheckoutCtx {
  db: Db;
  chain: BetaChain;
  price: PriceService;
  cfg: BetaChainConfig;
}

export class CheckoutUnavailableError extends Error {
  constructor(
    readonly code: "coming_soon" | "pricing_unavailable" | "geo_blocked",
    message: string,
  ) {
    super(message);
    this.name = "CheckoutUnavailableError";
  }
}

export interface QuoteView {
  orderId: Hex;
  quote: EthQuoteJson;
  signature: Hex;
  chainId: number;
  store: Address;
  deadlineMs: number;
  usdCents: number;
  priceWei: string;
  ethUsd: number;
  priceSources: { source: string; usd: number | null }[];
  referral: { level1: boolean; level2: boolean };
  mock: boolean;
}

function newOrderId(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** True when real ETH checkout is on (or a test drives a mock chain with enabled config). */
export function checkoutEnabled(cfg: BetaChainConfig): boolean {
  return cfg.enabled;
}

/**
 * The weekly and the $50 beta lifetime cap (AUDIT §6), checked before a quote is signed.
 * Runs twice per quote: once to fail fast, and again inside the order transaction under a
 * per-account advisory lock, so two concurrent quotes can't both pass (e.g. the last pack
 * under the lifetime cap).
 */
async function assertPackCaps(db: Db, session: Session, qty: number, now: Date, premiumUsdCents: number): Promise<void> {
  const st = await getPackState(db, { accountId: session.accountId, packType: "premium", now });
  const reserved = await reservedPremiumPacks(db, { accountId: session.accountId, now });
  if (st.paidThisWeek + reserved + qty > st.weeklyLimit) {
    throw new DomainError("PACK_LIMIT", `weekly limit: ${st.weeklyLimit} Premium Packs a week (${st.paidThisWeek} pulled, ${reserved} in checkout).`);
  }
  // Lifetime: confirmed + pending orders as pack quantity, priced at today's cents. Up to
  // exactly the cap is fine.
  const spent = (await premiumPacksLifetime(db, { accountId: session.accountId, now })) * premiumUsdCents;
  if (spent + premiumUsdCents * qty > PREMIUM_BETA_LIFETIME_USD_CENTS) {
    throw new DomainError("PACK_LIMIT", `Beta limit: $${PREMIUM_BETA_LIFETIME_USD_CENTS / 100} of packs per player`);
  }
}

/** USD cents the tester has already committed to Premium Packs over the beta (confirmed + pending). */
async function spentOnPacks(ctx: CheckoutCtx, session: Session, now: Date): Promise<number> {
  return (await premiumPacksLifetime(ctx.db, { accountId: session.accountId, now })) * ctx.cfg.premiumUsdCents;
}

/** USD cents left under the $50 beta lifetime cap; shown next to the weekly cap in the UI. */
export async function lifetimeLeftCents(ctx: CheckoutCtx, session: Session, now: Date): Promise<number> {
  return Math.max(0, PREMIUM_BETA_LIFETIME_USD_CENTS - (await spentOnPacks(ctx, session, now)));
}

export async function quoteCheckout(ctx: CheckoutCtx, session: Session, input: { sku: BetaSku; quantity: number; country: string | null; now: Date }): Promise<QuoteView> {
  const { db, chain, cfg } = ctx;
  if (!checkoutEnabled(cfg)) throw new CheckoutUnavailableError("coming_soon", "Premium Packs for ETH are coming soon.");
  if (input.country && cfg.blockedCountries.includes(input.country.toUpperCase())) {
    throw new CheckoutUnavailableError("geo_blocked", "Paid packs aren't available in your country.");
  }
  if (!BETA_SKUS[input.sku]) throw new DomainError("INVALID_INPUT", "Unknown item.");
  const qty = input.quantity;
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new DomainError("INVALID_INPUT", "Choose 1 to 10 packs.");
  const wallet = await verifiedWalletOf(db, session.accountId);
  if (!wallet) throw new DomainError("NOT_ELIGIBLE", "Link your wallet first (Profile → Wallet). It takes one free signature.");

  // Weekly cap (pulls this week + open orders), stalls and the foal crop, BEFORE signing.
  await assertPackCaps(db, session, qty, input.now, cfg.premiumUsdCents);
  const occ = await occupancy(db, session.stable);
  if (occ.free < qty) throw new DomainError("STABLE_FULL", `You need ${qty} free stall${qty > 1 ? "s" : ""} for ${qty} foal${qty > 1 ? "s" : ""}.`);
  const crop = await foalCropStatus(db, seasonNumberAt(input.now));
  if (crop.remaining < qty) throw new DomainError("CROP_SOLD_OUT", "This season's foal crop is all spoken for.");

  let price;
  try {
    price = await ctx.price.get();
  } catch (e) {
    if (e instanceof PriceUnavailableError) throw new CheckoutUnavailableError("pricing_unavailable", "Pricing is temporarily unavailable. Please retry in a minute.");
    throw e;
  }
  const usdCents = cfg.premiumUsdCents * qty;
  const priceWei = usdCentsToWeiCeil(usdCents, price.micros);
  const plan = await referralPlan(db, { buyerAccountId: session.accountId, buyerWallet: wallet, usdCents, now: input.now });
  const deadline = new Date(input.now.getTime() + cfg.quoteTtlSec * 1000);
  const orderId = newOrderId();
  const quote: EthQuote = {
    orderId,
    buyer: getAddress(wallet),
    sku: skuId(input.sku),
    quantity: qty,
    priceWei,
    usdCents: BigInt(usdCents),
    ref1: plan.ref1 ? getAddress(plan.ref1.wallet) : ZERO_ADDRESS,
    ref1Bps: plan.ref1?.bps ?? 0,
    ref2: plan.ref2 ? getAddress(plan.ref2.wallet) : ZERO_ADDRESS,
    ref2Bps: plan.ref2?.bps ?? 0,
    deadline: BigInt(Math.floor(deadline.getTime() / 1000)),
  };
  // The caps re-checked and the pending order row written inside one transaction, under a
  // per-account advisory lock: two concurrent quotes for the same last packs can't both
  // pass. The row is still written BEFORE the voucher exists.
  await runTx(db, async (tx) => {
    await lockPremiumCheckout(tx, session.accountId);
    await assertPackCaps(tx, session, qty, input.now, cfg.premiumUsdCents);
    await createChainOrder(tx, {
      orderId,
      accountId: session.accountId,
      wallet,
      sku: input.sku,
      quantity: qty,
      usdCents,
      priceWei,
      ethUsdMicros: price.micros,
      priceSources: { sources: price.sources, fetchedAtMs: price.fetchedAtMs, referralDropped: plan.dropped },
      chainId: chain.chainId,
      storeAddress: chain.store,
      deadline,
      now: input.now,
      ref1: plan.ref1,
      ref2: plan.ref2,
    });
  });
  const signature = await chain.signQuote(quote);
  await trackEvent(db, session.accountId, "checkout_quote", { sku: input.sku, qty, usdCents });
  return {
    orderId,
    quote: quoteToJson(quote),
    signature,
    chainId: chain.chainId,
    store: chain.store,
    deadlineMs: deadline.getTime(),
    usdCents,
    priceWei: priceWei.toString(),
    ethUsd: price.usd,
    priceSources: price.sources.map((s) => ({ source: s.source, usd: s.usd })),
    referral: { level1: !!plan.ref1, level2: !!plan.ref2 },
    mock: chain.kind === "mock",
  };
}

export type SettleResult =
  | { status: "fulfilled"; orderId: string; pullIds: string[]; duplicate: boolean }
  | { status: "pending"; orderId: string; reason: string }
  | { status: "paid_waiting"; orderId: string; reason: string }
  | { status: "rejected"; orderId: string; reason: string };

/** Verifies a paid order on-chain and fulfils it once. Safe to call any number of times. */
export async function settleOrder(ctx: CheckoutCtx, order: ChainOrderRow, txHash: Hex, now: Date): Promise<SettleResult> {
  const { db, chain } = ctx;
  if (order.status === "fulfilled") return { status: "fulfilled", orderId: order.orderId, pullIds: (order.pullIds as string[]) ?? [], duplicate: true };
  const v = await chain.verifyEthPurchase(txHash, {
    orderId: order.orderId as Hex,
    buyer: getAddress(order.wallet),
    sku: skuId(order.sku),
    quantity: order.quantity,
    priceWei: BigInt(order.priceWei),
  });
  if (v.status === "pending") return { status: "pending", orderId: order.orderId, reason: v.reason };
  if (v.status === "rejected") {
    // A tx that doesn't pay this order says nothing about the order itself: only a failed/
    // mismatched tx for it is recorded; the quote can still be paid until its deadline.
    if (order.status === "submitted") await clearOrderTx(db, { orderId: order.orderId, error: `tx ${txHash}: ${v.reason}`, now });
    else await noteOrderError(db, { orderId: order.orderId, error: `tx ${txHash}: ${v.reason}`, now });
    return { status: "rejected", orderId: order.orderId, reason: v.reason };
  }
  try {
    const res = await fulfilChainOrder(db, { orderId: order.orderId, txHash, now, split: { poolShareWei: v.poolShareWei, treasuryWei: v.treasuryWei } });
    await recordReferralEarnings(db, { order: res.order, txHash, commissions: v.commissions, now });
    if (!res.duplicate) await trackEvent(db, order.accountId, "checkout_paid", { sku: order.sku, qty: order.quantity, usdCents: order.usdCents });
    return { status: "fulfilled", orderId: order.orderId, pullIds: res.pulls.map((p) => p.pullId), duplicate: res.duplicate };
  } catch (e) {
    if (!isDomainError(e)) throw e;
    await noteOrderError(db, { orderId: order.orderId, error: `${e.code}: ${e.message}`, now });
    return { status: "paid_waiting", orderId: order.orderId, reason: e.message };
  }
}

export async function confirmCheckout(ctx: CheckoutCtx, session: Session, input: { orderId: string; txHash: string; now: Date }): Promise<SettleResult> {
  const txHash = input.txHash.toLowerCase() as Hex;
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw new DomainError("INVALID_INPUT", "bad transaction hash");
  const order = await markOrderSubmitted(ctx.db, { orderId: input.orderId, accountId: session.accountId, txHash, now: input.now });
  return settleOrder(ctx, order, txHash, input.now);
}

export interface OrderView {
  orderId: string;
  status: string;
  sku: string;
  quantity: number;
  usdCents: number;
  priceWei: string;
  txHash: string | null;
  deadlineMs: number;
  error: string | null;
  pullIds: string[];
  createdAtMs: number;
}

export const orderView = (o: ChainOrderRow): OrderView => ({
  orderId: o.orderId,
  status: o.status,
  sku: o.sku,
  quantity: o.quantity,
  usdCents: o.usdCents,
  priceWei: o.priceWei,
  txHash: o.txHash,
  deadlineMs: o.deadline.getTime(),
  error: o.error,
  pullIds: (o.pullIds as string[] | null) ?? [],
  createdAtMs: o.createdAt.getTime(),
});

/** Orders to resume after a reload; submitted/paid ones are re-checked on the way. */
export async function resumeOrders(ctx: CheckoutCtx, session: Session, now: Date): Promise<OrderView[]> {
  const open = await openChainOrders(ctx.db, { accountId: session.accountId, now });
  for (const o of open) {
    if ((o.status === "submitted" || o.status === "paid") && o.txHash) {
      try {
        await settleOrder(ctx, o, o.txHash as Hex, now);
      } catch (e) {
        console.error("resume order", o.orderId, e);
      }
    }
  }
  return (await openChainOrders(ctx.db, { accountId: session.accountId, now })).map(orderView);
}

export async function orderStatus(ctx: CheckoutCtx, session: Session, orderId: string): Promise<OrderView> {
  const o = await getChainOrder(ctx.db, orderId);
  if (!o || o.accountId !== session.accountId) throw new DomainError("NOT_FOUND", "order not found");
  return orderView(o);
}

/**
 * Cron backstop: settles submitted/paid orders; for quotes past their deadline, looks for a
 * payment on-chain (the client may have closed the tab) and otherwise marks them expired.
 */
export async function checkoutBackstop(ctx: CheckoutCtx, now: Date): Promise<{ settled: number; expired: number; waiting: number }> {
  let settled = 0;
  let expired = 0;
  let waiting = 0;
  if (!ctx.cfg.enabled) return { settled, expired, waiting };
  for (const o of await ordersNeedingAttention(ctx.db, { now })) {
    try {
      let tx = o.txHash as Hex | null;
      if (!tx) tx = await ctx.chain.findPurchaseTx(o.orderId as Hex);
      if (!tx) {
        // Unpaid and past its deadline (+1 min grace for the sequencer): the quote is dead.
        if (o.status === "quoted" && now.getTime() > o.deadline.getTime() + 60_000) {
          await markOrderUnpaid(ctx.db, { orderId: o.orderId, status: "expired", now });
          expired++;
        }
        continue;
      }
      const r = await settleOrder(ctx, o, tx, now);
      if (r.status === "fulfilled") settled++;
      else if (r.status === "paid_waiting") waiting++;
      else if (r.status === "rejected" && now.getTime() > o.deadline.getTime() + 60_000) {
        await markOrderUnpaid(ctx.db, { orderId: o.orderId, status: "rejected", error: r.reason, now });
      }
    } catch (e) {
      console.error("checkout backstop", o.orderId, e);
    }
  }
  return { settled, expired, waiting };
}

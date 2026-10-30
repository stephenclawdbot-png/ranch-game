/**
 * The USDG horse market, server side (docs/usdg-market.md). Rules and persistence live in
 * @thoroughbred/db (services/usdgMarket.ts); this module adds the chain: it signs HorseMarket
 * orders from the order rows the DB wrote first, verifies `Registered` / `Sold` before fulfilling,
 * checks EIP-712 bid signatures against the bidder's linked wallet, runs the backstop (close
 * auctions, expire stale orders, settle paid-but-unconfirmed ones) and, on the mock chain,
 * simulates payments so the whole flow is playable with WEB3_ENABLED off.
 */
import { getAddress, type Address, type Hex } from "viem";
import {
  DomainError,
  clearUsdgOrderTx,
  closeUsdgAuctions,
  delistUsdg,
  expireUsdgListings,
  expireUsdgOrder,
  fulfilUsdgOrder,
  getHorse,
  getUsdgOrder,
  horseNamesByIds,
  isDomainError,
  isUsdgRegistered,
  listStableHorses,
  listUsdg,
  markUsdgOrderSubmitted,
  myUsdgBids,
  myUsdgOrders,
  noteUsdgOrderError,
  occupancy,
  placeUsdgBid,
  quoteUsdgRegistration,
  quoteUsdgSale,
  usdgBarredUntil,
  usdgBoard,
  usdgOrdersForReview,
  usdgOrdersNeedingAttention,
  usdgRegisteredIds,
  usdgRegistrationStatus,
  usdgResaleLock,
  usdgSalesSummary,
  verifiedWalletOf,
  type Db,
  type UsdgChainRef,
  type UsdgOrderRow,
} from "@thoroughbred/db";
import * as gc from "@thoroughbred/game-core";
import { chainInfo } from "@/lib/chain/chains";
import { TESTNET_FAUCETS, isTestnet, orderToJson, saleOrderFromJson, registrationOrderFromJson, type RegistrationOrder, type SaleOrder, type UsdgOrderJson } from "@/lib/chain/usdg";
import type { UsdgCheckView, UsdgHorseView, UsdgLotView, UsdgMarketView, UsdgNetworkView, UsdgPolicyView, UsdgSellable } from "@/lib/usdgTypes";
import { ecoHorse, lotNumbers } from "../economy";
import { parseSilks } from "../horseView";
import type { Session } from "../session";
import type { MockUsdgChain, UsdgChain } from "./usdgChain";
import type { UsdgConfig } from "./usdgConfig";

export interface UsdgCtx {
  db: Db;
  chain: UsdgChain;
  cfg: UsdgConfig;
  policy: gc.UsdgPolicy;
}

export class UsdgUnavailableError extends Error {
  constructor(message = "The USDG market is coming soon.") {
    super(message);
    this.name = "UsdgUnavailableError";
  }
}

const chainRef = (ctx: UsdgCtx): UsdgChainRef => ({ chainId: ctx.chain.chainId, market: ctx.chain.market.toLowerCase(), token: ctx.chain.token.toLowerCase() });

function assertOpen(ctx: UsdgCtx): void {
  if (ctx.cfg.mode === "off") throw new UsdgUnavailableError();
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function networkView(ctx: UsdgCtx): UsdgNetworkView {
  const info = chainInfo(ctx.chain.chainId);
  const testnet = isTestnet(ctx.chain.chainId) || ctx.cfg.mode === "mock";
  return {
    mode: ctx.cfg.mode,
    chainId: ctx.chain.chainId,
    networkName: ctx.cfg.mode === "mock" ? `${info.name} (test mode: payments simulated)` : info.name,
    testnet,
    explorer: ctx.cfg.mode === "live" ? info.explorer : null,
    market: ctx.chain.market,
    token: ctx.chain.token,
    faucets: testnet ? { ...TESTNET_FAUCETS } : null,
  };
}

export function policyView(p: gc.UsdgPolicy): UsdgPolicyView {
  return {
    feeBps: p.feeBps,
    registrationFee: p.registrationFee,
    minPrice: p.minPrice,
    maxPrice: p.maxPrice,
    minLiveStarts: p.minLiveStarts,
    auctionHours: [...p.auctionHours],
    fixedListingDays: [...p.fixedListingDays],
    paymentWindowHours: Math.round(p.paymentWindowMs / 3_600_000),
    nonPayerBarDays: Math.round(p.nonPayerBarMs / 86_400_000),
    bidIncrementBps: p.bidIncrementBps,
    bidIncrementMin: p.bidIncrementMin,
  };
}

const CHECK_LABEL: Record<string, (p: gc.UsdgPolicy, liveStarts: number) => string> = {
  owned: () => "In your stable",
  racing_age: () => "Of racing age",
  live_starts: (p, n) => `${p.minLiveStarts} Live starts (${Math.min(n, p.minLiveStarts)} of ${p.minLiveStarts})`,
  not_legacy_farm: () => "Not on the Legacy Farm",
  not_in_race: () => "Not entered in a race",
  not_listed: () => "Not listed on the credits market",
  not_bound: () => "Not Club-bred (bound horses are never sold)",
  not_starter_or_gift: () => "Not a starter or gift horse",
  not_premium_pull: () => "Not pulled from a Premium Pack itself (its foals can register)",
  wallet: () => "A linked wallet (one free signature)",
  terms: () => "You are 18 or over and accept the USDG market terms",
};

/** Signs the order a row describes (never stored: re-signed on request, so nothing secret sits in the DB). */
async function signedOrder(ctx: UsdgCtx, o: UsdgOrderRow): Promise<UsdgOrderJson["signed"]> {
  if (o.status !== "pending") return null;
  if (o.kind === "sale") {
    const order: SaleOrder = {
      orderId: o.orderId as Hex,
      horseRef: o.horseRef as Hex,
      seller: getAddress(o.sellerWallet!),
      buyer: getAddress(o.wallet),
      token: getAddress(o.token),
      price: BigInt(o.price),
      fee: BigInt(o.fee),
      deadline: BigInt(Math.floor(o.deadline.getTime() / 1000)),
    };
    return { order: orderToJson(order), signature: await ctx.chain.signSale(order) };
  }
  const order: RegistrationOrder = {
    orderId: o.orderId as Hex,
    horseRef: o.horseRef as Hex,
    owner: getAddress(o.wallet),
    token: getAddress(o.token),
    fee: BigInt(o.fee),
    deadline: BigInt(Math.floor(o.deadline.getTime() / 1000)),
  };
  return { order: orderToJson(order), signature: await ctx.chain.signRegistration(order) };
}

export async function orderJson(ctx: UsdgCtx, o: UsdgOrderRow, now: Date, horseName: string | null = null): Promise<UsdgOrderJson> {
  const name = horseName ?? (await getHorse(ctx.db, o.horseId))?.name ?? null;
  return {
    orderId: o.orderId as Hex,
    kind: o.kind as UsdgOrderJson["kind"],
    status: o.status as UsdgOrderJson["status"],
    horseId: o.horseId,
    horseName: name,
    chainId: o.chainId,
    market: getAddress(o.marketAddress) as Address,
    token: getAddress(o.token) as Address,
    price: o.price,
    fee: o.fee,
    sellerReceives: o.price - o.fee,
    deadlineMs: o.deadline.getTime(),
    txHash: o.txHash,
    signed: o.status === "pending" && o.deadline > now ? await signedOrder(ctx, o) : null,
    mock: ctx.chain.kind === "mock",
    auction: !!o.bidId,
  };
}

export async function usdgMarketView(ctx: UsdgCtx, session: Session, now: Date): Promise<UsdgMarketView> {
  const nowMs = now.getTime();
  const board = await usdgBoard(ctx.db, { now });
  const names = await horseNamesByIds(ctx.db, board.flatMap((b) => [b.horse.sireId, b.horse.damId]).filter((x): x is string => !!x));
  const lots = lotNumbers(board.map((b) => b.listing.id));
  const myBids = await myUsdgBids(ctx.db, { accountId: session.accountId });
  const myBest = new Map<string, number>();
  for (const b of myBids) if (b.status !== "void" && b.status !== "defaulted") myBest.set(b.listingId, Math.max(myBest.get(b.listingId) ?? 0, b.amount));
  const view = (b: (typeof board)[number]): UsdgLotView => {
    const l = b.listing;
    const fee = gc.usdgFee(l.price, ctx.policy.feeBps);
    const open = l.kind === "auction" && l.status === "active" && l.endsAt > now;
    return {
      ...ecoHorse(b.horse, parseSilks(b.sellerSilks), nowMs),
      listingId: l.id,
      lot: lots.get(l.id)!,
      kind: l.kind as UsdgLotView["kind"],
      status: l.status as UsdgLotView["status"],
      price: l.price,
      fee,
      sellerReceives: l.price - fee,
      endsAtMs: l.endsAt.getTime(),
      sellerStableName: b.sellerStableName,
      sellerSilks: parseSilks(b.sellerSilks),
      mine: l.sellerAccountId === session.accountId,
      bestBid: b.bestBid,
      bidCount: b.bidCount,
      minNextBid: open ? gc.minNextBid(ctx.policy, l.price, b.bestBid) : null,
      myBestBid: myBest.get(l.id) ?? null,
      reserved: l.kind === "fixed" && !!b.offer,
      offeredToMe: !!b.offer && b.offer.accountId === session.accountId && l.kind === "auction",
      offerDeadlineMs: b.offer?.deadline.getTime() ?? null,
      sireName: b.horse.sireId ? (names.get(b.horse.sireId) ?? null) : null,
      damName: b.horse.damId ? (names.get(b.horse.damId) ?? null) : null,
    };
  };
  const all = board.map(view);
  const rows = (await listStableHorses(ctx.db, session.stable.id)).filter((r) => r.careerStatus !== "pasture");
  const regs = await usdgRegisteredIds(ctx.db, rows.map((r) => r.id));
  const silks = parseSilks(session.stable.silks);
  const registered: UsdgSellable[] = [];
  for (const r of rows.filter((x) => regs.has(x.id))) {
    const mineLot = all.find((l) => l.id === r.id && l.mine);
    registered.push({ ...ecoHorse(r, silks, nowMs), block: mineLot ? "Listed" : await listBlockOf(ctx, session, r.id, now), listingId: mineLot?.listingId ?? null });
  }
  await resumeMyOrders(ctx, session, now);
  const orders: UsdgOrderJson[] = [];
  for (const o of await myUsdgOrders(ctx.db, { accountId: session.accountId, now })) orders.push(await orderJson(ctx, o, now));
  const barred = await usdgBarredUntil(ctx.db, { accountId: session.accountId, now }, ctx.policy);
  const occ = await occupancy(ctx.db, session.stable);
  return {
    network: networkView(ctx),
    policy: policyView(ctx.policy),
    wallet: await verifiedWalletOf(ctx.db, session.accountId),
    barredUntilMs: barred?.getTime() ?? null,
    lots: all.filter((l) => !l.mine),
    mine: all.filter((l) => l.mine),
    orders,
    registered,
    stalls: { used: occ.used, slots: occ.slots, free: occ.free },
    serverNowMs: nowMs,
  };
}

/**
 * After a reload: my open orders are re-checked on-chain (a submitted hash, or a payment found by
 * orderId when the tab closed before confirming), so a paid horse arrives without waiting for the
 * cron. Only my own few orders, so the chain reads stay small.
 */
async function resumeMyOrders(ctx: UsdgCtx, session: Session, now: Date): Promise<void> {
  if (ctx.cfg.mode === "off") return;
  for (const o of await myUsdgOrders(ctx.db, { accountId: session.accountId, now })) {
    try {
      const tx = (o.txHash as Hex | null) ?? (await ctx.chain.findPaymentTx(o.kind as "registration" | "sale", o.orderId as Hex));
      if (tx) await settleUsdgOrder(ctx, o, tx, now);
    } catch (err) {
      console.error("usdg resume", o.orderId, err);
    }
  }
}

/** Why a registered horse can't be listed right now (null = it can), in plain words. */
async function listBlockOf(ctx: UsdgCtx, session: Session, horseId: string, now: Date): Promise<string | null> {
  const h = await getHorse(ctx.db, horseId);
  if (!h || h.ownerStableId !== session.stable.id) return "Not in your stable";
  if (!(await isUsdgRegistered(ctx.db, horseId))) return "Not registered yet";
  if (h.lockKind === "race") return "Entered in a race";
  if (h.lockKind === "market") return "Listed";
  if (h.careerStatus === "pasture") return "On the Legacy Farm";
  const resale = await usdgResaleLock(ctx.db, { horseId, ownerStableId: session.stable.id, ownerAccountId: session.accountId, now });
  if (resale) return `Bought recently: can be listed again after ${resale.until.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC`;
  if (!(await verifiedWalletOf(ctx.db, session.accountId))) return "Link your wallet first";
  return null;
}

export async function usdgHorseView(ctx: UsdgCtx, session: Session, horseId: string, now: Date): Promise<UsdgHorseView> {
  const horse = await getHorse(ctx.db, horseId);
  if (!horse) throw new DomainError("NOT_FOUND", "horse not found");
  const st = await usdgRegistrationStatus(ctx.db, { accountId: session.accountId, horseId, now }, ctx.policy);
  const checks: UsdgCheckView[] = st.checks.map((c) => ({ key: c.key, ok: c.ok, label: CHECK_LABEL[c.key]?.(ctx.policy, st.liveStarts) ?? c.key }));
  const board = (await usdgBoard(ctx.db, { now })).find((b) => b.listing.horseId === horseId);
  return {
    network: networkView(ctx),
    policy: policyView(ctx.policy),
    horseId,
    name: horse.name,
    mine: horse.ownerStableId === session.stable.id,
    registered: st.registered ? { atMs: st.registered.at.getTime() } : null,
    checks,
    liveStarts: st.liveStarts,
    openOrder: st.openOrder ? await orderJson(ctx, st.openOrder, now, horse.name) : null,
    listing: board
      ? { listingId: board.listing.id, kind: board.listing.kind as "fixed" | "auction", status: board.listing.status, price: board.listing.price, endsAtMs: board.listing.endsAt.getTime(), bestBid: board.bestBid, bidCount: board.bidCount }
      : null,
    listBlock: st.registered ? await listBlockOf(ctx, session, horseId, now) : "Not registered yet",
    wallet: await verifiedWalletOf(ctx.db, session.accountId),
    serverNowMs: now.getTime(),
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function registerHorse(ctx: UsdgCtx, session: Session, input: { horseId: string; termsAccepted: boolean }, now: Date): Promise<UsdgOrderJson> {
  assertOpen(ctx);
  const o = await quoteUsdgRegistration(ctx.db, { accountId: session.accountId, horseId: input.horseId, termsAccepted: input.termsAccepted, chain: chainRef(ctx), now }, ctx.policy);
  return orderJson(ctx, o, now);
}

export async function listHorseForUsdg(ctx: UsdgCtx, session: Session, input: { horseId: string; kind: "fixed" | "auction"; price: number; duration: number }, now: Date) {
  assertOpen(ctx);
  const l = await listUsdg(ctx.db, { accountId: session.accountId, ...input, now }, ctx.policy);
  return { listingId: l.id, kind: l.kind, price: l.price, endsAtMs: l.endsAt.getTime() };
}

export async function delistHorse(ctx: UsdgCtx, session: Session, listingId: string, now: Date) {
  await delistUsdg(ctx.db, { accountId: session.accountId, listingId, now });
  return { ok: true };
}

export async function buyFixed(ctx: UsdgCtx, session: Session, listingId: string, now: Date): Promise<UsdgOrderJson> {
  assertOpen(ctx);
  const o = await quoteUsdgSale(ctx.db, { accountId: session.accountId, listingId, chain: chainRef(ctx), now }, ctx.policy);
  return orderJson(ctx, o, now);
}

/**
 * A bid signed by the bidder's wallet (EIP-712 Bid in the HorseMarket domain). The claimed
 * bidder is the account's linked wallet: a signature from any other key is refused.
 */
export async function bid(ctx: UsdgCtx, session: Session, input: { listingId: string; amount: number; nonce: string; signature: Hex }, now: Date) {
  assertOpen(ctx);
  const wallet = await verifiedWalletOf(ctx.db, session.accountId);
  if (!wallet) throw new DomainError("NOT_ELIGIBLE", "Link your wallet first (one free signature).");
  if (!/^\d{1,78}$/.test(input.nonce)) throw new DomainError("INVALID_INPUT", "bad nonce");
  const ok = await ctx.chain.verifyBid({ listingId: input.listingId, amount: BigInt(input.amount), bidder: getAddress(wallet), nonce: BigInt(input.nonce) }, input.signature);
  if (!ok) throw new DomainError("NOT_ELIGIBLE", "That bid wasn't signed by your linked wallet.");
  const r = await placeUsdgBid(ctx.db, { accountId: session.accountId, listingId: input.listingId, amount: input.amount, nonce: input.nonce, signature: input.signature, signer: wallet, now }, ctx.policy);
  return { bidId: r.bid.id, amount: r.bid.amount, best: r.best, minNext: r.minNext };
}

/** The current state of one of my orders, signed again while it is payable. */
export async function myOrder(ctx: UsdgCtx, session: Session, orderId: string, now: Date): Promise<UsdgOrderJson> {
  const o = await getUsdgOrder(ctx.db, orderId);
  if (!o || o.accountId !== session.accountId) throw new DomainError("NOT_FOUND", "order not found");
  return orderJson(ctx, o, now);
}

export type UsdgSettle =
  | { status: "fulfilled"; orderId: string; horseId: string; duplicate: boolean }
  | { status: "pending" | "paid_waiting" | "rejected"; orderId: string; reason: string };

const expectedOf = (order: UsdgOrderRow) => ({
  kind: order.kind as "registration" | "sale",
  orderId: order.orderId as Hex,
  horseRef: order.horseRef as Hex,
  payer: getAddress(order.wallet),
  seller: order.sellerWallet ? getAddress(order.sellerWallet) : undefined,
  price: BigInt(order.price),
  fee: BigInt(order.fee),
});

/** Verifies the payment on-chain and fulfils the order once. Safe to call any number of times. */
export async function settleUsdgOrder(ctx: UsdgCtx, order: UsdgOrderRow, txHash: Hex, now: Date): Promise<UsdgSettle> {
  if (order.status === "fulfilled") return { status: "fulfilled", orderId: order.orderId, horseId: order.horseId, duplicate: true };
  const v = await ctx.chain.verifyPayment(txHash, expectedOf(order));
  if (v.status === "pending") return { status: "pending", orderId: order.orderId, reason: v.reason };
  if (v.status === "rejected") {
    // A tx that doesn't pay this order says nothing about the order: forget the hash.
    await clearUsdgOrderTx(ctx.db, { orderId: order.orderId, error: `tx ${txHash}: ${v.reason}`, now });
    return { status: "rejected", orderId: order.orderId, reason: v.reason };
  }
  try {
    const r = await fulfilUsdgOrder(ctx.db, { orderId: order.orderId, txHash, now }, ctx.policy);
    if (r.status === "paid") return { status: "paid_waiting", orderId: order.orderId, reason: r.order.error ?? "paid; waiting for the organiser" };
    return { status: "fulfilled", orderId: order.orderId, horseId: order.horseId, duplicate: r.duplicate };
  } catch (e) {
    if (!isDomainError(e)) throw e;
    await noteUsdgOrderError(ctx.db, { orderId: order.orderId, error: `${e.code}: ${e.message}`, now });
    return { status: "paid_waiting", orderId: order.orderId, reason: e.message };
  }
}

export async function confirmUsdgOrder(ctx: UsdgCtx, session: Session, input: { orderId: string; txHash: string }, now: Date): Promise<UsdgSettle> {
  const txHash = input.txHash.toLowerCase() as Hex;
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw new DomainError("INVALID_INPUT", "bad transaction hash");
  const prev = await getUsdgOrder(ctx.db, input.orderId);
  if (!prev || prev.accountId !== session.accountId) throw new DomainError("NOT_FOUND", "order not found");
  if (prev.status === "pending" && prev.txHash && prev.txHash !== txHash) {
    // An earlier hash the chain has never seen (or that doesn't pay this order) gives way to the new one.
    const v = await ctx.chain.verifyPayment(prev.txHash as Hex, expectedOf(prev));
    if (v.status === "rejected" || (v.status === "pending" && v.reason === "unknown_tx")) await clearUsdgOrderTx(ctx.db, { orderId: prev.orderId, error: `replaced tx ${prev.txHash}`, now });
  }
  const order = await markUsdgOrderSubmitted(ctx.db, { orderId: input.orderId, accountId: session.accountId, txHash, now });
  return settleUsdgOrder(ctx, order, txHash, now);
}

/**
 * Test mode only (mock chain, WEB3_ENABLED off): the server plays the wallet and HorseMarket,
 * "paying" the signed order, then confirms it like a real payment.
 */
export async function mockPay(ctx: UsdgCtx, session: Session, orderId: string, now: Date): Promise<UsdgSettle> {
  if (ctx.chain.kind !== "mock" || ctx.cfg.mode !== "mock") throw new DomainError("NOT_FOUND", "Simulated payments exist only in test mode.");
  const o = await getUsdgOrder(ctx.db, orderId);
  if (!o || o.accountId !== session.accountId) throw new DomainError("NOT_FOUND", "order not found");
  if (o.status === "fulfilled") return { status: "fulfilled", orderId: o.orderId, horseId: o.horseId, duplicate: true };
  const mock = ctx.chain as MockUsdgChain;
  const paid = await mock.findPaymentTx(o.kind as "registration" | "sale", o.orderId as Hex);
  if (paid) return confirmUsdgOrder(ctx, session, { orderId: o.orderId, txHash: paid }, now);
  if (o.status !== "pending" || o.deadline <= now) throw new DomainError("LISTING_EXPIRED", "This order has expired.");
  const signed = (await signedOrder(ctx, o))!;
  const nowSec = BigInt(Math.floor(now.getTime() / 1000));
  const tx = o.kind === "sale" ? mock.simulateSale(saleOrderFromJson(signed.order), { nowSec }) : mock.simulateRegistration(registrationOrderFromJson(signed.order), { nowSec });
  return confirmUsdgOrder(ctx, session, { orderId: o.orderId, txHash: tx }, now);
}

// ---------------------------------------------------------------------------
// Backstop (cron + lazy tick)
// ---------------------------------------------------------------------------

export interface UsdgBackstopResult {
  auctionsOffered: number;
  auctionsUnsold: number;
  listingsExpired: number;
  settled: number;
  expired: number;
  waiting: number;
}

/**
 * Closes ended auctions (offer to the top bidder), expires fixed listings, and for every order
 * that needs attention: settles it if the chain shows the payment (also when the client vanished
 * before confirming), otherwise expires it once its deadline (+ grace) passed, which offers an
 * auction to the next bidder. Orders the server didn't create are never fulfilled.
 */
export async function usdgBackstop(ctx: UsdgCtx, now: Date): Promise<UsdgBackstopResult> {
  const out: UsdgBackstopResult = { auctionsOffered: 0, auctionsUnsold: 0, listingsExpired: 0, settled: 0, expired: 0, waiting: 0 };
  if (ctx.cfg.mode === "off") return out;
  const closed = await closeUsdgAuctions(ctx.db, { now, chain: chainRef(ctx) }, ctx.policy);
  out.auctionsOffered = closed.offered.length;
  out.auctionsUnsold = closed.unsold;
  for (const o of await usdgOrdersNeedingAttention(ctx.db, { now })) {
    try {
      let r: UsdgSettle | null = o.txHash ? await settleUsdgOrder(ctx, o, o.txHash as Hex, now) : null;
      if (!r || r.status === "rejected" || (r.status === "pending" && r.reason === "unknown_tx")) {
        // No usable hash from the client: look for the payment by orderId (the tab may have closed).
        const found = await ctx.chain.findPaymentTx(o.kind as "registration" | "sale", o.orderId as Hex);
        if (found && found.toLowerCase() !== o.txHash) {
          if (o.txHash) await clearUsdgOrderTx(ctx.db, { orderId: o.orderId, error: `replaced tx ${o.txHash}`, now });
          r = await settleUsdgOrder(ctx, (await getUsdgOrder(ctx.db, o.orderId))!, found, now);
        }
      }
      if (r?.status === "fulfilled") out.settled++;
      else if (r?.status === "paid_waiting") out.waiting++;
      else if (o.status === "pending" && (!r || r.status === "rejected" || r.reason === "unknown_tx")) {
        // Nothing paid it: once past its deadline (+ grace) it can't be paid on-chain any more.
        const e = await expireUsdgOrder(ctx.db, { orderId: o.orderId, now }, ctx.policy);
        if (e.expired) out.expired++;
      }
    } catch (err) {
      console.error("usdg backstop", o.orderId, err);
    }
  }
  out.listingsExpired = await expireUsdgListings(ctx.db, { now });
  return out;
}

const T = globalThis as typeof globalThis & { __tbUsdgTickAt?: number };
const TICK_EVERY_MS = 20_000;

/** The lazy tick views run (per instance, at most every 20 s): auctions close on time without a frequent cron. */
export async function usdgTick(ctx: UsdgCtx, now: Date): Promise<void> {
  if (ctx.cfg.mode === "off") return;
  if (T.__tbUsdgTickAt && now.getTime() - T.__tbUsdgTickAt < TICK_EVERY_MS) return;
  T.__tbUsdgTickAt = now.getTime();
  try {
    await usdgBackstop(ctx, now);
  } catch (err) {
    console.error("usdg tick", err);
  }
}

/** Admin: totals plus the orders that need a human (paid but stuck, flagged by the price review). */
export async function usdgAdminView(ctx: UsdgCtx) {
  let market: Awaited<ReturnType<UsdgChain["marketState"]>> | { error: string };
  try {
    market = await ctx.chain.marketState();
  } catch (e) {
    market = { error: (e as Error).message };
  }
  return {
    network: networkView(ctx),
    policy: policyView(ctx.policy),
    market,
    /** The contract's fee must equal USDG_FEE_BPS, or every signed sale reverts with FeeMismatch. */
    feeMismatch: "feeBps" in market && market.feeBps !== ctx.policy.feeBps,
    summary: await usdgSalesSummary(ctx.db),
    attention: (await usdgOrdersForReview(ctx.db)).map((o) => ({
      orderId: o.orderId,
      kind: o.kind,
      status: o.status,
      price: o.price,
      fee: o.fee,
      flagged: o.flagged,
      flagReason: o.flagReason,
      error: o.error,
      txHash: o.txHash,
      createdAtMs: o.createdAt.getTime(),
    })),
  };
}

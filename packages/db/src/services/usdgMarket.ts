/**
 * The USDG horse market (docs/usdg-market.md). Pure DB + rules: chain I/O (signing orders,
 * verifying `Sold` / `Registered`, checking bid signatures) lives in apps/web; this module is
 * PGlite-tested.
 *
 * - Registration: a horse joins the USDG market once (requirements in game-core
 *   `usdgRegistrationChecks`, fee paid on-chain to the treasury). From then on it trades only for
 *   USDG: the credits market refuses it (market.ts, USDG_ONLY).
 * - Listings: fixed price or auction (reserve, 24-72 h). The horse is the escrow: listing locks it
 *   (lock_kind 'market', lock_ref = the USDG listing), so it can't race, breed or be listed twice.
 * - Orders (`usdg_orders`) are written BEFORE the server signs them, and fulfilled exactly once
 *   after the chain shows the payment. A fixed-price lot is reserved for one buyer while their
 *   signed order is live, so two people can never both pay for one horse.
 * - Auctions settle without escrow: bids are off-chain (signed by the bidder's wallet); at the close
 *   the top bidder is offered a SaleOrder with a payment window; a non-payer is barred from USDG
 *   bidding for a while and the next bidder is offered the horse at their own bid.
 * - Linked accounts can't trade (blocked + fraud event); the resale lock applies; sales far from
 *   recent comparable prices are flagged for review (wash-trading signal), not blocked.
 * - USDG stud fees (kind 'stud') share the orders table, the expiry and the backstop; their quote
 *   and fulfilment (which runs the covering) live in services/usdgStud.ts.
 */
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { DomainError, pgError } from "../errors";
import { gc } from "../gameCore";
import { defaultHooks } from "../hooks";
import { defaultAppraise, RULES } from "../rules";
import {
  fraudEvents,
  horses,
  packPulls,
  raceEntries,
  races,
  stables,
  trades,
  usdgBids,
  usdgListings,
  usdgOrders,
  usdgRegistrations,
  type HorseRow,
  type UsdgBidRow,
  type UsdgListingRow,
  type UsdgOrderRow,
} from "../schema";
import type { Db, Executor, Tx } from "../types";
import { areLinked, assertStallFree, lockStableOf, stableOf } from "./accounts";
import { verifiedWalletOf } from "./betaMoney";
import { isCarrying, lockHorse, openLeaseOfferOf } from "./horses";
import { playerLedgerAccountId, post, systemAccountId } from "./ledger";
import { LIVE_RACE_KINDS } from "./leagues";
import { audit, runTx } from "./tx";

/** Where USDG orders are paid: the chain, the HorseMarket contract and the token (stored on each order). */
export interface UsdgChainRef {
  chainId: number;
  market: string;
  token: string;
}

/** A signed order whose deadline passed is only treated as dead after this grace (sequencer / clock skew). */
export const USDG_ORDER_GRACE_MS = 2 * 60_000;

/** The live policy: game-core defaults with optional env overrides (USDG_MIN_STARTS, USDG_FEE_BPS...). */
export function usdgPolicy(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): gc.UsdgPolicy {
  return gc.usdgPolicyFromEnv(env);
}

function newOrderId(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

const lower = (a: string) => a.trim().toLowerCase();

/** Open orders hold a listing: paid, submitted (tx known), or not yet past deadline + grace. */
export function usdgOrderIsLive(o: Pick<UsdgOrderRow, "status" | "txHash" | "deadline">, now: Date): boolean {
  if (o.status === "paid") return true;
  if (o.status !== "pending") return false;
  return o.txHash !== null || o.deadline.getTime() + USDG_ORDER_GRACE_MS > now.getTime();
}

/**
 * Season slots of a stallion held by live USDG stud orders (signed and not yet expired, submitted,
 * or paid and waiting to be covered), optionally ignoring one order (the one being fulfilled).
 * A paid order flagged for a refund holds nothing.
 */
export async function studHoldsOf(ex: Executor, sireId: string, now: Date, excludeOrderId?: string): Promise<number> {
  const graceCutoff = new Date(now.getTime() - USDG_ORDER_GRACE_MS);
  const [r] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(usdgOrders)
    .where(
      and(
        eq(usdgOrders.kind, "stud"),
        eq(usdgOrders.horseId, sireId),
        excludeOrderId ? ne(usdgOrders.orderId, excludeOrderId.toLowerCase()) : undefined,
        or(
          and(eq(usdgOrders.status, "paid"), eq(usdgOrders.flagged, false)),
          and(eq(usdgOrders.status, "pending"), or(sql`${usdgOrders.txHash} is not null`, sql`${usdgOrders.deadline} > ${graceCutoff}`)),
        ),
      ),
    );
  return Number(r?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Facts about a horse
// ---------------------------------------------------------------------------

/** Settled Live starts (scheduled, Feature, Final): Story and quick races don't count. */
export async function liveStartsOf(ex: Executor, horseId: string): Promise<number> {
  const [r] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.horseId, horseId), eq(raceEntries.status, "entered"), eq(races.status, "settled"), inArray(races.kind, [...LIVE_RACE_KINDS])));
  return Number(r?.n ?? 0);
}

/** True when the horse itself came out of a Premium Pack (its foals are fine). */
export async function isPremiumPull(ex: Executor, horseId: string): Promise<boolean> {
  const [p] = await ex
    .select({ id: packPulls.id })
    .from(packPulls)
    .where(and(eq(packPulls.horseId, horseId), eq(packPulls.packType, "premium")))
    .limit(1);
  return !!p;
}

export async function usdgRegistrationOf(ex: Executor, horseId: string) {
  const [r] = await ex.select().from(usdgRegistrations).where(eq(usdgRegistrations.horseId, horseId));
  return r ?? null;
}

export async function isUsdgRegistered(ex: Executor, horseId: string): Promise<boolean> {
  return (await usdgRegistrationOf(ex, horseId)) !== null;
}

/** Which of these horses are registered for the USDG market (one query). */
export async function usdgRegisteredIds(ex: Executor, horseIds: string[]): Promise<Set<string>> {
  if (!horseIds.length) return new Set();
  const rows = await ex.select({ horseId: usdgRegistrations.horseId }).from(usdgRegistrations).where(inArray(usdgRegistrations.horseId, [...new Set(horseIds)]));
  return new Set(rows.map((r) => r.horseId));
}

async function registrationFacts(ex: Executor, input: { accountId: string; horse: HorseRow; termsAccepted: boolean }): Promise<gc.UsdgRegistrationFacts> {
  const stable = await stableOf(ex, input.accountId);
  const h = input.horse;
  return {
    ownedByCaller: h.ownerStableId === stable.id,
    racingAge: h.careSessions >= RULES.careToRacing,
    liveStarts: await liveStartsOf(ex, h.id),
    onLegacyFarm: h.careerStatus === "pasture",
    enteredInRace: h.lockKind === "race",
    listed: h.lockKind === "market",
    bound: h.bound || h.starts < h.tradeMinStarts,
    origin: h.origin,
    premiumPull: await isPremiumPull(ex, h.id),
    walletVerified: !!(await verifiedWalletOf(ex, input.accountId)),
    termsAccepted: input.termsAccepted,
  };
}

export interface UsdgRegistrationStatus {
  horseId: string;
  registered: { at: Date; wallet: string } | null;
  checks: gc.UsdgRequirement[];
  liveStarts: number;
  minLiveStarts: number;
  fee: number;
  /** A registration order already signed and still payable. */
  openOrder: UsdgOrderRow | null;
}

/**
 * The horse page's checklist. `terms` is shown as met here: the player confirms 18+ and the
 * terms with a checkbox when they register, and the server checks that flag on the quote.
 */
export async function usdgRegistrationStatus(ex: Executor, input: { accountId: string; horseId: string; now: Date }, policy: gc.UsdgPolicy = usdgPolicy()): Promise<UsdgRegistrationStatus> {
  const [horse] = await ex.select().from(horses).where(eq(horses.id, input.horseId));
  if (!horse) throw new DomainError("NOT_FOUND", "horse not found");
  const reg = await usdgRegistrationOf(ex, horse.id);
  const facts = await registrationFacts(ex, { accountId: input.accountId, horse, termsAccepted: true });
  const [open] = await ex
    .select()
    .from(usdgOrders)
    .where(and(eq(usdgOrders.horseId, horse.id), eq(usdgOrders.kind, "registration"), eq(usdgOrders.accountId, input.accountId), inArray(usdgOrders.status, ["pending", "paid"])))
    .orderBy(desc(usdgOrders.createdAt))
    .limit(1);
  return {
    horseId: horse.id,
    registered: reg ? { at: reg.createdAt, wallet: reg.wallet } : null,
    checks: gc.usdgRegistrationChecks(facts, policy),
    liveStarts: facts.liveStarts,
    minLiveStarts: policy.minLiveStarts,
    fee: policy.registrationFee,
    openOrder: open && usdgOrderIsLive(open, input.now) ? open : null,
  };
}

// ---------------------------------------------------------------------------
// Orders (shared by registration and sale)
// ---------------------------------------------------------------------------

export async function getUsdgOrder(ex: Executor, orderId: string): Promise<UsdgOrderRow | null> {
  const [o] = await ex.select().from(usdgOrders).where(eq(usdgOrders.orderId, lower(orderId)));
  return o ?? null;
}

async function insertOrder(
  tx: Executor,
  o: { kind: "registration" | "sale"; accountId: string; wallet: string; horseId: string; listingId?: string | null; bidId?: string | null; sellerAccountId?: string | null; sellerWallet?: string | null; price: number; fee: number; chain: UsdgChainRef; deadline: Date; now: Date },
): Promise<UsdgOrderRow> {
  const [row] = await tx
    .insert(usdgOrders)
    .values({
      orderId: newOrderId(),
      kind: o.kind,
      accountId: o.accountId,
      wallet: o.wallet,
      horseId: o.horseId,
      horseRef: gc.usdgHorseRef(o.horseId),
      listingId: o.listingId ?? null,
      bidId: o.bidId ?? null,
      sellerAccountId: o.sellerAccountId ?? null,
      sellerWallet: o.sellerWallet ?? null,
      price: o.price,
      fee: o.fee,
      token: o.chain.token,
      chainId: o.chain.chainId,
      marketAddress: o.chain.market,
      deadline: o.deadline,
      createdAt: o.now,
      updatedAt: o.now,
    })
    .returning();
  return row!;
}

/**
 * Registration quote: checks every requirement, then writes the pending order (the caller signs a
 * RegistrationOrder from it). A still-payable order for the same horse is returned instead of a
 * second one, so double clicks never produce two payable orders.
 */
export async function quoteUsdgRegistration(
  db: Db,
  input: { accountId: string; horseId: string; termsAccepted: boolean; chain: UsdgChainRef; now: Date },
  policy: gc.UsdgPolicy = usdgPolicy(),
): Promise<UsdgOrderRow> {
  return runTx(db, async (tx) => {
    const horse = await lockHorse(tx, input.horseId);
    if (horse.lesseeStableId) throw new DomainError(horse.lesseeStableId === (await stableOf(tx, input.accountId)).id ? "NOT_OWNER" : "HORSE_ON_LEASE", "Horses on lease can't be registered: only the owner can, once it is home.");
    if (await isUsdgRegistered(tx, horse.id)) throw new DomainError("NOT_ELIGIBLE", "This horse is already registered for the USDG market.");
    const [open] = await tx
      .select()
      .from(usdgOrders)
      .where(and(eq(usdgOrders.horseId, horse.id), eq(usdgOrders.kind, "registration"), inArray(usdgOrders.status, ["pending", "paid"])));
    if (open && usdgOrderIsLive(open, input.now)) {
      if (open.accountId === input.accountId) return open;
      throw new DomainError("LISTING_NOT_ACTIVE", "A registration for this horse is already being paid.");
    }
    const facts = await registrationFacts(tx, { accountId: input.accountId, horse, termsAccepted: input.termsAccepted });
    const block = gc.usdgRegistrationBlock(facts, policy);
    if (block) throw new DomainError(block === "owned" ? "NOT_OWNER" : "NOT_ELIGIBLE", registrationBlockText(block, policy), { requirement: block, liveStarts: facts.liveStarts });
    const wallet = (await verifiedWalletOf(tx, input.accountId))!;
    const order = await insertOrder(tx, {
      kind: "registration",
      accountId: input.accountId,
      wallet,
      horseId: horse.id,
      price: policy.registrationFee,
      fee: policy.registrationFee,
      chain: input.chain,
      deadline: new Date(input.now.getTime() + policy.quoteTtlMs),
      now: input.now,
    });
    await audit(tx, { actor: input.accountId, action: "usdg.registration_quote", entityType: "usdg_order", entityId: order.id, data: { horseId: horse.id, fee: policy.registrationFee } });
    return order;
  });
}

export function registrationBlockText(block: gc.UsdgRequirementKey, policy: Pick<gc.UsdgPolicy, "minLiveStarts">): string {
  switch (block) {
    case "owned":
      return "That horse isn't in your stable.";
    case "racing_age":
      return "Only horses of racing age can register.";
    case "live_starts":
      return `A horse needs ${policy.minLiveStarts} Live starts before it can register.`;
    case "not_legacy_farm":
      return "Horses on the Legacy Farm can't be sold.";
    case "not_in_race":
      return "The horse is entered in a race: register it after the race.";
    case "not_listed":
      return "The horse is listed on the market: take it off first.";
    case "not_bound":
      return "Club-bred horses stay with the stable that raised them.";
    case "not_starter_or_gift":
      return "Starter and gift horses can't be sold for USDG.";
    case "not_premium_pull":
      return "A horse from a Premium Pack can't register (its foals can).";
    case "wallet":
      return "Link your wallet first (one free signature).";
    case "terms":
      return "Confirm you are 18 or over and accept the USDG market terms.";
  }
}

/** Records the tx hash the wallet returned. Idempotent; a hash can pay one order only. */
export async function markUsdgOrderSubmitted(db: Db, input: { orderId: string; accountId: string; txHash: string; now: Date }): Promise<UsdgOrderRow> {
  const txHash = lower(input.txHash);
  const order = await getUsdgOrder(db, input.orderId);
  if (!order || order.accountId !== input.accountId) throw new DomainError("NOT_FOUND", "order not found");
  if (order.txHash && order.txHash !== txHash) throw new DomainError("IDEMPOTENCY_CONFLICT", "This order already has a different transaction.");
  const [other] = await db.select({ orderId: usdgOrders.orderId }).from(usdgOrders).where(eq(usdgOrders.txHash, txHash));
  if (other && other.orderId !== order.orderId) throw new DomainError("IDEMPOTENCY_CONFLICT", "That transaction paid another order.");
  if (order.txHash || order.status !== "pending") return order;
  const [row] = await db
    .update(usdgOrders)
    .set({ txHash, updatedAt: input.now })
    .where(and(eq(usdgOrders.id, order.id), sql`${usdgOrders.txHash} is null`))
    .returning();
  return row ?? (await getUsdgOrder(db, input.orderId))!;
}

/** The submitted tx doesn't pay this order: forget it, so the right hash (or the backstop) can still settle it. */
export async function clearUsdgOrderTx(db: Db, input: { orderId: string; error: string; now: Date }): Promise<void> {
  await db
    .update(usdgOrders)
    .set({ txHash: null, error: input.error.slice(0, 500), updatedAt: input.now })
    .where(and(eq(usdgOrders.orderId, lower(input.orderId)), eq(usdgOrders.status, "pending")));
}

export async function noteUsdgOrderError(db: Db, input: { orderId: string; error: string; now: Date }): Promise<void> {
  await db.update(usdgOrders).set({ error: input.error.slice(0, 500), updatedAt: input.now }).where(eq(usdgOrders.orderId, lower(input.orderId)));
}

export interface UsdgFulfilResult {
  order: UsdgOrderRow;
  duplicate: boolean;
  /** "fulfilled", or "paid" when the payment is recorded but the horse couldn't move (needs an admin). */
  status: "fulfilled" | "paid";
}

/**
 * Called ONLY after the chain verified the payment (`Registered` / `Sold` from our market, payer,
 * horseRef, exact amounts, confirmations). One transaction, idempotent: a retry or a concurrent
 * confirm returns the fulfilled order without doing anything twice. Never fulfils an order the
 * server didn't create.
 */
export async function fulfilUsdgOrder(db: Db, input: { orderId: string; txHash: string; now: Date }, policy: gc.UsdgPolicy = usdgPolicy()): Promise<UsdgFulfilResult> {
  const txHash = lower(input.txHash);
  return runTx(db, async (tx) => {
    const [order] = await tx.select().from(usdgOrders).where(eq(usdgOrders.orderId, lower(input.orderId))).for("update");
    if (!order) throw new DomainError("NOT_FOUND", "unknown order (never fulfil an orderId the server did not create)");
    if (order.kind === "stud") throw new DomainError("INVALID_INPUT", "stud orders are fulfilled by fulfilUsdgStudOrder (services/usdgStud.ts)");
    if (order.txHash && order.txHash !== txHash) throw new DomainError("IDEMPOTENCY_CONFLICT", "order paid by a different transaction");
    if (order.status === "fulfilled") return { order, duplicate: true, status: "fulfilled" as const };
    const wasExpired = order.status === "expired";
    if (order.status !== "paid") {
      await tx.update(usdgOrders).set({ status: "paid", txHash, paidAt: input.now, updatedAt: input.now, error: null }).where(eq(usdgOrders.id, order.id));
      await audit(tx, { actor: order.accountId, action: "usdg.order_paid", entityType: "usdg_order", entityId: order.id, data: { txHash, kind: order.kind, price: order.price } });
    }
    const paidRow = { ...order, status: "paid", txHash };
    const stuck = async (why: string): Promise<UsdgFulfilResult> => {
      const [row] = await tx.update(usdgOrders).set({ error: why.slice(0, 500), updatedAt: input.now }).where(eq(usdgOrders.id, order.id)).returning();
      if (order.error !== why.slice(0, 500)) await audit(tx, { actor: order.accountId, action: "usdg.order_stuck", entityType: "usdg_order", entityId: order.id, data: { why, wasExpired } });
      return { order: row ?? (paidRow as UsdgOrderRow), duplicate: false, status: "paid" };
    };

    if (order.kind === "registration") {
      await tx
        .insert(usdgRegistrations)
        .values({ horseId: order.horseId, accountId: order.accountId, orderId: order.orderId, wallet: order.wallet, fee: order.price, txHash, createdAt: input.now })
        .onConflictDoNothing();
      const reg = await usdgRegistrationOf(tx, order.horseId);
      if (!reg || reg.orderId !== order.orderId) return stuck("horse already registered by another order (refund the fee via support)");
    } else {
      if (!order.listingId) return stuck("sale order without a listing");
      const [listing] = await tx.select().from(usdgListings).where(eq(usdgListings.id, order.listingId)).for("update");
      const horse = await lockHorse(tx, order.horseId);
      // A fixed-price reservation that lapsed just before its (on-chain valid) payment confirmed
      // still delivers, as long as nobody else reserved the lot meanwhile.
      const reserved = listing && (listing.offerOrderId === order.orderId || (listing.kind === "fixed" && listing.offerOrderId === null && !order.bidId));
      if (
        !listing ||
        !reserved ||
        !["active", "closed"].includes(listing.status) ||
        horse.ownerStableId !== listing.sellerStableId ||
        horse.lockKind !== "market" ||
        horse.lockRef !== listing.id
      ) {
        return stuck("paid, but the lot was no longer reserved for this order (refund via support)");
      }
      const buyerStable = await stableOf(tx, order.accountId);
      await tx
        .update(horses)
        .set({ ownerStableId: buyerStable.id, lockKind: null, lockRef: null, studFee: null, studFeeUsdg: null, updatedAt: input.now })
        .where(eq(horses.id, horse.id));
      await tx.update(usdgListings).set({ status: "sold", closedAt: input.now }).where(eq(usdgListings.id, listing.id));
      if (order.bidId) await tx.update(usdgBids).set({ status: "won" }).where(eq(usdgBids.id, order.bidId));
      // Price review (wash-trading signal): flag, never block. Dollar prices are the players'.
      const recent = await tx
        .select({ price: usdgOrders.price, appraisal: usdgListings.appraisal })
        .from(usdgOrders)
        .innerJoin(usdgListings, eq(usdgListings.id, usdgOrders.listingId))
        .where(and(eq(usdgOrders.kind, "sale"), eq(usdgOrders.status, "fulfilled")))
        .orderBy(desc(usdgOrders.fulfilledAt))
        .limit(gc.USDG_REVIEW_COMPARABLES);
      const review = gc.usdgPriceOutlier({ price: order.price, appraisal: listing.appraisal }, recent, policy.reviewRatio);
      if (review.flagged) {
        await tx.update(usdgOrders).set({ flagged: true, flagReason: `price ${review.ratio!.toFixed(2)}x recent comparable sales` }).where(eq(usdgOrders.id, order.id));
        await tx.insert(fraudEvents).values({
          accountId: order.accountId,
          relatedAccountId: order.sellerAccountId,
          kind: "usdg_price_review",
          severity: 1,
          data: { orderId: order.orderId, horseId: order.horseId, price: order.price, appraisal: listing.appraisal, ratio: review.ratio },
        });
      }
    }
    const [row] = await tx
      .update(usdgOrders)
      .set({ status: "fulfilled", fulfilledAt: input.now, updatedAt: input.now, error: null })
      .where(eq(usdgOrders.id, order.id))
      .returning();
    await audit(tx, { actor: order.accountId, action: order.kind === "sale" ? "usdg.sale" : "usdg.registered", entityType: "usdg_order", entityId: order.id, data: { horseId: order.horseId, price: order.price, fee: order.fee, txHash } });
    return { order: row!, duplicate: false, status: "fulfilled" as const };
  });
}

/** Orders the backstop should look at: submitted (tx known), paid, or past their deadline. */
export async function usdgOrdersNeedingAttention(ex: Executor, input: { now: Date; limit?: number }): Promise<UsdgOrderRow[]> {
  return ex
    .select()
    .from(usdgOrders)
    .where(
      or(
        // A stud order flagged for a refund is settled for good (a human refunds it).
        and(eq(usdgOrders.status, "paid"), or(ne(usdgOrders.kind, "stud"), eq(usdgOrders.flagged, false))),
        and(eq(usdgOrders.status, "pending"), or(isNotNull(usdgOrders.txHash), sql`${usdgOrders.deadline} < ${new Date(input.now.getTime() - USDG_ORDER_GRACE_MS)}`)),
      ),
    )
    .orderBy(asc(usdgOrders.createdAt))
    .limit(input.limit ?? 100);
}

/** The account's open orders (to resume after a reload, and the auction winner's payment). */
export async function myUsdgOrders(ex: Executor, input: { accountId: string; now: Date }): Promise<UsdgOrderRow[]> {
  const rows = await ex
    .select()
    .from(usdgOrders)
    .where(and(eq(usdgOrders.accountId, input.accountId), inArray(usdgOrders.status, ["pending", "paid"])))
    .orderBy(desc(usdgOrders.createdAt))
    .limit(20);
  return rows.filter((o) => usdgOrderIsLive(o, input.now));
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

/** The latest purchase of this horse by its owner (credits trade or USDG sale) while inside the resale lock. */
export async function usdgResaleLock(ex: Executor, input: { horseId: string; ownerStableId: string; ownerAccountId: string; now: Date }): Promise<{ boughtAt: Date; until: Date } | null> {
  const [credit] = await ex
    .select({ at: trades.createdAt })
    .from(trades)
    .where(and(eq(trades.horseId, input.horseId), eq(trades.buyerStableId, input.ownerStableId)))
    .orderBy(desc(trades.createdAt))
    .limit(1);
  const [dollar] = await ex
    .select({ at: usdgOrders.fulfilledAt })
    .from(usdgOrders)
    .where(and(eq(usdgOrders.horseId, input.horseId), eq(usdgOrders.kind, "sale"), eq(usdgOrders.status, "fulfilled"), eq(usdgOrders.accountId, input.ownerAccountId)))
    .orderBy(desc(usdgOrders.fulfilledAt))
    .limit(1);
  const times = [credit?.at, dollar?.at].filter((d): d is Date => !!d);
  if (!times.length) return null;
  const boughtAt = new Date(Math.max(...times.map((d) => d.getTime())));
  const until = new Date(boughtAt.getTime() + RULES.resaleLockMs);
  return until.getTime() > input.now.getTime() ? { boughtAt, until } : null;
}

export interface UsdgListInput {
  accountId: string;
  horseId: string;
  kind: "fixed" | "auction";
  /** Fixed price, or the auction reserve (micro-USDG). */
  price: number;
  /** Fixed: one of policy.fixedListingDays (days). Auction: one of policy.auctionHours (hours). */
  duration: number;
  now: Date;
}

export async function listUsdg(db: Db, input: UsdgListInput, policy: gc.UsdgPolicy = usdgPolicy()): Promise<UsdgListingRow> {
  if (input.kind !== "fixed" && input.kind !== "auction") throw new DomainError("INVALID_INPUT", "choose a fixed price or an auction");
  if (!Number.isSafeInteger(input.price) || input.price < policy.minPrice) {
    throw new DomainError("PRICE_BELOW_FLOOR", `The lowest ${input.kind === "auction" ? "reserve" : "price"} is ${gc.formatUsdgDollars(policy.minPrice)}.`, { floor: policy.minPrice });
  }
  if (input.price > policy.maxPrice) throw new DomainError("PRICE_ABOVE_CEILING", `The highest price is ${gc.formatUsdgDollars(policy.maxPrice)}.`, { ceiling: policy.maxPrice });
  const allowed = input.kind === "fixed" ? policy.fixedListingDays : policy.auctionHours;
  if (!allowed.includes(input.duration)) throw new DomainError("INVALID_INPUT", `${input.kind === "fixed" ? "Listing days" : "Auction hours"}: ${allowed.join(", ")}.`);
  const durationMs = input.kind === "fixed" ? input.duration * 86_400_000 : input.duration * 3_600_000;
  return runTx(db, async (tx) => {
    const stable = await stableOf(tx, input.accountId);
    const horse = await lockHorse(tx, input.horseId);
    if (horse.ownerStableId !== stable.id) throw new DomainError("NOT_OWNER", "not your horse");
    if (horse.lesseeStableId) throw new DomainError("HORSE_ON_LEASE", "The horse is away on lease: list it once it is home.");
    if (await openLeaseOfferOf(tx, horse.id)) throw new DomainError("HORSE_LOCKED", "The horse is offered for lease: withdraw the lease offer first.");
    if (!(await isUsdgRegistered(tx, horse.id))) throw new DomainError("NOT_ELIGIBLE", "Register the horse for the USDG market first.");
    if (horse.lockKind) throw new DomainError("HORSE_LOCKED", horse.lockKind === "race" ? "The horse is entered in a race." : horse.lockKind === "stud" ? "The mare is booked for a covering." : "The horse is already listed.");
    if (horse.sex === "male" && (await studHoldsOf(tx, horse.id, input.now))) {
      throw new DomainError("HORSE_LOCKED", "Mare owners are paying his USDG stud fee right now: list him once their coverings are done.");
    }
    if (horse.careerStatus === "pasture") throw new DomainError("NOT_ELIGIBLE", "Horses on the Legacy Farm can't be sold.");
    if (horse.bound || horse.starts < horse.tradeMinStarts) throw new DomainError("HORSE_BOUND", "Club-bred horses can't be sold.");
    if (await isCarrying(tx, horse.id)) throw new DomainError("HORSE_IN_FOAL", "Mares in foal can't be sold.");
    const resale = await usdgResaleLock(tx, { horseId: horse.id, ownerStableId: stable.id, ownerAccountId: input.accountId, now: input.now });
    if (resale) throw new DomainError("RESALE_LOCKED", `Bought on ${resale.boughtAt.toISOString()}: can be listed again after ${resale.until.toISOString()}.`, { until: resale.until.getTime() });
    const wallet = await verifiedWalletOf(tx, input.accountId);
    if (!wallet) throw new DomainError("NOT_ELIGIBLE", "Link your wallet first: the sale is paid to it.");
    const appraisal = (defaultHooks.appraise ?? defaultAppraise)(horse);
    const [listing] = await tx
      .insert(usdgListings)
      .values({
        horseId: horse.id,
        sellerAccountId: input.accountId,
        sellerStableId: stable.id,
        sellerWallet: wallet,
        kind: input.kind,
        price: input.price,
        appraisal,
        endsAt: new Date(input.now.getTime() + durationMs),
        createdAt: input.now,
      })
      .returning();
    await tx.update(horses).set({ lockKind: "market", lockRef: listing!.id, updatedAt: input.now }).where(eq(horses.id, horse.id));
    await audit(tx, { actor: input.accountId, action: "usdg.list", entityType: "usdg_listing", entityId: listing!.id, data: { horseId: horse.id, kind: input.kind, price: input.price, endsAt: listing!.endsAt } });
    return listing!;
  });
}

async function unlockFor(tx: Tx, listing: UsdgListingRow, now: Date): Promise<void> {
  const h = await lockHorse(tx, listing.horseId);
  if (h.lockKind === "market" && h.lockRef === listing.id) await tx.update(horses).set({ lockKind: null, lockRef: null, updatedAt: now }).where(eq(horses.id, h.id));
}

async function liveOfferOf(tx: Executor, listing: UsdgListingRow, now: Date): Promise<UsdgOrderRow | null> {
  if (!listing.offerOrderId) return null;
  const o = await getUsdgOrder(tx, listing.offerOrderId);
  return o && usdgOrderIsLive(o, now) ? o : null;
}

/** Takes a listing down. Refused while a buyer holds a live order, or once an auction has bids. */
export async function delistUsdg(db: Db, input: { accountId: string; listingId: string; now: Date }): Promise<void> {
  await runTx(db, async (tx) => {
    const [listing] = await tx.select().from(usdgListings).where(eq(usdgListings.id, input.listingId)).for("update");
    if (!listing) throw new DomainError("NOT_FOUND", "listing not found");
    if (listing.sellerAccountId !== input.accountId) throw new DomainError("NOT_OWNER", "not your listing");
    if (listing.status !== "active") throw new DomainError("LISTING_NOT_ACTIVE", "This listing has already closed.");
    const live = await liveOfferOf(tx, listing, input.now);
    if (live) throw new DomainError("LISTING_NOT_ACTIVE", `A buyer is paying for this horse right now. Try again after ${live.deadline.toISOString()}.`, { until: live.deadline.getTime() });
    if (listing.kind === "auction") {
      const [bid] = await tx.select({ id: usdgBids.id }).from(usdgBids).where(eq(usdgBids.listingId, listing.id)).limit(1);
      if (bid) throw new DomainError("LISTING_NOT_ACTIVE", "An auction with bids can't be cancelled.");
    }
    await unlockFor(tx, listing, input.now);
    await tx.update(usdgListings).set({ status: "cancelled", closedAt: input.now }).where(eq(usdgListings.id, listing.id));
    await audit(tx, { actor: input.accountId, action: "usdg.delist", entityType: "usdg_listing", entityId: listing.id });
  });
}

/** Records a blocked linked-account attempt (committed even though the request fails). */
async function linkedRefusal(db: Db, input: { accountId: string; sellerAccountId: string; listing: UsdgListingRow; amount: number; what: string }): Promise<never> {
  await db.insert(fraudEvents).values({
    accountId: input.accountId,
    relatedAccountId: input.sellerAccountId,
    kind: "linked_trade_blocked",
    severity: 2,
    data: { market: "usdg", what: input.what, listingId: input.listing.id, horseId: input.listing.horseId, amount: input.amount },
  });
  throw new DomainError("LINKED_ACCOUNTS", "Trades between linked accounts are not allowed.");
}

/**
 * Fixed-price purchase quote: reserves the lot for this buyer for `quoteTtlMs` and writes the
 * pending sale order (the caller signs a SaleOrder from it). The same buyer asking again gets the
 * same live order back.
 */
export async function quoteUsdgSale(db: Db, input: { accountId: string; listingId: string; chain: UsdgChainRef; now: Date }, policy: gc.UsdgPolicy = usdgPolicy()): Promise<UsdgOrderRow> {
  const [pre] = await db.select().from(usdgListings).where(eq(usdgListings.id, input.listingId));
  if (pre && pre.sellerAccountId !== input.accountId && (await areLinked(db, input.accountId, pre.sellerAccountId))) {
    await linkedRefusal(db, { accountId: input.accountId, sellerAccountId: pre.sellerAccountId, listing: pre, amount: pre.price, what: "buy" });
  }
  return runTx(db, async (tx) => {
    const [listing] = await tx.select().from(usdgListings).where(eq(usdgListings.id, input.listingId)).for("update");
    if (!listing) throw new DomainError("NOT_FOUND", "listing not found");
    if (listing.kind !== "fixed") throw new DomainError("INVALID_INPUT", "This lot is an auction: place a bid.");
    if (listing.status !== "active") throw new DomainError("LISTING_NOT_ACTIVE", "This lot is no longer for sale.");
    if (listing.endsAt <= input.now) throw new DomainError("LISTING_EXPIRED", "This listing has ended.");
    const buyerStable = await lockStableOf(tx, input.accountId);
    if (buyerStable.id === listing.sellerStableId) throw new DomainError("CANNOT_BUY_OWN", "That is your own horse.");
    const live = await liveOfferOf(tx, listing, input.now);
    if (live) {
      if (live.accountId === input.accountId) return live;
      throw new DomainError("LISTING_NOT_ACTIVE", "Someone is paying for this horse right now. If they don't, it comes back in a few minutes.", { until: live.deadline.getTime() });
    }
    const wallet = await verifiedWalletOf(tx, input.accountId);
    if (!wallet) throw new DomainError("NOT_ELIGIBLE", "Link your wallet first (one free signature).");
    if (lower(wallet) === lower(listing.sellerWallet)) throw new DomainError("LINKED_ACCOUNTS", "Trades between linked accounts are not allowed.");
    await assertStallFree(tx, buyerStable);
    const order = await insertOrder(tx, {
      kind: "sale",
      accountId: input.accountId,
      wallet,
      horseId: listing.horseId,
      listingId: listing.id,
      sellerAccountId: listing.sellerAccountId,
      sellerWallet: listing.sellerWallet,
      price: listing.price,
      fee: gc.usdgFee(listing.price, policy.feeBps),
      chain: input.chain,
      deadline: new Date(input.now.getTime() + policy.quoteTtlMs),
      now: input.now,
    });
    await tx.update(usdgListings).set({ offerOrderId: order.orderId }).where(eq(usdgListings.id, listing.id));
    await audit(tx, { actor: input.accountId, action: "usdg.sale_quote", entityType: "usdg_order", entityId: order.id, data: { listingId: listing.id, price: listing.price } });
    return order;
  });
}

// ---------------------------------------------------------------------------
// Auctions: bids, close, offer to the top bidder, fall back to the next
// ---------------------------------------------------------------------------

/** When a non-payer may bid again, or null when they aren't barred. */
export async function usdgBarredUntil(ex: Executor, input: { accountId: string; now: Date }, policy: gc.UsdgPolicy = usdgPolicy()): Promise<Date | null> {
  const [r] = await ex
    .select({ at: sql<Date | null>`max(${usdgOrders.expiredAt})` })
    .from(usdgOrders)
    .innerJoin(usdgBids, eq(usdgBids.id, usdgOrders.bidId))
    .where(and(eq(usdgOrders.accountId, input.accountId), eq(usdgOrders.kind, "sale"), isNotNull(usdgOrders.expiredAt), eq(usdgBids.status, "defaulted")));
  if (!r?.at) return null;
  const until = new Date(new Date(r.at).getTime() + policy.nonPayerBarMs);
  return until > input.now ? until : null;
}

export async function bestUsdgBid(ex: Executor, listingId: string): Promise<UsdgBidRow | null> {
  const [b] = await ex
    .select()
    .from(usdgBids)
    .where(and(eq(usdgBids.listingId, listingId), inArray(usdgBids.status, ["active", "offered", "won"])))
    .orderBy(desc(usdgBids.amount), asc(usdgBids.createdAt))
    .limit(1);
  return b ?? null;
}

export interface UsdgBidInput {
  accountId: string;
  listingId: string;
  amount: number;
  nonce: string;
  signature: string;
  /** The wallet that signed the EIP-712 Bid, as recovered by the server (apps/web checks the signature). */
  signer: string;
  now: Date;
}

/** Places a bid (signature already verified by the caller against `signer`). */
export async function placeUsdgBid(db: Db, input: UsdgBidInput, policy: gc.UsdgPolicy = usdgPolicy()): Promise<{ bid: UsdgBidRow; best: number; minNext: number }> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new DomainError("INVALID_INPUT", "Bid a whole number of micro-USDG.");
  if (!/^\d{1,78}$/.test(input.nonce)) throw new DomainError("INVALID_INPUT", "bad nonce");
  const [pre] = await db.select().from(usdgListings).where(eq(usdgListings.id, input.listingId));
  if (pre && pre.sellerAccountId !== input.accountId && (await areLinked(db, input.accountId, pre.sellerAccountId))) {
    await linkedRefusal(db, { accountId: input.accountId, sellerAccountId: pre.sellerAccountId, listing: pre, amount: input.amount, what: "bid" });
  }
  return runTx(db, async (tx) => {
    const [listing] = await tx.select().from(usdgListings).where(eq(usdgListings.id, input.listingId)).for("update");
    if (!listing) throw new DomainError("NOT_FOUND", "listing not found");
    if (listing.kind !== "auction") throw new DomainError("INVALID_INPUT", "This lot has a fixed price: buy it.");
    if (listing.status !== "active" || listing.endsAt <= input.now) throw new DomainError("LISTING_EXPIRED", "Bidding has closed.");
    if (listing.sellerAccountId === input.accountId) throw new DomainError("CANNOT_BUY_OWN", "You can't bid on your own horse.");
    const wallet = await verifiedWalletOf(tx, input.accountId);
    if (!wallet) throw new DomainError("NOT_ELIGIBLE", "Link your wallet first (one free signature).");
    if (lower(wallet) !== lower(input.signer)) throw new DomainError("NOT_ELIGIBLE", "Sign the bid with your linked wallet.");
    if (lower(wallet) === lower(listing.sellerWallet)) throw new DomainError("LINKED_ACCOUNTS", "Trades between linked accounts are not allowed.");
    const barred = await usdgBarredUntil(tx, { accountId: input.accountId, now: input.now }, policy);
    if (barred) throw new DomainError("USDG_BARRED", `You didn't pay for an auction you won: USDG bidding reopens on ${barred.toISOString()}.`, { until: barred.getTime() });
    const best = await bestUsdgBid(tx, listing.id);
    const minNext = gc.minNextBid(policy, listing.price, best?.amount ?? null);
    if (input.amount < minNext) throw new DomainError("PRICE_BELOW_FLOOR", `The lowest bid now is ${gc.formatUsdgDollars(minNext)}.`, { minNext });
    if (input.amount > policy.maxPrice) throw new DomainError("PRICE_ABOVE_CEILING", `The highest bid is ${gc.formatUsdgDollars(policy.maxPrice)}.`);
    const [bid] = await tx
      .insert(usdgBids)
      .values({ listingId: listing.id, accountId: input.accountId, wallet, amount: input.amount, nonce: input.nonce, signature: lower(input.signature), createdAt: input.now })
      .returning();
    await audit(tx, { actor: input.accountId, action: "usdg.bid", entityType: "usdg_listing", entityId: listing.id, data: { amount: input.amount, bidId: bid!.id } });
    return { bid: bid!, best: input.amount, minNext: gc.minNextBid(policy, listing.price, input.amount) };
  }).catch((e: unknown) => {
    // A replayed signature or nonce: the same bid was already placed.
    if (pgError(e)?.code === "23505") throw new DomainError("IDEMPOTENCY_CONFLICT", "That bid was already placed.");
    throw e;
  });
}

/**
 * Offers the horse to the highest eligible bidder still standing (their highest bid): writes the
 * sale order with the payment window and marks the bid `offered`. Bidders who became ineligible
 * (barred, wallet gone, now linked to the seller) are skipped and their bids voided. No one left:
 * the auction ends unsold and the horse is unlocked.
 */
async function offerNextBidder(tx: Tx, listing: UsdgListingRow, chain: UsdgChainRef, now: Date, policy: gc.UsdgPolicy): Promise<UsdgOrderRow | null> {
  const candidates = await tx
    .select()
    .from(usdgBids)
    .where(and(eq(usdgBids.listingId, listing.id), eq(usdgBids.status, "active")))
    .orderBy(desc(usdgBids.amount), asc(usdgBids.createdAt));
  for (const bid of candidates) {
    const wallet = await verifiedWalletOf(tx, bid.accountId);
    const ok =
      wallet !== null &&
      lower(wallet) === lower(bid.wallet) &&
      lower(wallet) !== lower(listing.sellerWallet) &&
      !(await usdgBarredUntil(tx, { accountId: bid.accountId, now }, policy)) &&
      !(await areLinked(tx, bid.accountId, listing.sellerAccountId));
    if (!ok) {
      await tx.update(usdgBids).set({ status: "void" }).where(and(eq(usdgBids.listingId, listing.id), eq(usdgBids.accountId, bid.accountId), eq(usdgBids.status, "active")));
      continue;
    }
    const order = await insertOrder(tx, {
      kind: "sale",
      accountId: bid.accountId,
      wallet: bid.wallet,
      horseId: listing.horseId,
      listingId: listing.id,
      bidId: bid.id,
      sellerAccountId: listing.sellerAccountId,
      sellerWallet: listing.sellerWallet,
      price: bid.amount,
      fee: gc.usdgFee(bid.amount, policy.feeBps),
      chain,
      deadline: new Date(now.getTime() + policy.paymentWindowMs),
      now,
    });
    await tx.update(usdgBids).set({ status: "offered" }).where(eq(usdgBids.id, bid.id));
    await tx.update(usdgListings).set({ status: "closed", offerOrderId: order.orderId, closedAt: listing.closedAt ?? now }).where(eq(usdgListings.id, listing.id));
    await audit(tx, { actor: null, action: "usdg.auction_offer", entityType: "usdg_listing", entityId: listing.id, data: { bidId: bid.id, accountId: bid.accountId, amount: bid.amount, orderId: order.orderId } });
    return order;
  }
  await unlockFor(tx, listing, now);
  await tx.update(usdgListings).set({ status: "unsold", offerOrderId: null, closedAt: listing.closedAt ?? now }).where(eq(usdgListings.id, listing.id));
  await audit(tx, { actor: null, action: "usdg.auction_unsold", entityType: "usdg_listing", entityId: listing.id });
  return null;
}

/** Closes every auction past its end: offers the horse to the top bidder, or ends it unsold. */
export async function closeUsdgAuctions(db: Db, input: { now: Date; chain: UsdgChainRef }, policy: gc.UsdgPolicy = usdgPolicy()): Promise<{ offered: UsdgOrderRow[]; unsold: number }> {
  return runTx(db, async (tx) => {
    const due = await tx
      .select()
      .from(usdgListings)
      .where(and(eq(usdgListings.kind, "auction"), eq(usdgListings.status, "active"), lte(usdgListings.endsAt, input.now)))
      .for("update", { skipLocked: true });
    const offered: UsdgOrderRow[] = [];
    let unsold = 0;
    for (const l of due) {
      const o = await offerNextBidder(tx, l, input.chain, input.now, policy);
      if (o) offered.push(o);
      else unsold++;
    }
    return { offered, unsold };
  });
}

/**
 * The order's deadline passed and the caller checked the chain: no payment. Marks it expired.
 * An auction winner who didn't pay defaults (their bids are voided, they're barred from USDG
 * bidding for `nonPayerBarMs`) and the next bidder is offered the horse at their own bid. A
 * fixed-price reservation simply lapses (the lot is free again, or expires if its time is up).
 */
export async function expireUsdgOrder(db: Db, input: { orderId: string; now: Date }, policy: gc.UsdgPolicy = usdgPolicy()): Promise<{ expired: boolean; next: UsdgOrderRow | null }> {
  return runTx(db, async (tx) => {
    const [order] = await tx.select().from(usdgOrders).where(eq(usdgOrders.orderId, lower(input.orderId))).for("update");
    if (!order || order.status !== "pending") return { expired: false, next: null };
    if (order.deadline.getTime() + USDG_ORDER_GRACE_MS > input.now.getTime()) return { expired: false, next: null };
    await tx.update(usdgOrders).set({ status: "expired", expiredAt: input.now, updatedAt: input.now }).where(eq(usdgOrders.id, order.id));
    if (order.kind === "stud") await releaseStudBooking(tx, order, input.now);
    let next: UsdgOrderRow | null = null;
    if (order.kind === "sale" && order.listingId) {
      const [listing] = await tx.select().from(usdgListings).where(eq(usdgListings.id, order.listingId)).for("update");
      if (listing && listing.offerOrderId === order.orderId) {
        if (order.bidId) {
          await tx.update(usdgBids).set({ status: "defaulted" }).where(eq(usdgBids.id, order.bidId));
          await tx.update(usdgBids).set({ status: "void" }).where(and(eq(usdgBids.listingId, listing.id), eq(usdgBids.accountId, order.accountId), eq(usdgBids.status, "active")));
          await audit(tx, { actor: order.accountId, action: "usdg.non_payment", entityType: "usdg_order", entityId: order.id, data: { listingId: listing.id, barDays: Math.round(policy.nonPayerBarMs / 86_400_000) } });
          next = await offerNextBidder(tx, listing, { chainId: order.chainId, market: order.marketAddress, token: order.token }, input.now, policy);
        } else if (listing.endsAt <= input.now) {
          await unlockFor(tx, listing, input.now);
          await tx.update(usdgListings).set({ status: "expired", offerOrderId: null, closedAt: input.now }).where(eq(usdgListings.id, listing.id));
        } else {
          await tx.update(usdgListings).set({ offerOrderId: null }).where(eq(usdgListings.id, listing.id));
        }
      }
    }
    return { expired: true, next };
  });
}

/**
 * Undoes a stud booking that won't be covered (expired unpaid, or paid but refused at fulfilment):
 * unlocks the mare (if still locked to this order) and returns the credits base fee held in escrow.
 * Idempotent (the release posting has its own key).
 */
export async function releaseStudBooking(tx: Executor, order: UsdgOrderRow, now: Date): Promise<void> {
  if (order.kind !== "stud") return;
  if (order.mareId) {
    await tx
      .update(horses)
      .set({ lockKind: null, lockRef: null, updatedAt: now })
      .where(and(eq(horses.id, order.mareId), eq(horses.lockKind, "stud"), eq(horses.lockRef, order.id)));
  }
  const held = order.creditsHeld ?? 0;
  if (held > 0) {
    await post(tx, {
      idempotencyKey: `usdg-stud-release:${order.orderId}`,
      kind: "breeding_fee_release",
      memo: "USDG covering not made: base fee returned",
      postings: [
        { ledgerAccountId: await systemAccountId(tx, "escrow"), amount: -held },
        { ledgerAccountId: await playerLedgerAccountId(tx, order.accountId), amount: held },
      ],
    });
  }
}

/** Fixed-price listings past their end with no live order: expired, horse unlocked. */
export async function expireUsdgListings(db: Db, input: { now: Date }): Promise<number> {
  return runTx(db, async (tx) => {
    const due = await tx
      .select()
      .from(usdgListings)
      .where(and(eq(usdgListings.kind, "fixed"), eq(usdgListings.status, "active"), lte(usdgListings.endsAt, input.now)))
      .for("update", { skipLocked: true });
    let n = 0;
    for (const l of due) {
      if (await liveOfferOf(tx, l, input.now)) continue;
      await unlockFor(tx, l, input.now);
      await tx.update(usdgListings).set({ status: "expired", offerOrderId: null, closedAt: input.now }).where(eq(usdgListings.id, l.id));
      n++;
    }
    return n;
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface UsdgBoardRow {
  listing: UsdgListingRow;
  horse: HorseRow;
  sellerStableName: string;
  sellerSilks: unknown;
  bestBid: number | null;
  bidCount: number;
  offer: UsdgOrderRow | null;
}

/** Open lots (active, or closed auctions being offered), soonest end first. */
export async function usdgBoard(ex: Executor, input: { now: Date; limit?: number }): Promise<UsdgBoardRow[]> {
  const rows = await ex
    .select({ listing: usdgListings, horse: horses, sellerStableName: stables.name, sellerSilks: stables.silks })
    .from(usdgListings)
    .innerJoin(horses, eq(horses.id, usdgListings.horseId))
    .innerJoin(stables, eq(stables.id, usdgListings.sellerStableId))
    .where(inArray(usdgListings.status, ["active", "closed"]))
    .orderBy(asc(usdgListings.endsAt))
    .limit(input.limit ?? 100);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.listing.id);
  const bids = await ex
    .select({ listingId: usdgBids.listingId, best: sql<number | null>`max(${usdgBids.amount}) filter (where ${usdgBids.status} in ('active', 'offered', 'won'))`, n: sql<number>`count(*)::int` })
    .from(usdgBids)
    .where(inArray(usdgBids.listingId, ids))
    .groupBy(usdgBids.listingId);
  const byListing = new Map(bids.map((b) => [b.listingId, b]));
  const offerIds = rows.map((r) => r.listing.offerOrderId).filter((x): x is string => !!x);
  const offers = offerIds.length ? await ex.select().from(usdgOrders).where(inArray(usdgOrders.orderId, offerIds)) : [];
  const offerBy = new Map(offers.map((o) => [o.orderId, o]));
  return rows.map((r) => {
    const b = byListing.get(r.listing.id);
    const offer = r.listing.offerOrderId ? (offerBy.get(r.listing.offerOrderId) ?? null) : null;
    return { ...r, bestBid: b?.best != null ? Number(b.best) : null, bidCount: Number(b?.n ?? 0), offer: offer && usdgOrderIsLive(offer, input.now) ? offer : null };
  });
}

/** The account's bids on open auctions (highest per listing). */
export async function myUsdgBids(ex: Executor, input: { accountId: string }): Promise<UsdgBidRow[]> {
  return ex
    .select()
    .from(usdgBids)
    .innerJoin(usdgListings, eq(usdgListings.id, usdgBids.listingId))
    .where(and(eq(usdgBids.accountId, input.accountId), inArray(usdgListings.status, ["active", "closed"])))
    .orderBy(desc(usdgBids.createdAt))
    .limit(50)
    .then((rows) => rows.map((r) => r.usdg_bids));
}

/** Orders a human should look at: paid but not delivered (stuck), or flagged by the price review. */
export async function usdgOrdersForReview(ex: Executor, limit = 50): Promise<UsdgOrderRow[]> {
  return ex
    .select()
    .from(usdgOrders)
    .where(or(eq(usdgOrders.status, "paid"), eq(usdgOrders.flagged, true)))
    .orderBy(desc(usdgOrders.createdAt))
    .limit(limit);
}

export async function usdgSalesSummary(ex: Executor): Promise<{ registrations: number; sales: number; volume: number; studFees: number; studVolume: number; fees: number; flagged: number; open: number }> {
  const [r] = await ex
    .select({
      registrations: sql<number>`count(*) filter (where ${usdgOrders.kind} = 'registration' and ${usdgOrders.status} = 'fulfilled')::int`,
      sales: sql<number>`count(*) filter (where ${usdgOrders.kind} = 'sale' and ${usdgOrders.status} = 'fulfilled')::int`,
      volume: sql<number>`coalesce(sum(${usdgOrders.price}) filter (where ${usdgOrders.kind} = 'sale' and ${usdgOrders.status} = 'fulfilled'), 0)::bigint`,
      studFees: sql<number>`count(*) filter (where ${usdgOrders.kind} = 'stud' and ${usdgOrders.status} = 'fulfilled')::int`,
      studVolume: sql<number>`coalesce(sum(${usdgOrders.price}) filter (where ${usdgOrders.kind} = 'stud' and ${usdgOrders.status} = 'fulfilled'), 0)::bigint`,
      fees: sql<number>`coalesce(sum(${usdgOrders.fee}) filter (where ${usdgOrders.status} = 'fulfilled'), 0)::bigint`,
      flagged: sql<number>`count(*) filter (where ${usdgOrders.flagged})::int`,
      open: sql<number>`count(*) filter (where ${usdgOrders.status} = 'paid')::int`,
    })
    .from(usdgOrders);
  return { registrations: Number(r?.registrations ?? 0), sales: Number(r?.sales ?? 0), volume: Number(r?.volume ?? 0), studFees: Number(r?.studFees ?? 0), studVolume: Number(r?.studVolume ?? 0), fees: Number(r?.fees ?? 0), flagged: Number(r?.flagged ?? 0), open: Number(r?.open ?? 0) };
}

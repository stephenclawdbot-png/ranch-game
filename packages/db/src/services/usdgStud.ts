/**
 * USDG stud fees for registered stallions (docs/usdg-market.md, "USDG stud fees").
 *
 * Owner decision 2026-10-30: ordinary breeding stays in Stable Credits for everyone. The owner of
 * a stallion REGISTERED for the USDG market may stand him at stud for a USDG fee instead of a
 * credits fee (horses.stud_fee_usdg; never both). A mare owner who wants that covering pays the
 * fee straight to the stallion's owner (minus the platform fee to the treasury) through
 * HorseMarket.payStudFee, the same no-custody pattern as horse sales:
 *
 *   1. quote (`quoteUsdgStud`): every breeding rule of `breed` is checked now (kinship, sexes,
 *      eligibility, season and lifetime limits with other live bookings counted, mare in foal,
 *      stall), linked accounts are refused, then the order row is written FIRST. It holds one of
 *      the stallion's season slots (studHoldsOf) and locks the mare to the order (lock_kind 'stud')
 *      for the payment window; the credits base fee every covering pays is held in escrow.
 *   2. the server signs a StudOrder from the row (apps/web), the mare owner pays on-chain.
 *   3. fulfil (`fulfilUsdgStudOrder`), only after `StudFeePaid` is verified: one transaction, the
 *      covering runs through breeding.ts `coverTx` (the same rules, re-checked), idempotent on the
 *      order. If the covering can't happen any more (a rare race: the stallion died, a stall
 *      filled up...), the payment is recorded for an admin refund (no on-chain refund: money flows
 *      one way), the booking is released and an alert is raised (fraud_events + audit + inbox).
 *   4. unpaid orders expire (usdgMarket.ts `expireUsdgOrder` releases the booking); the backstop
 *      scanner settles payments nobody confirmed.
 *
 * Foals of USDG coverings are ordinary foals (they may register later like any horse).
 */
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { DomainError, isDomainError, pgError } from "../errors";
import { gc } from "../gameCore";
import { seasonNumberAt } from "../rules";
import { fraudEvents, horses, inboxItems, pregnancies, usdgOrders, type HorseRow, type UsdgOrderRow } from "../schema";
import type { Db, Executor, Tx } from "../types";
import { accountIdOfStable, areLinked, assertStallFree, lockStable, stableOf } from "./accounts";
import { verifiedWalletOf } from "./betaMoney";
import { BREED_BLOCK_CODES, coverTx, pedigreeIndex } from "./breeding";
import { breedingStateOf } from "./economyViews";
import { lockOwnedHorse } from "./horses";
import { playerLedgerAccountId, post, systemAccountId } from "./ledger";
import { audit, runTx } from "./tx";
import { fulfilUsdgOrder, getUsdgOrder, isUsdgRegistered, releaseStudBooking, usdgOrderIsLive, usdgPolicy, type UsdgChainRef, type UsdgFulfilResult } from "./usdgMarket";

const lower = (a: string) => a.trim().toLowerCase();

// ---------------------------------------------------------------------------
// The stallion owner's side: stand him for a USDG fee
// ---------------------------------------------------------------------------

/**
 * Stand a registered stallion at stud for a USDG fee (micro-USDG), replacing any credits fee, or
 * drop the USDG fee (null: he no longer stands for USDG; set a credits fee with setStudFee).
 * Bookings already signed keep their price.
 */
export async function setUsdgStudFee(db: Db, input: { accountId: string; horseId: string; fee: number | null; now: Date }, policy: gc.UsdgPolicy = usdgPolicy()): Promise<void> {
  await runTx(db, async (tx) => {
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    if (input.fee === null) {
      await tx.update(horses).set({ studFeeUsdg: null, updatedAt: input.now }).where(eq(horses.id, horse.id));
      await audit(tx, { actor: input.accountId, action: "usdg.stud_fee", entityType: "horse", entityId: horse.id, data: { fee: null } });
      return;
    }
    if (horse.sex !== "male" || horse.gelded || horse.careerStatus === "pasture") {
      throw new DomainError("BREEDING_NOT_ELIGIBLE", "Only entire stallions not on the Legacy Farm can stand at stud.");
    }
    if (!(await isUsdgRegistered(tx, horse.id))) throw new DomainError("NOT_ELIGIBLE", "Only a stallion registered for the USDG market can stand for a USDG fee.");
    if (!(await verifiedWalletOf(tx, input.accountId))) throw new DomainError("NOT_ELIGIBLE", "Link your wallet first: stud fees are paid to it.");
    const block = gc.usdgStudFeeBlock(input.fee, policy);
    if (block === "not_integer") throw new DomainError("INVALID_INPUT", "A USDG stud fee is a whole number of micro-USDG.");
    if (block === "below_min") throw new DomainError("PRICE_BELOW_FLOOR", `The lowest USDG stud fee is ${gc.formatUsdgDollars(policy.studFeeMin)}.`, { floor: policy.studFeeMin });
    if (block === "above_max") throw new DomainError("PRICE_ABOVE_CEILING", `The highest USDG stud fee is ${gc.formatUsdgDollars(policy.studFeeMax)}.`, { ceiling: policy.studFeeMax });
    await tx.update(horses).set({ studFeeUsdg: input.fee, studFee: null, updatedAt: input.now }).where(eq(horses.id, horse.id));
    await audit(tx, { actor: input.accountId, action: "usdg.stud_fee", entityType: "horse", entityId: horse.id, data: { fee: input.fee } });
  });
}

// ---------------------------------------------------------------------------
// The mare owner's side: book (quote) and fulfil
// ---------------------------------------------------------------------------

/** The stud order the mare is locked to (if still live), so a double click returns it. */
async function liveBookingOf(ex: Executor, mare: HorseRow, now: Date): Promise<UsdgOrderRow | null> {
  if (mare.lockKind !== "stud" || !mare.lockRef) return null;
  const [o] = await ex.select().from(usdgOrders).where(eq(usdgOrders.id, mare.lockRef));
  return o && usdgOrderIsLive(o, now) ? o : null;
}

/**
 * Books a covering by a stallion standing for a USDG fee: checks everything `breed` checks, holds
 * the stallion's slot and locks the mare for the payment window, holds the credits base fee in
 * escrow, and writes the pending stud order (the caller signs a StudOrder from it).
 */
export async function quoteUsdgStud(db: Db, input: { accountId: string; sireId: string; damId: string; chain: UsdgChainRef; now: Date }, policy: gc.UsdgPolicy = usdgPolicy()): Promise<UsdgOrderRow> {
  if (input.sireId === input.damId) throw new DomainError("SELF_BREEDING", "a horse cannot breed with itself");
  // Linked accounts: refused, and the attempt is recorded even though the request fails.
  const [pre] = await db.select().from(horses).where(eq(horses.id, input.sireId));
  if (pre?.ownerStableId) {
    const ownerAccount = await accountIdOfStable(db, pre.ownerStableId);
    if (ownerAccount !== input.accountId && (await areLinked(db, input.accountId, ownerAccount))) {
      await db.insert(fraudEvents).values({
        accountId: input.accountId,
        relatedAccountId: ownerAccount,
        kind: "linked_trade_blocked",
        severity: 2,
        data: { market: "usdg", what: "stud", sireId: input.sireId, damId: input.damId, amount: pre.studFeeUsdg },
      });
      throw new DomainError("LINKED_ACCOUNTS", "Paid coverings between linked accounts are not allowed.");
    }
  }
  return runTx(db, async (tx) => {
    // Same lock order as breed: the stable, then both horses in id order.
    const stable = await stableOf(tx, input.accountId);
    const lockedStable = await lockStable(tx, stable.id);
    const locked = await tx
      .select()
      .from(horses)
      .where(inArray(horses.id, [input.sireId, input.damId]))
      .orderBy(asc(horses.id))
      .for("update");
    const sire = locked.find((h) => h.id === input.sireId);
    const dam = locked.find((h) => h.id === input.damId);
    if (!sire || !dam) throw new DomainError("NOT_FOUND", "horse not found");
    if (dam.ownerStableId !== stable.id) throw new DomainError("NOT_OWNER", "You must own the mare.");
    if (dam.lesseeStableId || sire.lesseeStableId) throw new DomainError("HORSE_ON_LEASE", "Horses on lease don't breed: wait until they are home.");

    const again = await liveBookingOf(tx, dam, input.now);
    if (again) {
      if (again.accountId === input.accountId && again.horseId === sire.id) return again;
      throw new DomainError("HORSE_LOCKED", "This mare is already booked for a covering: pay it or let it lapse first.", { until: again.deadline.getTime() });
    }

    if (sire.ownerStableId === stable.id) throw new DomainError("NOT_ELIGIBLE", "He is your own stallion: cover your mare from the barn, with no stud fee.");
    if (sire.studFeeUsdg === null || sire.ownerStableId === null) throw new DomainError("NOT_OWNER", "That stallion is not standing at stud for a USDG fee.");
    if (!(await isUsdgRegistered(tx, sire.id))) throw new DomainError("NOT_ELIGIBLE", "That stallion is not registered for the USDG market.");
    if (sire.lockKind === "market") throw new DomainError("HORSE_LOCKED", "The stallion is listed for sale.");
    if (dam.lockKind) throw new DomainError("HORSE_LOCKED", dam.lockKind === "race" ? "The mare is entered in a race." : dam.lockKind === "stud" ? "The mare is booked for a covering." : "The mare is listed for sale.");

    // The breeding rules, with the stallion's other live bookings counted as used.
    const season = seasonNumberAt(input.now);
    const [sireState, damState] = [await breedingStateOf(tx, sire, input.now), await breedingStateOf(tx, dam, input.now)];
    const ped = await pedigreeIndex(tx, [sire.id, dam.id]);
    const block = gc.pairingBlock(sireState, damState, ped, season);
    if (block) throw new DomainError(BREED_BLOCK_CODES[block], `breeding blocked: ${block}`, { block });
    await assertStallFree(tx, lockedStable, { allowOverflow: true });

    const ownerAccount = await accountIdOfStable(tx, sire.ownerStableId);
    const payerWallet = await verifiedWalletOf(tx, input.accountId);
    if (!payerWallet) throw new DomainError("NOT_ELIGIBLE", "Link your wallet first (one free signature).");
    const ownerWallet = await verifiedWalletOf(tx, ownerAccount);
    if (!ownerWallet) throw new DomainError("NOT_ELIGIBLE", "The stallion's owner has no linked wallet right now, so his USDG stud fee can't be paid.");
    if (lower(payerWallet) === lower(ownerWallet)) throw new DomainError("LINKED_ACCOUNTS", "Paid coverings between linked accounts are not allowed.");

    const price = sire.studFeeUsdg;
    const baseFee = gc.breedingFees(0, false).baseFee;
    const orderId = `0x${randomBytes(32).toString("hex")}`;
    const [order] = await tx
      .insert(usdgOrders)
      .values({
        orderId,
        kind: "stud",
        accountId: input.accountId,
        wallet: payerWallet,
        horseId: sire.id,
        horseRef: gc.usdgHorseRef(sire.id),
        mareId: dam.id,
        mareRef: gc.usdgHorseRef(dam.id),
        sellerAccountId: ownerAccount,
        sellerWallet: ownerWallet,
        price,
        fee: gc.usdgFee(price, policy.feeBps),
        creditsHeld: baseFee,
        token: input.chain.token,
        chainId: input.chain.chainId,
        marketAddress: input.chain.market,
        deadline: new Date(input.now.getTime() + policy.quoteTtlMs),
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    // The credits base fee every covering pays, held until the covering (burned) or the release.
    if (baseFee > 0) {
      await post(tx, {
        idempotencyKey: `usdg-stud-hold:${orderId}`,
        kind: "breeding_fee_hold",
        memo: "USDG covering booked: base fee held",
        postings: [
          { ledgerAccountId: await playerLedgerAccountId(tx, input.accountId), amount: -baseFee },
          { ledgerAccountId: await systemAccountId(tx, "escrow"), amount: baseFee },
        ],
      });
    }
    await tx.update(horses).set({ lockKind: "stud", lockRef: order!.id, updatedAt: input.now }).where(eq(horses.id, dam.id));
    await audit(tx, { actor: input.accountId, action: "usdg.stud_quote", entityType: "usdg_order", entityId: order!.id, data: { sireId: sire.id, damId: dam.id, price, baseFee } });
    return order!;
  });
}

export interface UsdgStudFulfilResult extends UsdgFulfilResult {
  pregnancyId: string | null;
}

/** Postgres errors a covering can hit that mean "this covering can't happen", not "retry". */
const COVER_REFUSALS = new Set(["23505", "23514", "23P01"]);

/**
 * Called ONLY after the chain verified `StudFeePaid` (our market, the payer's wallet, both horse
 * refs, the stallion owner, exact amounts, confirmations). One transaction, idempotent: a retry
 * returns the fulfilled order. Runs the covering with every breeding rule re-checked; when it
 * can't happen any more, the payment is recorded for an admin refund and the booking released.
 */
export async function fulfilUsdgStudOrder(db: Db, input: { orderId: string; txHash: string; now: Date }): Promise<UsdgStudFulfilResult> {
  const txHash = lower(input.txHash);
  return runTx(db, async (tx) => {
    const [order] = await tx.select().from(usdgOrders).where(eq(usdgOrders.orderId, lower(input.orderId))).for("update");
    if (!order) throw new DomainError("NOT_FOUND", "unknown order (never fulfil an orderId the server did not create)");
    if (order.kind !== "stud" || !order.mareId) throw new DomainError("INVALID_INPUT", "not a stud order");
    if (order.txHash && order.txHash !== txHash) throw new DomainError("IDEMPOTENCY_CONFLICT", "order paid by a different transaction");
    if (order.status === "fulfilled") return { order, duplicate: true, status: "fulfilled" as const, pregnancyId: await pregnancyOf(tx, order) };
    if (order.status === "paid" && order.flagged) return { order, duplicate: true, status: "paid" as const, pregnancyId: null };
    const wasExpired = order.status === "expired";
    if (order.status !== "paid") {
      await tx.update(usdgOrders).set({ status: "paid", txHash, paidAt: input.now, updatedAt: input.now, error: null }).where(eq(usdgOrders.id, order.id));
      await audit(tx, { actor: order.accountId, action: "usdg.order_paid", entityType: "usdg_order", entityId: order.id, data: { txHash, kind: order.kind, price: order.price } });
    }
    const paid: UsdgOrderRow = { ...order, status: "paid", txHash, paidAt: order.paidAt ?? input.now };

    // Expired before the payment was seen: the booking (slot, mare, base fee) is already gone.
    if (wasExpired) return refundDue(tx, paid, "paid after the booking had lapsed", input.now);

    let cover: Awaited<ReturnType<typeof coverTx>>;
    try {
      // A savepoint: a refused covering rolls back alone, the payment record stays.
      cover = await tx.transaction((sp) =>
        coverTx(sp, {
          accountId: order.accountId,
          sireId: order.horseId,
          damId: order.mareId!,
          now: input.now,
          idempotencyKey: `usdg-stud:${order.orderId}`,
          usdg: { orderRowId: order.id, orderId: order.orderId, creditsHeld: order.creditsHeld ?? 0 },
        }),
      );
    } catch (e) {
      const code = pgError(e)?.code;
      if (!isDomainError(e) && !(code && COVER_REFUSALS.has(code))) throw e;
      return refundDue(tx, paid, isDomainError(e) ? e.message : `database refused the covering (${code})`, input.now);
    }

    const [row] = await tx
      .update(usdgOrders)
      .set({ status: "fulfilled", breedingEventId: cover.breedingEventId, fulfilledAt: input.now, updatedAt: input.now, error: null })
      .where(eq(usdgOrders.id, order.id))
      .returning();
    // Linked after the booking (the quote refused linked accounts): the covering stands, a human looks.
    if (order.sellerAccountId && (await areLinked(tx, order.accountId, order.sellerAccountId))) {
      await tx.update(usdgOrders).set({ flagged: true, flagReason: "accounts linked after the booking" }).where(eq(usdgOrders.id, order.id));
      await tx.insert(fraudEvents).values({ accountId: order.accountId, relatedAccountId: order.sellerAccountId, kind: "usdg_stud_linked", severity: 2, data: { orderId: order.orderId, sireId: order.horseId, damId: order.mareId } });
    }
    await audit(tx, { actor: order.accountId, action: "usdg.stud_covered", entityType: "usdg_order", entityId: order.id, data: { sireId: order.horseId, damId: order.mareId, price: order.price, fee: order.fee, txHash, breedingEventId: cover.breedingEventId } });
    if (order.sellerAccountId) {
      const names = await namesOf(tx, [order.horseId, order.mareId!]);
      await tx
        .insert(inboxItems)
        .values({
          accountId: order.sellerAccountId,
          kind: "usdg_stud",
          dedupeKey: `usdg-stud-paid:${order.orderId}`,
          title: `${names.get(order.horseId) ?? "Your stallion"} covered ${names.get(order.mareId!) ?? "a mare"}: ${gc.formatUsdgToken(order.price - order.fee)} stud fee paid to your wallet`,
          data: { orderId: order.orderId, price: order.price, fee: order.fee, txHash },
          horseId: order.horseId,
          createdAt: input.now,
        })
        .onConflictDoNothing();
    }
    return { order: row!, duplicate: cover.duplicate, status: "fulfilled" as const, pregnancyId: cover.pregnancyId };
  });
}

async function pregnancyOf(ex: Executor, order: UsdgOrderRow): Promise<string | null> {
  if (!order.breedingEventId) return null;
  const [p] = await ex.select({ id: pregnancies.id }).from(pregnancies).where(eq(pregnancies.breedingEventId, order.breedingEventId));
  return p?.id ?? null;
}

async function namesOf(ex: Executor, ids: string[]): Promise<Map<string, string>> {
  const rows = await ex.select({ id: horses.id, name: horses.name }).from(horses).where(inArray(horses.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * The stud fee was paid but the covering can't happen: never refunded on-chain (money flows one
 * way). The order stays `paid`, flagged "refund due" for an admin (usdgOrdersForReview), the
 * booking is released (mare unlocked, base fee returned), and an alert is raised.
 */
async function refundDue(tx: Tx, order: UsdgOrderRow, why: string, now: Date): Promise<UsdgStudFulfilResult> {
  const reason = why.slice(0, 400);
  await releaseStudBooking(tx, order, now);
  const [row] = await tx
    .update(usdgOrders)
    .set({ flagged: true, flagReason: `refund due: ${reason}`, error: reason, updatedAt: now })
    .where(eq(usdgOrders.id, order.id))
    .returning();
  await tx.insert(fraudEvents).values({
    accountId: order.accountId,
    relatedAccountId: order.sellerAccountId,
    kind: "usdg_stud_refund_due",
    severity: 3,
    data: { orderId: order.orderId, sireId: order.horseId, damId: order.mareId, price: order.price, fee: order.fee, txHash: order.txHash, why: reason },
  });
  await audit(tx, { actor: order.accountId, action: "usdg.stud_refund_due", entityType: "usdg_order", entityId: order.id, data: { why: reason, price: order.price, txHash: order.txHash } });
  await tx
    .insert(inboxItems)
    .values({
      accountId: order.accountId,
      kind: "usdg_stud",
      dedupeKey: `usdg-stud-refund:${order.orderId}`,
      title: `Your USDG covering couldn't go ahead (${reason}). The organiser will refund ${gc.formatUsdgToken(order.price)} to your wallet.`,
      data: { orderId: order.orderId, price: order.price, txHash: order.txHash },
      horseId: order.mareId,
      createdAt: now,
    })
    .onConflictDoNothing();
  console.error(`ALERT usdg stud order ${order.orderId} paid but not covered (${reason}): refund ${order.price} micro-USDG via support`);
  return { order: row ?? { ...order, flagged: true }, duplicate: false, status: "paid", pregnancyId: null };
}

/** Fulfils any verified USDG payment: stud orders run the covering, the others move or register the horse. */
export async function fulfilUsdgPayment(db: Db, input: { orderId: string; txHash: string; now: Date }, policy: gc.UsdgPolicy = usdgPolicy()): Promise<UsdgFulfilResult> {
  const o = await getUsdgOrder(db, input.orderId);
  if (o?.kind === "stud") return fulfilUsdgStudOrder(db, input);
  return fulfilUsdgOrder(db, input, policy);
}

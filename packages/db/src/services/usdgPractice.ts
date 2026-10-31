/**
 * Practice USDG ("T-USDG") for the beta (owner decision 2026-10-31, docs/usdg-market.md
 * "Practice mode"): testers sign in with their wallet, but every USDG flow (registration fee,
 * fixed-price buy, auction settlement, USDG stud fee) is paid from a per-account TEST balance in
 * the game ledger instead of on-chain. Nothing touches a chain and nothing has real value.
 *
 * - Currency: ledger currency `TUSDG` (micro units, 6 decimals like USDG), in the same
 *   double-entry ledger as Stable Credits but never mixed with them: `post()` refuses a
 *   transaction that touches two currencies, so T-USDG can't be converted to or from credits.
 *   There is no withdrawal, no purchase and no transfer outside a market payment. ONE balance
 *   per account, shared by the USDG market, USDG stud fees, Premium Packs and the tote's T-USDG
 *   pools (services/tote.ts uses the same ledger accounts).
 * - Grant: `PRACTICE_USDG_GRANT` (game-core, 100 T-USDG) once per account (idempotency key
 *   `usdg-practice:grant:<account>`), when it is wallet-signed-in or wallet-linked while practice
 *   mode is on (refused outside practice mode). Admins can top an account up (`topUpPracticeUsdg`).
 *   There is no other faucet.
 * - Payment: `payUsdgOrderPractice` replaces "the chain verified the payment": in ONE database
 *   transaction it moves the T-USDG (payer -> seller `price - fee`, payer -> practice burn `fee`;
 *   a registration fee goes wholly to the burn) and runs the existing fulfilment
 *   (`fulfilUsdgPayment`: moves or registers the horse, or runs the covering). If the order can't
 *   be delivered, the whole transaction rolls back: nothing is charged, the order stays pending and
 *   lapses through the normal expiry (which releases the lot, the stallion slot and the mare).
 * - Only orders written with the practice market address (`USDG_PRACTICE_MARKET`) can be paid
 *   this way, so a real order can never be settled with test money.
 * - Reset (`resetPracticeUsdg`, dry run unless `apply`): drains every T-USDG balance (players,
 *   the tote's T-USDG escrow and house) to the burn, releases open practice listings and bookings,
 *   and deletes practice orders, bids, listings, registrations and T-USDG tote bets and pools.
 *   Horses that changed hands during the beta stay where they are.
 */
import { createHash } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import { gc } from "../gameCore";
import { horses, inboxItems, ledgerAccounts, stables, toteBets, totePools, usdgBids, usdgListings, usdgOrders, usdgRegistrations, type UsdgListingRow, type UsdgOrderRow } from "../schema";
import type { Db, Executor } from "../types";
import { verifiedWalletOf } from "./betaMoney";
import { ensureSystemAccountId, getBalance, playerLedgerAccountId, post, USDG_PRACTICE_CURRENCY } from "./ledger";
import { audit, runTx } from "./tx";
import { releaseStudBooking, usdgPolicy, type UsdgFulfilResult } from "./usdgMarket";
import { fulfilUsdgPayment } from "./usdgStud";

/** Placeholder "market" and "token" written on practice orders (never real contracts; lowercase like stored orders). */
export const USDG_PRACTICE_MARKET = "0x0000000000000000000000000000000000007e57";
export const USDG_PRACTICE_TOKEN = "0x00000000000000000000000000000000007e5701";

type Env = Record<string, string | undefined>;
const processEnv = (): Env => (typeof process !== "undefined" ? process.env : {});

/** Practice mode on (USDG_MODE=practice exactly; the same switch as the tote's T-USDG pools). */
export function usdgPracticeOn(env: Env = processEnv()): boolean {
  return gc.isUsdgPracticeMode(env);
}

const lower = (a: string) => a.trim().toLowerCase();

/** A practice system account (mint: the grants' source, may go negative; burn: fees and resets). Created on demand. */
export function practiceSystemAccountId(ex: Executor, kind: "mint" | "burn"): Promise<string> {
  return ensureSystemAccountId(ex, kind, USDG_PRACTICE_CURRENCY);
}

/** The player's T-USDG account (created on demand; never negative). The tote's T-USDG pools use the same one. */
export function practiceLedgerAccountId(ex: Executor, accountId: string): Promise<string> {
  return playerLedgerAccountId(ex, accountId, USDG_PRACTICE_CURRENCY);
}

/** The account's T-USDG balance in micro units (0 when it never had any). */
export async function practiceUsdgBalance(ex: Executor, accountId: string): Promise<number> {
  return Number(await getBalance(ex, accountId, USDG_PRACTICE_CURRENCY));
}

/** Refuses (before anything is held) when the balance can't cover `amount`. */
export async function assertPracticeFunds(ex: Executor, accountId: string, amount: number): Promise<void> {
  const balance = await practiceUsdgBalance(ex, accountId);
  if (balance < amount) {
    throw new DomainError("INSUFFICIENT_FUNDS", `You have ${gc.formatPracticeUsdg(balance)}: this costs ${gc.formatPracticeUsdg(amount)}. T-USDG is test money for the beta and can't be bought.`, {
      balance,
      required: amount,
    });
  }
}

/**
 * The one-off practice grant (PRACTICE_USDG_GRANT), only to an account with a verified wallet.
 * Idempotent per account: replays (another sign-in, a concurrent tab) grant nothing.
 */
export async function grantPracticeUsdg(db: Db, input: { accountId: string; now: Date; env?: Env }): Promise<{ granted: boolean; balance: number }> {
  if (!usdgPracticeOn(input.env)) throw new DomainError("NOT_ELIGIBLE", "T-USDG exists only in practice mode.");
  const amount = gc.PRACTICE_USDG_GRANT;
  return runTx(db, async (tx) => {
    if (!(await verifiedWalletOf(tx, input.accountId))) throw new DomainError("NOT_ELIGIBLE", "Sign in with your wallet first (one free signature).");
    const r = await post(tx, {
      idempotencyKey: `usdg-practice:grant:${input.accountId}`,
      kind: "usdg_practice_grant",
      memo: "Beta test money (T-USDG): no real value",
      postings: [
        { ledgerAccountId: await practiceSystemAccountId(tx, "mint"), amount: -amount },
        { ledgerAccountId: await practiceLedgerAccountId(tx, input.accountId), amount },
      ],
    });
    if (!r.duplicate) await audit(tx, { actor: input.accountId, action: "usdg.practice_grant", entityType: "account", entityId: input.accountId, data: { amount, at: input.now.toISOString() } });
    return { granted: !r.duplicate, balance: await practiceUsdgBalance(tx, input.accountId) };
  });
}

/** Admin: adds T-USDG to an account (idempotent per key). */
export async function topUpPracticeUsdg(db: Db, input: { accountId: string; amount: number; idempotencyKey: string; actor: string | null; now: Date; env?: Env }): Promise<{ duplicate: boolean; balance: number }> {
  if (!usdgPracticeOn(input.env)) throw new DomainError("NOT_ELIGIBLE", "T-USDG exists only in practice mode.");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > gc.PRACTICE_USDG_TOPUP_MAX) {
    throw new DomainError("INVALID_INPUT", `A top-up is 0.000001 to ${gc.formatPracticeUsdg(gc.PRACTICE_USDG_TOPUP_MAX)}.`);
  }
  if (!input.idempotencyKey) throw new DomainError("INVALID_INPUT", "idempotency key required");
  return runTx(db, async (tx) => {
    const r = await post(tx, {
      idempotencyKey: `usdg-practice:topup:${input.idempotencyKey}`,
      kind: "usdg_practice_topup",
      memo: "Admin top-up of beta test money (T-USDG)",
      postings: [
        { ledgerAccountId: await practiceSystemAccountId(tx, "mint"), amount: -input.amount },
        { ledgerAccountId: await practiceLedgerAccountId(tx, input.accountId), amount: input.amount },
      ],
    });
    if (!r.duplicate) await audit(tx, { actor: input.actor, action: "usdg.practice_topup", entityType: "account", entityId: input.accountId, data: { amount: input.amount, key: input.idempotencyKey } });
    return { duplicate: r.duplicate, balance: await practiceUsdgBalance(tx, input.accountId) };
  });
}

/** A USDG listing by id (null when unknown). */
export async function usdgListingById(ex: Executor, listingId: string): Promise<UsdgListingRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(listingId)) return null;
  const [l] = await ex.select().from(usdgListings).where(eq(usdgListings.id, listingId));
  return l ?? null;
}

/** Admin helper: the account behind a stable name (case-insensitive), or null. */
export async function accountIdByStableName(ex: Executor, name: string): Promise<string | null> {
  const [s] = await ex.select({ accountId: stables.accountId }).from(stables).where(sql`lower(${stables.name}) = ${name.trim().toLowerCase()}`);
  return s?.accountId ?? null;
}

/** The stand-in for an on-chain tx hash on a practice order (deterministic, 32 bytes, never a real transaction). */
export function practiceTxHash(orderId: string): string {
  return `0x${createHash("sha256").update(`usdg-practice:${lower(orderId)}`).digest("hex")}`;
}

export const isPracticeOrder = (o: Pick<UsdgOrderRow, "marketAddress">): boolean => lower(o.marketAddress) === USDG_PRACTICE_MARKET;

/**
 * Pays one practice order from the payer's T-USDG and fulfils it, atomically (see the module doc).
 * Idempotent: a fulfilled order returns `duplicate: true` and moves nothing.
 */
export async function payUsdgOrderPractice(db: Db, input: { orderId: string; accountId: string; now: Date }, policy: gc.UsdgPolicy = usdgPolicy()): Promise<UsdgFulfilResult> {
  return runTx(db, async (tx) => {
    const [order] = await tx.select().from(usdgOrders).where(eq(usdgOrders.orderId, lower(input.orderId))).for("update");
    if (!order || order.accountId !== input.accountId) throw new DomainError("NOT_FOUND", "order not found");
    if (!isPracticeOrder(order)) throw new DomainError("INVALID_INPUT", "This is a real-money order: test T-USDG can't pay it.");
    if (order.status === "fulfilled") return { order, duplicate: true, status: "fulfilled" as const };
    if (order.status !== "pending" || order.deadline.getTime() <= input.now.getTime()) throw new DomainError("LISTING_EXPIRED", "This order has expired.");
    if (!(await verifiedWalletOf(tx, order.accountId))) throw new DomainError("NOT_ELIGIBLE", "Sign in with your wallet first (one free signature).");
    await assertPracticeFunds(tx, order.accountId, order.price);

    const payer = await practiceLedgerAccountId(tx, order.accountId);
    const burn = await practiceSystemAccountId(tx, "burn");
    const toSeller = order.kind === "registration" ? 0 : order.price - order.fee;
    const toBurn = order.kind === "registration" ? order.price : order.fee;
    const postings = [{ ledgerAccountId: payer, amount: -order.price }];
    if (toSeller > 0) {
      if (!order.sellerAccountId) throw new DomainError("INVALID_INPUT", "order without a seller");
      postings.push({ ledgerAccountId: await practiceLedgerAccountId(tx, order.sellerAccountId), amount: toSeller });
    }
    if (toBurn > 0) postings.push({ ledgerAccountId: burn, amount: toBurn });
    await post(tx, {
      idempotencyKey: `usdg-practice:pay:${order.orderId}`,
      kind: "usdg_practice_payment",
      memo: `T-USDG ${order.kind} (test money)`,
      meta: { orderId: order.orderId, kind: order.kind, horseId: order.horseId, price: order.price, fee: order.fee },
      postings,
    });

    // The same fulfilment as a verified on-chain payment (a savepoint inside this transaction).
    const r = await fulfilUsdgPayment(tx as unknown as Db, { orderId: order.orderId, txHash: practiceTxHash(order.orderId), now: input.now }, policy);
    if (r.status !== "fulfilled") {
      // Rolls back the payment too: nothing is charged; the order lapses like an unpaid one.
      const why = (r.order.error ?? r.order.flagReason ?? "it can't be delivered any more").replace(/^refund due: /, "");
      throw new DomainError("NOT_ELIGIBLE", `This can't go ahead (${why}). Nothing was charged.`);
    }

    const names = await tx.select({ id: horses.id, name: horses.name }).from(horses).where(inArray(horses.id, [order.horseId, ...(order.mareId ? [order.mareId] : [])]));
    const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? null;
    if (order.kind === "stud" && order.sellerAccountId) {
      await tx
        .update(inboxItems)
        .set({
          title: `${nameOf(order.horseId) ?? "Your stallion"} covered ${(order.mareId && nameOf(order.mareId)) ?? "a mare"}: ${gc.formatPracticeUsdg(toSeller)} stud fee added to your T-USDG balance (test money)`,
        })
        .where(and(eq(inboxItems.accountId, order.sellerAccountId), eq(inboxItems.dedupeKey, `usdg-stud-paid:${order.orderId}`)));
    }
    if (order.kind === "sale" && order.sellerAccountId) {
      await tx
        .insert(inboxItems)
        .values({
          accountId: order.sellerAccountId,
          kind: "usdg_sale",
          dedupeKey: `usdg-practice-sale:${order.orderId}`,
          title: `${nameOf(order.horseId) ?? "Your horse"} sold for ${gc.formatPracticeUsdg(order.price)}: ${gc.formatPracticeUsdg(toSeller)} added to your T-USDG balance (test money)`,
          data: { orderId: order.orderId, price: order.price, fee: order.fee, practice: true },
          horseId: order.horseId,
          createdAt: input.now,
        })
        .onConflictDoNothing();
    }
    await audit(tx, { actor: order.accountId, action: "usdg.practice_paid", entityType: "usdg_order", entityId: order.id, data: { kind: order.kind, price: order.price, fee: order.fee, toSeller, toBurn } });
    return r;
  });
}

// ---------------------------------------------------------------------------
// End of the beta: wipe practice balances and practice market rows
// ---------------------------------------------------------------------------

export interface PracticeResetReport {
  applied: boolean;
  /** Accounts holding T-USDG, and the total (micro units). */
  accounts: number;
  balanceTotal: number;
  orders: number;
  openOrders: number;
  listings: number;
  openListings: number;
  bids: number;
  registrations: number;
  /** Stallions whose T-USDG stud fee is cleared (their practice registration goes). */
  studFeesCleared: number;
  /** T-USDG tote bets (all, and still open) and settled T-USDG pools. */
  toteBets: number;
  openToteBets: number;
  totePools: number;
}

/**
 * Wipes practice T-USDG: a dry run (counts only) unless `apply`. With `apply`, in one
 * transaction: open practice listings unlock their horses, pending practice stud bookings release
 * the mare and return the escrowed credits base fee (the normal release), stallions standing for
 * a practice-registered T-USDG fee lose it, practice bids / orders / listings / registrations are
 * deleted, and every T-USDG balance is drained to the practice burn (the ledger is append-only, so
 * a balance goes to zero through a posting, never a delete). Horses keep their current owners.
 */
export async function resetPracticeUsdg(db: Db, input: { apply: boolean; now: Date; actor?: string | null }): Promise<PracticeResetReport> {
  return runTx(db, async (tx) => {
    const orders = await tx.select().from(usdgOrders).where(eq(usdgOrders.marketAddress, USDG_PRACTICE_MARKET));
    const orderIds = orders.map((o) => o.orderId);
    const regs = orderIds.length ? await tx.select().from(usdgRegistrations).where(inArray(usdgRegistrations.orderId, orderIds)) : [];
    const regHorses = regs.map((r) => r.horseId);
    const orderListings = orders.map((o) => o.listingId).filter((x): x is string => !!x);
    const listings =
      regHorses.length || orderListings.length
        ? await tx
            .select()
            .from(usdgListings)
            .where(or(regHorses.length ? inArray(usdgListings.horseId, regHorses) : undefined, orderListings.length ? inArray(usdgListings.id, orderListings) : undefined))
        : [];
    const listingIds = listings.map((l) => l.id);
    const [bidCount] = listingIds.length ? await tx.select({ n: sql<number>`count(*)::int` }).from(usdgBids).where(inArray(usdgBids.listingId, listingIds)) : [{ n: 0 }];
    const studFees = regHorses.length ? await tx.select({ id: horses.id }).from(horses).where(and(inArray(horses.id, regHorses), isNotNull(horses.studFeeUsdg))) : [];
    const held = await tx
      .select({ id: ledgerAccounts.id, kind: ledgerAccounts.kind, owner: ledgerAccounts.ownerAccountId, balance: ledgerAccounts.balance })
      .from(ledgerAccounts)
      .where(and(inArray(ledgerAccounts.kind, ["player", "escrow", "tote_house"]), eq(ledgerAccounts.currency, USDG_PRACTICE_CURRENCY), gt(ledgerAccounts.balance, 0)));
    const balances = held.filter((b) => b.kind === "player");
    const tote = await tx
      .select({ n: sql<number>`count(*)::int`, open: sql<number>`count(*) filter (where ${toteBets.status} = 'open')::int` })
      .from(toteBets)
      .where(eq(toteBets.currency, USDG_PRACTICE_CURRENCY));
    const [pools] = await tx.select({ n: sql<number>`count(*)::int` }).from(totePools).where(eq(totePools.currency, USDG_PRACTICE_CURRENCY));
    const openListings = listings.filter((l) => l.status === "active" || l.status === "closed");
    const openOrders = orders.filter((o) => o.status === "pending" || o.status === "paid");
    const report: PracticeResetReport = {
      applied: input.apply,
      accounts: balances.length,
      balanceTotal: balances.reduce((s, b) => s + Number(b.balance), 0),
      orders: orders.length,
      openOrders: openOrders.length,
      listings: listings.length,
      openListings: openListings.length,
      bids: Number(bidCount?.n ?? 0),
      registrations: regs.length,
      studFeesCleared: studFees.length,
      toteBets: Number(tote[0]?.n ?? 0),
      openToteBets: Number(tote[0]?.open ?? 0),
      totePools: Number(pools?.n ?? 0),
    };
    if (!input.apply) return report;

    for (const l of openListings) {
      await tx.update(horses).set({ lockKind: null, lockRef: null, updatedAt: input.now }).where(and(eq(horses.id, l.horseId), eq(horses.lockKind, "market"), eq(horses.lockRef, l.id)));
    }
    for (const o of openOrders) if (o.kind === "stud") await releaseStudBooking(tx, o, input.now);
    if (studFees.length) await tx.update(horses).set({ studFeeUsdg: null, updatedAt: input.now }).where(inArray(horses.id, studFees.map((h) => h.id)));
    if (listingIds.length) await tx.delete(usdgBids).where(inArray(usdgBids.listingId, listingIds));
    if (orderIds.length) await tx.delete(usdgOrders).where(inArray(usdgOrders.orderId, orderIds));
    if (listingIds.length) await tx.delete(usdgListings).where(inArray(usdgListings.id, listingIds));
    if (regs.length) await tx.delete(usdgRegistrations).where(inArray(usdgRegistrations.id, regs.map((r) => r.id)));
    // T-USDG tote bets go with the balances (open stakes sit in the T-USDG escrow, drained below).
    await tx.delete(toteBets).where(eq(toteBets.currency, USDG_PRACTICE_CURRENCY));
    await tx.delete(totePools).where(eq(totePools.currency, USDG_PRACTICE_CURRENCY));
    if (held.length) {
      const burn = await practiceSystemAccountId(tx, "burn");
      for (const b of held) {
        await post(tx, {
          idempotencyKey: `usdg-practice:reset:${b.owner ?? b.kind}:${input.now.getTime()}`,
          kind: "usdg_practice_reset",
          memo: "Beta over: test T-USDG balance reset",
          postings: [
            { ledgerAccountId: b.id, amount: -Number(b.balance) },
            { ledgerAccountId: burn, amount: Number(b.balance) },
          ],
        });
      }
    }
    await audit(tx, { actor: input.actor ?? null, action: "usdg.practice_reset", entityType: "usdg_market", entityId: "practice", data: { ...report } });
    return report;
  });
}

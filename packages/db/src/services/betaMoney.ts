/**
 * Closed-beta money (docs/web3.md "Beta money flow"): SIWE-verified wallets, ETH checkout
 * orders for Premium Packs, and the weekly on-chain Prize Pool's epoch allocations.
 *
 * - Money is real here. Every table in this module SURVIVES the playtest reset (no foreign
 *   keys to accounts; none of them is in RESET_TABLES).
 * - Stable Credits are never involved: an order grants pack pulls (prepaid), and Prize Pool
 *   allocations are ETH paid by the PrizePool contract, computed from league/cup results.
 * - Chain I/O lives in apps/web (viem). This module is pure DB + rules, so it is PGlite-tested.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { DomainError, pgError } from "../errors";
import { utcDay, utcWeekStart } from "../crypto";
import {
  accountPlayDays,
  accounts,
  chainOrders,
  dailyCupEntries,
  fraudEvents,
  poolAllocations,
  poolEpochs,
  raceEntries,
  races,
  stables,
  testers,
  walletChallenges,
  type ChainOrderRow,
  type PoolAllocationRow,
  type PoolEpochRow,
  type TesterRow,
} from "../schema";
import type { Db, Executor, Tx } from "../types";
import { recordAccountSignal } from "./accounts";
import { LIVE_RACE_KINDS, runPoints } from "./leagues";
import { pullPack, type PullResult } from "./packs";
import { EVM_ADDRESS_RE } from "./playtest";
import { audit, runTx } from "./tx";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Wallets: SIWE (EIP-4361) challenge -> verified link on the tester row
// ---------------------------------------------------------------------------

export async function createWalletChallenge(db: Db, input: { accountId: string | null; nonce: string; message: string; expiresAt: Date; purpose?: "link" | "login" }): Promise<void> {
  if (!/^[A-Za-z0-9]{8,64}$/.test(input.nonce)) throw new DomainError("INVALID_INPUT", "bad nonce");
  if (input.purpose === "login" && input.accountId !== null) throw new DomainError("INVALID_INPUT", "a sign-in challenge has no account");
  if (input.purpose !== "login" && input.accountId === null) throw new DomainError("INVALID_INPUT", "a link challenge needs the signed-in account");
  await db.insert(walletChallenges).values({ nonce: input.nonce, accountId: input.accountId, message: input.message, purpose: input.purpose ?? "link", expiresAt: input.expiresAt });
}

/**
 * Marks a challenge used (single-use) and returns the exact message the wallet had to sign.
 * The conditional UPDATE is the whole guard: under READ COMMITTED a concurrent replay
 * matches nothing, so the row lock a transaction adds is belt-and-braces, not load-bearing.
 */
export async function consumeWalletChallenge(db: Db, input: { accountId: string | null; nonce: string; now: Date; purpose?: "link" | "login" }): Promise<string> {
  const purpose = input.purpose ?? "link";
  return runTx(db, async (tx) => {
    const [row] = await tx
      .update(walletChallenges)
      .set({ usedAt: input.now })
      .where(
        and(
          eq(walletChallenges.nonce, input.nonce),
          purpose === "login" ? and(eq(walletChallenges.purpose, "login"), isNull(walletChallenges.accountId)) : and(eq(walletChallenges.accountId, input.accountId ?? ""), eq(walletChallenges.purpose, "link")),
          isNull(walletChallenges.usedAt),
          gte(walletChallenges.expiresAt, input.now),
        ),
      )
      .returning();
    if (!row) throw new DomainError("INVALID_INPUT", "This sign-in request expired or was already used. Try again.");
    return row.message;
  });
}

export async function testerOfAccount(ex: Executor, accountId: string): Promise<TesterRow | null> {
  const [t] = await ex.select().from(testers).where(eq(testers.accountId, accountId));
  return t ?? null;
}

/**
 * Serialises per-wallet work (founding a stable with a wallet) across transactions and
 * instances: a transaction-scoped advisory lock keyed by lower(address). Safe to take
 * repeatedly; it releases at the transaction's end.
 */
export async function lockWalletTx(tx: Tx, address: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(lower(${address.trim().toLowerCase()})))`);
}

/** The account's verified wallet (checksummed as stored), or null. */
export async function verifiedWalletOf(ex: Executor, accountId: string): Promise<string | null> {
  const t = await testerOfAccount(ex, accountId);
  return t?.walletAddress && t.walletVerifiedAt ? t.walletAddress : null;
}

/**
 * The account a wallet signs in to: `accounts.wallet_address` (case-insensitive via the
 * accounts_wallet_lower_uq index), else the verified wallet of a tester that has this account.
 */
export async function accountForWallet(ex: Executor, address: string): Promise<string | null> {
  const lower = address.trim().toLowerCase();
  const [a] = await ex.select({ id: accounts.id }).from(accounts).where(sql`lower(${accounts.walletAddress}) = ${lower}`);
  if (a) return a.id;
  const [t] = await ex
    .select({ accountId: testers.accountId })
    .from(testers)
    .where(and(sql`lower(${testers.walletAddress}) = ${lower}`, sql`${testers.walletVerifiedAt} is not null`, sql`${testers.accountId} is not null`));
  return t?.accountId ?? null;
}

/** The account's sign-in wallet (accounts.wallet_address, checksummed), or null. */
export async function loginWalletOf(ex: Executor, accountId: string): Promise<string | null> {
  const [a] = await ex.select({ walletAddress: accounts.walletAddress }).from(accounts).where(eq(accounts.id, accountId));
  return a?.walletAddress ?? null;
}

/**
 * Stores the wallet on the account itself (`accounts.wallet_address`, checksummed): one
 * wallet signs in to one account. Set when unset by any successful SIWE verification; a
 * wallet already on ANOTHER account is refused (LINKED_ACCOUNTS — also what the
 * `accounts_wallet_lower_uq` index enforces when two requests race), and a stable that already
 * signed in with a different wallet keeps it (same rule as the tester row).
 */
async function setAccountWalletTx(tx: Tx, input: { accountId: string; address: string; now: Date }): Promise<void> {
  const lower = input.address.trim().toLowerCase();
  const [taken] = await tx.select({ id: accounts.id }).from(accounts).where(sql`lower(${accounts.walletAddress}) = ${lower}`).for("update");
  if (taken && taken.id !== input.accountId) throw new DomainError("LINKED_ACCOUNTS", "That wallet is already linked to another stable. One wallet per player.");
  const [mine] = await tx.select({ walletAddress: accounts.walletAddress }).from(accounts).where(eq(accounts.id, input.accountId)).for("update");
  if (!mine) throw new DomainError("NOT_FOUND", "account not found");
  if (mine.walletAddress && mine.walletAddress.toLowerCase() !== lower) {
    throw new DomainError("NOT_ELIGIBLE", "Your stable already has a sign-in wallet. Ask the organiser to change it.");
  }
  if (mine.walletAddress) return;
  try {
    await tx.update(accounts).set({ walletAddress: input.address.trim() }).where(eq(accounts.id, input.accountId));
  } catch (err) {
    // Lost the race for this wallet (unique index on lower(wallet_address)), not a server error.
    if (pgError(err)?.code === "23505") throw new DomainError("LINKED_ACCOUNTS", "That wallet is already linked to another stable. One wallet per player.");
    throw err;
  }
  await audit(tx, { actor: input.accountId, action: "account.wallet_set", entityType: "account", entityId: input.accountId, data: { address: input.address, at: input.now } });
}

/** see setAccountWalletTx */
export async function ensureAccountWallet(db: Db, input: { accountId: string; address: string; now: Date }): Promise<void> {
  await runTx(db, (tx) => setAccountWalletTx(tx, input));
}

/**
 * Stores a SIWE-verified wallet on the account's tester row (one wallet per account, one
 * account per wallet). Outside the closed playtest (no tester row), a tester row is created
 * with the invite code "OPEN". A different verified wallet can only be replaced by the admin
 * (`adminUnlinkWallet`), so allocations can't be moved around. The link also feeds the
 * linked-account detection (§4b) as a `wallet` signal.
 */
export async function linkVerifiedWallet(db: Db, input: { accountId: string; address: string; stableName?: string | null; now: Date }): Promise<{ tester: TesterRow; linkedAccounts: string[] }> {
  const address = input.address.trim();
  if (!EVM_ADDRESS_RE.test(address)) throw new DomainError("INVALID_INPUT", "That isn't an EVM address.");
  const tester = await runTx(db, async (tx) => {
    const [taken] = await tx
      .select()
      .from(testers)
      .where(and(sql`lower(${testers.walletAddress}) = ${address.toLowerCase()}`, sql`${testers.walletVerifiedAt} is not null`));
    let mine = (await tx.select().from(testers).where(eq(testers.accountId, input.accountId)).for("update"))[0];
    if (taken && taken.id !== mine?.id) {
      // A tester left without an account by the playtest reset keeps its wallet; the person
      // who proves they own it (this SIWE signature) takes it to their new tester row.
      if (taken.accountId !== null) throw new DomainError("LINKED_ACCOUNTS", "That wallet is already linked to another stable. One wallet per player.");
      await tx.update(testers).set({ walletAddress: null, walletVerifiedAt: null }).where(eq(testers.id, taken.id));
    }
    if (mine?.walletVerifiedAt && mine.walletAddress && mine.walletAddress.toLowerCase() !== address.toLowerCase()) {
      throw new DomainError("NOT_ELIGIBLE", "Your stable already has a verified wallet. Ask the organiser to change it.");
    }
    if (!mine) {
      [mine] = await tx.insert(testers).values({ inviteCode: "OPEN", accountId: input.accountId, stableName: input.stableName ?? null }).returning();
    }
    const [t] = await tx.update(testers).set({ walletAddress: address, walletVerifiedAt: input.now }).where(eq(testers.id, mine!.id)).returning();
    await audit(tx, { actor: input.accountId, action: "wallet.link", entityType: "tester", entityId: t!.id, data: { address } });
    // Same signature, same claim: the account itself can now be found by wallet (sign-in).
    await setAccountWalletTx(tx, { accountId: input.accountId, address, now: input.now });
    return t!;
  });
  const linkedAccounts = await recordAccountSignal(db, { accountId: input.accountId, kind: "wallet", value: address });
  return { tester, linkedAccounts };
}

/** Admin: removes a tester's wallet (e.g. lost wallet): the payout link and the sign-in wallet on the account. Past allocations keep their address. */
export async function adminUnlinkWallet(db: Db, input: { testerId: string }): Promise<void> {
  await runTx(db, async (tx) => {
    const [t] = await tx.select().from(testers).where(eq(testers.id, input.testerId));
    await tx.update(testers).set({ walletAddress: null, walletVerifiedAt: null }).where(eq(testers.id, input.testerId));
    if (t?.accountId) await tx.update(accounts).set({ walletAddress: null }).where(eq(accounts.id, t.accountId));
  });
}

// ---------------------------------------------------------------------------
// Checkout orders
// ---------------------------------------------------------------------------

/** SKUs sold for ETH in the closed beta (prices in USD, converted at quote time). */
export const BETA_SKUS = {
  premium_pack: { packType: "premium", label: "Premium Pack" },
} as const;
export type BetaSku = keyof typeof BETA_SKUS;

export type ChainOrderStatus = "quoted" | "submitted" | "paid" | "fulfilled" | "expired" | "rejected";

export interface NewChainOrder {
  orderId: string;
  accountId: string;
  wallet: string;
  sku: BetaSku;
  quantity: number;
  usdCents: number;
  priceWei: bigint;
  ethUsdMicros: number;
  priceSources: unknown;
  chainId: number;
  storeAddress: string;
  deadline: Date;
  now: Date;
  /** Affiliate plan signed into the quote (services/affiliates.ts referralPlan). */
  ref1?: { accountId: string; wallet: string; bps: number } | null;
  ref2?: { accountId: string; wallet: string; bps: number } | null;
}

export async function createChainOrder(db: Db, o: NewChainOrder): Promise<ChainOrderRow> {
  const tester = await testerOfAccount(db, o.accountId);
  const [row] = await db
    .insert(chainOrders)
    .values({
      orderId: o.orderId.toLowerCase(),
      accountId: o.accountId,
      testerId: tester?.id ?? null,
      wallet: o.wallet,
      sku: o.sku,
      quantity: o.quantity,
      usdCents: o.usdCents,
      priceWei: o.priceWei.toString(),
      ethUsdMicros: o.ethUsdMicros,
      priceSources: o.priceSources ?? null,
      chainId: o.chainId,
      storeAddress: o.storeAddress.toLowerCase(),
      deadline: o.deadline,
      createdAt: o.now,
      updatedAt: o.now,
      ref1AccountId: o.ref1?.accountId ?? null,
      ref1Wallet: o.ref1?.wallet.toLowerCase() ?? null,
      ref1Bps: o.ref1?.bps ?? 0,
      ref2AccountId: o.ref2?.accountId ?? null,
      ref2Wallet: o.ref2?.wallet.toLowerCase() ?? null,
      ref2Bps: o.ref2?.bps ?? 0,
    })
    .returning();
  return row!;
}

export async function getChainOrder(ex: Executor, orderId: string): Promise<ChainOrderRow | null> {
  const [row] = await ex.select().from(chainOrders).where(eq(chainOrders.orderId, orderId.toLowerCase()));
  return row ?? null;
}

/**
 * Premium Packs this week that count toward the weekly cap before they are pulled: open
 * quotes (not expired), submitted and paid-but-unfulfilled orders. Fulfilled orders are
 * already pack_pulls rows (counted by the pack service).
 */
export async function reservedPremiumPacks(ex: Executor, input: { accountId: string; now: Date }): Promise<number> {
  const [r] = await ex
    .select({ n: sql<number>`coalesce(sum(${chainOrders.quantity}), 0)::int` })
    .from(chainOrders)
    .where(
      and(
        eq(chainOrders.accountId, input.accountId),
        sql`(${chainOrders.status} in ('submitted', 'paid') or (${chainOrders.status} = 'quoted' and ${chainOrders.deadline} >= ${input.now}))`,
      ),
    );
  return Number(r?.n ?? 0);
}

/**
 * Premium Packs this tester has bought over the WHOLE beta (the $50 lifetime cap, AUDIT §6):
 * confirmed orders (fulfilled) plus pending ones (live quotes, submitted, paid), as pack
 * quantity — the caller prices them with the current PREMIUM_PACK_USD_CENTS.
 */
export async function premiumPacksLifetime(ex: Executor, input: { accountId: string; now: Date }): Promise<number> {
  const [r] = await ex
    .select({ n: sql<number>`coalesce(sum(${chainOrders.quantity}), 0)::int` })
    .from(chainOrders)
    .where(
      and(
        eq(chainOrders.accountId, input.accountId),
        eq(chainOrders.sku, "premium_pack"),
        sql`(${chainOrders.status} in ('submitted', 'paid', 'fulfilled') or (${chainOrders.status} = 'quoted' and ${chainOrders.deadline} >= ${input.now}))`,
      ),
    );
  return Number(r?.n ?? 0);
}

/** Orders a client should resume (after a reload): quoted (live), submitted or paid. */
export async function openChainOrders(ex: Executor, input: { accountId: string; now: Date }): Promise<ChainOrderRow[]> {
  return ex
    .select()
    .from(chainOrders)
    .where(
      and(
        eq(chainOrders.accountId, input.accountId),
        sql`(${chainOrders.status} in ('submitted', 'paid') or (${chainOrders.status} = 'quoted' and ${chainOrders.deadline} >= ${input.now}))`,
      ),
    )
    .orderBy(desc(chainOrders.createdAt))
    .limit(10);
}

export async function recentChainOrders(ex: Executor, input: { accountId?: string; limit?: number } = {}): Promise<ChainOrderRow[]> {
  return ex
    .select()
    .from(chainOrders)
    .where(input.accountId ? eq(chainOrders.accountId, input.accountId) : sql`true`)
    .orderBy(desc(chainOrders.createdAt))
    .limit(input.limit ?? 50);
}

/** Orders the backstop should look at: submitted/paid, or quoted ones whose deadline passed. */
export async function ordersNeedingAttention(ex: Executor, input: { now: Date; limit?: number }): Promise<ChainOrderRow[]> {
  return ex
    .select()
    .from(chainOrders)
    .where(sql`${chainOrders.status} in ('submitted', 'paid') or (${chainOrders.status} = 'quoted' and ${chainOrders.deadline} < ${input.now})`)
    .orderBy(asc(chainOrders.createdAt))
    .limit(input.limit ?? 100);
}

/** Records the tx hash the buyer's wallet returned. Idempotent; a hash can belong to one order only. */
export async function markOrderSubmitted(db: Db, input: { orderId: string; accountId: string; txHash: string; now: Date }): Promise<ChainOrderRow> {
  const txHash = input.txHash.toLowerCase();
  const order = await getChainOrder(db, input.orderId);
  if (!order || order.accountId !== input.accountId) throw new DomainError("NOT_FOUND", "order not found");
  if (order.txHash && order.txHash !== txHash) throw new DomainError("IDEMPOTENCY_CONFLICT", "This order already has a different transaction.");
  const [other] = await db.select({ orderId: chainOrders.orderId }).from(chainOrders).where(eq(chainOrders.txHash, txHash));
  if (other && other.orderId !== order.orderId) throw new DomainError("IDEMPOTENCY_CONFLICT", "That transaction paid another order.");
  if (order.status !== "quoted" && order.status !== "expired") return order;
  const [row] = await db
    .update(chainOrders)
    .set({ status: "submitted", txHash, updatedAt: input.now })
    .where(and(eq(chainOrders.id, order.id), inArray(chainOrders.status, ["quoted", "expired"])))
    .returning();
  return row ?? (await getChainOrder(db, input.orderId))!;
}

/**
 * The submitted tx doesn't pay this order (wrong hash, failed tx, mismatch): forget it so a
 * correct hash can still be submitted, and the backstop scans for a payment by orderId.
 */
export async function clearOrderTx(db: Db, input: { orderId: string; error: string; now: Date }): Promise<void> {
  await db
    .update(chainOrders)
    .set({ status: "quoted", txHash: null, error: input.error.slice(0, 500), updatedAt: input.now })
    .where(and(eq(chainOrders.orderId, input.orderId.toLowerCase()), eq(chainOrders.status, "submitted")));
}

/** Terminal states for orders that were never paid (deadline passed / tx rejected). */
export async function markOrderUnpaid(db: Db, input: { orderId: string; status: "expired" | "rejected"; error?: string; now: Date }): Promise<void> {
  await db
    .update(chainOrders)
    .set({ status: input.status, error: input.error ?? null, updatedAt: input.now })
    .where(and(eq(chainOrders.orderId, input.orderId.toLowerCase()), inArray(chainOrders.status, ["quoted", "submitted", "expired"])));
}

export interface FulfilResult {
  order: ChainOrderRow;
  pulls: PullResult[];
  duplicate: boolean;
}

/**
 * Called ONLY after the chain verified the payment (event from our store, buyer, sku,
 * quantity, exact amount, confirmations). Marks the order paid, then grants one prepaid
 * Premium Pack pull per quantity with idempotency keys derived from the orderId, then marks
 * it fulfilled. Every step is idempotent, so a crash or a concurrent retry can't double-grant.
 * A paid order that can't be pulled right now stays `paid` and is retried (never lost).
 */
export async function fulfilChainOrder(
  db: Db,
  input: { orderId: string; txHash: string; now: Date; split?: { poolShareWei: bigint; treasuryWei: bigint } },
): Promise<FulfilResult> {
  const txHash = input.txHash.toLowerCase();
  const order = await getChainOrder(db, input.orderId);
  if (!order) throw new DomainError("NOT_FOUND", "unknown order (never fulfil an orderId the server did not create)");
  if (order.txHash && order.txHash !== txHash) throw new DomainError("IDEMPOTENCY_CONFLICT", "order paid by a different transaction");
  if (order.status === "rejected") throw new DomainError("NOT_ELIGIBLE", "order was rejected");
  if (order.status !== "paid" && order.status !== "fulfilled") {
    await db
      .update(chainOrders)
      .set({
        status: "paid",
        txHash,
        paidAt: input.now,
        updatedAt: input.now,
        error: null,
        poolShareWei: input.split?.poolShareWei.toString() ?? null,
        treasuryWei: input.split?.treasuryWei.toString() ?? null,
      })
      .where(and(eq(chainOrders.id, order.id), inArray(chainOrders.status, ["quoted", "submitted", "expired"])));
    await audit(db, { actor: order.accountId, action: "chain_order.paid", entityType: "chain_order", entityId: order.id, data: { txHash, priceWei: order.priceWei } });
  }
  const sku = BETA_SKUS[order.sku as BetaSku];
  if (!sku) throw new DomainError("INVALID_INPUT", `unknown sku ${order.sku}`);
  const pulls: PullResult[] = [];
  for (let i = 1; i <= order.quantity; i++) {
    pulls.push(
      await pullPack(db, {
        accountId: order.accountId,
        packType: sku.packType,
        prepaid: true,
        idempotencyKey: `chain:${order.chainId}:${order.storeAddress}:${order.orderId}:${i}`,
        now: input.now,
      }),
    );
  }
  const wasFulfilled = order.status === "fulfilled";
  const [row] = await db
    .update(chainOrders)
    .set({ status: "fulfilled", txHash, pullIds: pulls.map((p) => p.pullId), fulfilledAt: order.fulfilledAt ?? input.now, updatedAt: input.now })
    .where(eq(chainOrders.id, order.id))
    .returning();
  return { order: row!, pulls, duplicate: wasFulfilled };
}

/** Records a fulfilment error on a paid order (it stays `paid` and is retried). */
export async function noteOrderError(db: Db, input: { orderId: string; error: string; now: Date }): Promise<void> {
  await db.update(chainOrders).set({ error: input.error.slice(0, 500), updatedAt: input.now }).where(eq(chainOrders.orderId, input.orderId.toLowerCase()));
}

export async function chainSalesSummary(ex: Executor): Promise<{ orders: number; fulfilled: number; paidWei: string; open: number }> {
  const [r] = await ex
    .select({
      orders: sql<number>`count(*)::int`,
      fulfilled: sql<number>`count(*) filter (where ${chainOrders.status} = 'fulfilled')::int`,
      paidWei: sql<string>`coalesce(sum(${chainOrders.priceWei}) filter (where ${chainOrders.status} in ('paid', 'fulfilled')), 0)::text`,
      open: sql<number>`count(*) filter (where ${chainOrders.status} in ('submitted', 'paid'))::int`,
    })
    .from(chainOrders);
  return { orders: Number(r?.orders ?? 0), fulfilled: Number(r?.fulfilled ?? 0), paidWei: String(r?.paidWei ?? "0"), open: Number(r?.open ?? 0) };
}

// ---------------------------------------------------------------------------
// Prize Pool: scores, eligibility, allocations (USD-defined, converted to wei at posting)
// ---------------------------------------------------------------------------

export interface PoolRules {
  /** Share of the pool's FREE balance one weekly epoch may use (bps). On-chain hard cap: maxEpochBps. */
  budgetBps: number;
  /** Per-player cap per epoch in USD cents (e.g. 1000 = $10/week). */
  capUsdCents: number;
  /** Minimum active (play) days in the period. */
  minActiveDays: number;
  /** How many ranks are paid. */
  paidRanks: number;
  /** Allocations below this are dropped (dust). */
  minPayoutUsdCents: number;
  /** Runs by horses from Premium Packs don't score (no paying for better odds at real money). */
  excludePremiumHorses: boolean;
  /** Accounts with unreviewed linked-account flags are held back for review. */
  excludeFlagged: boolean;
  /** Linear vesting length. */
  vestDays: number;
}

export const DEFAULT_POOL_RULES: PoolRules = {
  budgetBps: 2_500,
  capUsdCents: 1_000,
  minActiveDays: 4,
  paidRanks: 10,
  minPayoutUsdCents: 50,
  excludePremiumHorses: true,
  excludeFlagged: true,
  vestDays: 14,
};

export interface PoolScoreRow {
  accountId: string;
  testerId: string | null;
  stableName: string | null;
  wallet: string | null;
  racePoints: number;
  cupPoints: number;
  score: number;
  wins: number;
  runs: number;
  activeDays: number;
  flagged: boolean;
  eligible: boolean;
  reason: string | null;
}

/**
 * Skill score of every owner for [from, to), on rate, not volume (audit §6): points per Live
 * run x 15 (the weight min(1, runs / 8) folds into the divisor max(runs, 8)) plus the mean of
 * the best 3 Daily Cup days x 5, both floor-rounded. Per-run points use the league table
 * (game-core racePoints + tier bonus) uncapped; 0 Live runs scores from the Cup term only.
 * Eligibility as in the rules. Ties break by wins, then fewer runs (efficiency), then account
 * id (deterministic).
 */
export async function poolScores(ex: Executor, input: { from: Date; to: Date; rules: PoolRules }): Promise<PoolScoreRow[]> {
  const { from, to, rules } = input;
  const runs = await ex
    .select({
      accountId: stables.accountId,
      raceId: races.id,
      position: raceEntries.finishPosition,
      raceClass: races.raceClass,
      postTime: races.postTime,
      horseId: raceEntries.horseId,
      fieldSize: sql<number>`(select count(*)::int from race_entries x where x.race_id = "races"."id" and x.status = 'entered')`,
      premium: sql<number>`(exists (select 1 from pack_pulls p where p.horse_id = "race_entries"."horse_id" and p.pack_type = 'premium'))::int`,
    })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .innerJoin(stables, eq(stables.id, raceEntries.stableId))
    .where(
      and(
        eq(races.status, "settled"),
        inArray(races.kind, [...LIVE_RACE_KINDS]),
        gte(races.postTime, from),
        lt(races.postTime, to),
        sql`${raceEntries.finishPosition} is not null`,
        eq(raceEntries.status, "entered"),
      ),
    );
  // Per-run league points over the whole period (no weekly cap: the score is a rate).
  const byAccount = new Map<string, { position: number; fieldSize: number; raceClass: string }[]>();
  for (const r of runs) {
    if (rules.excludePremiumHorses && Number(r.premium) === 1) continue;
    byAccount.set(r.accountId, [...(byAccount.get(r.accountId) ?? []), { position: r.position ?? 99, fieldSize: Number(r.fieldSize), raceClass: r.raceClass }]);
  }
  const race = new Map<string, { points: number; wins: number; runs: number }>();
  for (const [acc, rs] of byAccount) {
    let points = 0;
    let wins = 0;
    for (const r of rs) {
      points += runPoints(r);
      if (r.position === 1) wins++;
    }
    race.set(acc, { points, wins, runs: rs.length });
  }

  const cupRows = await ex
    .select({
      accountId: dailyCupEntries.accountId,
      day: dailyCupEntries.day,
      points: sql<number>`coalesce(sum(${dailyCupEntries.points}), 0)::int`,
      nonPremium: sql<number>`coalesce(sum(${dailyCupEntries.points}) filter (where not exists (select 1 from pack_pulls p where p.horse_id = "daily_cup_entries"."horse_id" and p.pack_type = 'premium')), 0)::int`,
    })
    .from(dailyCupEntries)
    .where(and(gte(dailyCupEntries.day, utcDay(from)), lt(dailyCupEntries.day, utcDay(to))))
    .groupBy(dailyCupEntries.accountId, dailyCupEntries.day);
  // Best 3 Cup days (fewer count as 0): the mean is over 3, so one lucky day can't carry.
  const cupDays = new Map<string, number[]>();
  for (const c of cupRows) cupDays.set(c.accountId, [...(cupDays.get(c.accountId) ?? []), Number(rules.excludePremiumHorses ? c.nonPremium : c.points)]);
  const cup = new Map([...cupDays].map(([acc, ds]) => [acc, ds.sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0)] as const));

  const activeRows = await ex
    .select({ accountId: accountPlayDays.accountId, days: sql<number>`count(*)::int` })
    .from(accountPlayDays)
    .where(and(gte(accountPlayDays.day, utcDay(from)), lt(accountPlayDays.day, utcDay(to))))
    .groupBy(accountPlayDays.accountId);
  const active = new Map(activeRows.map((a) => [a.accountId, Number(a.days)] as const));

  const accountIds = [...new Set([...race.keys(), ...cup.keys(), ...active.keys()])];
  if (!accountIds.length) return [];
  const testerRows = await ex.select().from(testers).where(inArray(testers.accountId, accountIds));
  const testerOf = new Map(testerRows.map((t) => [t.accountId!, t] as const));
  const stableRows = await ex.select({ accountId: stables.accountId, name: stables.name }).from(stables).where(inArray(stables.accountId, accountIds));
  const nameOf = new Map(stableRows.map((s) => [s.accountId, s.name] as const));
  const flagRows = await ex
    .selectDistinct({ accountId: fraudEvents.accountId })
    .from(fraudEvents)
    .where(and(inArray(fraudEvents.accountId, accountIds), isNull(fraudEvents.reviewedAt)));
  const flagged = new Set(flagRows.map((f) => f.accountId));

  const rows: PoolScoreRow[] = accountIds.map((accountId) => {
    const r = race.get(accountId) ?? { points: 0, wins: 0, runs: 0 };
    const c = cup.get(accountId) ?? 0;
    const t = testerOf.get(accountId);
    const wallet = t?.walletAddress && t.walletVerifiedAt ? t.walletAddress : null;
    const activeDays = active.get(accountId) ?? 0;
    const isFlagged = flagged.has(accountId);
    // Rate score: placing quality per run (full weight from 8 runs) + best-3 Cup days.
    const raceTerm = r.runs ? Math.floor((r.points * 15) / Math.max(r.runs, 8)) : 0;
    const cupTerm = Math.floor((c * 5) / 3);
    const score = raceTerm + cupTerm;
    const reason =
      score <= 0
        ? "no points"
        : activeDays < rules.minActiveDays
          ? `active ${activeDays}/${rules.minActiveDays} days`
          : !wallet
            ? "no verified wallet"
            : rules.excludeFlagged && isFlagged
              ? "linked-account flag under review"
              : null;
    return {
      accountId,
      testerId: t?.id ?? null,
      stableName: nameOf.get(accountId) ?? t?.stableName ?? null,
      wallet,
      racePoints: r.points,
      cupPoints: c,
      score,
      wins: r.wins,
      runs: r.runs,
      activeDays,
      flagged: isFlagged,
      eligible: reason === null,
      reason,
    };
  });
  rows.sort((a, b) => b.score - a.score || b.wins - a.wins || a.runs - b.runs || (a.accountId < b.accountId ? -1 : 1));
  return rows;
}

export interface UsdAllocation {
  accountId: string;
  testerId: string | null;
  stableName: string | null;
  wallet: string;
  rank: number;
  score: number;
  activeDays: number;
  usdCents: number;
}

/**
 * Splits `budgetUsdCents` over the top `paidRanks` ELIGIBLE players by linearly decreasing
 * weights (rank 1 gets paidRanks shares, the last paid rank 1 share), capped per player.
 * Whatever the caps or dust rule leave unspent simply stays in the pool (rolls over).
 * Pure and deterministic.
 */
export function allocateUsd(scores: readonly PoolScoreRow[], budgetUsdCents: number, rules: PoolRules): UsdAllocation[] {
  const eligible = scores.filter((s) => s.eligible && s.wallet);
  const paid = eligible.slice(0, Math.max(0, rules.paidRanks));
  const n = paid.length;
  if (!n || budgetUsdCents <= 0) return [];
  const totalWeight = (n * (n + 1)) / 2;
  const out: UsdAllocation[] = [];
  paid.forEach((s, i) => {
    const weight = n - i;
    const share = Math.min(rules.capUsdCents, Math.floor((budgetUsdCents * weight) / totalWeight));
    if (share < rules.minPayoutUsdCents) return;
    out.push({ accountId: s.accountId, testerId: s.testerId, stableName: s.stableName, wallet: s.wallet!, rank: i + 1, score: s.score, activeDays: s.activeDays, usdCents: share });
  });
  return out;
}

/** USD cents -> wei at `ethUsdMicros` (micro-dollars per ETH). Rounds down (never over-promise). */
export function usdCentsToWei(usdCents: number, ethUsdMicros: number): bigint {
  if (ethUsdMicros <= 0) throw new Error("bad ETH price");
  return (BigInt(usdCents) * 10n ** 22n) / BigInt(ethUsdMicros);
}

/** wei -> USD cents at `ethUsdMicros`, rounded down. */
export function weiToUsdCents(wei: bigint, ethUsdMicros: number): number {
  return Number((wei * BigInt(ethUsdMicros)) / 10n ** 22n);
}

export interface EpochDraftInput {
  chainId: number;
  poolAddress: string;
  epochId: number;
  kind: "weekly" | "season";
  weekStart: string;
  root: string;
  totalWei: bigint;
  availableWei: bigint;
  ethUsdMicros: number;
  priceSources: unknown;
  config: Record<string, unknown>;
  vestStart: Date;
  vestEnd: Date;
  allocations: (UsdAllocation & { amountWei: bigint; leaf: string; proof: string[] })[];
  now: Date;
}

/**
 * Saves (or replaces) the draft for an epoch id. A posted epoch is immutable: its root is
 * on-chain, so it can never be overwritten here.
 */
export async function saveEpochDraft(db: Db, d: EpochDraftInput): Promise<PoolEpochRow> {
  const pool = d.poolAddress.toLowerCase();
  return runTx(db, async (tx) => {
    const [existing] = await tx
      .select()
      .from(poolEpochs)
      .where(and(eq(poolEpochs.chainId, d.chainId), eq(poolEpochs.poolAddress, pool), eq(poolEpochs.epochId, d.epochId)))
      .for("update");
    if (existing && existing.status !== "draft") throw new DomainError("PERMANENT_STATE", `epoch ${d.epochId} is already ${existing.status}`);
    if (existing) {
      await tx.delete(poolAllocations).where(eq(poolAllocations.epochRowId, existing.id));
      await tx.delete(poolEpochs).where(eq(poolEpochs.id, existing.id));
    }
    const [row] = await tx
      .insert(poolEpochs)
      .values({
        chainId: d.chainId,
        poolAddress: pool,
        epochId: d.epochId,
        kind: d.kind,
        weekStart: d.weekStart,
        status: "draft",
        root: d.root.toLowerCase(),
        totalWei: d.totalWei.toString(),
        leafCount: d.allocations.length,
        availableWei: d.availableWei.toString(),
        ethUsdMicros: d.ethUsdMicros,
        priceSources: d.priceSources ?? null,
        config: d.config,
        vestStart: d.vestStart,
        vestEnd: d.vestEnd,
        createdAt: d.now,
      })
      .returning();
    if (d.allocations.length) {
      await tx.insert(poolAllocations).values(
        d.allocations.map((a) => ({
          epochRowId: row!.id,
          accountId: a.accountId,
          testerId: a.testerId,
          wallet: a.wallet.toLowerCase(),
          stableName: a.stableName,
          rank: a.rank,
          score: a.score,
          activeDays: a.activeDays,
          usdCents: a.usdCents,
          amountWei: a.amountWei.toString(),
          leaf: a.leaf.toLowerCase(),
          proof: a.proof,
          createdAt: d.now,
        })),
      );
    }
    return row!;
  });
}

export async function getEpochRow(ex: Executor, id: string): Promise<PoolEpochRow | null> {
  const [row] = await ex.select().from(poolEpochs).where(eq(poolEpochs.id, id));
  return row ?? null;
}

export async function epochAllocations(ex: Executor, epochRowId: string): Promise<PoolAllocationRow[]> {
  return ex.select().from(poolAllocations).where(eq(poolAllocations.epochRowId, epochRowId)).orderBy(asc(poolAllocations.rank));
}

export async function listPoolEpochs(ex: Executor, input: { chainId: number; poolAddress: string; limit?: number }): Promise<PoolEpochRow[]> {
  return ex
    .select()
    .from(poolEpochs)
    .where(and(eq(poolEpochs.chainId, input.chainId), eq(poolEpochs.poolAddress, input.poolAddress.toLowerCase())))
    .orderBy(desc(poolEpochs.epochId))
    .limit(input.limit ?? 30);
}

/** Records that the root is on-chain (verified by the caller against the contract). */
export async function markEpochPosted(db: Db, input: { id: string; txHash: string | null; now: Date }): Promise<PoolEpochRow> {
  const [row] = await db
    .update(poolEpochs)
    .set({ status: "posted", txHash: input.txHash?.toLowerCase() ?? null, postedAt: input.now })
    .where(and(eq(poolEpochs.id, input.id), eq(poolEpochs.status, "draft")))
    .returning();
  if (row) return row;
  const cur = await getEpochRow(db, input.id);
  if (cur?.status === "posted") return cur;
  throw new DomainError("NOT_FOUND", "epoch draft not found");
}

export async function markEpochCancelled(db: Db, input: { id: string }): Promise<void> {
  await db.update(poolEpochs).set({ status: "cancelled" }).where(eq(poolEpochs.id, input.id));
}

/** A wallet's POSTED allocations (with proofs), newest first. */
export async function allocationsForWallet(ex: Executor, input: { wallet: string; chainId: number; poolAddress: string }) {
  return ex
    .select({ allocation: poolAllocations, epoch: poolEpochs })
    .from(poolAllocations)
    .innerJoin(poolEpochs, eq(poolEpochs.id, poolAllocations.epochRowId))
    .where(
      and(
        eq(poolAllocations.wallet, input.wallet.toLowerCase()),
        eq(poolEpochs.chainId, input.chainId),
        eq(poolEpochs.poolAddress, input.poolAddress.toLowerCase()),
        eq(poolEpochs.status, "posted"),
      ),
    )
    .orderBy(desc(poolEpochs.epochId));
}

/** Period helpers: the UTC week [from, to) of `weekStart`, and the last completed week. */
export function weekPeriod(weekStart: string): { from: Date; to: Date } {
  const from = new Date(`${weekStart}T00:00:00.000Z`);
  return { from, to: new Date(from.getTime() + 7 * DAY_MS) };
}

export function lastCompletedWeek(now: Date): string {
  return utcWeekStart(new Date(new Date(`${utcWeekStart(now)}T00:00:00.000Z`).getTime() - DAY_MS));
}

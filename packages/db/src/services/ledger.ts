/**
 * Double-entry credits ledger.
 *
 * - Every movement is a transaction with >= 2 postings summing to zero (checked here and,
 *   at COMMIT, by a deferred constraint trigger).
 * - Each transaction has a unique idempotency key: replaying a key is a no-op that returns
 *   the original transaction (`duplicate: true`), even under concurrent retries.
 * - Balances are never written directly: a trigger applies each posting, and a CHECK
 *   rejects any player balance below zero, rolling the whole transaction back.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import { ledgerAccounts, ledgerPostings, ledgerTransactions } from "../schema";
import type { Db, Executor } from "../types";
import { runTx } from "./tx";

export type SystemAccount = "mint" | "burn" | "treasury" | "escrow";
/** Ledger currencies: Stable Credits, and practice T-USDG (the tote's placeholder practice ledger). */
export type LedgerCurrency = "CR" | "TUSDG";

export interface Posting {
  ledgerAccountId: string;
  amount: number;
}

export interface PostInput {
  idempotencyKey: string;
  kind: string;
  memo?: string;
  meta?: Record<string, unknown>;
  postings: Posting[];
}

export interface PostResult {
  transactionId: string;
  duplicate: boolean;
}

export async function systemAccountId(ex: Executor, kind: SystemAccount): Promise<string> {
  const [row] = await ex
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.kind, kind), isNull(ledgerAccounts.ownerAccountId), eq(ledgerAccounts.currency, "CR")));
  if (!row) throw new Error(`system ledger account ${kind} missing (migrations not applied?)`);
  return row.id;
}

/** The player's credits account (or, with `currency`, their account in that currency), created on demand. */
export async function playerLedgerAccountId(ex: Executor, accountId: string, currency: LedgerCurrency = "CR"): Promise<string> {
  const found = await ex
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.ownerAccountId, accountId), eq(ledgerAccounts.kind, "player"), eq(ledgerAccounts.currency, currency)));
  if (found[0]) return found[0].id;
  const inserted = await ex
    .insert(ledgerAccounts)
    .values({ kind: "player", ownerAccountId: accountId, currency })
    .onConflictDoNothing()
    .returning({ id: ledgerAccounts.id });
  if (inserted[0]) return inserted[0].id;
  return playerLedgerAccountId(ex, accountId, currency);
}

/**
 * A system account in any currency, created on demand. The migrations seed only the credits
 * mint/burn/treasury/escrow; the tote's `tote_house` and every T-USDG system account are made
 * here the first time they are needed (an enum value can't be used in the migration that adds it).
 */
export async function ensureSystemAccountId(ex: Executor, kind: SystemAccount | "tote_house", currency: LedgerCurrency): Promise<string> {
  const where = and(eq(ledgerAccounts.kind, kind), isNull(ledgerAccounts.ownerAccountId), eq(ledgerAccounts.currency, currency));
  const [row] = await ex.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(where);
  if (row) return row.id;
  await ex.insert(ledgerAccounts).values({ kind, currency, allowNegative: kind === "mint" }).onConflictDoNothing();
  const [made] = await ex.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(where);
  if (!made) throw new Error(`system ledger account ${kind}/${currency} could not be created`);
  return made.id;
}

/**
 * Posts a balanced transaction inside the caller's transaction. Locks the touched ledger
 * accounts (in id order, to avoid deadlocks) and fails with INSUFFICIENT_FUNDS before any
 * player account would go negative.
 */
export async function post(ex: Executor, input: PostInput): Promise<PostResult> {
  const { postings } = input;
  if (!input.idempotencyKey) throw new DomainError("INVALID_INPUT", "idempotency key required");
  if (postings.length < 2) throw new DomainError("INVALID_INPUT", "a transaction needs at least two postings");
  let sum = 0;
  for (const p of postings) {
    if (!Number.isSafeInteger(p.amount) || p.amount === 0) throw new DomainError("INVALID_INPUT", "posting amounts must be non-zero integers");
    sum += p.amount;
  }
  if (sum !== 0) throw new DomainError("INVALID_INPUT", `unbalanced transaction (sum ${sum})`);

  const created = await ex
    .insert(ledgerTransactions)
    .values({ idempotencyKey: input.idempotencyKey, kind: input.kind, memo: input.memo ?? null, meta: input.meta ?? null })
    .onConflictDoNothing({ target: ledgerTransactions.idempotencyKey })
    .returning({ id: ledgerTransactions.id });
  if (!created[0]) {
    const [existing] = await ex
      .select({ id: ledgerTransactions.id, kind: ledgerTransactions.kind })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.idempotencyKey, input.idempotencyKey));
    if (!existing) throw new Error("idempotency key vanished");
    if (existing.kind !== input.kind) {
      throw new DomainError("IDEMPOTENCY_CONFLICT", `key ${input.idempotencyKey} was used for a ${existing.kind} transaction`);
    }
    return { transactionId: existing.id, duplicate: true };
  }
  const transactionId = created[0].id;

  const ids = [...new Set(postings.map((p) => p.ledgerAccountId))].sort();
  const accounts = await ex
    .select({ id: ledgerAccounts.id, balance: ledgerAccounts.balance, allowNegative: ledgerAccounts.allowNegative })
    .from(ledgerAccounts)
    .where(inArray(ledgerAccounts.id, ids))
    .orderBy(asc(ledgerAccounts.id))
    .for("update");
  if (accounts.length !== ids.length) throw new DomainError("NOT_FOUND", "ledger account not found");
  for (const a of accounts) {
    const delta = postings.filter((p) => p.ledgerAccountId === a.id).reduce((s, p) => s + p.amount, 0);
    if (!a.allowNegative && a.balance + delta < 0) {
      throw new DomainError("INSUFFICIENT_FUNDS", "not enough credits", { balance: a.balance, required: -delta });
    }
  }
  const ordered = [...postings].sort((a, b) => (a.ledgerAccountId < b.ledgerAccountId ? -1 : a.ledgerAccountId > b.ledgerAccountId ? 1 : 0));
  await ex.insert(ledgerPostings).values(ordered.map((p) => ({ transactionId, ledgerAccountId: p.ledgerAccountId, amount: p.amount })));
  return { transactionId, duplicate: false };
}

// ---------------------------------------------------------------------------
// Convenience operations (each its own transaction)
// ---------------------------------------------------------------------------

export interface CreditInput {
  accountId: string;
  amount: number;
  idempotencyKey: string;
  kind: string;
  memo?: string;
}

/** New credits into a player's account from the mint (purses, rewards, grants). */
export async function grantCredits(db: Db, input: CreditInput): Promise<PostResult> {
  return runTx(db, (tx) => grantCreditsTx(tx, input));
}

export async function grantCreditsTx(ex: Executor, input: CreditInput): Promise<PostResult> {
  if (input.amount <= 0) throw new DomainError("INVALID_INPUT", "amount must be positive");
  const player = await playerLedgerAccountId(ex, input.accountId);
  const mint = await systemAccountId(ex, "mint");
  return post(ex, {
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    memo: input.memo,
    postings: [
      { ledgerAccountId: mint, amount: -input.amount },
      { ledgerAccountId: player, amount: input.amount },
    ],
  });
}

/** Credits out of a player's account into a sink (burn by default). */
export async function spendCredits(db: Db, input: CreditInput & { sink?: SystemAccount }): Promise<PostResult> {
  return runTx(db, (tx) => spendCreditsTx(tx, input));
}

export async function spendCreditsTx(ex: Executor, input: CreditInput & { sink?: SystemAccount }): Promise<PostResult> {
  if (input.amount <= 0) throw new DomainError("INVALID_INPUT", "amount must be positive");
  const player = await playerLedgerAccountId(ex, input.accountId);
  const sink = await systemAccountId(ex, input.sink ?? "burn");
  return post(ex, {
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    memo: input.memo,
    postings: [
      { ledgerAccountId: player, amount: -input.amount },
      { ledgerAccountId: sink, amount: input.amount },
    ],
  });
}

export async function getBalance(ex: Executor, accountId: string, currency: LedgerCurrency = "CR"): Promise<number> {
  const [row] = await ex
    .select({ balance: ledgerAccounts.balance })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.ownerAccountId, accountId), eq(ledgerAccounts.kind, "player"), eq(ledgerAccounts.currency, currency)));
  return row?.balance ?? 0;
}

export interface LedgerHealth {
  /** Sum of every posting ever made: always 0. */
  totalPostings: number;
  /** Transactions whose postings do not sum to 0 (always empty). */
  unbalancedTransactions: string[];
  /** Accounts whose cached balance differs from the sum of their postings (always empty). */
  driftedAccounts: string[];
  /** Non-system accounts below zero (always empty). */
  negativeAccounts: string[];
}

/** Full-ledger audit; cheap enough for tests and an admin health check. */
export async function ledgerHealth(ex: Executor): Promise<LedgerHealth> {
  const [total] = await ex.select({ s: sql<string>`coalesce(sum(${ledgerPostings.amount}), 0)` }).from(ledgerPostings);
  const unbalanced = await ex
    .select({ id: ledgerPostings.transactionId })
    .from(ledgerPostings)
    .groupBy(ledgerPostings.transactionId)
    .having(sql`sum(${ledgerPostings.amount}) <> 0`);
  const drifted = await ex
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      sql`${ledgerAccounts.balance} <> coalesce((select sum(p.amount) from ledger_postings p where p.ledger_account_id = ${ledgerAccounts.id}), 0)`,
    );
  const negative = await ex
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.allowNegative, false), sql`${ledgerAccounts.balance} < 0`));
  return {
    totalPostings: Number(total?.s ?? 0),
    unbalancedTransactions: unbalanced.map((r) => r.id),
    driftedAccounts: drifted.map((r) => r.id),
    negativeAccounts: negative.map((r) => r.id),
  };
}

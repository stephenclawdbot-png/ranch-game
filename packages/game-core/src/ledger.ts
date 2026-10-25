/**
 * Double-entry credits ledger (pure, immutable).
 *
 * Invariants (enforced by `post`, checked by `checkLedger`):
 *   - every transaction's postings sum to exactly 0 and are non-zero integers;
 *   - player and escrow accounts never go negative (system accounts are the issuer side
 *     of faucets and the receiving side of sinks/burns, so they may);
 *   - an idempotency key applies at most once: replaying the same transaction is a no-op,
 *     reusing a key for a different transaction is refused.
 */
import type { AccountId, LedgerTx, LedgerTxKind, Posting } from "./types";
import { AccountIdSchema, LedgerTxSchema } from "./types";

export interface Ledger {
  balances: Readonly<Record<AccountId, number>>;
  txs: readonly LedgerTx[];
  /** idempotencyKey -> tx id */
  keys: Readonly<Record<string, string>>;
}

export const EMPTY_LEDGER: Ledger = { balances: {}, txs: [], keys: {} };

export const SYSTEM = {
  purses: "system:faucet:purses",
  dailyGoals: "system:faucet:daily_goals",
  dailyCup: "system:faucet:daily_cup",
  grants: "system:faucet:grants",
  insurancePool: "system:insurance_pool",
  club: "system:faucet:club",
  burn: "system:sink:burn",
  training: "system:sink:training",
  entryFees: "system:sink:entry_fees",
  vet: "system:sink:vet",
  breeding: "system:sink:breeding",
  packs: "system:sink:packs",
  scans: "system:sink:scans",
  facilities: "system:sink:facilities",
} as const satisfies Record<string, AccountId>;

export const player = (id: string): AccountId => `player:${id}`;
export const escrow = (id: string): AccountId => `escrow:${id}`;

export function isConstrained(account: AccountId): boolean {
  return account.startsWith("player:") || account.startsWith("escrow:");
}

export function balanceOf(ledger: Ledger, account: AccountId): number {
  return ledger.balances[account] ?? 0;
}

export type PostError = "invalid" | "unbalanced" | "zero_posting" | "insufficient_funds" | "idempotency_conflict";

export type PostResult = { ok: true; ledger: Ledger; applied: boolean } | { ok: false; error: PostError; account?: AccountId };

function sameTx(a: LedgerTx, b: LedgerTx): boolean {
  return JSON.stringify([a.kind, a.postings, a.atMs, a.memo ?? null]) === JSON.stringify([b.kind, b.postings, b.atMs, b.memo ?? null]);
}

/** Post a transaction. Pure: returns a new ledger. */
export function post(ledger: Ledger, tx: LedgerTx): PostResult {
  if (!LedgerTxSchema.safeParse(tx).success) return { ok: false, error: "invalid" };
  const existingId = ledger.keys[tx.idempotencyKey];
  if (existingId !== undefined) {
    const prev = ledger.txs.find((t) => t.id === existingId);
    return prev && sameTx(prev, tx) ? { ok: true, ledger, applied: false } : { ok: false, error: "idempotency_conflict" };
  }
  let sum = 0;
  for (const p of tx.postings) {
    if (p.amount === 0) return { ok: false, error: "zero_posting" };
    sum += p.amount;
  }
  if (sum !== 0) return { ok: false, error: "unbalanced" };
  const balances: Record<AccountId, number> = { ...ledger.balances };
  for (const p of tx.postings) balances[p.account] = (balances[p.account] ?? 0) + p.amount;
  for (const p of tx.postings) {
    if (isConstrained(p.account) && balances[p.account]! < 0) return { ok: false, error: "insufficient_funds", account: p.account };
  }
  return { ok: true, applied: true, ledger: { balances, txs: [...ledger.txs, tx], keys: { ...ledger.keys, [tx.idempotencyKey]: tx.id } } };
}

/** Full invariant check (recomputes balances from postings). */
export function checkLedger(ledger: Ledger): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const recomputed: Record<string, number> = {};
  const keys = new Set<string>();
  let total = 0;
  for (const tx of ledger.txs) {
    if (keys.has(tx.idempotencyKey)) problems.push(`duplicate key ${tx.idempotencyKey}`);
    keys.add(tx.idempotencyKey);
    let s = 0;
    for (const p of tx.postings) {
      if (!AccountIdSchema.safeParse(p.account).success) problems.push(`bad account ${p.account}`);
      s += p.amount;
      recomputed[p.account] = (recomputed[p.account] ?? 0) + p.amount;
    }
    if (s !== 0) problems.push(`tx ${tx.id} unbalanced`);
    total += s;
  }
  for (const [a, b] of Object.entries(ledger.balances)) {
    if ((recomputed[a] ?? 0) !== b) problems.push(`balance mismatch ${a}`);
    if (isConstrained(a as AccountId) && b < 0) problems.push(`negative ${a}`);
  }
  if (total !== 0) problems.push("ledger total != 0");
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Transaction builders
// ---------------------------------------------------------------------------

function tx(kind: LedgerTxKind, idempotencyKey: string, atMs: number, postings: Posting[], memo?: string): LedgerTx {
  const out: LedgerTx = { id: `tx:${idempotencyKey}`, idempotencyKey, kind, atMs, postings: postings.filter((p) => p.amount !== 0) };
  if (memo) out.memo = memo;
  return out;
}

/** Faucet: system -> player. */
export function grantTx(kind: LedgerTxKind, from: AccountId, playerId: string, amount: number, key: string, atMs: number, memo?: string): LedgerTx {
  return tx(kind, key, atMs, [
    { account: from, amount: -amount },
    { account: player(playerId), amount },
  ], memo);
}

/** Sink: player -> system. */
export function spendTx(kind: LedgerTxKind, to: AccountId, playerId: string, amount: number, key: string, atMs: number, memo?: string): LedgerTx {
  return tx(kind, key, atMs, [
    { account: player(playerId), amount: -amount },
    { account: to, amount },
  ], memo);
}

/** Stud fee: mare owner pays; stallion owner receives (fee − burn); burn goes to the burn sink. */
export function studFeeTx(mareOwner: string, stallionOwner: string, fee: number, burnPermille: number, key: string, atMs: number): LedgerTx {
  const burn = Math.floor((fee * burnPermille) / 1000);
  return tx("stud_fee", key, atMs, [
    { account: player(mareOwner), amount: -fee },
    { account: player(stallionOwner), amount: fee - burn },
    { account: SYSTEM.burn, amount: burn },
  ]);
}

/** Market: buyer funds escrow at purchase; settlement pays seller (price − fee) and burns the fee. */
export function escrowTx(buyer: string, listingId: string, price: number, key: string, atMs: number): LedgerTx {
  return tx("market_escrow", key, atMs, [
    { account: player(buyer), amount: -price },
    { account: escrow(listingId), amount: price },
  ]);
}

export function settleSaleTx(seller: string, listingId: string, price: number, feePermille: number, key: string, atMs: number): LedgerTx {
  const fee = Math.floor((price * feePermille) / 1000);
  return tx("market_sale", key, atMs, [
    { account: escrow(listingId), amount: -price },
    { account: player(seller), amount: price - fee },
    { account: SYSTEM.burn, amount: fee },
  ]);
}

export function refundTx(buyer: string, listingId: string, price: number, key: string, atMs: number): LedgerTx {
  return tx("market_refund", key, atMs, [
    { account: escrow(listingId), amount: -price },
    { account: player(buyer), amount: price },
  ]);
}

/** Post many; stops at the first failure and returns the ledger up to it. */
export function postAll(ledger: Ledger, txs: readonly LedgerTx[]): { ledger: Ledger; failed: { tx: LedgerTx; error: PostError } | null } {
  let l = ledger;
  for (const t of txs) {
    const r = post(l, t);
    if (!r.ok) return { ledger: l, failed: { tx: t, error: r.error } };
    l = r.ledger;
  }
  return { ledger: l, failed: null };
}

import type { Address, Hex } from "viem";
import type { ProofKind } from "./merkle";

/** Premium SKUs. Names are hashed on-chain with keccak256(utf8(name)); see `skuId`. */
export type SkuName = "premium_pack" | "season_pass" | "entry_refill" | `cosmetic.${string}`;

/** Fields of the EIP-712 `Order` voucher the server signs and the buyer submits. */
export interface PurchaseOrder {
  orderId: Hex;
  buyer: Address;
  sku: Hex;
  quantity: number;
  token: Address;
  maxTotal: bigint;
  /** unix seconds */
  deadline: bigint;
}

export interface SignedVoucher {
  order: PurchaseOrder;
  signature: Hex;
  chainId: number;
  storeAddress: Address;
  /** true when produced by MockChainAdapter (not a real signature). */
  mock: boolean;
}

/** What the server expects to find in the tx, from its own pending-order row. */
export interface PurchaseExpectation {
  orderId: Hex;
  sku: Hex;
  /** The wallet linked to the account that created the order. */
  buyer?: Address;
  quantity?: number;
  token?: Address;
  /** Reject if the paid total is below this (e.g. the quoted price). */
  minTotal?: bigint;
}

export interface VerifiedPurchase {
  /** Use as a UNIQUE key in the DB when crediting: `${chainId}:${store}:${orderId}`. */
  idempotencyKey: string;
  chainId: number;
  store: Address;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  orderId: Hex;
  buyer: Address;
  sku: Hex;
  token: Address;
  quantity: number;
  unitPrice: bigint;
  total: bigint;
  confirmations: number;
}

export type PurchaseRejectReason =
  | "disabled"
  | "wrong_chain"
  | "tx_failed"
  | "event_not_found"
  | "buyer_mismatch"
  | "sku_mismatch"
  | "quantity_mismatch"
  | "token_mismatch"
  | "amount_too_low";

export type PurchaseVerification =
  | { status: "confirmed"; purchase: VerifiedPurchase }
  /** Retry later. `unknown_tx` can also mean a bogus hash: give up after a timeout. */
  | { status: "pending"; reason: "unknown_tx" | "not_mined" | "confirmations" | "finality"; confirmations: number; required: number }
  | { status: "rejected"; reason: PurchaseRejectReason; detail?: string };

export interface ProofBatchPublication {
  kind: ProofKind;
  batchId: bigint;
  root: Hex;
  leafCount: number;
  manifestUri?: string;
}

export interface ProofBatchRecord {
  root: Hex;
  leafCount: number;
  publishedAt: bigint;
}

export interface ProofBatchReceipt {
  /** `already_published` = same root was already anchored (idempotent retry). */
  status: "published" | "already_published";
  txHash?: Hex;
  blockNumber?: bigint;
}

export interface TokenBalance {
  token: Address;
  symbol: string;
  decimals: number;
  amount: bigint;
}

export interface Balances {
  address: Address;
  native: bigint;
  paymentToken?: TokenBalance;
}

/**
 * Server-side chain integration. Every method is server-only: keys come from env and are
 * never exposed to the browser. The game works fully with the MockChainAdapter (default).
 */
export interface ChainAdapter {
  readonly kind: "mock" | "evm";
  readonly chainId: number;
  /** Sign an EIP-712 Order after the server has enforced every off-chain rule. */
  createPurchaseVoucher(order: PurchaseOrder): Promise<SignedVoucher>;
  /** Verify a buyer-submitted tx hash against the expected order. Pure read; idempotent. */
  verifyPurchase(txHash: Hex, expected: PurchaseExpectation): Promise<PurchaseVerification>;
  /** Anchor a proof batch root. Idempotent for identical (kind, batchId, root). */
  publishProofBatch(batch: ProofBatchPublication): Promise<ProofBatchReceipt>;
  getProofBatch(kind: ProofKind, batchId: bigint): Promise<ProofBatchRecord | null>;
  /** For display only (wallet panel). */
  getBalances(address: Address): Promise<Balances>;
}

export class ChainConfigError extends Error {
  override name = "ChainConfigError";
}

export class ProofBatchConflictError extends Error {
  override name = "ProofBatchConflictError";
}

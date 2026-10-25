import { concat, keccak256, numberToHex, type Address, type Hex } from "viem";
import type { ProofKind } from "./merkle";
import type {
  Balances,
  ChainAdapter,
  ProofBatchPublication,
  ProofBatchReceipt,
  ProofBatchRecord,
  PurchaseExpectation,
  PurchaseOrder,
  PurchaseVerification,
  SignedVoucher,
  VerifiedPurchase,
} from "./types";
import { ProofBatchConflictError } from "./types";
import { checkPurchase, idempotencyKey } from "./verify";

export const MOCK_STORE_ADDRESS: Address = "0x00000000000000000000000000000000005701e5";

interface MockTx {
  purchase: Omit<VerifiedPurchase, "confirmations" | "idempotencyKey">;
  status: "success" | "reverted";
}

/**
 * In-memory chain used whenever WEB3_ENABLED is not "true" (the default), in dev and in tests.
 * It mirrors the contract rules that matter to the server: single-use orderIds, maxTotal,
 * write-once proof batches, and confirmation counting.
 */
export class MockChainAdapter implements ChainAdapter {
  readonly kind = "mock" as const;
  readonly chainId: number;
  readonly storeAddress: Address = MOCK_STORE_ADDRESS;
  private readonly requiredConfirmations: number;
  private block = 1n;
  private nonce = 0;
  private readonly txs = new Map<string, MockTx>();
  private readonly fulfilled = new Set<string>();
  private readonly batches = new Map<string, ProofBatchRecord>();
  private readonly balances = new Map<string, Balances>();

  constructor(opts: { chainId?: number; minConfirmations?: number } = {}) {
    this.chainId = opts.chainId ?? 31337;
    this.requiredConfirmations = Math.max(1, opts.minConfirmations ?? 1);
  }

  async createPurchaseVoucher(order: PurchaseOrder): Promise<SignedVoucher> {
    return { order, signature: "0x", chainId: this.chainId, storeAddress: this.storeAddress, mock: true };
  }

  /** Dev/test helper: what a successful `PremiumStore.purchase` would produce. Returns the tx hash. */
  simulatePurchase(order: PurchaseOrder, unitPrice: bigint): Hex {
    const key = order.orderId.toLowerCase();
    if (this.fulfilled.has(key)) throw new Error(`OrderAlreadyFulfilled(${order.orderId})`);
    if (order.quantity <= 0 || order.quantity > 100) throw new Error(`InvalidQuantity(${order.quantity})`);
    const total = unitPrice * BigInt(order.quantity);
    if (total > order.maxTotal) throw new Error(`PriceAboveMax(${total}, ${order.maxTotal})`);
    const txHash = keccak256(concat([order.orderId, numberToHex(++this.nonce, { size: 32 })]));
    this.fulfilled.add(key);
    this.txs.set(txHash, {
      status: "success",
      purchase: {
        chainId: this.chainId,
        store: this.storeAddress,
        txHash,
        blockNumber: this.block,
        logIndex: 0,
        orderId: order.orderId,
        buyer: order.buyer,
        sku: order.sku,
        token: order.token,
        quantity: order.quantity,
        unitPrice,
        total,
      },
    });
    this.block += 1n;
    return txHash;
  }

  /** Dev/test helper: advance the mock chain head. */
  mineBlocks(n = 1): void {
    this.block += BigInt(n);
  }

  setBalances(balances: Balances): void {
    this.balances.set(balances.address.toLowerCase(), balances);
  }

  async verifyPurchase(txHash: Hex, expected: PurchaseExpectation): Promise<PurchaseVerification> {
    const tx = this.txs.get(txHash.toLowerCase());
    if (!tx) return { status: "pending", reason: "unknown_tx", confirmations: 0, required: this.requiredConfirmations };
    if (tx.status !== "success") return { status: "rejected", reason: "tx_failed" };
    if (tx.purchase.orderId.toLowerCase() !== expected.orderId.toLowerCase()) return { status: "rejected", reason: "event_not_found" };
    const mismatch = checkPurchase(tx.purchase, expected);
    if (mismatch) return mismatch;
    const confirmations = Number(this.block - 1n - tx.purchase.blockNumber + 1n);
    if (confirmations < this.requiredConfirmations) {
      return { status: "pending", reason: "confirmations", confirmations, required: this.requiredConfirmations };
    }
    return {
      status: "confirmed",
      purchase: {
        ...tx.purchase,
        confirmations,
        idempotencyKey: idempotencyKey(this.chainId, this.storeAddress, tx.purchase.orderId),
      },
    };
  }

  async publishProofBatch(batch: ProofBatchPublication): Promise<ProofBatchReceipt> {
    if (batch.leafCount <= 0) throw new Error("EmptyBatch");
    if (BigInt(batch.root) === 0n) throw new Error("EmptyRoot");
    const key = `${batch.kind}:${batch.batchId}`;
    const existing = this.batches.get(key);
    if (existing) {
      if (existing.root.toLowerCase() === batch.root.toLowerCase()) return { status: "already_published" };
      throw new ProofBatchConflictError(`batch ${key} already anchored with a different root`);
    }
    this.batches.set(key, { root: batch.root, leafCount: batch.leafCount, publishedAt: BigInt(Math.floor(Date.now() / 1000)) });
    const txHash = keccak256(concat([batch.root, numberToHex(++this.nonce, { size: 32 })]));
    const blockNumber = this.block;
    this.block += 1n;
    return { status: "published", txHash, blockNumber };
  }

  async getProofBatch(kind: ProofKind, batchId: bigint): Promise<ProofBatchRecord | null> {
    return this.batches.get(`${kind}:${batchId}`) ?? null;
  }

  async getBalances(address: Address): Promise<Balances> {
    return this.balances.get(address.toLowerCase()) ?? { address, native: 0n };
  }
}

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  http,
  isAddressEqual,
  parseEventLogs,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { premiumStoreAbi, raceProofRegistryAbi } from "./abi";
import type { ChainConfig, ChainSecrets } from "./config";
import type { ProofKind } from "./merkle";
import { orderTypedData } from "./voucher";
import {
  ChainConfigError,
  ProofBatchConflictError,
  type Balances,
  type ChainAdapter,
  type ProofBatchPublication,
  type ProofBatchReceipt,
  type ProofBatchRecord,
  type PurchaseExpectation,
  type PurchaseOrder,
  type PurchaseVerification,
  type SignedVoucher,
} from "./types";
import { checkPurchase, idempotencyKey, sameHex } from "./verify";

export type PurchaseFinality = "latest" | "safe" | "finalized";

export interface EvmChainAdapterOptions {
  publicClient: PublicClient;
  chainId: number;
  premiumStore?: Address;
  raceProofRegistry?: Address;
  paymentToken?: Address;
  /** Wallet holding PUBLISHER_ROLE on the registry. Server only. */
  publisher?: WalletClient<Transport, Chain | undefined, Account>;
  /** Key holding SIGNER_ROLE on the store. Server only. */
  voucherSigner?: LocalAccount;
  minConfirmations?: number;
  /**
   * "latest" trusts the sequencer's soft confirmation (sub-second, fine for low-value SKUs).
   * "safe"/"finalized" wait until the batch is posted to / finalized on Ethereum (minutes).
   */
  purchaseFinality?: PurchaseFinality;
}

function assertServerOnly(): void {
  if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
    throw new ChainConfigError("EvmChainAdapter is server-only: never load chain keys in the browser");
  }
}

/** viem chain for a configured id. Known Robinhood chains come from viem; others are defined ad hoc. */
export function chainFor(chainId: number, rpcUrl: string): Chain {
  const base = chainId === robinhood.id ? robinhood : chainId === robinhoodTestnet.id ? robinhoodTestnet : undefined;
  if (base) return { ...base, rpcUrls: { default: { http: [rpcUrl] } } };
  return defineChain({
    id: chainId,
    name: `EVM ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export class EvmChainAdapter implements ChainAdapter {
  readonly kind = "evm" as const;
  readonly chainId: number;
  private readonly pc: PublicClient;
  private readonly opts: EvmChainAdapterOptions;
  private chainChecked = false;

  constructor(opts: EvmChainAdapterOptions) {
    assertServerOnly();
    this.opts = opts;
    this.pc = opts.publicClient;
    this.chainId = opts.chainId;
  }

  static fromConfig(config: ChainConfig, secrets: ChainSecrets): EvmChainAdapter {
    if (!config.rpcUrl) throw new ChainConfigError("ROBINHOOD_RPC_URL is required when WEB3_ENABLED=true");
    const chain = chainFor(config.chainId, config.rpcUrl);
    const transport = http(config.rpcUrl, { retryCount: 2, timeout: 15_000 });
    const publicClient = createPublicClient({ chain, transport }) as PublicClient;
    const publisher = secrets.publisherKey
      ? createWalletClient({ chain, transport, account: privateKeyToAccount(secrets.publisherKey) })
      : undefined;
    const voucherSigner = secrets.storeSignerKey ? privateKeyToAccount(secrets.storeSignerKey) : undefined;
    return new EvmChainAdapter({
      publicClient,
      chainId: config.chainId,
      premiumStore: config.premiumStore,
      raceProofRegistry: config.raceProofRegistry,
      paymentToken: config.paymentToken,
      publisher,
      voucherSigner,
      minConfirmations: config.minConfirmations,
      purchaseFinality: config.purchaseFinality,
    });
  }

  private async onExpectedChain(): Promise<boolean> {
    if (this.chainChecked) return true;
    const actual = await this.pc.getChainId();
    if (actual !== this.chainId) return false;
    this.chainChecked = true;
    return true;
  }

  async createPurchaseVoucher(order: PurchaseOrder): Promise<SignedVoucher> {
    const store = this.opts.premiumStore;
    const signer = this.opts.voucherSigner;
    if (!store || !signer) throw new ChainConfigError("PREMIUM_STORE_ADDRESS and STORE_SIGNER_PRIVATE_KEY are required to sign vouchers");
    if (order.quantity <= 0 || !Number.isInteger(order.quantity)) throw new Error("quantity must be a positive integer");
    const signature = await signer.signTypedData(orderTypedData(order, this.chainId, store));
    return { order, signature, chainId: this.chainId, storeAddress: store, mock: false };
  }

  async verifyPurchase(txHash: Hex, expected: PurchaseExpectation): Promise<PurchaseVerification> {
    const store = this.opts.premiumStore;
    if (!store) return { status: "rejected", reason: "disabled", detail: "PREMIUM_STORE_ADDRESS not configured" };
    if (!(await this.onExpectedChain())) return { status: "rejected", reason: "wrong_chain" };
    const required = Math.max(1, this.opts.minConfirmations ?? 1);

    let receipt;
    try {
      receipt = await this.pc.getTransactionReceipt({ hash: txHash });
    } catch (err) {
      if (!(err instanceof TransactionReceiptNotFoundError)) throw err;
      try {
        await this.pc.getTransaction({ hash: txHash });
        return { status: "pending", reason: "not_mined", confirmations: 0, required };
      } catch (inner) {
        if (inner instanceof TransactionNotFoundError) return { status: "pending", reason: "unknown_tx", confirmations: 0, required };
        throw inner;
      }
    }
    if (receipt.status !== "success") return { status: "rejected", reason: "tx_failed" };

    // Only logs emitted by OUR store count (a fake contract can emit an identical event).
    const events = parseEventLogs({
      abi: premiumStoreAbi,
      eventName: "Purchased",
      logs: receipt.logs.filter((l) => isAddressEqual(l.address, store)),
    });
    // A tx may contain several purchases (smart-account batching): match on orderId.
    const ev = events.find((e) => sameHex(e.args.orderId, expected.orderId));
    if (!ev) return { status: "rejected", reason: "event_not_found" };

    const found = {
      chainId: this.chainId,
      store,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      logIndex: ev.logIndex,
      orderId: ev.args.orderId,
      buyer: ev.args.buyer,
      sku: ev.args.sku,
      token: ev.args.token,
      quantity: Number(ev.args.quantity),
      unitPrice: ev.args.unitPrice,
      total: ev.args.total,
    };
    const mismatch = checkPurchase(found, expected);
    if (mismatch) return mismatch;

    const head = await this.pc.getBlockNumber();
    const confirmations = Number(head - receipt.blockNumber + 1n);
    if (confirmations < required) return { status: "pending", reason: "confirmations", confirmations, required };
    const finality = this.opts.purchaseFinality ?? "latest";
    if (finality !== "latest") {
      const tagged = await this.pc.getBlock({ blockTag: finality });
      if (tagged.number === null || tagged.number < receipt.blockNumber) {
        return { status: "pending", reason: "finality", confirmations, required };
      }
    }
    return {
      status: "confirmed",
      purchase: { ...found, confirmations, idempotencyKey: idempotencyKey(this.chainId, store, found.orderId) },
    };
  }

  async getProofBatch(kind: ProofKind, batchId: bigint): Promise<ProofBatchRecord | null> {
    const registry = this.opts.raceProofRegistry;
    if (!registry) throw new ChainConfigError("RACE_PROOF_REGISTRY_ADDRESS not configured");
    const b = await this.pc.readContract({ address: registry, abi: raceProofRegistryAbi, functionName: "getBatch", args: [kind, batchId] });
    if (BigInt(b.root) === 0n) return null;
    return { root: b.root, leafCount: b.leafCount, publishedAt: b.publishedAt };
  }

  async publishProofBatch(batch: ProofBatchPublication): Promise<ProofBatchReceipt> {
    const registry = this.opts.raceProofRegistry;
    const publisher = this.opts.publisher;
    if (!registry || !publisher) {
      throw new ChainConfigError("RACE_PROOF_REGISTRY_ADDRESS and CHAIN_PUBLISHER_PRIVATE_KEY are required to publish");
    }
    if (!(await this.onExpectedChain())) throw new ChainConfigError(`RPC is not chain ${this.chainId}`);
    const existing = await this.getProofBatch(batch.kind, batch.batchId);
    if (existing) {
      if (sameHex(existing.root, batch.root)) return { status: "already_published" };
      throw new ProofBatchConflictError(`batch ${batch.kind}:${batch.batchId} already anchored with a different root`);
    }
    const { request } = await this.pc.simulateContract({
      address: registry,
      abi: raceProofRegistryAbi,
      functionName: "publishBatch",
      args: [batch.kind, batch.batchId, batch.root, batch.leafCount, batch.manifestUri ?? ""],
      account: publisher.account,
    });
    const hash = await publisher.writeContract({ ...request, chain: publisher.chain ?? null } as Parameters<typeof publisher.writeContract>[0]);
    const receipt = await this.pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`publishBatch reverted in ${hash}`);
    return { status: "published", txHash: hash, blockNumber: receipt.blockNumber };
  }

  async getBalances(address: Address): Promise<Balances> {
    const native = await this.pc.getBalance({ address });
    const token = this.opts.paymentToken;
    if (!token) return { address, native };
    const [amount, decimals, symbol] = await Promise.all([
      this.pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
      this.pc.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      this.pc.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    ]);
    return { address, native, paymentToken: { token, symbol, decimals, amount } };
  }
}

/**
 * The closed beta's chain adapter (server only): sign ETH quotes, verify purchases, read and
 * post Prize Pool epochs. `MockBetaChain` (default, WEB3_ENABLED unset, tests) mirrors the
 * contract rules in memory; `EvmBetaChain` talks to Robinhood Chain (or a local Hardhat node)
 * with viem. Only logs emitted by OUR store address count.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddressEqual,
  keccak256,
  concat,
  numberToHex,
  parseEventLogs,
  toBytes,
  verifyMessage,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { premiumStoreAbi, prizePoolAbi } from "@/lib/chain/contracts.generated";
import { viemChain } from "@/lib/chain/chains";
import { ethQuoteTypedData, type EthQuote } from "@/lib/chain/quote";
import { assertLiveConfig, readBetaConfig, type BetaChainConfig } from "./config";

export const skuId = (name: string): Hex => keccak256(toBytes(name));

export interface ExpectedPurchase {
  orderId: Hex;
  buyer: Address;
  sku: Hex;
  quantity: number;
  priceWei: bigint;
}

export interface Commission {
  level: 1 | 2;
  wallet: Address;
  amountWei: bigint;
  deferred: boolean;
}

export type EthVerification =
  | { status: "confirmed"; poolShareWei: bigint; treasuryWei: bigint; commissions: Commission[]; blockNumber: bigint; confirmations: number }
  | { status: "pending"; reason: "unknown_tx" | "not_mined" | "confirmations" }
  | { status: "rejected"; reason: string };

export interface PoolState {
  balanceWei: bigint;
  availableWei: bigint;
  outstandingWei: bigint;
  lastEpochId: number;
  lastPostedAt: number;
  maxEpochBps: number;
  minEpochInterval: number;
  claimWindow: number;
  maxClaimPerEpochWei: bigint;
  paused: boolean;
}

export interface StoreState {
  poolBps: number;
  maxRef1Bps: number;
  maxRef2Bps: number;
  treasury: Address;
  prizePool: Address;
  paused: boolean;
  premiumActive: boolean;
  signerHasRole: boolean;
  signerCanPost: boolean;
}

export interface OnChainEpoch {
  root: Hex;
  total: bigint;
  claimed: bigint;
  returned: bigint;
  postedAt: number;
  claimDeadline: number;
  closed: boolean;
}

export interface BetaChain {
  readonly kind: "mock" | "evm";
  readonly chainId: number;
  readonly store: Address;
  readonly pool: Address;
  signerAddress(): Address | null;
  signQuote(q: EthQuote): Promise<Hex>;
  verifyEthPurchase(txHash: Hex, expected: ExpectedPurchase): Promise<EthVerification>;
  /** Backstop: the tx that paid `orderId`, if any (event scan by the indexed orderId). */
  findPurchaseTx(orderId: Hex): Promise<Hex | null>;
  poolState(): Promise<PoolState>;
  storeState(): Promise<StoreState>;
  epoch(epochId: number): Promise<OnChainEpoch | null>;
  claimOf(epochId: number, account: Address): Promise<{ claimed: bigint; revoked: boolean; cap: bigint }>;
  /** Posts an epoch root with the server key (needs POSTER_ROLE and gas). */
  postEpoch(input: { epochId: number; root: Hex; total: bigint; leafCount: number; uri: string }): Promise<Hex>;
  /** EIP-191 signature check; ERC-1271/6492 smart wallets too when an RPC is available. */
  verifySignature(address: Address, message: string, signature: Hex): Promise<boolean>;
}

const ROLE = (n: string) => keccak256(toBytes(n));

// ---------------------------------------------------------------------------
// EVM (viem)
// ---------------------------------------------------------------------------

export class EvmBetaChain implements BetaChain {
  readonly kind = "evm" as const;
  readonly chainId: number;
  readonly store: Address;
  readonly pool: Address;
  private readonly pc: PublicClient;
  private readonly signer: PrivateKeyAccount;
  private readonly rpcUrl: string;
  private readonly minConfirmations: number;
  private readonly lookback: bigint;

  constructor(cfg: BetaChainConfig) {
    assertLiveConfig(cfg);
    if (typeof (globalThis as { window?: unknown }).window !== "undefined") throw new Error("server only");
    this.chainId = cfg.chainId;
    this.store = cfg.store;
    this.pool = cfg.pool;
    this.rpcUrl = cfg.rpcUrl;
    this.minConfirmations = cfg.minConfirmations;
    this.lookback = cfg.logLookbackBlocks;
    this.signer = privateKeyToAccount(cfg.signerKey);
    this.pc = createPublicClient({ chain: viemChain(cfg.chainId, cfg.rpcUrl), transport: http(cfg.rpcUrl, { retryCount: 2, timeout: 15_000 }) }) as PublicClient;
  }

  signerAddress(): Address {
    return this.signer.address;
  }

  signQuote(q: EthQuote): Promise<Hex> {
    return this.signer.signTypedData(ethQuoteTypedData(q, this.chainId, this.store));
  }

  async verifyEthPurchase(txHash: Hex, e: ExpectedPurchase): Promise<EthVerification> {
    if ((await this.pc.getChainId()) !== this.chainId) return { status: "rejected", reason: "wrong_chain" };
    let receipt;
    try {
      receipt = await this.pc.getTransactionReceipt({ hash: txHash });
    } catch (err) {
      if (!(err instanceof TransactionReceiptNotFoundError)) throw err;
      try {
        await this.pc.getTransaction({ hash: txHash });
        return { status: "pending", reason: "not_mined" };
      } catch (inner) {
        if (inner instanceof TransactionNotFoundError) return { status: "pending", reason: "unknown_tx" };
        throw inner;
      }
    }
    if (receipt.status !== "success") return { status: "rejected", reason: "tx_failed" };
    const ours = receipt.logs.filter((l) => isAddressEqual(l.address, this.store));
    const bought = parseEventLogs({ abi: premiumStoreAbi, eventName: "PurchasedWithEth", logs: ours }).find((l) => l.args.orderId.toLowerCase() === e.orderId.toLowerCase());
    if (!bought) return { status: "rejected", reason: "event_not_found" };
    const a = bought.args;
    if (!isAddressEqual(a.buyer, e.buyer)) return { status: "rejected", reason: "buyer_mismatch" };
    if (a.sku.toLowerCase() !== e.sku.toLowerCase()) return { status: "rejected", reason: "sku_mismatch" };
    if (Number(a.quantity) !== e.quantity) return { status: "rejected", reason: "quantity_mismatch" };
    if (a.priceWei !== e.priceWei) return { status: "rejected", reason: "amount_mismatch" };
    const head = await this.pc.getBlockNumber({ cacheTime: 0 });
    const confirmations = Number(head - receipt.blockNumber + 1n);
    if (confirmations < this.minConfirmations) return { status: "pending", reason: "confirmations" };
    const commissions = parseEventLogs({ abi: premiumStoreAbi, eventName: "ReferralCommission", logs: ours })
      .filter((l) => l.args.orderId.toLowerCase() === e.orderId.toLowerCase())
      .map((l) => ({ level: Number(l.args.level) as 1 | 2, wallet: l.args.referrer, amountWei: l.args.amount, deferred: l.args.deferred }));
    return { status: "confirmed", poolShareWei: a.poolShare, treasuryWei: a.treasuryShare, commissions, blockNumber: receipt.blockNumber, confirmations };
  }

  async findPurchaseTx(orderId: Hex): Promise<Hex | null> {
    const head = await this.pc.getBlockNumber({ cacheTime: 0 });
    const fromBlock = head > this.lookback ? head - this.lookback : 0n;
    const logs = await this.pc.getContractEvents({ address: this.store, abi: premiumStoreAbi, eventName: "PurchasedWithEth", args: { orderId }, fromBlock, toBlock: "latest" });
    return logs[0]?.transactionHash ?? null;
  }

  private read<F extends string>(address: Address, abi: typeof prizePoolAbi | typeof premiumStoreAbi, functionName: F, args: readonly unknown[] = []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.pc.readContract({ address, abi: abi as any, functionName, args } as any) as Promise<any>;
  }

  async poolState(): Promise<PoolState> {
    const p = this.pool;
    const [balance, available, outstanding, last, lastAt, bps, interval, window, maxClaim, paused] = await Promise.all([
      this.pc.getBalance({ address: p }),
      this.read(p, prizePoolAbi, "available"),
      this.read(p, prizePoolAbi, "outstanding"),
      this.read(p, prizePoolAbi, "lastEpochId"),
      this.read(p, prizePoolAbi, "lastPostedAt"),
      this.read(p, prizePoolAbi, "maxEpochBps"),
      this.read(p, prizePoolAbi, "minEpochInterval"),
      this.read(p, prizePoolAbi, "claimWindow"),
      this.read(p, prizePoolAbi, "maxClaimPerEpoch"),
      this.read(p, prizePoolAbi, "paused"),
    ]);
    return {
      balanceWei: balance,
      availableWei: available,
      outstandingWei: outstanding,
      lastEpochId: Number(last),
      lastPostedAt: Number(lastAt),
      maxEpochBps: Number(bps),
      minEpochInterval: Number(interval),
      claimWindow: Number(window),
      maxClaimPerEpochWei: maxClaim,
      paused,
    };
  }

  async storeState(): Promise<StoreState> {
    const s = this.store;
    const [poolBps, r1, r2, treasury, prizePool, paused, active, signer, poster] = await Promise.all([
      this.read(s, premiumStoreAbi, "poolBps"),
      this.read(s, premiumStoreAbi, "maxRef1Bps"),
      this.read(s, premiumStoreAbi, "maxRef2Bps"),
      this.read(s, premiumStoreAbi, "treasury"),
      this.read(s, premiumStoreAbi, "prizePool"),
      this.read(s, premiumStoreAbi, "paused"),
      this.read(s, premiumStoreAbi, "skuActive", [skuId("premium_pack")]),
      this.read(s, premiumStoreAbi, "hasRole", [ROLE("SIGNER_ROLE"), this.signer.address]),
      this.read(this.pool, prizePoolAbi, "hasRole", [ROLE("POSTER_ROLE"), this.signer.address]),
    ]);
    return { poolBps: Number(poolBps), maxRef1Bps: Number(r1), maxRef2Bps: Number(r2), treasury, prizePool, paused, premiumActive: active, signerHasRole: signer, signerCanPost: poster };
  }

  async epoch(epochId: number): Promise<OnChainEpoch | null> {
    const e = await this.read(this.pool, prizePoolAbi, "getEpoch", [BigInt(epochId)]);
    if (BigInt(e.root) === 0n) return null;
    return { root: e.root, total: e.total, claimed: e.claimed, returned: e.returned, postedAt: Number(e.postedAt), claimDeadline: Number(e.claimDeadline), closed: e.closed };
  }

  async claimOf(epochId: number, account: Address) {
    const c = await this.read(this.pool, prizePoolAbi, "claimOf", [BigInt(epochId), account]);
    return { claimed: c.claimed as bigint, revoked: c.revoked as boolean, cap: c.cap as bigint };
  }

  async postEpoch(input: { epochId: number; root: Hex; total: bigint; leafCount: number; uri: string }): Promise<Hex> {
    const wallet = createWalletClient({ account: this.signer, chain: viemChain(this.chainId, this.rpcUrl), transport: http(this.rpcUrl) });
    const { request } = await this.pc.simulateContract({
      address: this.pool,
      abi: prizePoolAbi,
      functionName: "postEpoch",
      args: [BigInt(input.epochId), input.root, input.total, input.leafCount, input.uri],
      account: this.signer,
    });
    const hash = await wallet.writeContract(request);
    const r = await this.pc.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`postEpoch reverted (${hash})`);
    return hash;
  }

  async verifySignature(address: Address, message: string, signature: Hex): Promise<boolean> {
    try {
      // Handles EOAs, ERC-1271 smart wallets and ERC-6492 counterfactual wallets.
      return await this.pc.verifyMessage({ address, message, signature });
    } catch {
      return verifyMessage({ address, message, signature }).catch(() => false);
    }
  }
}

// ---------------------------------------------------------------------------
// Mock (default): in-memory chain that mirrors the store and pool rules the server relies on
// ---------------------------------------------------------------------------

interface MockTx {
  quote: EthQuote;
  poolShareWei: bigint;
  treasuryWei: bigint;
  commissions: Commission[];
  block: bigint;
}

export const MOCK_STORE: Address = "0x00000000000000000000000000000000005701e5";
export const MOCK_POOL: Address = "0x000000000000000000000000000000000000900a";

export class MockBetaChain implements BetaChain {
  readonly kind = "mock" as const;
  readonly store = MOCK_STORE;
  readonly pool = MOCK_POOL;
  poolBps = 3000;
  private block = 1n;
  private nonce = 0;
  private readonly txs = new Map<string, MockTx>();
  private readonly used = new Set<string>();
  private readonly epochs = new Map<number, OnChainEpoch & { leafCount: number }>();
  private readonly claims = new Map<string, bigint>();
  balanceWei = 0n;
  outstandingWei = 0n;
  maxClaimPerEpochWei = 10n ** 17n;

  constructor(
    readonly chainId = 31337,
    private readonly minConfirmations = 1,
  ) {}

  signerAddress(): Address {
    return "0x000000000000000000000000000000000051617e";
  }

  async signQuote(q: EthQuote): Promise<Hex> {
    return keccak256(toBytes(JSON.stringify({ ...q, priceWei: q.priceWei.toString(), usdCents: q.usdCents.toString(), deadline: q.deadline.toString() })));
  }

  /** Test/dev helper: what a successful purchaseWithEth would do. Returns the tx hash. */
  simulatePurchase(q: EthQuote, opts: { from?: Address; value?: bigint; nowSec?: bigint } = {}): Hex {
    const from = opts.from ?? q.buyer;
    if (from.toLowerCase() !== q.buyer.toLowerCase()) throw new Error("NotOrderBuyer");
    if (this.used.has(q.orderId.toLowerCase())) throw new Error("OrderAlreadyFulfilled");
    if ((opts.value ?? q.priceWei) !== q.priceWei) throw new Error("WrongPayment");
    if (opts.nowSec !== undefined && opts.nowSec > q.deadline) throw new Error("OrderExpired");
    const poolShareWei = (q.priceWei * BigInt(this.poolBps)) / 10_000n;
    const r1 = (q.priceWei * BigInt(q.ref1Bps)) / 10_000n;
    const r2 = (q.priceWei * BigInt(q.ref2Bps)) / 10_000n;
    const commissions: Commission[] = [];
    if (r1 > 0n) commissions.push({ level: 1, wallet: q.ref1, amountWei: r1, deferred: false });
    if (r2 > 0n) commissions.push({ level: 2, wallet: q.ref2, amountWei: r2, deferred: false });
    const hash = keccak256(concat([q.orderId, numberToHex(++this.nonce, { size: 32 })]));
    this.used.add(q.orderId.toLowerCase());
    this.txs.set(hash, { quote: q, poolShareWei, treasuryWei: q.priceWei - poolShareWei - r1 - r2, commissions, block: this.block });
    this.balanceWei += poolShareWei;
    this.block += 1n;
    return hash;
  }

  mine(n = 1): void {
    this.block += BigInt(n);
  }

  async verifyEthPurchase(txHash: Hex, e: ExpectedPurchase): Promise<EthVerification> {
    const tx = this.txs.get(txHash.toLowerCase()) ?? this.txs.get(txHash);
    if (!tx) return { status: "pending", reason: "unknown_tx" };
    const q = tx.quote;
    if (q.orderId.toLowerCase() !== e.orderId.toLowerCase()) return { status: "rejected", reason: "event_not_found" };
    if (q.buyer.toLowerCase() !== e.buyer.toLowerCase()) return { status: "rejected", reason: "buyer_mismatch" };
    if (q.sku.toLowerCase() !== e.sku.toLowerCase()) return { status: "rejected", reason: "sku_mismatch" };
    if (q.quantity !== e.quantity) return { status: "rejected", reason: "quantity_mismatch" };
    if (q.priceWei !== e.priceWei) return { status: "rejected", reason: "amount_mismatch" };
    const confirmations = Number(this.block - tx.block);
    if (confirmations < this.minConfirmations) return { status: "pending", reason: "confirmations" };
    return { status: "confirmed", poolShareWei: tx.poolShareWei, treasuryWei: tx.treasuryWei, commissions: tx.commissions, blockNumber: tx.block, confirmations };
  }

  async findPurchaseTx(orderId: Hex): Promise<Hex | null> {
    for (const [hash, tx] of this.txs) if (tx.quote.orderId.toLowerCase() === orderId.toLowerCase()) return hash as Hex;
    return null;
  }

  async poolState(): Promise<PoolState> {
    const last = Math.max(0, ...this.epochs.keys());
    return {
      balanceWei: this.balanceWei,
      availableWei: this.balanceWei - this.outstandingWei,
      outstandingWei: this.outstandingWei,
      lastEpochId: last,
      lastPostedAt: last ? this.epochs.get(last)!.postedAt : 0,
      maxEpochBps: 5000,
      minEpochInterval: 0,
      claimWindow: 56 * 86_400,
      maxClaimPerEpochWei: this.maxClaimPerEpochWei,
      paused: false,
    };
  }

  async storeState(): Promise<StoreState> {
    return { poolBps: this.poolBps, maxRef1Bps: 1000, maxRef2Bps: 300, treasury: "0x0000000000000000000000000000000000007ea5", prizePool: this.pool, paused: false, premiumActive: true, signerHasRole: true, signerCanPost: true };
  }

  async epoch(epochId: number): Promise<OnChainEpoch | null> {
    return this.epochs.get(epochId) ?? null;
  }

  async claimOf(epochId: number, account: Address) {
    return { claimed: this.claims.get(`${epochId}:${account.toLowerCase()}`) ?? 0n, revoked: false, cap: 0n };
  }

  async postEpoch(input: { epochId: number; root: Hex; total: bigint; leafCount: number; uri: string }): Promise<Hex> {
    const st = await this.poolState();
    if (input.epochId !== st.lastEpochId + 1) throw new Error("EpochOutOfOrder");
    if (input.total > (st.availableWei * BigInt(st.maxEpochBps)) / 10_000n) throw new Error("OverAllocation");
    const now = Math.floor(Date.now() / 1000);
    this.epochs.set(input.epochId, { root: input.root, total: input.total, claimed: 0n, returned: 0n, postedAt: now, claimDeadline: now + st.claimWindow, closed: false, leafCount: input.leafCount });
    this.outstandingWei += input.total;
    return keccak256(concat([input.root, numberToHex(++this.nonce, { size: 32 })]));
  }

  /** Test helper: a claim paid by the pool. */
  simulateClaim(epochId: number, account: Address, amount: bigint): void {
    const k = `${epochId}:${account.toLowerCase()}`;
    this.claims.set(k, (this.claims.get(k) ?? 0n) + amount);
    this.balanceWei -= amount;
    this.outstandingWei -= amount;
  }

  async verifySignature(address: Address, message: string, signature: Hex): Promise<boolean> {
    return verifyMessage({ address, message, signature }).catch(() => false);
  }
}

// ---------------------------------------------------------------------------

const G = globalThis as typeof globalThis & { __tbBetaChain?: BetaChain; __tbBetaChainKey?: string };

/** The process-wide chain: EVM when WEB3_ENABLED=true (fails loudly if misconfigured), else the mock. */
export function betaChain(env: Record<string, string | undefined> = process.env): BetaChain {
  const cfg = readBetaConfig(env);
  const key = `${cfg.enabled}:${cfg.chainId}:${cfg.store}:${cfg.pool}:${cfg.rpcUrl}`;
  if (G.__tbBetaChain && G.__tbBetaChainKey === key) return G.__tbBetaChain;
  G.__tbBetaChain = cfg.enabled ? new EvmBetaChain(cfg) : new MockBetaChain(cfg.chainId);
  G.__tbBetaChainKey = key;
  return G.__tbBetaChain;
}

/** For tests: install a specific chain (e.g. a MockBetaChain you drive). */
export function setBetaChainForTests(chain: BetaChain | undefined): void {
  G.__tbBetaChain = chain;
  G.__tbBetaChainKey = chain ? `${readBetaConfig().enabled}:${readBetaConfig().chainId}:${readBetaConfig().store}:${readBetaConfig().pool}:${readBetaConfig().rpcUrl}` : undefined;
}

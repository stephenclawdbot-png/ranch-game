/**
 * The USDG horse market's chain adapter (server only). `MockUsdgChain` (dev, tests, WEB3 off)
 * mirrors HorseMarket's rules in memory so the whole flow is playable without a node;
 * `EvmUsdgChain` signs orders with the server key and verifies `Sold` / `Registered` /
 * `StudFeePaid` logs from OUR market address only.
 */
import {
  concat,
  createPublicClient,
  http,
  isAddressEqual,
  keccak256,
  numberToHex,
  parseEventLogs,
  recoverTypedDataAddress,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { horseMarketAbi } from "@/lib/chain/contracts.generated";
import { viemChain } from "@/lib/chain/chains";
import { bidTypedData, registrationOrderTypedData, saleOrderTypedData, studOrderTypedData, type Bid, type RegistrationOrder, type SaleOrder, type StudOrder } from "@/lib/chain/usdg";
import { usdgPolicy } from "@thoroughbred/db";
import { readUsdgConfig, type UsdgConfig } from "./usdgConfig";

export type UsdgOrderKind = "registration" | "sale" | "stud";

export interface ExpectedUsdgPayment {
  kind: UsdgOrderKind;
  orderId: Hex;
  /** The horse (registration, sale) or the stallion (stud). */
  horseRef: Hex;
  /** Stud fees: the mare being covered. */
  mareRef?: Hex;
  /** Buyer (sale), owner (registration) or the mare's owner (stud). */
  payer: Address;
  /** Seller (sale) or the stallion's owner (stud). */
  seller?: Address;
  price: bigint;
  fee: bigint;
}

export type UsdgVerification =
  | { status: "confirmed"; blockNumber: bigint; confirmations: number }
  | { status: "pending"; reason: "unknown_tx" | "not_mined" | "confirmations" }
  | { status: "rejected"; reason: string };

export interface MarketState {
  feeBps: number;
  treasury: Address;
  paused: boolean;
  tokenAccepted: boolean;
  signerHasRole: boolean;
}

export interface UsdgChain {
  readonly kind: "mock" | "evm" | "practice";
  readonly chainId: number;
  readonly market: Address;
  readonly token: Address;
  signSale(o: SaleOrder): Promise<Hex>;
  signRegistration(o: RegistrationOrder): Promise<Hex>;
  signStud(o: StudOrder): Promise<Hex>;
  verifyPayment(txHash: Hex, expected: ExpectedUsdgPayment): Promise<UsdgVerification>;
  /** Backstop: the tx that paid `orderId`, if any (event scan by the indexed orderId). */
  findPaymentTx(kind: UsdgOrderKind, orderId: Hex): Promise<Hex | null>;
  /** True when `bid.bidder` signed this EIP-712 Bid (EOAs; ERC-1271 smart wallets with an RPC). */
  verifyBid(bid: Bid, signature: Hex): Promise<boolean>;
  marketState(): Promise<MarketState>;
}

const SIGNER_ROLE = keccak256(new TextEncoder().encode("SIGNER_ROLE"));

// ---------------------------------------------------------------------------
// EVM
// ---------------------------------------------------------------------------

export class EvmUsdgChain implements UsdgChain {
  readonly kind = "evm" as const;
  readonly chainId: number;
  readonly market: Address;
  readonly token: Address;
  private readonly pc: PublicClient;
  private readonly signer: PrivateKeyAccount;
  private readonly minConfirmations: number;
  private readonly lookback: bigint;

  constructor(cfg: UsdgConfig) {
    if (cfg.mode !== "live" || !cfg.rpcUrl || !cfg.signerKey) throw new Error("EvmUsdgChain needs a live config");
    if (typeof (globalThis as { window?: unknown }).window !== "undefined") throw new Error("server only");
    this.chainId = cfg.chainId;
    this.market = cfg.market;
    this.token = cfg.token;
    this.minConfirmations = cfg.minConfirmations;
    this.lookback = cfg.logLookbackBlocks;
    this.signer = privateKeyToAccount(cfg.signerKey);
    this.pc = createPublicClient({ chain: viemChain(cfg.chainId, cfg.rpcUrl), transport: http(cfg.rpcUrl, { retryCount: 2, timeout: 15_000 }) }) as PublicClient;
  }

  signSale(o: SaleOrder): Promise<Hex> {
    return this.signer.signTypedData(saleOrderTypedData(o, this.chainId, this.market));
  }

  signRegistration(o: RegistrationOrder): Promise<Hex> {
    return this.signer.signTypedData(registrationOrderTypedData(o, this.chainId, this.market));
  }

  signStud(o: StudOrder): Promise<Hex> {
    return this.signer.signTypedData(studOrderTypedData(o, this.chainId, this.market));
  }

  async verifyPayment(txHash: Hex, e: ExpectedUsdgPayment): Promise<UsdgVerification> {
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
    const ours = receipt.logs.filter((l) => isAddressEqual(l.address, this.market));
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    if (e.kind === "sale") {
      const ev = parseEventLogs({ abi: horseMarketAbi, eventName: "Sold", logs: ours }).find((l) => same(l.args.orderId, e.orderId));
      if (!ev) return { status: "rejected", reason: "event_not_found" };
      const a = ev.args;
      if (!same(a.horseRef, e.horseRef)) return { status: "rejected", reason: "horse_mismatch" };
      if (!isAddressEqual(a.buyer, e.payer)) return { status: "rejected", reason: "buyer_mismatch" };
      if (e.seller && !isAddressEqual(a.seller, e.seller)) return { status: "rejected", reason: "seller_mismatch" };
      if (a.price !== e.price || a.fee !== e.fee) return { status: "rejected", reason: "amount_mismatch" };
    } else if (e.kind === "stud") {
      const ev = parseEventLogs({ abi: horseMarketAbi, eventName: "StudFeePaid", logs: ours }).find((l) => same(l.args.orderId, e.orderId));
      if (!ev) return { status: "rejected", reason: "event_not_found" };
      const a = ev.args;
      if (!same(a.stallionRef, e.horseRef) || (e.mareRef && !same(a.mareRef, e.mareRef))) return { status: "rejected", reason: "horse_mismatch" };
      if (!isAddressEqual(a.payer, e.payer)) return { status: "rejected", reason: "payer_mismatch" };
      if (e.seller && !isAddressEqual(a.stallionOwner, e.seller)) return { status: "rejected", reason: "seller_mismatch" };
      if (a.price !== e.price || a.fee !== e.fee) return { status: "rejected", reason: "amount_mismatch" };
    } else {
      const ev = parseEventLogs({ abi: horseMarketAbi, eventName: "Registered", logs: ours }).find((l) => same(l.args.orderId, e.orderId));
      if (!ev) return { status: "rejected", reason: "event_not_found" };
      const a = ev.args;
      if (!same(a.horseRef, e.horseRef)) return { status: "rejected", reason: "horse_mismatch" };
      if (!isAddressEqual(a.owner, e.payer)) return { status: "rejected", reason: "owner_mismatch" };
      if (a.fee !== e.fee) return { status: "rejected", reason: "amount_mismatch" };
    }
    const head = await this.pc.getBlockNumber({ cacheTime: 0 });
    const confirmations = Number(head - receipt.blockNumber + 1n);
    if (confirmations < this.minConfirmations) return { status: "pending", reason: "confirmations" };
    return { status: "confirmed", blockNumber: receipt.blockNumber, confirmations };
  }

  async findPaymentTx(kind: UsdgOrderKind, orderId: Hex): Promise<Hex | null> {
    const head = await this.pc.getBlockNumber({ cacheTime: 0 });
    const fromBlock = head > this.lookback ? head - this.lookback : 0n;
    const eventName = kind === "sale" ? "Sold" : kind === "stud" ? "StudFeePaid" : "Registered";
    const logs = await this.pc.getContractEvents({ address: this.market, abi: horseMarketAbi, eventName, args: { orderId }, fromBlock, toBlock: "latest" });
    return logs[0]?.transactionHash ?? null;
  }

  async verifyBid(bid: Bid, signature: Hex): Promise<boolean> {
    try {
      // EOAs, ERC-1271 smart wallets and ERC-6492 counterfactual wallets.
      return await this.pc.verifyTypedData({ address: bid.bidder, signature, ...bidTypedData(bid, this.chainId, this.market) } as unknown as Parameters<PublicClient["verifyTypedData"]>[0]);
    } catch {
      return recoverTypedDataAddress({ ...bidTypedData(bid, this.chainId, this.market), signature })
        .then((a) => isAddressEqual(a, bid.bidder))
        .catch(() => false);
    }
  }

  async marketState(): Promise<MarketState> {
    const read = (functionName: string, args: readonly unknown[] = []) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.pc.readContract({ address: this.market, abi: horseMarketAbi as any, functionName, args } as any) as Promise<any>;
    const [feeBps, treasury, paused, accepted, signer] = await Promise.all([read("feeBps"), read("treasury"), read("paused"), read("acceptedToken", [this.token]), read("hasRole", [SIGNER_ROLE, this.signer.address])]);
    return { feeBps: Number(feeBps), treasury, paused, tokenAccepted: accepted, signerHasRole: signer };
  }
}

// ---------------------------------------------------------------------------
// Mock (default): in-memory HorseMarket
// ---------------------------------------------------------------------------

interface MockPayment {
  kind: UsdgOrderKind;
  orderId: Hex;
  horseRef: Hex;
  mareRef?: Hex;
  payer: Address;
  seller: Address | null;
  price: bigint;
  fee: bigint;
  block: bigint;
}

export class MockUsdgChain implements UsdgChain {
  readonly kind = "mock" as const;
  feeBps = 500;
  private block = 1n;
  private nonce = 0;
  private readonly txs = new Map<string, MockPayment>();
  private readonly used = new Set<string>();

  constructor(
    readonly chainId: number,
    readonly market: Address,
    readonly token: Address,
    private readonly minConfirmations = 1,
  ) {}

  /** Mock "signatures": a hash of the order (never a real key). */
  async signSale(o: SaleOrder): Promise<Hex> {
    return keccak256(new TextEncoder().encode(`sale:${JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`));
  }

  async signRegistration(o: RegistrationOrder): Promise<Hex> {
    return keccak256(new TextEncoder().encode(`reg:${JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`));
  }

  async signStud(o: StudOrder): Promise<Hex> {
    return keccak256(new TextEncoder().encode(`stud:${JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`));
  }

  private record(p: Omit<MockPayment, "block">, nowSec?: bigint, deadline?: bigint): Hex {
    if (this.used.has(p.orderId.toLowerCase())) throw new Error("OrderAlreadyUsed");
    if (nowSec !== undefined && deadline !== undefined && nowSec > deadline) throw new Error("OrderExpired");
    const hash = keccak256(concat([p.orderId, numberToHex(++this.nonce, { size: 32 })]));
    this.used.add(p.orderId.toLowerCase());
    this.txs.set(hash, { ...p, block: this.block });
    this.block += 1n;
    return hash;
  }

  /** What a successful HorseMarket.buy would do (dev/test helper). Returns the tx hash. */
  simulateSale(o: SaleOrder, opts: { from?: Address; nowSec?: bigint } = {}): Hex {
    if ((opts.from ?? o.buyer).toLowerCase() !== o.buyer.toLowerCase()) throw new Error("NotOrderBuyer");
    const floor = (o.price * BigInt(this.feeBps)) / 10_000n;
    const ceil = (o.price * BigInt(this.feeBps) + 9_999n) / 10_000n;
    if (o.fee !== floor && o.fee !== ceil) throw new Error("FeeMismatch");
    return this.record({ kind: "sale", orderId: o.orderId, horseRef: o.horseRef, payer: o.buyer, seller: o.seller, price: o.price, fee: o.fee }, opts.nowSec, o.deadline);
  }

  /** What a successful HorseMarket.payStudFee would do (dev/test helper). Returns the tx hash. */
  simulateStud(o: StudOrder, opts: { from?: Address; nowSec?: bigint } = {}): Hex {
    if ((opts.from ?? o.payer).toLowerCase() !== o.payer.toLowerCase()) throw new Error("NotOrderBuyer");
    if (o.payer.toLowerCase() === o.stallionOwner.toLowerCase()) throw new Error("SelfTrade");
    const floor = (o.price * BigInt(this.feeBps)) / 10_000n;
    const ceil = (o.price * BigInt(this.feeBps) + 9_999n) / 10_000n;
    if (o.fee !== floor && o.fee !== ceil) throw new Error("FeeMismatch");
    return this.record({ kind: "stud", orderId: o.orderId, horseRef: o.stallionRef, mareRef: o.mareRef, payer: o.payer, seller: o.stallionOwner, price: o.price, fee: o.fee }, opts.nowSec, o.deadline);
  }

  simulateRegistration(o: RegistrationOrder, opts: { from?: Address; nowSec?: bigint } = {}): Hex {
    if ((opts.from ?? o.owner).toLowerCase() !== o.owner.toLowerCase()) throw new Error("NotOrderBuyer");
    return this.record({ kind: "registration", orderId: o.orderId, horseRef: o.horseRef, payer: o.owner, seller: null, price: o.fee, fee: o.fee }, opts.nowSec, o.deadline);
  }

  async verifyPayment(txHash: Hex, e: ExpectedUsdgPayment): Promise<UsdgVerification> {
    const tx = this.txs.get(txHash.toLowerCase()) ?? this.txs.get(txHash);
    if (!tx) return { status: "pending", reason: "unknown_tx" };
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    if (tx.kind !== e.kind || !same(tx.orderId, e.orderId)) return { status: "rejected", reason: "event_not_found" };
    if (!same(tx.horseRef, e.horseRef) || (e.mareRef && tx.mareRef && !same(tx.mareRef, e.mareRef))) return { status: "rejected", reason: "horse_mismatch" };
    if (!same(tx.payer, e.payer)) return { status: "rejected", reason: e.kind === "sale" ? "buyer_mismatch" : e.kind === "stud" ? "payer_mismatch" : "owner_mismatch" };
    if (e.seller && tx.seller && !same(tx.seller, e.seller)) return { status: "rejected", reason: "seller_mismatch" };
    if (tx.fee !== e.fee || (e.kind !== "registration" && tx.price !== e.price)) return { status: "rejected", reason: "amount_mismatch" };
    const confirmations = Number(this.block - tx.block);
    if (confirmations < this.minConfirmations) return { status: "pending", reason: "confirmations" };
    return { status: "confirmed", blockNumber: tx.block, confirmations };
  }

  async findPaymentTx(kind: UsdgOrderKind, orderId: Hex): Promise<Hex | null> {
    for (const [hash, tx] of this.txs) if (tx.kind === kind && tx.orderId.toLowerCase() === orderId.toLowerCase()) return hash as Hex;
    return null;
  }

  async verifyBid(bid: Bid, signature: Hex): Promise<boolean> {
    return recoverTypedDataAddress({ ...bidTypedData(bid, this.chainId, this.market), signature })
      .then((a) => isAddressEqual(a, bid.bidder))
      .catch(() => false);
  }

  async marketState(): Promise<MarketState> {
    return { feeBps: this.feeBps, treasury: "0x0000000000000000000000000000000000007ea5", paused: false, tokenAccepted: true, signerHasRole: true };
  }
}

// ---------------------------------------------------------------------------
// Practice (USDG_MODE=practice): there is no chain. Payments are T-USDG ledger transfers
// (@thoroughbred/db usdgPractice) and rehearsal bids are verified locally (usdg.ts), so every
// method here refuses: reaching one would be a bug, and it must never become a network call.
// ---------------------------------------------------------------------------

export class UsdgPracticeChainError extends Error {
  constructor(what: string) {
    super(`practice mode has no chain (${what})`);
    this.name = "UsdgPracticeChainError";
  }
}

export class PracticeUsdgChain implements UsdgChain {
  readonly kind = "practice" as const;
  constructor(
    readonly chainId: number,
    readonly market: Address,
    readonly token: Address,
  ) {}
  async signSale(): Promise<Hex> {
    throw new UsdgPracticeChainError("signSale");
  }
  async signRegistration(): Promise<Hex> {
    throw new UsdgPracticeChainError("signRegistration");
  }
  async signStud(): Promise<Hex> {
    throw new UsdgPracticeChainError("signStud");
  }
  async verifyPayment(): Promise<UsdgVerification> {
    throw new UsdgPracticeChainError("verifyPayment");
  }
  async findPaymentTx(): Promise<Hex | null> {
    throw new UsdgPracticeChainError("findPaymentTx");
  }
  async verifyBid(): Promise<boolean> {
    throw new UsdgPracticeChainError("verifyBid");
  }
  async marketState(): Promise<MarketState> {
    throw new UsdgPracticeChainError("marketState");
  }
}

// ---------------------------------------------------------------------------

const G = globalThis as typeof globalThis & { __tbUsdgChain?: UsdgChain; __tbUsdgChainKey?: string };

/** The process-wide USDG chain: EVM when the market is live, none in practice mode, else the mock (also when "off": nothing gets signed then). */
export function usdgChain(env: Record<string, string | undefined> = process.env): UsdgChain {
  const cfg = readUsdgConfig(env);
  const key = `${cfg.mode}:${cfg.chainId}:${cfg.market}:${cfg.token}:${cfg.rpcUrl}`;
  if (G.__tbUsdgChain && G.__tbUsdgChainKey === key) return G.__tbUsdgChain;
  if (cfg.mode === "live") G.__tbUsdgChain = new EvmUsdgChain(cfg);
  else if (cfg.mode === "practice") G.__tbUsdgChain = new PracticeUsdgChain(cfg.chainId, cfg.market, cfg.token);
  else {
    const mock = new MockUsdgChain(cfg.chainId, cfg.market, cfg.token, 1);
    mock.feeBps = usdgPolicy(env).feeBps; // the mock "contract" charges what the server signs
    G.__tbUsdgChain = mock;
  }
  G.__tbUsdgChainKey = key;
  return G.__tbUsdgChain;
}

/** For tests: install a chain you drive. */
export function setUsdgChainForTests(chain: UsdgChain | undefined): void {
  const cfg = readUsdgConfig();
  G.__tbUsdgChain = chain;
  G.__tbUsdgChainKey = chain ? `${cfg.mode}:${cfg.chainId}:${cfg.market}:${cfg.token}:${cfg.rpcUrl}` : undefined;
}

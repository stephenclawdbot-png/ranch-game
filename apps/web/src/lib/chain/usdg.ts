/**
 * USDG horse market (docs/usdg-market.md), client + server safe: EIP-712 typed data for
 * HorseMarket orders and off-chain bids (types generated from the contracts package), the JSON
 * shapes the API sends, and display helpers. No secrets here.
 */
import type { Address, Hex } from "viem";
import { formatUsdgDollars, formatUsdgToken } from "@thoroughbred/game-core";
import { MARKET_EIP712_NAME, MARKET_EIP712_VERSION, bidTypes, registrationOrderTypes, saleOrderTypes, studOrderTypes } from "./contracts.generated";
import { ROBINHOOD_TESTNET } from "./chains";

export interface SaleOrder {
  orderId: Hex;
  horseRef: Hex;
  seller: Address;
  buyer: Address;
  token: Address;
  price: bigint;
  fee: bigint;
  deadline: bigint;
}

export interface RegistrationOrder {
  orderId: Hex;
  horseRef: Hex;
  owner: Address;
  token: Address;
  fee: bigint;
  deadline: bigint;
}

/** A registered stallion's USDG stud fee for one covering (HorseMarket.payStudFee). */
export interface StudOrder {
  orderId: Hex;
  stallionRef: Hex;
  mareRef: Hex;
  stallionOwner: Address;
  payer: Address;
  token: Address;
  price: bigint;
  fee: bigint;
  deadline: bigint;
}

export interface Bid {
  listingId: string;
  amount: bigint;
  bidder: Address;
  nonce: bigint;
}

const domain = (chainId: number, market: Address) => ({ name: MARKET_EIP712_NAME, version: MARKET_EIP712_VERSION, chainId, verifyingContract: market });

export function saleOrderTypedData(o: SaleOrder, chainId: number, market: Address) {
  return { domain: domain(chainId, market), types: saleOrderTypes, primaryType: "SaleOrder" as const, message: o };
}

export function registrationOrderTypedData(o: RegistrationOrder, chainId: number, market: Address) {
  return { domain: domain(chainId, market), types: registrationOrderTypes, primaryType: "RegistrationOrder" as const, message: o };
}

export function studOrderTypedData(o: StudOrder, chainId: number, market: Address) {
  return { domain: domain(chainId, market), types: studOrderTypes, primaryType: "StudOrder" as const, message: o };
}

export function bidTypedData(b: Bid, chainId: number, market: Address) {
  return { domain: domain(chainId, market), types: bidTypes, primaryType: "Bid" as const, message: b };
}

/** What the browser receives for a payable order: the signed struct (bigints as strings) and its context. */
export interface UsdgOrderJson {
  orderId: Hex;
  kind: "registration" | "sale" | "stud";
  status: "pending" | "paid" | "fulfilled" | "expired";
  /** The horse (registration, sale) or the stallion (stud). */
  horseId: string;
  horseName: string | null;
  /** Stud orders: the mare being covered, and the stallion owner's stable (who receives the fee). */
  mareId?: string | null;
  mareName?: string | null;
  payeeName?: string | null;
  chainId: number;
  market: Address;
  token: Address;
  /** micro-USDG */
  price: number;
  fee: number;
  sellerReceives: number;
  deadlineMs: number;
  txHash: string | null;
  /** Present while the order can be paid (signed on request). */
  signed: { order: Record<string, string>; signature: Hex } | null;
  /** True on the mock chain (WEB3_ENABLED off): "pay" is simulated by the server. */
  mock: boolean;
  /** Practice mode (USDG_MODE=practice): paid from the player's T-USDG test balance, never on-chain. */
  practice: boolean;
  /** An auction win (pay within the window) rather than a fixed-price buy. */
  auction: boolean;
}

export function saleOrderFromJson(o: Record<string, string>): SaleOrder {
  return {
    orderId: o.orderId as Hex,
    horseRef: o.horseRef as Hex,
    seller: o.seller as Address,
    buyer: o.buyer as Address,
    token: o.token as Address,
    price: BigInt(o.price!),
    fee: BigInt(o.fee!),
    deadline: BigInt(o.deadline!),
  };
}

export function registrationOrderFromJson(o: Record<string, string>): RegistrationOrder {
  return { orderId: o.orderId as Hex, horseRef: o.horseRef as Hex, owner: o.owner as Address, token: o.token as Address, fee: BigInt(o.fee!), deadline: BigInt(o.deadline!) };
}

export function studOrderFromJson(o: Record<string, string>): StudOrder {
  return {
    orderId: o.orderId as Hex,
    stallionRef: o.stallionRef as Hex,
    mareRef: o.mareRef as Hex,
    stallionOwner: o.stallionOwner as Address,
    payer: o.payer as Address,
    token: o.token as Address,
    price: BigInt(o.price!),
    fee: BigInt(o.fee!),
    deadline: BigInt(o.deadline!),
  };
}

/** The wallet that must send the payment for a signed order. */
export function orderPayer(kind: UsdgOrderJson["kind"], o: Record<string, string>): string | null {
  return (kind === "sale" ? o.buyer : kind === "stud" ? o.payer : o.owner) ?? null;
}

export function orderToJson(o: SaleOrder | RegistrationOrder | StudOrder): Record<string, string> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : String(v)]));
}

/** "$12.50 · 12.5 USDG" */
export function usdgLabel(micro: number): string {
  return `${formatUsdgDollars(micro)} · ${formatUsdgToken(micro)}`;
}

export { formatUsdgDollars, formatUsdgToken };

/** Faucets for testnet play (facts dated 2026-10-25, see the robinhood-chain skill). */
export const TESTNET_FAUCETS = {
  usdg: "https://faucet.paxos.com",
  eth: "https://www.alchemy.com/faucets/robinhood-testnet",
} as const;

export const isTestnet = (chainId: number) => chainId === ROBINHOOD_TESTNET || chainId === 31337;

/** EIP-712 EthQuote for PremiumStore.purchaseWithEth (client + server). Types are generated from the contracts package. */
import type { Address, Hex } from "viem";
import { ethQuoteTypes, STORE_EIP712_NAME, STORE_EIP712_VERSION } from "./contracts.generated";

export interface EthQuote {
  orderId: Hex;
  buyer: Address;
  sku: Hex;
  quantity: number;
  priceWei: bigint;
  usdCents: bigint;
  ref1: Address;
  ref1Bps: number;
  ref2: Address;
  ref2Bps: number;
  deadline: bigint;
}

/** JSON form sent to the browser (bigints as decimal strings). */
export interface EthQuoteJson {
  orderId: Hex;
  buyer: Address;
  sku: Hex;
  quantity: number;
  priceWei: string;
  usdCents: string;
  ref1: Address;
  ref1Bps: number;
  ref2: Address;
  ref2Bps: number;
  deadline: string;
}

export function ethQuoteTypedData(quote: EthQuote, chainId: number, store: Address) {
  return {
    domain: { name: STORE_EIP712_NAME, version: STORE_EIP712_VERSION, chainId, verifyingContract: store },
    types: ethQuoteTypes,
    primaryType: "EthQuote" as const,
    message: quote,
  };
}

export const quoteToJson = (q: EthQuote): EthQuoteJson => ({ ...q, priceWei: q.priceWei.toString(), usdCents: q.usdCents.toString(), deadline: q.deadline.toString() });
export const quoteFromJson = (q: EthQuoteJson): EthQuote => ({ ...q, priceWei: BigInt(q.priceWei), usdCents: BigInt(q.usdCents), deadline: BigInt(q.deadline) });

import type { Address, Hex, TypedDataDefinition } from "viem";
import { STORE_EIP712_NAME, STORE_EIP712_VERSION } from "./voucher";

// EIP-712 EthQuote for PremiumStore.purchaseWithEth. MUST match PremiumStore.sol
// (ETH_QUOTE_TYPEHASH, same domain as Order). test/premium-store-eth.test.ts checks
// hashEthQuote() against viem's digest. apps/web/src/lib/chain/contracts.generated.ts carries a
// copy of these types (scripts/export-web.ts; freshness is tested in test/export-web.test.ts).

export const ethQuoteTypes = {
  EthQuote: [
    { name: "orderId", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "sku", type: "bytes32" },
    { name: "quantity", type: "uint32" },
    { name: "priceWei", type: "uint256" },
    { name: "usdCents", type: "uint64" },
    { name: "ref1", type: "address" },
    { name: "ref1Bps", type: "uint16" },
    { name: "ref2", type: "address" },
    { name: "ref2Bps", type: "uint16" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export interface EthQuote {
  orderId: Hex;
  buyer: Address;
  sku: Hex;
  quantity: number;
  /** Exact total in wei; msg.value must equal it. */
  priceWei: bigint;
  /** USD price (cents) the quote was computed from; checked on-chain only if a feed is set. */
  usdCents: bigint;
  /** Level-1 / level-2 affiliate wallets (zero address = none) and their commission bps. */
  ref1: Address;
  ref1Bps: number;
  ref2: Address;
  ref2Bps: number;
  /** unix seconds; at most MAX_QUOTE_TTL (10 min) ahead on-chain; the server uses 5 min. */
  deadline: bigint;
}

export function ethQuoteTypedData(quote: EthQuote, chainId: number, storeAddress: Address): TypedDataDefinition<typeof ethQuoteTypes, "EthQuote"> {
  return {
    domain: { name: STORE_EIP712_NAME, version: STORE_EIP712_VERSION, chainId, verifyingContract: storeAddress },
    types: ethQuoteTypes,
    primaryType: "EthQuote",
    message: { ...quote },
  };
}

export const NO_REFERRER: Address = "0x0000000000000000000000000000000000000000";

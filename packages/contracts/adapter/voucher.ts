import { keccak256, toBytes, toHex, type Address, type Hex, type TypedDataDefinition } from "viem";
import type { PurchaseOrder, SkuName } from "./types";

// EIP-712 domain + types. MUST match PremiumStore.sol (EIP712("ThoroughbredPremiumStore", "1")
// and ORDER_TYPEHASH). test/premium-store.test.ts signs with this and checks hashOrder().

export const STORE_EIP712_NAME = "ThoroughbredPremiumStore";
export const STORE_EIP712_VERSION = "1";

export const orderTypes = {
  Order: [
    { name: "orderId", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "sku", type: "bytes32" },
    { name: "quantity", type: "uint32" },
    { name: "token", type: "address" },
    { name: "maxTotal", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export function orderTypedData(
  order: PurchaseOrder,
  chainId: number,
  storeAddress: Address,
): TypedDataDefinition<typeof orderTypes, "Order"> {
  return {
    domain: { name: STORE_EIP712_NAME, version: STORE_EIP712_VERSION, chainId, verifyingContract: storeAddress },
    types: orderTypes,
    primaryType: "Order",
    message: { ...order },
  };
}

/** On-chain SKU id: keccak256(utf8(name)). */
export function skuId(name: SkuName): Hex {
  return keccak256(toBytes(name));
}

/** 32 random bytes from the platform CSPRNG. Store it on the pending order row first. */
export function newOrderId(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Converts a decimal string price like "4.99" into base units (6 decimals for USDG/USDC). */
export function parseTokenAmount(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error(`bad amount "${amount}"`);
  const [whole, frac = ""] = amount.split(".");
  if (frac.length > decimals) throw new Error(`"${amount}" has more than ${decimals} decimals`);
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

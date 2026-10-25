import { isAddressEqual, type Hex } from "viem";
import type { PurchaseExpectation, PurchaseVerification, VerifiedPurchase } from "./types";

/** Shared by the mock and EVM adapters so both enforce exactly the same matching rules. */
export function checkPurchase(
  found: Omit<VerifiedPurchase, "confirmations" | "idempotencyKey">,
  expected: PurchaseExpectation,
): Extract<PurchaseVerification, { status: "rejected" }> | null {
  if (!sameHex(found.sku, expected.sku)) return { status: "rejected", reason: "sku_mismatch" };
  if (expected.buyer && !isAddressEqual(found.buyer, expected.buyer)) return { status: "rejected", reason: "buyer_mismatch" };
  if (expected.quantity !== undefined && found.quantity !== expected.quantity) {
    return { status: "rejected", reason: "quantity_mismatch", detail: `paid for ${found.quantity}, expected ${expected.quantity}` };
  }
  if (expected.token && !isAddressEqual(found.token, expected.token)) return { status: "rejected", reason: "token_mismatch" };
  if (expected.minTotal !== undefined && found.total < expected.minTotal) {
    return { status: "rejected", reason: "amount_too_low", detail: `paid ${found.total}, expected at least ${expected.minTotal}` };
  }
  return null;
}

export function idempotencyKey(chainId: number, store: string, orderId: Hex): string {
  return `${chainId}:${store.toLowerCase()}:${orderId.toLowerCase()}`;
}

export function sameHex(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Builds the checkout/pool context for route handlers (db + chain + price + config). */
import { db } from "../db";
import { betaChain } from "./adapter";
import type { CheckoutCtx } from "./checkout";
import { readBetaConfig } from "./config";
import { priceService } from "./price";

export async function chainCtx(): Promise<CheckoutCtx> {
  const cfg = readBetaConfig();
  return { db: await db(), chain: betaChain(), price: priceService(), cfg };
}

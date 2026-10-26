/** Route plumbing for the beta-money APIs: maps checkout/price/config errors to friendly JSON. */
import type { NextResponse } from "next/server";
import { adminSecret, isAdmin } from "../playtest";
import { errorJson, handleError, json } from "../http";
import { requireSession, type Session } from "../session";
import { CheckoutUnavailableError, type CheckoutCtx } from "./checkout";
import { BetaConfigError } from "./config";
import { chainCtx } from "./context";
import { PriceUnavailableError } from "./price";

export function chainError(err: unknown): NextResponse {
  if (err instanceof CheckoutUnavailableError) {
    const res = errorJson(err.code === "geo_blocked" ? 451 : 503, err.code, { message: err.message });
    if (err.code === "pricing_unavailable") res.headers.set("Retry-After", "30");
    return res;
  }
  if (err instanceof PriceUnavailableError) return errorJson(503, "pricing_unavailable", { message: "Pricing is temporarily unavailable. Please retry in a minute." });
  if (err instanceof BetaConfigError) return errorJson(503, "chain_not_configured", { message: err.message });
  return handleError(err);
}

export async function withChainPlayer<T>(fn: (ctx: CheckoutCtx, session: Session, now: Date) => Promise<T>, status = 200) {
  try {
    const ctx = await chainCtx();
    const session = await requireSession(ctx.db);
    return json(await fn(ctx, session, new Date()), { status });
  } catch (err) {
    return chainError(err);
  }
}

export async function withChainAdmin<T>(fn: (ctx: CheckoutCtx, now: Date) => Promise<T>, status = 200) {
  try {
    if (!adminSecret()) return errorJson(404, "NOT_FOUND", { message: "Admin is disabled on this server (ADMIN_SECRET is not set)." });
    if (!(await isAdmin())) return errorJson(401, "admin_required", { message: "Sign in as admin first." });
    return json(await fn(await chainCtx(), new Date()), { status });
  } catch (err) {
    return chainError(err);
  }
}

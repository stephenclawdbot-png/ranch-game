/** Route plumbing for the USDG market APIs: context (db + chain + config + policy) and friendly errors. */
import type { NextResponse } from "next/server";
import { usdgPolicy } from "@thoroughbred/db";
import { db } from "../db";
import { errorJson, handleError, json } from "../http";
import { adminSecret, isAdmin } from "../playtest";
import { requireSession, type Session } from "../session";
import { BetaConfigError } from "./config";
import { UsdgUnavailableError, usdgTick, type UsdgCtx } from "./usdg";
import { usdgChain } from "./usdgChain";
import { readUsdgConfig } from "./usdgConfig";

export async function usdgCtx(): Promise<UsdgCtx> {
  return { db: await db(), chain: usdgChain(), cfg: readUsdgConfig(), policy: usdgPolicy() };
}

export function usdgError(err: unknown): NextResponse {
  if (err instanceof UsdgUnavailableError) return errorJson(503, "coming_soon", { message: err.message });
  if (err instanceof BetaConfigError) return errorJson(503, "chain_not_configured", { message: err.message });
  return handleError(err);
}

/** Runs `fn` for the signed-in player. `tick` first runs the lazy backstop (close auctions, expire orders). */
export async function withUsdgPlayer<T>(fn: (ctx: UsdgCtx, session: Session, now: Date) => Promise<T>, opts: { status?: number; tick?: boolean } = {}) {
  try {
    const ctx = await usdgCtx();
    const session = await requireSession(ctx.db);
    const now = new Date();
    if (opts.tick) await usdgTick(ctx, now);
    return json(await fn(ctx, session, now), { status: opts.status ?? 200 });
  } catch (err) {
    return usdgError(err);
  }
}

export async function withUsdgAdmin<T>(fn: (ctx: UsdgCtx, now: Date) => Promise<T>) {
  try {
    if (!adminSecret()) return errorJson(404, "NOT_FOUND", { message: "Admin is disabled on this server (ADMIN_SECRET is not set)." });
    if (!(await isAdmin())) return errorJson(401, "admin_required", { message: "Sign in as admin first." });
    return json(await fn(await usdgCtx(), new Date()));
  } catch (err) {
    return usdgError(err);
  }
}

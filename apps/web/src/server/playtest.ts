/**
 * Closed playtest glue for route handlers: config, telemetry (never throws), admin auth.
 * Data lives in packages/db services/playtest.ts.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import { playtestConfig, track, type TelemetryEvent } from "@thoroughbred/db";
import type { Db } from "./db";

export { playtestConfig };

/** Records a telemetry event; failures are logged and never break the request. */
export async function trackEvent(db: Db, accountId: string | null, name: TelemetryEvent, props?: Record<string, unknown>): Promise<void> {
  try {
    await track(db, { accountId, name, props });
  } catch (err) {
    console.error("telemetry", name, err);
  }
}

// ---------------------------------------------------------------------------
// Admin auth: ADMIN_SECRET via the x-admin-secret header, or a login form that sets an
// httpOnly cookie holding a hash of the secret (never the secret itself).
// ---------------------------------------------------------------------------

export const ADMIN_COOKIE = "tb_admin";

export function adminSecret(): string | null {
  const s = process.env.ADMIN_SECRET?.trim();
  return s && s.length >= 12 ? s : null;
}

function adminToken(secret: string): string {
  return createHash("sha256").update(`thoroughbred-admin:${secret}`).digest("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkAdminSecret(candidate: string): boolean {
  const secret = adminSecret();
  return !!secret && same(createHash("sha256").update(candidate).digest("hex"), createHash("sha256").update(secret).digest("hex"));
}

/** True when this request is the admin (header or cookie). False when ADMIN_SECRET is unset. */
export async function isAdmin(): Promise<boolean> {
  const secret = adminSecret();
  if (!secret) return false;
  const h = await headers();
  const header = h.get("x-admin-secret");
  if (header && checkAdminSecret(header)) return true;
  const c = (await cookies()).get(ADMIN_COOKIE)?.value;
  return !!c && same(c, adminToken(secret));
}

export function setAdminCookie(res: NextResponse): void {
  const secret = adminSecret();
  if (!secret) return;
  res.cookies.set(ADMIN_COOKIE, adminToken(secret), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 12 * 60 * 60 });
}

export function clearAdminCookie(res: NextResponse): void {
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
}

/** The Robinhood Chain block explorer (tx links on /beta and /admin). */
export function explorerUrl(): string {
  return (process.env.ROBINHOOD_EXPLORER_URL?.trim() || "https://robinhoodchain.blockscout.com").replace(/\/$/, "");
}

/** Optional budget cap for the fallback payout ledger (USD), from BETA_BUDGET_USD. */
export function betaBudgetCents(): number | null {
  const n = Number(process.env.BETA_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

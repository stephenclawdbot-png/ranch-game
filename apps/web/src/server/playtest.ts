/**
 * Closed playtest glue for route handlers: config, telemetry (never throws), admin auth.
 * Data lives in packages/db services/playtest.ts.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import { isDbUnavailable, playtestConfig, track, trackMany, type TelemetryEvent, type TrackRow } from "@thoroughbred/db";
import type { Db } from "./db";

export { playtestConfig };

/** Records a telemetry event; failures are logged and never break the request. */
export async function trackEvent(db: Db, accountId: string | null, name: TelemetryEvent, props?: Record<string, unknown>, maxProps?: number): Promise<void> {
  try {
    await track(db, { accountId, name, props, maxProps });
  } catch (err) {
    console.error("telemetry", name, err);
  }
}

/**
 * Events from visitors without a stable, waiting in this server instance's memory. A visitor
 * (or a crawler) must never wake the database, so their `session_start` is not written when it
 * arrives: it rides along with the next batch that goes to the database anyway (a signed-in
 * player's events). If the instance is recycled first they are lost, which is fine for a
 * visitor count. Capped, oldest dropped.
 */
const VISITOR_BUFFER_MAX = 200;
const G = globalThis as typeof globalThis & { __tbVisitorEvents?: TrackRow[] };
const visitorBuffer = (G.__tbVisitorEvents ??= []);

/** Client events that are only ever written for a signed-in player (a visitor's are dropped). */
const SIGNED_IN_ONLY: ReadonlySet<TelemetryEvent> = new Set<TelemetryEvent>(["page_view", "pool_claim"]);
/** Visitor events that wait for the next write instead of causing one. */
const VISITOR_DEFERRED: ReadonlySet<TelemetryEvent> = new Set<TelemetryEvent>(["session_start"]);

/**
 * Records one request's batch of client events (POST /api/events) with a single insert.
 * Signed in: the whole batch, plus any visitor events waiting in memory. A visitor: page views
 * are dropped, `session_start` waits in memory, and only a race watched or a perf report (the
 * database is already serving that race) is written now. Never throws.
 */
export async function trackClientBatch(db: Db, accountId: string | null, events: TrackRow[], now = new Date()): Promise<{ written: number; deferred: number; dropped: number }> {
  let deferred = 0;
  let dropped = 0;
  let rows: TrackRow[] = events;
  if (!accountId) {
    rows = [];
    for (const e of events) {
      if (SIGNED_IN_ONLY.has(e.name)) dropped++;
      else if (VISITOR_DEFERRED.has(e.name)) {
        visitorBuffer.push({ ...e, at: e.at ?? now, accountId: null });
        if (visitorBuffer.length > VISITOR_BUFFER_MAX) visitorBuffer.splice(0, visitorBuffer.length - VISITOR_BUFFER_MAX);
        deferred++;
      } else rows.push(e);
    }
    if (rows.length === 0) return { written: 0, deferred, dropped };
  }
  const waiting = visitorBuffer.splice(0, visitorBuffer.length);
  try {
    const written = await trackMany(db, { accountId, events: [...rows, ...waiting], now });
    return { written, deferred, dropped };
  } catch (err) {
    // Keep the visitors' events for the next batch; a telemetry failure never breaks the request.
    visitorBuffer.unshift(...waiting.slice(0, VISITOR_BUFFER_MAX - visitorBuffer.length));
    if (!isDbUnavailable(err)) console.error("telemetry batch", err);
    return { written: 0, deferred, dropped };
  }
}

/** Tests: visitor events waiting in memory. */
export function visitorEventsWaiting(): number {
  return visitorBuffer.length;
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

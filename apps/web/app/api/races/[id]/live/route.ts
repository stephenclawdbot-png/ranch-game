import { NextResponse } from "next/server";
import type { RaceBroadcastChunk } from "@thoroughbred/shared";
import { LIVE_WINDOW_FRAMES, MAX_LIVE_WINDOW, liveWindowStart } from "@/lib/liveWindow";
import { db } from "@/server/db";
import { liveChunk } from "@/server/game";
import { errorJson, handleError, json } from "@/server/http";
import { liveWindowHeaders, liveWindowState } from "@/server/liveCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FROM_RE = /^\d{1,7}$/;
const WINDOW_RE = /^\d{1,4}$/;

/**
 * GET /api/races/:id/live?w=<window>   ->  RaceBroadcastChunk (shared, CDN-cacheable)
 * GET /api/races/:id/live?from=<frame> ->  RaceBroadcastChunk (per viewer, no-store; old clients)
 *
 * The race as broadcast so far: header, frames up to the live edge, the events revealed so
 * far and, only once the whole field has finished on the broadcast clock, `final` (the
 * complete replay with result and seed). Before the off (field locked), liveEdgeFrame is -1
 * so the client can show the gate countdown; 425 while entries are open.
 *
 * `?w=n` returns frames [n*50, (n+1)*50) capped at the live edge, so every viewer of a race
 * asks for the same URL and the CDN answers almost all of them (server/liveCache.ts). It
 * reads no cookies or request headers: the response is the same for everyone.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const params = new URL(req.url).searchParams;
  const windowParam = params.get("w");
  if (windowParam !== null) return windowResponse(decodeURIComponent(id), windowParam);
  const fromParam = params.get("from") ?? "0";
  if (!FROM_RE.test(fromParam)) return errorJson(400, "bad_from");
  try {
    const chunk = await liveChunk(await db(), decodeURIComponent(id), Number(fromParam), new Date());
    // Live chunks change every poll and must never be cached; the final one never changes.
    return json(chunk, { cache: chunk.final ? "public, max-age=31536000, immutable" : "no-store" });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Window chunks being generated right now, by race and window. Vercel only collapses
 * concurrent cache misses for ISR routes, so when a window's CDN copy expires (or a new
 * window is first asked for) every viewer arriving meanwhile reaches the function; with
 * Fluid compute many of them land on the same instance and share this one generation (one
 * database read, identical bodies). Entries leave as soon as they settle: nothing is reused
 * after the fact, so this never adds staleness beyond the generation time itself.
 */
const inflight = new Map<string, Promise<RaceBroadcastChunk>>();

function windowChunk(id: string, w: number): Promise<RaceBroadcastChunk> {
  const key = `${id}\n${w}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async () => liveChunk(await db(), id, liveWindowStart(w), new Date(), LIVE_WINDOW_FRAMES))().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function windowResponse(id: string, windowParam: string): Promise<NextResponse> {
  if (!WINDOW_RE.test(windowParam) || Number(windowParam) > MAX_LIVE_WINDOW) return errorJson(400, "bad_window");
  const w = Number(windowParam);
  try {
    const chunk = await windowChunk(id, w);
    const res = NextResponse.json(chunk);
    for (const [k, v] of Object.entries(liveWindowHeaders(liveWindowState(w, chunk)))) res.headers.set(k, v);
    return res;
  } catch (err) {
    // 425 / 404 / 400 stay no-store, so a race that goes live is never stuck behind a cached error.
    return handleError(err);
  }
}

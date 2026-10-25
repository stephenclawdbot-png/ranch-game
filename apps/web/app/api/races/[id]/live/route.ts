import { db } from "@/server/db";
import { liveChunk } from "@/server/game";
import { errorJson, handleError, json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FROM_RE = /^\d{1,7}$/;

/**
 * GET /api/races/:id/live?from=<frameIndex>  ->  RaceBroadcastChunk
 *
 * The race as broadcast so far: header, frames [from, liveEdge] (capped per chunk), the
 * events revealed so far and, only once the whole field has finished on the broadcast
 * clock, `final` (the complete replay with result and seed). Before the off (field locked),
 * liveEdgeFrame is -1 so the client can show the gate countdown; 425 while entries are open.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const fromParam = new URL(req.url).searchParams.get("from") ?? "0";
  if (!FROM_RE.test(fromParam)) return errorJson(400, "bad_from");
  try {
    const chunk = await liveChunk(await db(), decodeURIComponent(id), Number(fromParam), new Date());
    // Live chunks change every poll and must never be cached; the final one never changes.
    return json(chunk, { cache: chunk.final ? "public, max-age=31536000, immutable" : "no-store" });
  } catch (err) {
    return handleError(err);
  }
}

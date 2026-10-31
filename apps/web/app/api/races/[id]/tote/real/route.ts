import { realToteBoard } from "@thoroughbred/db";
import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { realToteOn, realToteTick } from "@/server/chain/toteChain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/races/:id/tote/real -> the DORMANT real-money pool of a race (docs/usdg-tote.md):
 * `{ available: false }` while REAL_TOTE_ENABLED is off (no database, no chain) or for a race
 * without one; otherwise the status, the betting close and live odds from the mirrored on-chain
 * pools. Same for every viewer. Also nudges the race's keeper (market, entropy), throttled.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!realToteOn()) return json({ available: false }, { cache: "public, s-maxage=60" });
  const { id } = await ctx.params;
  const raceId = decodeURIComponent(id);
  if (!UUID_RE.test(raceId)) return json({ available: false }, { cache: "public, s-maxage=60" });
  try {
    const database = await db();
    const now = new Date();
    await realToteTick(database, raceId, now);
    const board = await realToteBoard(database, raceId);
    return json(board ? { available: true, board } : { available: false }, { cache: "public, s-maxage=2, stale-while-revalidate=3" });
  } catch (err) {
    return handleError(err);
  }
}

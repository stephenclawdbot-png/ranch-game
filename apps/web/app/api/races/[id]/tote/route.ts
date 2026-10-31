import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { boardCache, raceToteBoard } from "@/server/tote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/races/:id/tote -> the public tote board: runners, live (after the off: final) odds and
 * pool shares per currency and pool, and once settled the tote audit. The same for everyone (no
 * cookies read), so the CDN serves most polls. `{ available: false }` for races without a tote.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const board = await raceToteBoard(await db(), decodeURIComponent(id), new Date());
    return json(board ? { available: true, board } : { available: false }, { cache: boardCache(board) });
  } catch (err) {
    return handleError(err);
  }
}

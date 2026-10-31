import { db } from "@/server/db";
import { horseLog } from "@/server/formBook";
import { handleError, json } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/horses/[id]/log?cursor=: one page of the horse's log, newest first. Its keeper or
 * owner only (401 signed out, 404 for anyone else's horse). Races still to run carry no result.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await horseLog(database, session, id, new URL(req.url).searchParams.get("cursor"), new Date()));
  } catch (err) {
    return handleError(err);
  }
}

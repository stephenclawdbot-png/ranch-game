import { db } from "@/server/db";
import { myRaceResult } from "@/server/game";
import { handleError, json } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Your result in this race (position, purse, Story reward, rating change). 425 until the
 * finish has been broadcast. Settles lazily if the cron hasn't yet; marks the inbox read.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await myRaceResult(database, session, decodeURIComponent(id), new Date()));
  } catch (err) {
    return handleError(err);
  }
}

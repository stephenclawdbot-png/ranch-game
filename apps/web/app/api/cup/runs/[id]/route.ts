import { db } from "@/server/db";
import { cupRunView } from "@/server/competition";
import { errorJson, handleError, json } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One Cup Run with its replay. The day's seed is withheld (zeros) until the Cup closes. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const database = await db();
    const session = await getSession(database);
    const run = await cupRunView(database, decodeURIComponent(id), session, new Date());
    return run ? json({ run }) : errorJson(404, "NOT_FOUND");
  } catch (err) {
    return handleError(err);
  }
}

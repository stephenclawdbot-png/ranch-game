import { db } from "@/server/db";
import { entryOptions } from "@/server/game";
import { handleError, json } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** For the entry sheet: each of your horses' eligibility, fit and injury risk (per ride intensity) for this race. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await entryOptions(database, session, decodeURIComponent(id), new Date()));
  } catch (err) {
    return handleError(err);
  }
}

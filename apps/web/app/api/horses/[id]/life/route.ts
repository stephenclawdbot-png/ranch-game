import { db } from "@/server/db";
import { errorJson, handleError, json } from "@/server/http";
import { horseLifeView } from "@/server/horseLife";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The owner's view of a horse: care, condition and injuries, training plan, career. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const database = await db();
    const session = await requireSession(database);
    const view = await horseLifeView(database, session, decodeURIComponent(id), new Date());
    if (!view) return errorJson(404, "horse_not_found", { message: "That horse isn't in your stable." });
    return json(view);
  } catch (err) {
    return handleError(err);
  }
}

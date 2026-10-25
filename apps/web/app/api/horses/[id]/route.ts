import { db } from "@/server/db";
import { horseDetail } from "@/server/game";
import { errorJson, handleError, json } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const database = await db();
    const view = await horseDetail(database, id, await getSession(database), new Date());
    if (!view) return errorJson(404, "horse_not_found", { message: "We couldn't find that horse." });
    return json(view);
  } catch (err) {
    return handleError(err);
  }
}

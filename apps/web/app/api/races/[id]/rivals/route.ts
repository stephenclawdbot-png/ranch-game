import { db } from "@/server/db";
import { isRaceId } from "@/server/game";
import { errorJson, handleError, json } from "@/server/http";
import { requireSession } from "@/server/session";
import { raceRivalLines } from "@/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your rival lines for a race ("You beat ... for the first time in 4 meetings"): 425 until its broadcast is over. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isRaceId(id)) return errorJson(404, "race_not_found");
  try {
    const database = await db();
    const session = await requireSession(database);
    return json({ lines: await raceRivalLines(database, session, id, new Date()) });
  } catch (err) {
    return handleError(err);
  }
}

import { db } from "@/server/db";
import { isRaceId } from "@/server/game";
import { errorJson, handleError, json } from "@/server/http";
import { requireSession } from "@/server/session";
import { planCandidates } from "@/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Races a horse could be aimed at: the published card, then calendar races further out. */
export async function GET(req: Request) {
  const horseId = new URL(req.url).searchParams.get("horseId");
  if (!horseId || !isRaceId(horseId)) return errorJson(400, "bad_query");
  try {
    const database = await db();
    const session = await requireSession(database);
    return json({ races: await planCandidates(database, session, horseId, new Date()) });
  } catch (err) {
    return handleError(err);
  }
}

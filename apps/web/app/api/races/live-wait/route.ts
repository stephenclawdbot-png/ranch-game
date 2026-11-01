import { db } from "@/server/db";
import { driveCard, isRaceId } from "@/server/game";
import { handleError, json } from "@/server/http";
import { liveWaitView } from "@/server/liveWait";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Live wait card: your entered race (`?raceId=`, else your next Live entry) with the other
 * stables entered so far, the soonest race you could enter, another Live race to watch now, and up
 * to three things to do meanwhile. Outcome-free: post times, names and entry counts only.
 */
export async function GET(req: Request) {
  try {
    const database = await db();
    const session = await requireSession(database);
    const now = new Date();
    await driveCard(database, now);
    const raceId = new URL(req.url).searchParams.get("raceId");
    return json(await liveWaitView(database, session, raceId && isRaceId(raceId) ? raceId : null, now));
  } catch (err) {
    return handleError(err);
  }
}

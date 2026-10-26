import { db } from "@/server/db";
import { leagueView } from "@/server/competition";
import { handleError, json } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your weekly league (zones, points from settled Live races), past weeks, season standings and the feature calendar. */
export async function GET() {
  try {
    const database = await db();
    const session = await getSession(database);
    return json({ league: await leagueView(database, session, new Date()) });
  } catch (err) {
    return handleError(err);
  }
}

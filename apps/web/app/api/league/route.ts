import { db } from "@/server/db";
import { leagueView } from "@/server/competition";
import { handleError, json } from "@/server/http";
import { getSession, hasSessionCookie } from "@/server/session";
import { visitorLeague } from "@/server/visitorViews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your weekly league (zones, points from settled Live races), past weeks, season standings and the feature calendar. */
export async function GET() {
  try {
    const session = (await hasSessionCookie()) ? await getSession(await db()) : null;
    return json({ league: session ? await leagueView(await db(), session, new Date()) : (await visitorLeague()).view });
  } catch (err) {
    return handleError(err);
  }
}

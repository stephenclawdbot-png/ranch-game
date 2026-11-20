import { db } from "@/server/db";
import { hallView } from "@/server/competition";
import { handleError, json } from "@/server/http";
import { getSession, hasSessionCookie } from "@/server/session";
import { visitorHall } from "@/server/visitorViews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hall of Fame: inductees, record times, champions, bloodlines, season winners; your achievements and rivals. */
export async function GET() {
  try {
    const session = (await hasSessionCookie()) ? await getSession(await db()) : null;
    return json({ hall: session ? await hallView(await db(), session, new Date()) : await visitorHall() });
  } catch (err) {
    return handleError(err);
  }
}

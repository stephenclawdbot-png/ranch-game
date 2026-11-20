import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { tipsters } from "@/server/picks";
import { getSession, hasSessionCookie } from "@/server/session";
import { visitorTipsters } from "@/server/visitorViews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The weekly tipster table (resets Monday 00:00 UTC), last week's top 10, best weeks and your line. */
export async function GET() {
  try {
    const session = (await hasSessionCookie()) ? await getSession(await db()) : null;
    return json(session ? await tipsters(await db(), session, new Date()) : await visitorTipsters());
  } catch (err) {
    return handleError(err);
  }
}

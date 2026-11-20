import { db } from "@/server/db";
import { raceList } from "@/server/game";
import { handleError, json } from "@/server/http";
import { getSession, hasSessionCookie } from "@/server/session";
import { visitorRaceLists } from "@/server/visitorViews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The shared Live card: upcoming races (entries open / closed) and the latest ones (live, then results). */
export async function GET() {
  try {
    const now = new Date();
    const session = (await hasSessionCookie()) ? await getSession(await db()) : null;
    if (!session) {
      // A visitor: the shared copy of the card (no database), with "live" first as on the fresh list.
      const v = await visitorRaceLists(now);
      return json({ serverNowMs: now.getTime(), upcoming: v.upcoming.slice(0, 6), recent: [...(v.live ? [v.live] : []), ...v.recent.filter((r) => r.id !== v.live?.id)].slice(0, 6) });
    }
    const races = await raceList(await db(), now, session.stable.id);
    return json({ serverNowMs: now.getTime(), ...races });
  } catch (err) {
    return handleError(err);
  }
}

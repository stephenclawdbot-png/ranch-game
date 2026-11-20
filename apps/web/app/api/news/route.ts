import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { getSession, hasSessionCookie } from "@/server/session";
import { visitorNews } from "@/server/visitorViews";
import { newsFeed } from "@/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The racing news: ?tab=mine for your horses, jockeys and rivals; ?before=<ms> pages back. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") === "mine" ? "mine" : "all";
  const before = Number(url.searchParams.get("before"));
  try {
    const session = (await hasSessionCookie()) ? await getSession(await db()) : null;
    const beforeMs = Number.isFinite(before) && before > 0 ? before : null;
    // A visitor's first page is the shared copy (no database).
    if (!session) return json({ items: tab === "mine" ? [] : beforeMs === null ? await visitorNews() : await newsFeed(await db(), null, tab, new Date(), beforeMs) });
    return json({ items: await newsFeed(await db(), session, tab, new Date(), beforeMs) });
  } catch (err) {
    return handleError(err);
  }
}

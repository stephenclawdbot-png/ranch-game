import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { getSession } from "@/server/session";
import { newsFeed } from "@/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The racing news: ?tab=mine for your horses, jockeys and rivals; ?before=<ms> pages back. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") === "mine" ? "mine" : "all";
  const before = Number(url.searchParams.get("before"));
  try {
    const database = await db();
    const session = await getSession(database);
    return json({ items: await newsFeed(database, session, tab, new Date(), Number.isFinite(before) && before > 0 ? before : null) });
  } catch (err) {
    return handleError(err);
  }
}

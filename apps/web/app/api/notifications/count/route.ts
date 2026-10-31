import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { unreadCount } from "@/server/notifications";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Seconds a browser may reuse the count (private: never a shared cache, it's per account). */
const COUNT_MAX_AGE_S = 15;

/** The bell's unread count, polled by the top bar: one capped read, cached briefly in the browser only. */
export async function GET() {
  try {
    const database = await db();
    const session = await requireSession(database);
    return json({ unread: await unreadCount(database, session, new Date()) }, { cache: `private, max-age=${COUNT_MAX_AGE_S}` });
  } catch (err) {
    return handleError(err);
  }
}

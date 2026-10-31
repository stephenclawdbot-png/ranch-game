import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { isCategory, notificationsView } from "@/server/notifications";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in player's notifications, newest first, with the unread count. Default: the bell
 * (switched-off categories left out). `all=1`: a page of the full inbox (everything, muted ones
 * flagged), `before=<ms>` for the next page, `category=<key>` to filter. Titles are spoiler-safe.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const all = url.searchParams.get("all") === "1";
    const before = Number(url.searchParams.get("before"));
    const category = url.searchParams.get("category");
    const database = await db();
    const session = await requireSession(database);
    return json(
      await notificationsView(database, session, new Date(), {
        all,
        before: Number.isFinite(before) && before > 0 ? before : null,
        category: isCategory(category) ? category : null,
      }),
    );
  } catch (err) {
    return handleError(err);
  }
}

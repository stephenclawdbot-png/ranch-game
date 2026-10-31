import { missItDue } from "@thoroughbred/db";
import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether the signed-in tester should be asked the exit question now (answered via POST /api/feedback, category "miss_it"). */
export async function GET() {
  try {
    const database = await db();
    const session = await getSession(database);
    const due = session ? await missItDue(database, { accountId: session.accountId, now: new Date() }) : false;
    const res = json({ due });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    return handleError(err);
  }
}

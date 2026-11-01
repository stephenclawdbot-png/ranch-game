import { db } from "@/server/db";
import { engageView } from "@/server/engage";
import { handleError, json } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tomorrow at your yard (signed in), this week's table across every stable, and the Saturday Feature card. */
export async function GET() {
  try {
    const database = await db();
    const session = await getSession(database);
    return json(await engageView(database, session, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

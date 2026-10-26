import { db } from "@/server/db";
import { hallView } from "@/server/competition";
import { handleError, json } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hall of Fame: inductees, record times, champions, bloodlines, season winners; your achievements and rivals. */
export async function GET() {
  try {
    const database = await db();
    const session = await getSession(database);
    return json({ hall: await hallView(database, session, new Date()) });
  } catch (err) {
    return handleError(err);
  }
}

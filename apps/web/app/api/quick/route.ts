import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { quickHub } from "@/server/quickRaces";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Quick races hub: your horses, the courses, today's daily challenge, ghost sources, your recent quick races. */
export async function GET() {
  try {
    const database = await db();
    const session = await getSession(database);
    return json(await quickHub(database, session, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

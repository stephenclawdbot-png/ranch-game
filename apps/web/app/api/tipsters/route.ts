import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { tipsters } from "@/server/picks";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The weekly tipster table (resets Monday 00:00 UTC), last week's top 10, best weeks and your line. */
export async function GET() {
  try {
    const database = await db();
    return json(await tipsters(database, await getSession(database), new Date()));
  } catch (err) {
    return handleError(err);
  }
}

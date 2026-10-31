import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { homePicks } from "@/server/picks";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Home's "Today's picks": the next races open for picks, your latest scored picks, your week. */
export async function GET() {
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await homePicks(database, session, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

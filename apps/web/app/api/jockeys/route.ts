import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { myJockeys } from "@/server/jockeys";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your stable's jockeys (the Stable page's "Your jockeys"). */
export async function GET() {
  try {
    const database = await db();
    const session = await requireSession(database);
    return json({ jockeys: await myJockeys(database, session, new Date()) });
  } catch (err) {
    return handleError(err);
  }
}

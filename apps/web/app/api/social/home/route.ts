import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { requireSession } from "@/server/session";
import { homeSocial } from "@/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Home and the stable page: your top rivals with head-to-head, your nemesis, and the latest racing news. */
export async function GET() {
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await homeSocial(database, session, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

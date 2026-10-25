import { db } from "@/server/db";
import { playerView, refill } from "@/server/game";
import { handleError, json } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** +5 stable entries for credits (once per local day, only below 5). */
export async function POST() {
  try {
    const database = await db();
    const session = await requireSession(database);
    const now = new Date();
    await refill(database, session, now);
    return json({ player: await playerView(database, session, now) });
  } catch (err) {
    return handleError(err);
  }
}

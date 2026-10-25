import { db } from "@/server/db";
import { playerView, quickPickLive } from "@/server/game";
import { handleError, json } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live Quick Pick: enters your best-fit fresh horse into the next suitable race on the shared card. */
export async function POST() {
  try {
    const database = await db();
    const session = await requireSession(database);
    const now = new Date();
    const pick = await quickPickLive(database, session, now);
    return json({ pick, player: await playerView(database, session, now) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

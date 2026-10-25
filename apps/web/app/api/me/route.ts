import { db } from "@/server/db";
import { playerView } from "@/server/game";
import { handleError, json } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in player: stable, credits, entry bank, horses, active entries, inbox, recent runs. `{ player: null }` without a stable. */
export async function GET() {
  try {
    const database = await db();
    const session = await getSession(database);
    return json({ player: session ? await playerView(database, session, new Date()) : null });
  } catch (err) {
    return handleError(err);
  }
}

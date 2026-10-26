import { db } from "@/server/db";
import { homeTiles } from "@/server/home";
import { handleError, json } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Home tiles for the signed-in player: Daily Cup, care today, free pack, foaling, next Story race. */
export async function GET() {
  try {
    const database = await db();
    const session = await requireSession(database);
    return json({ tiles: await homeTiles(database, session, new Date()) });
  } catch (err) {
    return handleError(err);
  }
}

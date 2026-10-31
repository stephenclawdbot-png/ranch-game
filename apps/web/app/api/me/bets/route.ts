import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { requireSession } from "@/server/session";
import { myBetsHistory } from "@/server/tote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/bets -> your tote bets, newest first, with P&L per currency. Signed-in only. */
export async function GET() {
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await myBetsHistory(database, session, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

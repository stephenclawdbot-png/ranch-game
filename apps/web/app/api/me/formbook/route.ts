import { db } from "@/server/db";
import { stableFormBook } from "@/server/formBook";
import { handleError, json } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/formbook?horse=: the stable's splits (every horse it has run, or one), from
 * settled races only. Signed-in only (401 otherwise).
 */
export async function GET(req: Request) {
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await stableFormBook(database, session, new URL(req.url).searchParams.get("horse"), new Date()));
  } catch (err) {
    return handleError(err);
  }
}

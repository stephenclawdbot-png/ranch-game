import { db } from "@/server/db";
import { myRaces } from "@/server/game";
import { handleError, json } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/races: the stable's settled runs, newest first, with filters (horse, kind,
 * wins) and a summary for the same filter. Signed-in only (401 otherwise). Cursor-paged.
 */
export async function GET(req: Request) {
  try {
    const database = await db();
    const session = await requireSession(database);
    const p = new URL(req.url).searchParams;
    const k = p.get("kind");
    const kind: "all" | "live" | "story" = k === "live" || k === "story" ? k : "all";
    return json(await myRaces(database, session, { horseId: p.get("horse"), kind, winsOnly: p.get("wins") === "1" }, p.get("cursor")));
  } catch (err) {
    return handleError(err);
  }
}
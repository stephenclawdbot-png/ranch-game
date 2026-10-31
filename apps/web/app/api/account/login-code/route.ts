import { db } from "@/server/db";
import { errorJson, handleError, json } from "@/server/http";
import { ensureLoginCode } from "@/server/loginCode";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Testing phase: the signed-in player's permanent login code (the same code every time), for
 * signing back in without a wallet at /link. 404 outside the playtest.
 */
export async function GET() {
  try {
    const database = await db();
    const session = await requireSession(database);
    const code = await ensureLoginCode(database, session.accountId);
    if (!code) return errorJson(404, "NOT_FOUND", { message: "Login codes are only for the testing phase." });
    const res = json({ code });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    return handleError(err);
  }
}

import { isDbUnavailable, pingDb } from "@thoroughbred/db";
import { db } from "@/server/db";
import { errorJson, json, outageJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Does the database answer? One `select 1`. 200 `{ ok: true }`, or the outage answer (503
 * `db_unavailable`). Only the outage screen's "Try again" calls this: it is never polled.
 */
export async function GET() {
  try {
    await pingDb(await db());
    return json({ ok: true });
  } catch (err) {
    if (isDbUnavailable(err)) return outageJson();
    console.error("[health]", err);
    return errorJson(500, "health_check_failed", { message: "The health check failed." });
  }
}

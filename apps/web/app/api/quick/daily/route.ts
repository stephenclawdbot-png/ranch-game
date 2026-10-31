import { DailyRequestSchema } from "@/lib/quickRaces";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { runDailyChallenge } from "@/server/quickRaces";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Takes today's daily challenge attempt (one per stable per UTC day; 409 RACE_LIMIT after). Points only. */
export async function POST(req: Request) {
  const parsed = DailyRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Pick a tactic, a ride and a rider." });
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await runDailyChallenge(database, session, parsed.data, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

import { MatchRequestSchema } from "@/lib/quickRaces";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { runMatchRace } from "@/server/quickRaces";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Runs a match race now (fresh random seed): unofficial, no credits, rating, fatigue or form. 429 past MATCH_RACES_PER_DAY. */
export async function POST(req: Request) {
  const parsed = MatchRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Pick your horse, who to race and where." });
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await runMatchRace(database, session, parsed.data, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

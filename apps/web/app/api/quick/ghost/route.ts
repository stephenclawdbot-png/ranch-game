import { GhostRequestSchema } from "@/lib/quickRaces";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { runGhostRace } from "@/server/quickRaces";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Runs a ghost race now: your horse against the first three of a settled Live race (fresh seed). Unofficial. 429 past GHOST_RACES_PER_DAY. */
export async function POST(req: Request) {
  const parsed = GhostRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Pick your horse and a race." });
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await runGhostRace(database, session, parsed.data, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

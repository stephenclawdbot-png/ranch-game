import { z } from "zod";
import { RunningStyleSchema } from "@thoroughbred/shared";
import { db } from "@/server/db";
import { runCup } from "@/server/competition";
import { playerView } from "@/server/game";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { HorseIdSchema } from "@/server/planSchema";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ horseId: HorseIdSchema, tactic: RunningStyleSchema.optional() });

/**
 * Today's Cup Run (one per stable per UTC day): the client picks the horse and the ride only.
 * The run is simulated on the server against the day's fixed field; free, not a career start.
 */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { issues: parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message) });
  try {
    const database = await db();
    const session = await requireSession(database);
    const now = new Date();
    const { entryId } = await runCup(database, session, parsed.data, now);
    return json({ entryId, player: await playerView(database, session, now) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

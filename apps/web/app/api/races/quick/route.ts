import { z } from "zod";
import { db } from "@/server/db";
import { createStoryRace, playerView } from "@/server/game";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { HorseIdSchema, PlanSchema } from "@/server/planSchema";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Story mode (§4e): a solo race against the Club's house horses. The client chooses only the
 * horse and the plan (or `pick: "auto"` for Quick Pick). The race is simulated and settled on
 * the server right here (capped Story rewards in the ledger); watching only shows it.
 * `instant` back-dates the race so the result is visible at once (Story only).
 */
const BodySchema = z
  .object({
    pick: z.literal("auto").optional(),
    horseId: HorseIdSchema.optional(),
    plan: PlanSchema.optional(),
    instant: z.boolean().optional(),
  })
  .refine((b) => b.pick === "auto" || b.horseId !== undefined, { message: 'horseId is required unless pick is "auto"' });

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { issues: parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message) });
  try {
    const database = await db();
    const session = await requireSession(database);
    const now = new Date();
    const created = await createStoryRace(database, session, { horseId: parsed.data.pick === "auto" ? undefined : parsed.data.horseId, plan: parsed.data.plan, instant: parsed.data.instant }, now);
    return json({ ...created, player: await playerView(database, session, now) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

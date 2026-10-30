import { z } from "zod";
import { RaceDayChoiceSchema } from "@thoroughbred/game-core";
import { db } from "@/server/db";
import { enterLive, playerView } from "@/server/game";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { HorseIdSchema, PlanSchema } from "@/server/planSchema";
import { requireSession } from "@/server/session";
import { trackEvent } from "@/server/playtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Race-day extras and jockey are optional choices (priced and charged on the server); a claiming race needs a claim price. */
const BodySchema = z.object({ horseId: HorseIdSchema, plan: PlanSchema, raceDay: RaceDayChoiceSchema.optional(), claimPrice: z.number().int().positive().max(1e9).optional() });

/** Enters one of your horses in a Live card race (costs stable entries, plus any race-day extras; idempotent per horse). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Choose a horse and a riding plan." });
  try {
    const database = await db();
    const session = await requireSession(database);
    const now = new Date();
    const entry = await enterLive(database, session, decodeURIComponent(id), parsed.data.horseId, parsed.data.plan, now, parsed.data.raceDay, parsed.data.claimPrice);
    await trackEvent(database, session.accountId, "race_entered", { kind: "live" });
    return json({ entry, player: await playerView(database, session, now) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

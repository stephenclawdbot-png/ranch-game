import { z } from "zod";
import { db } from "@/server/db";
import { enterLive, playerView } from "@/server/game";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { HorseIdSchema, PlanSchema } from "@/server/planSchema";
import { requireSession } from "@/server/session";
import { trackEvent } from "@/server/playtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ horseId: HorseIdSchema, plan: PlanSchema });

/** Enters one of your horses in a Live card race (costs stable entries; idempotent per horse). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Choose a horse and a riding plan." });
  try {
    const database = await db();
    const session = await requireSession(database);
    const now = new Date();
    const entry = await enterLive(database, session, decodeURIComponent(id), parsed.data.horseId, parsed.data.plan, now);
    await trackEvent(database, session.accountId, "race_entered", { kind: "live" });
    return json({ entry, player: await playerView(database, session, now) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

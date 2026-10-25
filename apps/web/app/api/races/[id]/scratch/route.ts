import { z } from "zod";
import { db } from "@/server/db";
import { playerView, scratchLive } from "@/server/game";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { HorseIdSchema } from "@/server/planSchema";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ horseId: HorseIdSchema });

/** Withdraws your horse while entries are open (the stable entry is forfeited, §4f). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    const now = new Date();
    await scratchLive(database, session, decodeURIComponent(id), parsed.data.horseId, now);
    return json({ player: await playerView(database, session, now) });
  } catch (err) {
    return handleError(err);
  }
}

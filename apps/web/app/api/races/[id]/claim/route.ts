import { z } from "zod";
import { db } from "@/server/db";
import { claimLive, playerView } from "@/server/game";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { HorseIdSchema } from "@/server/planSchema";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ horseId: HorseIdSchema });

/** Lodges a claim on a runner of a claiming race (its claim price is held in escrow until the race; idempotent). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Choose a runner to claim." });
  try {
    const database = await db();
    const session = await requireSession(database);
    const now = new Date();
    const claim = await claimLive(database, session, decodeURIComponent(id), parsed.data.horseId, now);
    return json({ claim: { horseId: claim.horseId, price: claim.price, status: claim.status }, player: await playerView(database, session, now) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

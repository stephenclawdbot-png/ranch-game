import { z } from "zod";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { HorseIdSchema } from "@/server/planSchema";
import { pickRunner, racePick } from "@/server/picks";
import { getSession, requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The race's Pick block: the declared field with the points a winning pick would score, and your pick. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const database = await db();
    const view = await racePick(database, await getSession(database), decodeURIComponent(id), new Date());
    if (!view) return errorJson(404, "not_found");
    return json(view);
  } catch (err) {
    return handleError(err);
  }
}

const BodySchema = z.object({ horseId: HorseIdSchema });

/** Picks (or changes) your runner to win, until the off. Points only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await pickRunner(database, session, decodeURIComponent(id), parsed.data.horseId, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

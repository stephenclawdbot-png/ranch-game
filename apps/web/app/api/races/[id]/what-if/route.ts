import { z } from "zod";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { HorseIdSchema } from "@/server/planSchema";
import { requireSession } from "@/server/session";
import { runWhatIf, whatIfOptions } from "@/server/whatIf";
import { WhatIfChangeSchema } from "@/lib/whatIf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a "What if?" re-run may change for your runner in a settled race (425 TOO_EARLY before it
 * has settled, 403 for a horse your stable didn't run or own).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const horseId = HorseIdSchema.safeParse(new URL(req.url).searchParams.get("horseId"));
  if (!horseId.success) return errorJson(400, "invalid_body", { message: "Which horse?" });
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await whatIfOptions(database, session, decodeURIComponent(id), horseId.data, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

const BodySchema = z.object({ horseId: HorseIdSchema, change: WhatIfChangeSchema });

/**
 * Re-runs the settled race with one change to your runner: same field, same seed. Unofficial:
 * no credits, rating or form. Free; cached per change; 429 past the hourly limit of fresh re-runs.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Pick one change to try." });
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await runWhatIf(database, session, decodeURIComponent(id), parsed.data.horseId, parsed.data.change, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

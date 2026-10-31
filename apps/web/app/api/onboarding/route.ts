import { z } from "zod";
import { db } from "@/server/db";
import { isRaceId } from "@/server/game";
import { onboardingAction } from "@/server/guide";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mentor"), plainLanguage: z.boolean().nullable().optional() }),
  z.object({ action: z.literal("plain"), on: z.boolean() }),
  z.object({ action: z.literal("coach"), id: z.string().max(40) }),
  z.object({ action: z.literal("why"), raceId: z.string().refine(isRaceId) }),
  z.object({ action: z.literal("welcome_back") }),
]);

/**
 * The beginner welcome's choices: the mentor finished or skipped (with the "New to horse
 * racing?" answer), plain language on or off, a coach mark dismissed, the Why card read (a step,
 * checked against a race the stable ran and watched), the welcome-back card dismissed.
 */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await onboardingAction(database, session, parsed.data, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

import { z } from "zod";
import { db } from "@/server/db";
import { isRaceId } from "@/server/game";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { requireSession } from "@/server/session";
import { pinTarget, stablePlan, unpinTarget } from "@/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Uuid = z.string().refine(isRaceId);
const PinSchema = z.object({ horseId: Uuid, raceId: Uuid.optional(), slotIndex: z.number().int().nonnegative().optional() }).refine((b) => b.raceId !== undefined || b.slotIndex !== undefined);
const UnpinSchema = z.object({ id: Uuid });

/** The stable's campaign plan (?horseId= for one horse) with its checks. */
export async function GET(req: Request) {
  const horseId = new URL(req.url).searchParams.get("horseId");
  if (horseId && !isRaceId(horseId)) return errorJson(400, "bad_query");
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await stablePlan(database, session, new Date(), horseId));
  } catch (err) {
    return handleError(err);
  }
}

/** Pins a race (published card race by id, or a calendar race by slot) as a horse's target. */
export async function POST(req: Request) {
  const parsed = PinSchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await pinTarget(database, session, parsed.data, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

/** Takes a target off the plan. */
export async function DELETE(req: Request) {
  const parsed = UnpinSchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    await unpinTarget(database, session, parsed.data.id, new Date());
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

import { z } from "zod";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { markSeen } from "@/server/notifications";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100).optional() });

/**
 * Marks notifications seen in the bell: `ids`, or every unread one ("mark all read") without.
 * Only the player's own. Never marks a race result watched (its reveal still waits on the race page).
 */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    return json({ unread: await markSeen(database, session, new Date(), parsed.data.ids) });
  } catch (err) {
    return handleError(err);
  }
}

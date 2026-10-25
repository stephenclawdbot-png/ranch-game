import { z } from "zod";
import { markInboxRead } from "@thoroughbred/db";
import { db } from "@/server/db";
import { isRaceId } from "@/server/game";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ raceId: z.string().refine(isRaceId) });

/** Marks the inbox items of a race as seen. */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    const changed = await markInboxRead(database, { accountId: session.accountId, raceId: parsed.data.raceId, now: new Date() });
    return json({ changed });
  } catch (err) {
    return handleError(err);
  }
}

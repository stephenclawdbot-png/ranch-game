import { z } from "zod";
import { db } from "@/server/db";
import { isRaceId } from "@/server/game";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { dismissHighlight } from "@/server/moments";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// moment ids are inbox item uuids (isRaceId is the shared uuid check)
const BodySchema = z.object({ id: z.string().refine(isRaceId) });

/** Dismisses a moment's horse-page highlight (the owner's own only; idempotent). */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    const changed = await dismissHighlight(database, session, parsed.data.id, new Date());
    return json({ changed });
  } catch (err) {
    return handleError(err);
  }
}

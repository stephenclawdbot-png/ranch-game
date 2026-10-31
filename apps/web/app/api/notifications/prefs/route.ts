import { z } from "zod";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { prefsView, savePrefs } from "@/server/notifications";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The notification categories and which are on (all on by default). */
export async function GET() {
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await prefsView(database, session));
  } catch (err) {
    return handleError(err);
  }
}

const Category = z.enum(["races", "health", "training", "market", "breeding", "jockeys", "betting", "club"]);
const BodySchema = z.object({ enabled: z.partialRecord(Category, z.boolean()) });

/** Switches categories on or off: `{ enabled: { market: false } }` (categories left out keep their setting). */
export async function PUT(req: Request) {
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await savePrefs(database, session, parsed.data.enabled, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

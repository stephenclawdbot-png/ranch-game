import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { requireSession } from "@/server/session";
import { bettingSettings, SettingsActionSchema, updateBettingSettings } from "@/server/tote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/betting -> your betting limits, self-exclusion and the 18+ confirmation. */
export async function GET() {
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await bettingSettings(database, session, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/me/betting {action: "confirm_adult"} | {action: "limits", currency, perRace, perDay}
 * | {action: "exclude", choice: "24h" | "7d" | "30d" | "permanent"}. Lower limits apply at once,
 * raises after 24 h; a self-exclusion can't be undone early.
 */
export async function POST(req: Request) {
  const parsed = SettingsActionSchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await updateBettingSettings(database, session, parsed.data, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

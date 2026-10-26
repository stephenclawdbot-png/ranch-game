import { z } from "zod";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { trackEvent } from "@/server/playtest";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Client-side events only; everything else is recorded by the server where it happens. */
const Event = z.object({
  name: z.enum(["session_start", "page_view", "race_watched", "pool_claim"]),
  /** Route path only: query strings and hashes are stripped. */
  route: z.string().max(200).optional(),
  raceId: z.string().uuid().optional(),
});
const Schema = z.object({ events: z.array(Event).min(1).max(10) });

/** First-party telemetry (our own database; no third-party trackers). */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await getSession(database);
    for (const e of parsed.data.events) {
      const route = e.route?.split("?")[0]?.split("#")[0];
      await trackEvent(database, session?.accountId ?? null, e.name, { ...(route ? { route } : {}), ...(e.raceId ? { raceId: e.raceId } : {}) });
    }
    return json({ ok: true }, { status: 202 });
  } catch (err) {
    return handleError(err);
  }
}

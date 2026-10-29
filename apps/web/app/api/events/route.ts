import { z } from "zod";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { trackEvent } from "@/server/playtest";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Client-side events only; everything else is recorded by the server where it happens. */
const Event = z.union([
  z.object({
    name: z.enum(["session_start", "page_view", "race_watched", "pool_claim"]),
    /** Route path only: query strings and hashes are stripped. */
    route: z.string().max(200).optional(),
    raceId: z.string().uuid().optional(),
  }),
  // One real-device perf report per mounted race viewer (8 props; cleanProps caps the rest).
  z.object({
    name: z.literal("race_perf"),
    fps: z.number().int().min(0).max(1000),
    fpsLow: z.number().int().min(0).max(1000),
    quality: z.enum(["high", "low"]),
    downgraded: z.boolean(),
    view: z.enum(["trackside", "classic"]),
    device: z.enum(["phone", "tablet", "desktop"]),
    dpr: z.number().min(0).max(64),
    gpu: z.string().max(120),
  }),
]);
const Schema = z.object({ events: z.array(Event).min(1).max(10) });

/** First-party telemetry (our own database; no third-party trackers). */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await getSession(database);
    for (const e of parsed.data.events) {
      if (e.name === "race_perf") {
        const { name: _n, ...perf } = e;
        await trackEvent(database, session?.accountId ?? null, "race_perf", { ...perf, gpu: e.gpu.slice(0, 60) });
        continue;
      }
      const route = e.route?.split("?")[0]?.split("#")[0];
      await trackEvent(database, session?.accountId ?? null, e.name, { ...(route ? { route } : {}), ...(e.raceId ? { raceId: e.raceId } : {}) });
    }
    return json({ ok: true }, { status: 202 });
  } catch (err) {
    return handleError(err);
  }
}

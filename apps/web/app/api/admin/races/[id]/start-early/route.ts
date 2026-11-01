import { z } from "zod";
import { startRaceEarly } from "@thoroughbred/db";
import { adminRoute } from "@/server/adminHttp";
import { errorJson, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ minutes: z.number().int().min(5).max(60).optional() });

/**
 * Admin: bring an open Live card race forward to `minutes` from now (default 10). Calendar races
 * and races whose entries have closed are never moved. Entrants get a bell note.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Schema.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return errorJson(400, "invalid_body");
  return adminRoute(async (db, now) => {
    const moved = await startRaceEarly(db, { raceId: id, now, minutes: parsed.data.minutes });
    return moved ? { moved: true, postTimeMs: moved.postTime.getTime() } : { moved: false };
  });
}

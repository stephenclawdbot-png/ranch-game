import { z } from "zod";
import { raceRepository } from "@/server/repository";
import { errorJson, handleRaceError, json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const QuerySchema = z.object({ commitment: Hex64.optional(), resultHash: Hex64.optional() });

/**
 * Re-simulates the race server-side from the revealed seed.
 * Optional ?commitment=&resultHash= let the client check the values it saw earlier.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const q = QuerySchema.safeParse({
    commitment: url.searchParams.get("commitment") ?? undefined,
    resultHash: url.searchParams.get("resultHash") ?? undefined,
  });
  if (!q.success) return errorJson(400, "bad_query");
  try {
    const result = await raceRepository().verifyRace(decodeURIComponent(id), Date.now(), q.data);
    return json(result);
  } catch (err) {
    return handleRaceError(err);
  }
}

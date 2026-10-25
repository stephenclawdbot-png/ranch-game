import { raceRepository } from "@/server/repository";
import { handleRaceError, json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Race card: config, field, seed commitment. Never the seed. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const now = Date.now();
  try {
    const card = await raceRepository().getRace(decodeURIComponent(id), now);
    return json({ serverNowMs: now, race: card });
  } catch (err) {
    return handleRaceError(err);
  }
}

import { raceRepository } from "@/server/repository";
import { handleRaceError, json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 425 before post time; afterwards the deterministic replay (seed revealed), cacheable forever. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const replay = await raceRepository().getReplay(decodeURIComponent(id), Date.now());
    return json(replay, { cache: "public, max-age=31536000, immutable" });
  } catch (err) {
    return handleRaceError(err);
  }
}

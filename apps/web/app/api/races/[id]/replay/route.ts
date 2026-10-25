import { db } from "@/server/db";
import { servedReplay } from "@/server/game";
import { handleError, json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 425 before post time and while the race is live on the broadcast clock; afterwards the deterministic replay (seed revealed), cacheable forever. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const replay = await servedReplay(await db(), decodeURIComponent(id), new Date());
    return json(replay, { cache: "public, max-age=31536000, immutable" });
  } catch (err) {
    return handleError(err);
  }
}

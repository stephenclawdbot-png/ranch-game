import { horseRepository } from "@/server/repository";
import { errorJson, json } from "@/server/http";

export const runtime = "nodejs";

/** The player's starter horses (deterministic from playerId). */
export async function GET(_req: Request, ctx: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await ctx.params;
  const horses = await horseRepository().getStable(playerId);
  if (!horses) return errorJson(404, "player_not_found");
  return json({ playerId, horses }, { cache: "public, max-age=3600" });
}

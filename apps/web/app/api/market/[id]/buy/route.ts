import { buy, marketView } from "@/server/economy";
import { IdSchema, withPlayer } from "@/server/economyHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Buys a listing atomically (5% burned, needs a free stall). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return errorJson(404, "NOT_FOUND");
  return withPlayer(async (db, session, now) => ({ trade: await buy(db, session, id, now), view: await marketView(db, session, now) }), 200, "market_buy");
}

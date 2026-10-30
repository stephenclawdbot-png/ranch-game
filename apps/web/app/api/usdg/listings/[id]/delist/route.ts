import { delistHorse } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Takes your listing down (not while a buyer is paying, nor once an auction has bids). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson(404, "NOT_FOUND");
  return withUsdgPlayer((c, session, now) => delistHorse(c, session, id, now));
}

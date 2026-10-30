import { myOrder } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One of my USDG orders, signed again while payable (auction winners pay from here). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return errorJson(404, "NOT_FOUND");
  return withUsdgPlayer((c, session, now) => myOrder(c, session, id.toLowerCase(), now));
}

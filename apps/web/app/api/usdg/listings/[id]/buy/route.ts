import { buyFixed } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fixed-price buy: reserves the lot for you for a few minutes and returns the signed SaleOrder to pay. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson(404, "NOT_FOUND");
  return withUsdgPlayer((c, session, now) => buyFixed(c, session, id, now), { status: 201 });
}

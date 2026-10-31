import { practicePay } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Practice mode only (USDG_MODE=practice): pays one of my orders from my T-USDG test balance and
 * delivers it in the same database transaction. No chain, no real money.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return errorJson(404, "NOT_FOUND");
  return withUsdgPlayer((c, session, now) => practicePay(c, session, id.toLowerCase(), now));
}

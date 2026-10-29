import { mockPay } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Test mode only (WEB3_ENABLED off, mock chain): simulates the wallet paying the order, then confirms it. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return errorJson(404, "NOT_FOUND");
  return withUsdgPlayer((c, session, now) => mockPay(c, session, id.toLowerCase(), now));
}

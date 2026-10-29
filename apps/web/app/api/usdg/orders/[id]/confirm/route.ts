import { z } from "zod";
import { confirmUsdgOrder } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";
import { errorJson, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/** The wallet sent the payment: verify it on-chain and deliver (idempotent; poll while "pending"). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return errorJson(404, "NOT_FOUND");
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Missing transaction." });
  return withUsdgPlayer((c, session, now) => confirmUsdgOrder(c, session, { orderId: id.toLowerCase(), txHash: parsed.data.txHash }, now));
}

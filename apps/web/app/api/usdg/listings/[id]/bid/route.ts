import { z } from "zod";
import { bid } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";
import { errorJson, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ amount: z.number().int().positive().max(1e15), nonce: z.string().regex(/^\d{1,78}$/), signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(4000) });

/** A bid signed by your linked wallet (EIP-712 Bid). No money moves until the auction closes. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson(404, "NOT_FOUND");
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "The bid or its signature is missing." });
  return withUsdgPlayer((c, session, now) => bid(c, session, { listingId: id, amount: parsed.data.amount, nonce: parsed.data.nonce, signature: parsed.data.signature as `0x${string}` }, now), { status: 201 });
}

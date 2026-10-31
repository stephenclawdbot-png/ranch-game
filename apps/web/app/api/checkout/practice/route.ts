import { z } from "zod";
import { errorJson, readJson } from "@/server/http";
import { practiceCheckout } from "@/server/chain/checkout";
import { withChainPlayer } from "@/server/chain/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ sku: z.literal("premium_pack"), quantity: z.number().int().min(1).max(10), clientKey: z.string().regex(/^[A-Za-z0-9_-]{6,80}$/) });

/**
 * Practice mode only (USDG_MODE=practice): buys Premium Packs with T-USDG test money (1 T-USDG
 * per USD of the price) and pulls them in the same transaction. No ETH, no chain, no real money.
 */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Choose 1 to 10 Premium Packs." });
  const country = req.headers.get("x-vercel-ip-country");
  return withChainPlayer((ctx, session, now) => practiceCheckout(ctx, session, { ...parsed.data, country, now }), 201);
}

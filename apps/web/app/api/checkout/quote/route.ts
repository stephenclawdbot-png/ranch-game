import { z } from "zod";
import { errorJson, readJson } from "@/server/http";
import { quoteCheckout } from "@/server/chain/checkout";
import { withChainPlayer } from "@/server/chain/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ sku: z.literal("premium_pack"), quantity: z.number().int().min(1).max(10) });

/**
 * A signed ETH quote for Premium Packs: "$X ≈ Y ETH", valid 5 minutes. The order row is
 * written before signing; the wallet pays exactly `priceWei`.
 */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Choose 1 to 10 Premium Packs." });
  const country = req.headers.get("x-vercel-ip-country");
  return withChainPlayer((ctx, session, now) => quoteCheckout(ctx, session, { sku: parsed.data.sku, quantity: parsed.data.quantity, country, now }), 201);
}

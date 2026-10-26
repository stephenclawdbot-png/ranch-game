import { z } from "zod";
import { errorJson, readJson } from "@/server/http";
import { confirmCheckout } from "@/server/chain/checkout";
import { withChainPlayer } from "@/server/chain/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ orderId: z.string().regex(/^0x[0-9a-fA-F]{64}$/), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/** The wallet sent the payment: verify it on-chain and grant the pulls (idempotent; poll while "pending"). */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Missing order or transaction." });
  return withChainPlayer((ctx, session, now) => confirmCheckout(ctx, session, { orderId: parsed.data.orderId.toLowerCase(), txHash: parsed.data.txHash, now }));
}

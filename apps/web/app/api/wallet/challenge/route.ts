import { z } from "zod";
import { errorJson, readJson } from "@/server/http";
import { withChainPlayer } from "@/server/chain/http";
import { walletChallenge } from "@/server/chain/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/** Step 1 of linking: a one-time EIP-4361 message for the wallet to sign (free, no transaction). */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Connect a wallet first." });
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return withChainPlayer((ctx, session, now) => walletChallenge(ctx.db, session, { address: parsed.data.address, host, proto, chainId: ctx.chain.chainId, now }));
}

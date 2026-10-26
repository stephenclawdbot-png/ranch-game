import { withChainPlayer } from "@/server/chain/http";
import { walletStatus } from "@/server/chain/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The stable's SIWE-verified wallet (or null). */
export async function GET() {
  return withChainPlayer(async (ctx, session) => ({ ...(await walletStatus(ctx.db, session)), chainId: ctx.chain.chainId }));
}

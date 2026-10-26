import { resumeOrders } from "@/server/chain/checkout";
import { withChainPlayer } from "@/server/chain/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Open ETH orders to resume after a reload (submitted/paid ones are re-checked on the way). */
export async function GET() {
  return withChainPlayer(async (ctx, session, now) => ({ orders: await resumeOrders(ctx, session, now) }));
}

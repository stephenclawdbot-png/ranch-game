import { usdgAdminView } from "@/server/chain/usdg";
import { withUsdgAdmin } from "@/server/chain/usdgHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: USDG market totals, the contract's state (fee bps vs USDG_FEE_BPS) and orders that need a human. */
export async function GET() {
  return withUsdgAdmin((ctx) => usdgAdminView(ctx));
}

import { usdgMarketView } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The USDG market board (registered lots, fixed price and live auctions), my orders and my registered horses. */
export async function GET() {
  return withUsdgPlayer((ctx, session, now) => usdgMarketView(ctx, session, now), { tick: true });
}

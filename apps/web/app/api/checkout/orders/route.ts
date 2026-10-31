import { lifetimeLeftCents, practiceBalanceOf, resumeOrders } from "@/server/chain/checkout";
import { marketIdentityKind } from "@/server/chain/practice";
import { withChainPlayer } from "@/server/chain/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Checkout status for the Packs screen: is ETH checkout on, the price in USD, the $50 beta
 * allowance left, and the open orders to resume after a reload (submitted/paid ones are
 * re-checked on the way).
 */
export async function GET() {
  return withChainPlayer(async (ctx, session, now) => ({
    enabled: ctx.cfg.enabled,
    /** Practice mode: packs cost T-USDG from the practice balance (POST /api/checkout/practice), no chain. */
    practice: ctx.cfg.practice,
    practiceBalance: ctx.cfg.practice ? await practiceBalanceOf(ctx, session, now) : null,
    /** Practice mode: "wallet", "practice" (no wallet: trade as the stable, never show an address) or null. */
    practiceIdentity: ctx.cfg.practice ? await marketIdentityKind(ctx.db, session.accountId) : null,
    stableName: session.stable.name,
    chainId: ctx.chain.chainId,
    store: ctx.chain.store,
    packUsdCents: ctx.cfg.premiumUsdCents,
    lifetimeLeftCents: ctx.cfg.enabled || ctx.cfg.practice ? await lifetimeLeftCents(ctx, session, now) : 0,
    orders: ctx.cfg.enabled ? await resumeOrders(ctx, session, now) : [],
  }));
}

import { privateKeyToAccount } from "viem/accounts";
import { chainSalesSummary, ownerAccountId, recentChainOrders, verifiedWalletOf } from "@thoroughbred/db";
import { withChainAdmin } from "@/server/chain/http";
import { readBetaConfig } from "@/server/chain/config";
import { orderView } from "@/server/chain/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chain status for /admin/chain and the Prize Pool tab: config (never secrets: only the
 * server signer's ADDRESS), live contract state, sales and recent orders.
 */
export async function GET() {
  return withChainAdmin(async (ctx) => {
    const cfg = readBetaConfig();
    const signerAddress = cfg.signerKey ? privateKeyToAccount(cfg.signerKey).address : null;
    const live = cfg.enabled && cfg.store && cfg.pool;
    const [store, pool] = live ? await Promise.all([ctx.chain.storeState().catch((e: Error) => ({ error: e.message })), ctx.chain.poolState().catch((e: Error) => ({ error: e.message }))]) : [null, null];
    const ser = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
    const owner = await ownerAccountId(ctx.db);
    let price: unknown = null;
    try {
      const p = await ctx.price.get();
      price = { usd: p.usd, sources: p.sources, fetchedAtMs: p.fetchedAtMs, fixed: p.fixed };
    } catch (e) {
      price = { error: (e as Error).message };
    }
    return {
      config: {
        enabled: cfg.enabled,
        chainId: cfg.chainId,
        rpcConfigured: !!cfg.rpcUrl,
        store: cfg.store,
        pool: cfg.pool,
        signerAddress,
        premiumUsdCents: cfg.premiumUsdCents,
        minConfirmations: cfg.minConfirmations,
        blockedCountries: cfg.blockedCountries,
        priceSource: process.env.ETH_USD_PRICE_SOURCE?.trim() || "auto",
      },
      store: ser(store),
      pool: ser(pool),
      price,
      owner: owner ? { accountId: owner, wallet: await verifiedWalletOf(ctx.db, owner) } : null,
      sales: await chainSalesSummary(ctx.db),
      orders: (await recentChainOrders(ctx.db, { limit: 30 })).map(orderView),
    };
  });
}

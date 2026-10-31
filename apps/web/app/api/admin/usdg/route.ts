import { z } from "zod";
import { usdgFromDecimal } from "@thoroughbred/game-core";
import { practiceAdmin, usdgAdminView } from "@/server/chain/usdg";
import { withUsdgAdmin } from "@/server/chain/usdgHttp";
import { errorJson, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: USDG market totals, the contract's state (fee bps vs USDG_FEE_BPS), practice T-USDG totals and orders that need a human. */
export async function GET() {
  return withUsdgAdmin((ctx) => usdgAdminView(ctx));
}

const Schema = z.discriminatedUnion("action", [
  /** Practice mode: add T-USDG (decimal, e.g. "50") to a stable (name or account id). `key` makes it idempotent. */
  z.object({ action: z.literal("practice_topup"), stable: z.string().min(1).max(80), amount: z.string().regex(/^\d+(\.\d{1,6})?$/), key: z.string().min(1).max(80) }),
  /** End of the beta: wipe practice balances and practice listings/orders. A dry run unless apply is true. */
  z.object({ action: z.literal("practice_reset"), apply: z.boolean().default(false) }),
]);

/** Admin actions for practice T-USDG (docs/usdg-market.md "Practice mode"). */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: 'Send { action: "practice_topup", stable, amount, key } or { action: "practice_reset", apply }.' });
  const body = parsed.data;
  if (body.action === "practice_reset") return withUsdgAdmin((ctx, now) => practiceAdmin(ctx, { action: "reset", apply: body.apply }, now));
  const amount = usdgFromDecimal(body.amount);
  if (amount === null || amount <= 0) return errorJson(400, "invalid_body", { message: "Amount in T-USDG, e.g. 50 or 12.5." });
  return withUsdgAdmin((ctx, now) => practiceAdmin(ctx, { action: "topup", stable: body.stable, amount, key: body.key }, now));
}

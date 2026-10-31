import { createHash, timingSafeEqual } from "node:crypto";
import { settleReferralActivations } from "@thoroughbred/db";
import { errorJson, json } from "@/server/http";
import { checkoutBackstop } from "@/server/chain/checkout";
import { chainCtx } from "@/server/chain/context";
import { usdgBackstop } from "@/server/chain/usdg";
import { usdgCtx } from "@/server/chain/usdgHttp";
import { realToteBackstop } from "@/server/chain/toteChain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Beta-money backstop (Vercel Cron, `Authorization: Bearer $CRON_SECRET`): settles paid
 * orders whose client never confirmed, expires dead quotes, grants affiliate activity rewards,
 * and runs the USDG market backstop (close auctions, offer to the next bidder after a missed
 * payment, settle paid-but-unconfirmed sales and registrations, expire stale orders), and the
 * DORMANT real-money tote keeper (returns `{skipped: "off"}` while REAL_TOTE_ENABLED is off).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return errorJson(503, "cron_not_configured", { message: "Set CRON_SECRET to enable the cron route." });
  const h = (s: string) => createHash("sha256").update(s).digest();
  if (!timingSafeEqual(h(req.headers.get("authorization") ?? ""), h(`Bearer ${secret}`))) return errorJson(401, "unauthorized", { message: "Bad cron secret." });
  const ctx = await chainCtx();
  const now = new Date();
  const orders = await checkoutBackstop(ctx, now);
  const activations = await settleReferralActivations(ctx.db, { now });
  let usdg: unknown;
  try {
    usdg = await usdgBackstop(await usdgCtx(), now);
  } catch (err) {
    console.error("usdg backstop", err);
    usdg = { error: (err as Error).message };
  }
  let realTote: unknown;
  try {
    realTote = await realToteBackstop(ctx.db, now);
  } catch (err) {
    console.error("real tote backstop", err);
    realTote = { error: (err as Error).message };
  }
  return json({ ok: true, orders, activations, usdg, realTote });
}

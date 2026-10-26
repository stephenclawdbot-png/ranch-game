import { createHash, timingSafeEqual } from "node:crypto";
import { settleReferralActivations } from "@thoroughbred/db";
import { errorJson, json } from "@/server/http";
import { checkoutBackstop } from "@/server/chain/checkout";
import { chainCtx } from "@/server/chain/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Beta-money backstop (Vercel Cron, `Authorization: Bearer $CRON_SECRET`): settles paid
 * orders whose client never confirmed, expires dead quotes, grants affiliate activity rewards.
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
  return json({ ok: true, orders, activations });
}

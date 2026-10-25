import { db } from "@/server/db";
import { driveCard } from "@/server/game";
import { errorJson, json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron backstop for the Live card (lazy driving on reads is the primary path): publishes the
 * card, locks closed fields, settles races whose broadcast is over and runs maintenance
 * (healing, foaling, listing expiry). Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return errorJson(503, "cron_not_configured", { message: "Set CRON_SECRET to enable the cron route." });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return errorJson(401, "unauthorized", { message: "Bad cron secret." });
  const started = Date.now();
  const report = await driveCard(await db(), new Date(), { force: true, maintenance: true });
  return json({ ok: true, ms: Date.now() - started, locked: report?.locked ?? 0, settled: report?.settled.length ?? 0 });
}

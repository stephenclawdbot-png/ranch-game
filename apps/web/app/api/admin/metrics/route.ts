import { playtestMetrics } from "@thoroughbred/db";
import { adminRoute } from "@/server/adminHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retention, daily actives, the signup funnel, time-to-first-race and perf reports. */
export async function GET(req: Request) {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 14);
  return adminRoute(async (db, now) => ({ metrics: await playtestMetrics(db, { now, days: Number.isFinite(days) ? days : 14 }) }));
}

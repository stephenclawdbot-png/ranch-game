import { economyHealth, playtestMetrics } from "@thoroughbred/db";
import { adminRoute } from "@/server/adminHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retention, daily actives, the signup funnel, time-to-first-race, perf reports and economy / loop health. */
export async function GET(req: Request) {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 14);
  const d = Number.isFinite(days) ? days : 14;
  return adminRoute(async (db, now) => ({ metrics: await playtestMetrics(db, { now, days: d }), economy: await economyHealth(db, { now, days: 7 }) }));
}

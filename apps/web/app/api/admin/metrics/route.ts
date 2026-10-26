import { playtestMetrics } from "@thoroughbred/db";
import { adminRoute } from "@/server/adminHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retention (day 1 / day 7), daily actives, sessions, races per day, and the signup funnel. */
export async function GET(req: Request) {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 14);
  return adminRoute(async (db, now) => ({ metrics: await playtestMetrics(db, { now, days: Number.isFinite(days) ? days : 14 }) }));
}

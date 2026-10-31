import { toteAdminStats } from "@thoroughbred/db";
import { adminRoute } from "@/server/adminHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: the tote's house take per day and week per currency, pool volume, bettors and the biggest pools. */
export async function GET() {
  return adminRoute(async (db, now) => toteAdminStats(db, now));
}

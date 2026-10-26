import { listTesters } from "@thoroughbred/db";
import { adminRoute } from "@/server/adminHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Testers: stable name, joined, last seen, races, days played, wallet, perks. */
export async function GET() {
  return adminRoute(async (db) => ({ testers: await listTesters(db) }));
}

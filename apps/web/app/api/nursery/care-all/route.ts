import { careAllAction } from "@/server/horseLife";
import { act } from "@/server/horseLifeRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stable hand: cares for every horse not yet cared for today (each counts once). */
export async function POST() {
  return act((database, session, now) => careAllAction(database, session, now), 200, "care");
}

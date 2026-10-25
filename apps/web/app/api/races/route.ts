import { raceRepository } from "@/server/repository";
import { json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Upcoming and recent scheduled races. */
export async function GET() {
  const now = Date.now();
  const races = await raceRepository().listRaces(now);
  return json({ serverNowMs: now, ...races });
}

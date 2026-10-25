import { db } from "@/server/db";
import { raceList } from "@/server/game";
import { handleError, json } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The shared Live card: upcoming races (entries open / closed) and the latest ones (live, then results). */
export async function GET() {
  try {
    const database = await db();
    const session = await getSession(database);
    const now = new Date();
    const races = await raceList(database, now, session?.stable.id ?? null);
    return json({ serverNowMs: now.getTime(), ...races });
  } catch (err) {
    return handleError(err);
  }
}

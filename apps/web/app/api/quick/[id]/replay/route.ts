import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { quickRaceReplay } from "@/server/quickRaces";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A quick race's replay for the viewer (re-simulated from the stored input). A daily challenge
 * attempt's seed stays masked until its day is over; someone else's attempt is 425 until then.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const database = await db();
    const session = await getSession(database);
    return json(await quickRaceReplay(database, session, decodeURIComponent(id), new Date()), { cache: "private, no-store" });
  } catch (err) {
    return handleError(err);
  }
}

import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { quickRaceView } from "@/server/quickRaces";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A quick race's result. Someone else's daily challenge attempt: 425 until the day is over. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const database = await db();
    const session = await getSession(database);
    return json(await quickRaceView(database, session, decodeURIComponent(id), new Date()));
  } catch (err) {
    return handleError(err);
  }
}

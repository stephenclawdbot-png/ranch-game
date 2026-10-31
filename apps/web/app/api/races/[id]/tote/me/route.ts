import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { getSession } from "@/server/session";
import { myRaceTote } from "@/server/tote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/races/:id/tote/me -> your bets on this race (with potential returns at the current pool), whether you may bet, and your allowances. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const database = await db();
    const session = await getSession(database);
    if (!session) return json({ signedIn: false });
    return json({ signedIn: true, me: await myRaceTote(database, session, decodeURIComponent(id), new Date()) });
  } catch (err) {
    return handleError(err);
  }
}

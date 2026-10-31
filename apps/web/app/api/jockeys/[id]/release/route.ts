import { releaseJockey } from "@thoroughbred/db";
import { db } from "@/server/db";
import { handleError, json, requireSameOrigin } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Releases one of your jockeys back to the Club pool (rides already booked still go ahead). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = requireSameOrigin(req);
  if (bad) return bad;
  const { id } = await ctx.params;
  try {
    const database = await db();
    const session = await requireSession(database);
    await releaseJockey(database, { accountId: session.accountId, jockeyId: decodeURIComponent(id), now: new Date() });
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

import { signJockey } from "@thoroughbred/db";
import { db } from "@/server/db";
import { handleError, json, requireSameOrigin } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Signs an unsigned Club freelancer (a one-off signing fee by grade; at most three jockeys a stable). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = requireSameOrigin(req);
  if (bad) return bad;
  const { id } = await ctx.params;
  try {
    const database = await db();
    const session = await requireSession(database);
    const result = await signJockey(database, { accountId: session.accountId, jockeyId: decodeURIComponent(id), now: new Date() });
    return json({ ok: true, ...result });
  } catch (err) {
    return handleError(err);
  }
}

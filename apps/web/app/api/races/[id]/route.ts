import { db } from "@/server/db";
import { raceCard } from "@/server/game";
import { handleError, json } from "@/server/http";
import { getSession, hasSessionCookie } from "@/server/session";
import { visitorRaceCard } from "@/server/visitorViews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Race card: config, field (preview while entries are open), seed commitment. Never the seed. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const now = new Date();
    const session = (await hasSessionCookie()) ? await getSession(await db()) : null;
    // A visitor gets the kept copy of a finished race (no database); everything else is computed now.
    const card = session ? await raceCard(await db(), decodeURIComponent(id), now, session.stable.id) : await visitorRaceCard(decodeURIComponent(id));
    return json({ serverNowMs: now.getTime(), race: card });
  } catch (err) {
    return handleError(err);
  }
}

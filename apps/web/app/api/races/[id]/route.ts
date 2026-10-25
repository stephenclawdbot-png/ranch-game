import { db } from "@/server/db";
import { raceCard } from "@/server/game";
import { handleError, json } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Race card: config, field (preview while entries are open), seed commitment. Never the seed. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const database = await db();
    const session = await getSession(database);
    const now = new Date();
    const card = await raceCard(database, decodeURIComponent(id), now, session?.stable.id ?? null);
    return json({ serverNowMs: now.getTime(), race: card });
  } catch (err) {
    return handleError(err);
  }
}

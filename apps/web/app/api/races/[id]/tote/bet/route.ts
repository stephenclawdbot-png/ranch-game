import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { requireSession } from "@/server/session";
import { BetSchema, placeBet, TooManyBetsError } from "@/server/tote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/races/:id/tote/bet {horseId, pool, currency, stake, clientKey} -> places one bet
 * (refused at or after the off, by the database clock). Returns your side of the race's tote.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = BetSchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    const me = await placeBet(database, session, decodeURIComponent(id), parsed.data, new Date());
    if (!me) return errorJson(404, "race_not_found");
    return json({ me });
  } catch (err) {
    if (err instanceof TooManyBetsError) return errorJson(429, "RATE_LIMITED", { message: "That's a lot of bets in a minute. Take a breather." });
    return handleError(err);
  }
}

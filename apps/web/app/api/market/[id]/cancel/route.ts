import { cancel, marketView } from "@/server/economy";
import { IdSchema, withPlayer } from "@/server/economyHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cancels your listing (the horse is unlocked). Idempotent. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return errorJson(404, "NOT_FOUND");
  return withPlayer(async (db, session, now) => {
    await cancel(db, session, id, now);
    return { view: await marketView(db, session, now) };
  });
}

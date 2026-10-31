import { requireUnlocked } from "@/server/guide";
import { leaseView, takeOffer } from "@/server/leasing";
import { IdSchema, withPlayer } from "@/server/economyHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Takes a lease offer (first come first served; idempotent; needs a free stall and an established stable). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return errorJson(404, "NOT_FOUND");
  return withPlayer(async (db, session, now) => {
    await requireUnlocked(db, session, "leasing", now);
    return { lease: await takeOffer(db, session, id, now), view: await leaseView(db, session, now) };
  });
}

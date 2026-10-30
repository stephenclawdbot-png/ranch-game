import { leaseView, withdrawOffer } from "@/server/leasing";
import { IdSchema, withPlayer } from "@/server/economyHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Withdraws your open lease offer. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return errorJson(404, "NOT_FOUND");
  return withPlayer(async (db, session, now) => {
    await withdrawOffer(db, session, id, now);
    return { view: await leaseView(db, session, now) };
  });
}

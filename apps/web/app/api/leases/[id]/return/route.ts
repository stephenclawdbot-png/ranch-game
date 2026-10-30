import { handBack, leaseView } from "@/server/leasing";
import { IdSchema, withPlayer } from "@/server/economyHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The lessee hands a leased horse back early (after its race, if it is entered in one). Owners can't recall. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return errorJson(404, "NOT_FOUND");
  return withPlayer(async (db, session, now) => ({ result: await handBack(db, session, id, now), view: await leaseView(db, session, now) }));
}

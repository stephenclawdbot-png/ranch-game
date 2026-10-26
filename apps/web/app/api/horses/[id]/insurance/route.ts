import { insuranceAction } from "@/server/horseLife";
import { act } from "@/server/horseLifeRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Career-ending-injury insurance: one premium, idempotent. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return act((database, session) => insuranceAction(database, session, decodeURIComponent(id)));
}

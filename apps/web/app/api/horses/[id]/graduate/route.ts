import { graduateAction } from "@/server/horseLife";
import { act } from "@/server/horseLifeRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Welcomes a nursery graduate (racing age) to the yard. Idempotent. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return act((database, session, now) => graduateAction(database, session, decodeURIComponent(id), now));
}

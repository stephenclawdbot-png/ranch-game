import { scanAction } from "@/server/horseLife";
import { act } from "@/server/horseLifeRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pedigree Scan: narrows the revealed potential ranges for good (credits, once). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return act((database, session, now) => scanAction(database, session, decodeURIComponent(id), now));
}

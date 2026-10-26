import { vetAction } from "@/server/horseLife";
import { act } from "@/server/horseLifeRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vet treatment during recovery (credits; once per injury per local day). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return act((database, session, now) => vetAction(database, session, decodeURIComponent(id), now));
}

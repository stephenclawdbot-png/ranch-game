import { z } from "zod";
import { renameAction } from "@/server/horseLife";
import { act, badBody, body } from "@/server/horseLifeRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().trim().min(1).max(64) });

/** Names (or renames) a horse before its first start. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req, Body);
  if (!b) return badBody("Give your horse a name of 2 to 18 characters.");
  return act((database, session) => renameAction(database, session, decodeURIComponent(id), b.name));
}

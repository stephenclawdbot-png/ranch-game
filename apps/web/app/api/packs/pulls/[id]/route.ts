import { pullProof } from "@/server/economy";
import { IdSchema, withPlayer } from "@/server/economyHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The proof of one of your pulls: commitment, revealed seed, the earlier seeds (pity), the foal's genome. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return errorJson(404, "NOT_FOUND");
  return withPlayer((db, session) => pullProof(db, session, id));
}

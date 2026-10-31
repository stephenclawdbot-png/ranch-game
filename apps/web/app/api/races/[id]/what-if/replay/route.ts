import { db } from "@/server/db";
import { errorJson, handleError, json } from "@/server/http";
import { HorseIdSchema } from "@/server/planSchema";
import { requireSession } from "@/server/session";
import { whatIfReplay } from "@/server/whatIf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The replay of a what-if you have already run (?horseId=&change=<key>): never official, never
 * served for a race that hasn't settled, and watching it never spends a re-run.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const horseId = HorseIdSchema.safeParse(sp.get("horseId"));
  const change = sp.get("change");
  if (!horseId.success || !change) return errorJson(400, "invalid_body", { message: "Which what-if?" });
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await whatIfReplay(database, session, decodeURIComponent(id), horseId.data, change, new Date()), { cache: "private, max-age=3600" });
  } catch (err) {
    return handleError(err);
  }
}

import { z } from "zod";
import { leaseView, rate } from "@/server/leasing";
import { IdSchema, parseBody, withPlayer } from "@/server/economyHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ stars: z.number().int().min(1).max(5) });

/** The owner rates the lessee 1-5 stars, once per finished lease (shown on the lessee's public record). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return errorJson(404, "NOT_FOUND");
  const body = await parseBody(req, Schema, "Rate 1 to 5 stars.");
  if (!body.ok) return body.res;
  return withPlayer(async (db, session, now) => ({ rated: await rate(db, session, id, body.data.stars, now), view: await leaseView(db, session, now) }));
}

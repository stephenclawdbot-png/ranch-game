import { z } from "zod";
import { careAction } from "@/server/horseLife";
import { act, badBody, body } from "@/server/horseLifeRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ feed: z.string().max(40).optional(), groom: z.boolean().optional(), turnout: z.boolean().optional() });

/** Today's care session (feed, groom, turnout): counted once per local day; a repeat is a no-op. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req, Body);
  if (!b) return badBody("Choose a feed.");
  return act((database, session, now) => careAction(database, session, decodeURIComponent(id), b, now));
}

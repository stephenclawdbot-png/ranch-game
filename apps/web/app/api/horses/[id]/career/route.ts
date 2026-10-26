import { z } from "zod";
import { careerAction } from "@/server/horseLife";
import { act, badBody, body } from "@/server/horseLifeRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["retire", "legacy", "release"]) });

/** Career decisions: retire from racing, move to the Legacy Farm, or release to the Club. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req, Body);
  if (!b) return badBody("Choose retire, Legacy Farm or release.");
  return act((database, session, now) => careerAction(database, session, decodeURIComponent(id), b.action, now));
}

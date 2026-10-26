import { z } from "zod";
import { savePlanAction, trainAction } from "@/server/horseLife";
import { act, badBody, body } from "@/server/horseLifeRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PlanBody = z.object({ slots: z.array(z.string().max(40)).min(3).max(4) });
const SessionBody = z.object({ expectedSession: z.number().int().min(0).max(4).optional() });

/** Saves the weekly plan (free; each session costs credits when it runs). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req, PlanBody);
  if (!b) return badBody("A plan has 3 slots (4 with a Trainer).");
  return act(async (database, session, now) => ({ plan: await savePlanAction(database, session, decodeURIComponent(id), b.slots, now) }));
}

/** Runs the plan's next session now. `expectedSession` makes a double tap a no-op. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req, SessionBody);
  if (!b) return badBody("Something in that request wasn't right.");
  return act((database, session, now) => trainAction(database, session, decodeURIComponent(id), b, now));
}

import { makeJockeyOffer, withdrawJockeyOffer } from "@thoroughbred/db";
import * as gc from "@thoroughbred/game-core";
import { z } from "zod";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson, requireSameOrigin } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OfferBody = z.object({
  wage: z.number().int().nonnegative(),
  length: z.enum(gc.JOCKEY_CONTRACT_LENGTHS),
  promisedRides: z.number().int().nonnegative(),
  buyout: z.number().int().nonnegative(),
});

/** Makes or amends an offer to a free agent in this week's transfer window (the signing fee is escrowed). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = requireSameOrigin(req);
  if (bad) return bad;
  const { id } = await ctx.params;
  const parsed = OfferBody.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  const terms = parsed.data;
  try {
    const database = await db();
    const session = await requireSession(database);
    const offer = await makeJockeyOffer(database, { accountId: session.accountId, jockeyId: decodeURIComponent(id), now: new Date(), terms });
    return json({ ok: true, offer: { wage: offer.wage, length: offer.length, promisedRides: offer.promisedRides, buyout: offer.buyout, fee: offer.fee } });
  } catch (err) {
    return handleError(err);
  }
}

/** Withdraws your open offer (the fee comes back). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = requireSameOrigin(req);
  if (bad) return bad;
  const { id } = await ctx.params;
  try {
    const database = await db();
    const session = await requireSession(database);
    await withdrawJockeyOffer(database, { accountId: session.accountId, jockeyId: decodeURIComponent(id), now: new Date() });
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

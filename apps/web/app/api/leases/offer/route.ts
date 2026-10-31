import { requireUnlocked } from "@/server/guide";
import { z } from "zod";
import * as gc from "@thoroughbred/game-core";
import { leaseView, offerForLease } from "@/server/leasing";
import { IdSchema, parseBody, withPlayer } from "@/server/economyHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  horseId: IdSchema,
  termDays: z.number().int(),
  ownerSharePct: z.number().int().min(0).max(100),
  allowAllOut: z.boolean().default(false),
  maxLiveStartsPerWeek: z.number().int().default(gc.LEASE_WEEKLY_STARTS_DEFAULT),
  minLesseeRating: z.number().int().min(1).max(5).nullable().default(null),
});

/** Offers one of your racing horses for lease (term, your prize share, welfare terms). No upfront fee in the beta. */
export async function POST(req: Request) {
  const body = await parseBody(req, Schema, "Choose a horse, a term and your share of the prizes.");
  if (!body.ok) return body.res;
  return withPlayer(async (db, session, now) => {
    await requireUnlocked(db, session, "leasing", now);
    return { offer: await offerForLease(db, session, body.data, now), view: await leaseView(db, session, now) };
  }, 201);
}

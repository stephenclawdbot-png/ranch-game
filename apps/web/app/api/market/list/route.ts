import { z } from "zod";
import { listForSale, marketView } from "@/server/economy";
import { IdSchema, parseBody, withPlayer } from "@/server/economyHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ horseId: IdSchema, price: z.number().int().positive().max(100_000_000), days: z.number().int().default(7) });

/** Lists one of your horses (price >= 70% of the appraisal; the horse is locked until sold, cancelled or expired). */
export async function POST(req: Request) {
  const body = await parseBody(req, Schema, "Choose a horse and a whole-credit price.");
  if (!body.ok) return body.res;
  return withPlayer(async (db, session, now) => ({ listing: await listForSale(db, session, body.data, now), view: await marketView(db, session, now) }), 201, "market_list");
}

import { z } from "zod";
import { breedingView, coverMare } from "@/server/economy";
import { IdSchema, KeySchema, parseBody, withPlayer } from "@/server/economyHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The breeding barn: your mares and stallions with eligibility, studs, pregnancies, fees. */
export async function GET() {
  return withPlayer((db, session, now) => breedingView(db, session, now));
}

const CoverSchema = z.object({ sireId: IdSchema, damId: IdSchema, key: KeySchema });

/** Covers your mare (base fee + stud fee, 10% of the stud fee burned). Idempotent per key. */
export async function POST(req: Request) {
  const body = await parseBody(req, CoverSchema, "Choose a mare and a stallion.");
  if (!body.ok) return body.res;
  return withPlayer(async (db, session, now) => ({ cover: await coverMare(db, session, body.data, now), view: await breedingView(db, session, now) }), 201);
}

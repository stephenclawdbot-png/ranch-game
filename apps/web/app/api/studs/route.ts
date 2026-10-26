import { z } from "zod";
import { breedingView, MAX_STUD_FEE, standAtStud } from "@/server/economy";
import { IdSchema, parseBody, withPlayer } from "@/server/economyHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The stud book: stallions standing at stud, and your own stallions. */
export async function GET() {
  return withPlayer(async (db, session, now) => {
    const v = await breedingView(db, session, now);
    return { studs: v.studs, mine: v.stallions, baseFee: v.baseFee, studBurnPermille: v.studBurnPermille, maxFee: MAX_STUD_FEE };
  });
}

const Schema = z.object({ horseId: IdSchema, fee: z.number().int().min(0).max(MAX_STUD_FEE).nullable() });

/** Stand your stallion at stud for a fee in credits, or withdraw him (fee: null). */
export async function POST(req: Request) {
  const body = await parseBody(req, Schema, `A stud fee is a whole number of credits (0 to ${MAX_STUD_FEE.toLocaleString("en-GB")}).`);
  if (!body.ok) return body.res;
  return withPlayer(async (db, session, now) => {
    await standAtStud(db, session, body.data);
    return { view: await breedingView(db, session, now) };
  });
}

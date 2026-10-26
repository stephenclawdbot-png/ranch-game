import { z } from "zod";
import { breedingPreview } from "@/server/economy";
import { IdSchema, parseBody, withPlayer } from "@/server/economyHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ sireId: IdSchema, damId: IdSchema });

/** The exact breeding preview (stat ranges, overall, coats, aptitudes, COI, nick) for a pairing. Read-only. */
export async function POST(req: Request) {
  const body = await parseBody(req, Schema, "Choose a mare and a stallion.");
  if (!body.ok) return body.res;
  return withPlayer((db, session, now) => breedingPreview(db, session, body.data, now));
}

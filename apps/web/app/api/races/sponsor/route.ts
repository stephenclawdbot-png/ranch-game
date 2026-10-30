import { z } from "zod";
import { KeySchema, parseBody, withPlayer } from "@/server/economyHttp";
import { sponsorAction, sponsorView } from "@/server/sponsor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The sponsor list for one of your local days (`?date=YYYY-MM-DD`), with prices and your sponsorships. */
export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date");
  return withPlayer((db, session, now) => sponsorView(db, session, now, { date }));
}

const Schema = z.object({ slot: z.number().int().nonnegative(), key: KeySchema });

/** Sponsors a Live card slot (credits burned; one sponsor per slot; idempotent per key). */
export async function POST(req: Request) {
  const body = await parseBody(req, Schema, "Choose a race to sponsor.");
  if (!body.ok) return body.res;
  return withPlayer(async (db, session, now) => ({ result: await sponsorAction(db, session, body.data, now), view: await sponsorView(db, session, now) }), 201);
}

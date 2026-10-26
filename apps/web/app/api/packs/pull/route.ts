import { z } from "zod";
import { packsView, pull } from "@/server/economy";
import { KeySchema, parseBody, withPlayer } from "@/server/economyHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ packType: z.enum(["paddock", "premium"]), free: z.boolean().default(false), key: KeySchema });

/** Pulls a pack (committed seed revealed with the result). Idempotent per key. */
export async function POST(req: Request) {
  const body = await parseBody(req, Schema, "Choose a pack.");
  if (!body.ok) return body.res;
  return withPlayer(async (db, session, now) => ({ result: await pull(db, session, body.data, now), view: await packsView(db, session, now) }), 201);
}

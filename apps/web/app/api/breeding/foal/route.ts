import { z } from "zod";
import { foalAndName, renameFoal } from "@/server/economy";
import { IdSchema, parseBody, withPlayer } from "@/server/economyHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Name = z.string().trim().min(1).max(32);
const FoalSchema = z.object({ pregnancyId: IdSchema, name: Name.optional() });
const RenameSchema = z.object({ horseId: IdSchema, name: Name });

/** Foals a due mare (idempotent) and names the foal. The foal goes to the nursery. */
export async function POST(req: Request) {
  const body = await parseBody(req, FoalSchema, "Names are 1 to 32 characters.");
  if (!body.ok) return body.res;
  return withPlayer((db, session, now) => foalAndName(db, session, body.data, now), 201, "foal");
}

/** Names a foal (only before its first start). */
export async function PATCH(req: Request) {
  const body = await parseBody(req, RenameSchema, "Names are 1 to 32 characters.");
  if (!body.ok) return body.res;
  return withPlayer(async (db, session, now) => ({ foal: await renameFoal(db, session, body.data, now) }));
}

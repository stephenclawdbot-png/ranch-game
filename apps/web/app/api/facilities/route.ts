import { z } from "zod";
import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { facilitiesView, facilityAction } from "@/server/horseLife";
import { act, badBody, body } from "@/server/horseLifeRoute";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stalls, entry office, trainer, vet and stable hand, with their game-core prices. */
export async function GET() {
  try {
    const database = await db();
    return json(await facilitiesView(database, await requireSession(database)));
  } catch (err) {
    return handleError(err);
  }
}

const Body = z.object({ facility: z.enum(["stalls", "entries", "trainer", "vet", "stableHand"]), toLevel: z.number().int().min(1).max(24) });

/** Buys the next level (`toLevel`: the level being bought, so a retry is a no-op). */
export async function POST(req: Request) {
  const b = await body(req, Body);
  if (!b) return badBody("Choose a facility to upgrade.");
  return act((database, session, now) => facilityAction(database, session, b.facility, b.toLevel, now));
}

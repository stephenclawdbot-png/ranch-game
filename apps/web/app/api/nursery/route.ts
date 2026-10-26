import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { nurseryView } from "@/server/horseLife";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Foals growing through care, graduates ready to race, and the nursery overflow slot. */
export async function GET() {
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await nurseryView(database, session, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

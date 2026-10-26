import { db } from "@/server/db";
import { createLinkCodeResponse } from "@/server/devices";
import { handleError } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A one-time code for playing this stable on another device: 8 unambiguous characters,
 * valid 10 minutes, single use. Getting a new code expires the previous unused one.
 */
export async function POST() {
  try {
    const database = await db();
    const session = await requireSession(database);
    return await createLinkCodeResponse(database, session);
  } catch (err) {
    return handleError(err);
  }
}
import { db } from "@/server/db";
import { listDevicesResponse } from "@/server/devices";
import { handleError } from "@/server/http";
import { requireSession, sessionToken } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The account's linked devices (label, created, last seen), the requesting one marked. */
export async function GET() {
  try {
    const database = await db();
    const session = await requireSession(database);
    return await listDevicesResponse(database, session, await sessionToken());
  } catch (err) {
    return handleError(err);
  }
}
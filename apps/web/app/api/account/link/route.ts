import { db } from "@/server/db";
import { clientIp, linkDeviceResponse } from "@/server/devices";
import { handleError, readJson } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Links this device to the stable that shows the code: no session needed, the session cookie
 * is set on success. Works without an existing stable; a browser that already has one in
 * play must confirm with { replace: true }.
 */
export async function POST(req: Request) {
  try {
    const database = await db();
    return await linkDeviceResponse(database, {
      body: await readJson(req),
      ip: clientIp(req),
      session: await getSession(database),
    });
  } catch (err) {
    return handleError(err);
  }
}
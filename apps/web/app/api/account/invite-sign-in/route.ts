import { db } from "@/server/db";
import { clientIp, inviteSignInResponse } from "@/server/devices";
import { handleError, readJson } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Testing phase: the tester's own invite link signs this browser back into their stable
 * (single-use admin codes with a live account only; rate-limited by IP and by code, audited).
 * 404 outside the playtest or without the login-code secret.
 */
export async function POST(req: Request) {
  try {
    const database = await db();
    return await inviteSignInResponse(database, {
      body: await readJson(req),
      ip: clientIp(req),
      session: await getSession(database),
    });
  } catch (err) {
    return handleError(err);
  }
}

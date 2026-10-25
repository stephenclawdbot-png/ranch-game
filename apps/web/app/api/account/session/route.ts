import { json } from "@/server/http";
import { clearSessionCookie } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Forgets this browser's stable (the cookie). There is no way back without the token. */
export async function DELETE() {
  const res = json({ ok: true });
  clearSessionCookie(res);
  return res;
}

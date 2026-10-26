import { checkInvite } from "@thoroughbred/db";
import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { playtestConfig } from "@/server/playtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Closed playtest: is it on, and is this invite code usable? (Read-only; the code is used at signup.) */
export async function GET(req: Request) {
  try {
    const cfg = playtestConfig();
    const code = new URL(req.url).searchParams.get("code");
    if (!cfg.enabled) return json({ playtest: false, ok: true });
    if (!code) return json({ playtest: true, ok: false, problem: "MISSING" });
    const res = await checkInvite(await db(), code.slice(0, 40), cfg.testerCap);
    return json({ playtest: true, ...res });
  } catch (err) {
    return handleError(err);
  }
}

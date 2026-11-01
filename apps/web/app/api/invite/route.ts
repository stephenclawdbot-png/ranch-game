import { checkInvite } from "@thoroughbred/db";
import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { loginCodesEnabled } from "@/server/loginCode";
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
    // Testing phase (login codes on): a tester's own used invite answers SIGN_IN, and /play signs in through the rate-limited route.
    const res = await checkInvite(await db(), code.slice(0, 40), cfg.testerCap, { recovery: loginCodesEnabled() });
    return json({ playtest: true, ...res });
  } catch (err) {
    return handleError(err);
  }
}

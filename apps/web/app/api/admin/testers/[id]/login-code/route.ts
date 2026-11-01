import { testerAccount } from "@thoroughbred/db";
import { adminRoute } from "@/server/adminHttp";
import { errorJson } from "@/server/http";
import { ensureLoginCode } from "@/server/loginCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin support (testing phase): a locked-out tester's permanent login code, to send them
 * privately. The same code the game showed them; derived on the server, never stored in clear.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson(400, "invalid_id");
  return adminRoute(async (db) => {
    const t = await testerAccount(db, id);
    if (!t) return { code: null, reason: "This tester has no stable right now." };
    const code = await ensureLoginCode(db, t.accountId);
    return code ? { code, stableName: t.stableName } : { code: null, reason: "Login codes are off (testing phase only)." };
  });
}

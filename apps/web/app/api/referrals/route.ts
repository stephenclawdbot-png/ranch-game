import { inviteView } from "@/server/chain/affiliates";
import { withChainPlayer } from "@/server/chain/http";
import { trackEvent } from "@/server/playtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your referral link, invitees (2 levels) with activity, earnings and the rules. */
export async function GET(req: Request) {
  const origin = (process.env.PUBLIC_BASE_URL?.trim() || new URL(req.url).origin).replace(/\/$/, "");
  return withChainPlayer(async (ctx, session, now) => {
    await trackEvent(ctx.db, session.accountId, "invite_view");
    return inviteView(ctx.db, ctx.chain, session, { origin, now });
  });
}

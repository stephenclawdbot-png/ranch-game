import { claimOwner } from "@thoroughbred/db";
import { withChainAdmin } from "@/server/chain/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Claim root": makes the game account signed in on THIS browser the owner (root of the
 * affiliate tree). It needs a SIWE-verified wallet (the owner's affiliate wallet).
 */
export async function POST() {
  return withChainAdmin(async (ctx, now) => {
    const session = await requireSession(ctx.db);
    return claimOwner(ctx.db, { accountId: session.accountId, now });
  });
}

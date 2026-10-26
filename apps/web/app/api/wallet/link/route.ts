import { z } from "zod";
import { errorJson, readJson } from "@/server/http";
import { withChainPlayer } from "@/server/chain/http";
import { linkWallet } from "@/server/chain/wallet";
import { trackEvent } from "@/server/playtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ nonce: z.string().regex(/^[A-Za-z0-9]{8,64}$/), signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(4000) });

/** Step 2 of linking: verify the signed message and store the verified wallet (one per stable). */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "The signature is missing." });
  return withChainPlayer(async (ctx, session, now) => {
    const res = await linkWallet(ctx.db, ctx.chain, session, { nonce: parsed.data.nonce, signature: parsed.data.signature as `0x${string}`, now });
    await trackEvent(ctx.db, session.accountId, "wallet_linked", { linked: res.linkedAccounts > 0 });
    return res;
  });
}

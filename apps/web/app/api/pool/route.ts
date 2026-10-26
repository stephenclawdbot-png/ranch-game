import { json } from "@/server/http";
import { chainCtx } from "@/server/chain/context";
import { chainError } from "@/server/chain/http";
import { poolView } from "@/server/chain/pool";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Prize Pool: on-chain balance, this week's standings with projected shares, rules, history. */
export async function GET() {
  try {
    const ctx = await chainCtx();
    const session = await getSession(ctx.db);
    return json(await poolView(ctx, session, new Date()));
  } catch (err) {
    return chainError(err);
  }
}

import { usdgHorseView } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The horse page's USDG panel: requirements checklist, registration, listing state. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson(404, "NOT_FOUND");
  return withUsdgPlayer((c, session, now) => usdgHorseView(c, session, id, now), { tick: true });
}

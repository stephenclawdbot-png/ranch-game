import { packsView } from "@/server/economy";
import { withPlayer } from "@/server/economyHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Packs: published odds, pity counters, weekly limits, free pack progress, the seasonal crop, your pulls. */
export async function GET() {
  return withPlayer((db, session, now) => packsView(db, session, now));
}

import { marketView } from "@/server/economy";
import { withPlayer } from "@/server/economyHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The market: listings, your listings, your horses with floors and locks, seller requirements. */
export async function GET() {
  return withPlayer((db, session, now) => marketView(db, session, now));
}

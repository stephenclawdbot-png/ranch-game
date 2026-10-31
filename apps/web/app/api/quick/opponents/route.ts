import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { matchOpponents } from "@/server/quickRaces";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Other stables' racing horses to challenge: ?q=<horse or stable name> (2+ letters) or ?ids=<id,id>. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const ids = (sp.get("ids") ?? "").split(",").filter((x) => UUID.test(x));
  const q = (sp.get("q") ?? "").slice(0, 40);
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await matchOpponents(database, session, ids.length ? { ids } : { text: q }, new Date()));
  } catch (err) {
    return handleError(err);
  }
}

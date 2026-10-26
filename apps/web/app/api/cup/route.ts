import { db } from "@/server/db";
import { cupView } from "@/server/competition";
import { handleError, json } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Today's Daily Cup: conditions, the fixed field, the seed commitment, the board (top + near you), your run or your horses. */
export async function GET() {
  try {
    const database = await db();
    const session = await getSession(database);
    return json({ cup: await cupView(database, session, new Date()) });
  } catch (err) {
    return handleError(err);
  }
}

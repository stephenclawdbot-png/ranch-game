import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { getSession } from "@/server/session";
import { storyView } from "@/server/story";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Story mode: chapters and their races (won, best horse), licence, rival stables, recent Story results. */
export async function GET() {
  try {
    const database = await db();
    const session = await getSession(database);
    return json({ story: await storyView(database, session, new Date()) });
  } catch (err) {
    return handleError(err);
  }
}

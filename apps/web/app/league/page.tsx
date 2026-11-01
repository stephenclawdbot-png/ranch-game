import type { Metadata } from "next";
import { LeagueScreen } from "@/components/competition/LeagueScreen";
import { leagueView } from "@/server/competition";
import { weekBoard } from "@/server/engage";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "League" };

export default async function LeaguePage() {
  const database = await db();
  const session = await getSession(database);
  const now = new Date();
  const [view, board] = await Promise.all([leagueView(database, session, now), weekBoard(database, session, now, 100).catch(() => null)]);
  return <LeagueScreen view={view} signedIn={!!session} board={board} />;
}

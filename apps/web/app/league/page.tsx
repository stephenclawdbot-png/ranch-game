import type { Metadata } from "next";
import { LeagueScreen } from "@/components/competition/LeagueScreen";
import { leagueView } from "@/server/competition";
import { weekBoard } from "@/server/engage";
import { db } from "@/server/db";
import { dbPage } from "@/server/outage";
import { getSession, hasSessionCookie } from "@/server/session";
import { visitorLeague } from "@/server/visitorViews";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "League" };

export default function LeaguePage() {
  return dbPage("/league", async () => {
    const session = (await hasSessionCookie()) ? await getSession(await db()) : null;
    if (!session) {
      // A visitor reads the shared copy (no database).
      const { view, board } = await visitorLeague();
      return <LeagueScreen view={view} signedIn={false} board={board} />;
    }
    const database = await db();
    const now = new Date();
    const [view, board] = await Promise.all([leagueView(database, session, now), weekBoard(database, session, now, 100).catch(() => null)]);
    return <LeagueScreen view={view} signedIn board={board} />;
  });
}

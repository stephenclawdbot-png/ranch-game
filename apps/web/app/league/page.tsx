import type { Metadata } from "next";
import { LeagueScreen } from "@/components/competition/LeagueScreen";
import { leagueView } from "@/server/competition";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "League" };

export default async function LeaguePage() {
  const database = await db();
  const session = await getSession(database);
  const view = await leagueView(database, session, new Date());
  return <LeagueScreen view={view} signedIn={!!session} />;
}

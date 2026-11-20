import type { Metadata } from "next";
import { HallScreen } from "@/components/competition/HallScreen";
import { hallView } from "@/server/competition";
import { db } from "@/server/db";
import { dbPage } from "@/server/outage";
import { getSession, hasSessionCookie } from "@/server/session";
import { visitorHall } from "@/server/visitorViews";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hall of Fame" };

export default function HallPage() {
  return dbPage("/hall", async () => {
    const session = (await hasSessionCookie()) ? await getSession(await db()) : null;
    // A visitor reads the shared copy (no database); a player's page has their own achievements.
    const view = session ? await hallView(await db(), session, new Date()) : await visitorHall();
    return <HallScreen view={view} />;
  });
}

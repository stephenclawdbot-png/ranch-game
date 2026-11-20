import type { Metadata } from "next";
import { JoinNudge } from "@/components/PlayerGate";
import { FacilitiesBoard } from "@/components/horseLife/FacilitiesBoard";
import { db } from "@/server/db";
import { facilitiesView } from "@/server/horseLife";
import { getSession } from "@/server/session";
import { outagePage } from "@/server/outage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Facilities" };

async function FacilitiesPage() {
  const database = await db();
  const session = await getSession(database);
  if (!session) return <JoinNudge />;
  return <FacilitiesBoard view={await facilitiesView(database, session)} />;
}

// The database unreachable or over quota: the outage page (HTTP 503), not an error page.
export default outagePage("/facilities", FacilitiesPage);

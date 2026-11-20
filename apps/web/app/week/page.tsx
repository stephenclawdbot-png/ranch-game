import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RoadToSaturday } from "@/components/competition/RoadToSaturday";
import { PlannerPanel } from "@/components/planner/PlannerPanel";
import { db } from "@/server/db";
import { getSession } from "@/server/session";
import { stablePlan } from "@/server/social";
import { weekView } from "@/server/week";
import { outagePage } from "@/server/outage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "This week" };

async function WeekPage() {
  const database = await db();
  const session = await getSession(database);
  if (!session) redirect("/play");
  const now = new Date();
  const [view, plan] = await Promise.all([weekView(database, session, now), stablePlan(database, session, now)]);
  return (
    <>
      <RoadToSaturday view={view} />
      <PlannerPanel initial={plan} horses={view.horses.map((h) => ({ id: h.id, name: h.name }))} />
    </>
  );
}

// The database unreachable or over quota: the outage page (HTTP 503), not an error page.
export default outagePage("/week", WeekPage);

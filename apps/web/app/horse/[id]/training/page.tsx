import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TrainingPlanner } from "@/components/horseLife/TrainingPlanner";
import { HorseLifeHeader } from "@/components/horseLife/HorseLifeHeader";
import { db } from "@/server/db";
import { horseLifeView } from "@/server/horseLife";
import { getSession } from "@/server/session";
import { outagePage } from "@/server/outage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Training" };

async function HorseTrainingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const session = await getSession(database);
  const view = session ? await horseLifeView(database, session, id, new Date()) : null;
  // Only the owner has these tabs; everyone else sees the public horse page.
  if (!view) redirect(`/horse/${encodeURIComponent(id)}`);
  return (
    <div className="grid gap-5">
      <HorseLifeHeader view={view} active="training" />
      <TrainingPlanner view={view} />
    </div>
  );
}

// The database unreachable or over quota: the outage page (HTTP 503), not an error page.
export default outagePage("/horse/[id]/training", HorseTrainingPage);

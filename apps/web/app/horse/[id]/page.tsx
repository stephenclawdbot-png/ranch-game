import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HorseDetail } from "@/components/horse/HorseDetail";
import { HorseTabs } from "@/components/horseLife/HorseTabs";
import { MomentHighlights } from "@/components/moments/MomentHighlights";
import { PlannerPanel } from "@/components/planner/PlannerPanel";
import { db } from "@/server/db";
import { horseDetail } from "@/server/game";
import { horseHighlights } from "@/server/moments";
import { getSession } from "@/server/session";
import { stablePlan } from "@/server/social";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const database = await db();
  const session = await getSession(database);
  const now = new Date();
  const view = await horseDetail(database, id, session, now);
  if (!view) return null;
  // the owner's one-time highlights: discoveries and milestones since they last looked
  const highlights = view.owned || view.mine ? await horseHighlights(database, session, view.horse.id) : [];
  // the campaign plan: the keeper's targets for this horse (racing horses only)
  const plan = view.mine && session && view.status?.careerStatus === "racing" ? await stablePlan(database, session, now, view.horse.id) : null;
  return { ...view, highlights, plan };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const view = await load((await params).id);
  return { title: view?.horse.name ?? "Horse not found" };
}

export default async function HorsePage({ params }: { params: Promise<{ id: string }> }) {
  const view = await load((await params).id);
  if (!view) notFound();
  const highlights = view.highlights.length ? <MomentHighlights moments={view.highlights} horseId={view.horse.id} /> : null;
  return (
    <HorseDetail
      view={view}
      planner={view.plan ? <PlannerPanel initial={view.plan} horses={[{ id: view.horse.id, name: view.horse.name }]} horseId={view.horse.id} /> : undefined}
      tabs={
        view.mine || highlights ? (
          <>
            {view.mine && <HorseTabs id={view.horse.id} active="overview" />}
            {highlights}
          </>
        ) : undefined
      }
    />
  );
}

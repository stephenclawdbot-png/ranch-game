import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HorseDetail } from "@/components/horse/HorseDetail";
import { HorseTabs } from "@/components/horseLife/HorseTabs";
import { MomentHighlights } from "@/components/moments/MomentHighlights";
import { db } from "@/server/db";
import { horseDetail } from "@/server/game";
import { horseHighlights } from "@/server/moments";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const database = await db();
  const session = await getSession(database);
  const view = await horseDetail(database, id, session, new Date());
  // the owner's one-time highlights: discoveries and milestones since they last looked
  return view ? { ...view, highlights: view.owned || view.mine ? await horseHighlights(database, session, view.horse.id) : [] } : null;
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

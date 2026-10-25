import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RaceExperience } from "@/components/race/RaceExperience";
import type { RaceCard } from "@/lib/types";
import { db } from "@/server/db";
import { RaceNotFoundError } from "@/server/errors";
import { raceCard } from "@/server/game";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

async function load(id: string): Promise<RaceCard | null> {
  try {
    const database = await db();
    const session = await getSession(database);
    return await raceCard(database, decodeURIComponent(id), new Date(), session?.stable.id ?? null);
  } catch (err) {
    if (err instanceof RaceNotFoundError) return null;
    throw err;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const card = await load((await params).id);
  return { title: card ? card.config.name : "Race not found" };
}

export default async function RacePage({ params }: { params: Promise<{ id: string }> }) {
  const card = await load((await params).id);
  if (!card) notFound();
  return <RaceExperience card={card} serverNowMs={Date.now()} />;
}

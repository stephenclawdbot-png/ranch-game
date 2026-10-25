import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RaceExperience } from "@/components/race/RaceExperience";
import { raceRepository } from "@/server/repository";
import { RaceNotFoundError, type RaceCard } from "@/server/races";

export const dynamic = "force-dynamic";

async function load(id: string): Promise<RaceCard | null> {
  try {
    return await raceRepository().getRace(decodeURIComponent(id), Date.now());
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

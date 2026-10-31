import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RaceExperience } from "@/components/race/RaceExperience";
import type { RaceCard } from "@/lib/types";
import { db } from "@/server/db";
import { RaceNotFoundError } from "@/server/errors";
import { raceCard, replayStartFor } from "@/server/game";
import { publicSiteHost } from "@/server/publicUrl";
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

export default async function RacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const at = Array.isArray(sp.at) ? sp.at[0] : sp.at;
  const card = await load(id);
  if (!card) notFound();
  // ?at= only applies once the race is over (replayStartFor checks the broadcast clock);
  // a live or upcoming race ignores it, so a shared link never spoils the result.
  const initialTimeSec = at != null && card.status === "finished" ? await replayStartFor(await db(), card.id, at, new Date()) : undefined;
  return <RaceExperience card={card} serverNowMs={Date.now()} initialTimeSec={initialTimeSec} siteHost={publicSiteHost()} />;
}
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { RaceExperience } from "@/components/race/RaceExperience";
import type { RaceCard } from "@/lib/types";
import { db } from "@/server/db";
import { RaceNotFoundError } from "@/server/errors";
import { raceCard, replayStartFor } from "@/server/game";
import { dbPage } from "@/server/outage";
import { publicSiteHost } from "@/server/publicUrl";
import { getSession, hasSessionCookie } from "@/server/session";
import { visitorRaceCard, visitorReplayStart } from "@/server/visitorViews";

export const dynamic = "force-dynamic";

/**
 * The card, once per request (the page and its metadata share it). A visitor gets the kept copy
 * of a finished race (no database); a race that is still to run or running, and everything a
 * signed-in player sees, is computed now.
 */
const load = cache(async (id: string): Promise<{ card: RaceCard | null; visitor: boolean }> => {
  try {
    const session = (await hasSessionCookie()) ? await getSession(await db()) : null;
    if (!session) return { card: await visitorRaceCard(decodeURIComponent(id)), visitor: true };
    return { card: await raceCard(await db(), decodeURIComponent(id), new Date(), session.stable.id), visitor: false };
  } catch (err) {
    if (err instanceof RaceNotFoundError) return { card: null, visitor: false };
    throw err;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { card } = await dbPage(`/race/${id}`, () => load(id));
  return { title: card ? card.config.name : "Race not found" };
}

export default async function RacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const at = Array.isArray(sp.at) ? sp.at[0] : sp.at;
  const { card, visitor } = await dbPage(`/race/${id}`, () => load(id));
  if (!card) notFound();
  // ?at= only applies once the race is over (replayStartFor checks the broadcast clock);
  // a live or upcoming race ignores it, so a shared link never spoils the result.
  const initialTimeSec =
    at != null && card.status === "finished"
      ? await dbPage(`/race/${id}`, async () => (visitor ? ((await visitorReplayStart(card.id, at.slice(0, 16))) ?? undefined) : replayStartFor(await db(), card.id, at, new Date())))
      : undefined;
  return <RaceExperience card={card} serverNowMs={Date.now()} initialTimeSec={initialTimeSec} siteHost={publicSiteHost()} />;
}
import { AutoRefresh } from "@/components/AutoRefresh";
import { HomeView } from "@/components/home/HomeView";
import type { RaceSummary } from "@/lib/types";
import { db } from "@/server/db";
import { raceList } from "@/server/game";
import { orWhenDown } from "@/server/outage";
import { getSession, hasSessionCookie } from "@/server/session";
import { playtestConfig } from "@/server/playtest";
import { visitorRaceLists } from "@/server/visitorViews";

export const dynamic = "force-dynamic";

interface HomeLists {
  next: RaceSummary | null;
  live: RaceSummary | null;
  recent: RaceSummary[];
}

const NOTHING: HomeLists = { next: null, live: null, recent: [] };

/** A visitor's landing page: the race card from the shared copy, so a visit never reaches the database. */
async function visitorLists(now: Date): Promise<HomeLists> {
  const v = await visitorRaceLists(now);
  return { next: v.upcoming[0] ?? null, live: v.live, recent: v.recent.slice(0, 6) };
}

/** A signed-in player's Home: the card as it is this second. */
async function playerLists(now: Date): Promise<HomeLists | null> {
  const database = await db();
  const session = await getSession(database);
  if (!session) return null;
  const { upcoming, recent } = await raceList(database, now, session.stable.id);
  return { next: upcoming[0] ?? null, live: recent.find((r) => r.phase === "live") ?? null, recent };
}

export default async function HomePage() {
  const now = new Date();
  // Home never fails for want of the database: the landing page (and the yard's frame) render
  // without the race card; a signed-in player's own data then reports the outage (OutageOverlay).
  const lists =
    ((await hasSessionCookie()) ? await orWhenDown(() => playerLists(now), null, "/") : null) ??
    (await orWhenDown(() => visitorLists(now), NOTHING, "/").catch((err: unknown) => {
      console.error("[home] race card unavailable", err);
      return NOTHING;
    }));
  const { next, live, recent } = lists;
  // A live race has no public end time (it would reveal the result): re-check every 10 s.
  const nextChange = Math.min(next?.postTimeMs ?? Infinity, live ? now.getTime() + 10_000 : Infinity);
  return (
    <>
      <AutoRefresh atMs={Number.isFinite(nextChange) ? nextChange : null} serverNowMs={now.getTime()} />
      <HomeView next={next} live={live} recent={recent} inviteOnly={playtestConfig().enabled} />
    </>
  );
}

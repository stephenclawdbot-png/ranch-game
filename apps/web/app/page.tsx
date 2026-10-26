import { AutoRefresh } from "@/components/AutoRefresh";
import { HomeView } from "@/components/home/HomeView";
import { db } from "@/server/db";
import { raceList } from "@/server/game";
import { getSession } from "@/server/session";
import { playtestConfig } from "@/server/playtest";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const now = new Date();
  const database = await db();
  const session = await getSession(database);
  const { upcoming, recent } = await raceList(database, now, session?.stable.id ?? null);
  const live = recent.find((r) => r.phase === "live") ?? null;
  const next = upcoming[0] ?? null;
  // A live race has no public end time (it would reveal the result): re-check every 10 s.
  const nextChange = Math.min(next?.postTimeMs ?? Infinity, live ? now.getTime() + 10_000 : Infinity);
  return (
    <>
      <AutoRefresh atMs={Number.isFinite(nextChange) ? nextChange : null} serverNowMs={now.getTime()} />
      <HomeView next={next} live={live} recent={recent} inviteOnly={playtestConfig().enabled} />
    </>
  );
}

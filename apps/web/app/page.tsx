import { AutoRefresh } from "@/components/AutoRefresh";
import { HomeView } from "@/components/home/HomeView";
import { raceRepository } from "@/server/repository";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const now = Date.now();
  const { upcoming, recent } = await raceRepository().listRaces(now);
  const live = recent.find((r) => r.phase === "live") ?? null;
  const next = upcoming[0]!;
  // A live race has no public end time (it would reveal the result): re-check every 10 s.
  const nextChange = Math.min(next.postTimeMs, live ? now + 10_000 : Infinity);
  return (
    <>
      <AutoRefresh atMs={nextChange} serverNowMs={now} />
      <HomeView next={next} live={live} recent={recent} />
    </>
  );
}

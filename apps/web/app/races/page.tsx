import type { Metadata } from "next";
import { AutoRefresh } from "@/components/AutoRefresh";
import { QuickRacePanel } from "@/components/QuickRacePanel";
import { RaceBoard, RecentRaceRow, UpcomingRaceRow } from "@/components/RaceList";
import { raceRepository } from "@/server/repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Races" };

export default async function RacesPage() {
  const now = Date.now();
  const { upcoming, recent } = await raceRepository().listRaces(now);
  // A live race has no public end time (it would reveal the result): re-check every 10 s while one runs.
  const nextChange = Math.min(upcoming[0]?.postTimeMs ?? Infinity, recent.some((r) => r.phase === "live") ? now + 10_000 : Infinity);

  return (
    <div className="grid gap-8">
      <AutoRefresh atMs={Number.isFinite(nextChange) ? nextChange : null} serverNowMs={now} />
      <section id="quick" className="grid scroll-mt-20 gap-3" aria-labelledby="quick-h">
        <div>
          <h1 id="quick-h" className="t-display-xl">
            Quick race
          </h1>
          <p className="mt-1 max-w-2xl text-lg text-cream-dim">Pick a runner and a plan. The gates open ten seconds after you enter.</p>
        </div>
        <QuickRacePanel />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <RaceBoard title="Club card today" note="A race every 3 minutes · watch any of them">
          {upcoming.map((r) => (
            <UpcomingRaceRow key={r.id} race={r} />
          ))}
        </RaceBoard>
        <RaceBoard title="Results" note="Every replay is sealed and reproducible">
          {recent.map((r) => (
            <RecentRaceRow key={r.id} race={r} />
          ))}
        </RaceBoard>
      </div>
    </div>
  );
}

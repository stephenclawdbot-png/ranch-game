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
          <p className="eyebrow">Story · club races</p>
          <h1 id="quick-h" className="t-display-xl">
            Races
          </h1>
          <p className="mt-1 max-w-2xl text-lg text-cream-dim">
            Story races pit your horses against the club&rsquo;s rival stables, whenever you like.
          </p>
        </div>
        <QuickRacePanel />
      </section>

      <section id="live" className="grid scroll-mt-20 gap-3" aria-labelledby="live-h">
        <div>
          <h2 id="live-h" className="t-display-l">
            Live races
          </h2>
          <p className="mt-1 max-w-2xl text-cream-dim">
            A shared race every 3 minutes, live for everyone at once. Watch any of them; entering your own horses opens soon.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <RaceBoard title="Coming up" note="Watch any of them">
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
      </section>
    </div>
  );
}

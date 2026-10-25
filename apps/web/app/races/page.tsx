import type { Metadata } from "next";
import { AutoRefresh } from "@/components/AutoRefresh";
import { QuickRacePanel } from "@/components/QuickRacePanel";
import { RaceBoard, RecentRaceRow, UpcomingRaceRow } from "@/components/RaceList";
import { SceneHero } from "@/components/pixel/SceneBackdrop";
import { raceRepository } from "@/server/repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Races" };

export default async function RacesPage() {
  const now = Date.now();
  const repo = raceRepository();
  const { upcoming, recent } = await repo.listRaces(now);
  const feature = upcoming[0] ? await repo.getRace(upcoming[0].id, now).catch(() => null) : null;
  // A live race has no public end time (it would reveal the result): re-check every 10 s while one runs.
  const nextChange = Math.min(upcoming[0]?.postTimeMs ?? Infinity, recent.some((r) => r.phase === "live") ? now + 10_000 : Infinity);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:gap-8">
      <AutoRefresh atMs={Number.isFinite(nextChange) ? nextChange : null} serverNowMs={now} />
      <section id="quick" className="grid min-w-0 scroll-mt-24 gap-3">
        <SceneHero variant="grandstand" overlay={false} runner={feature?.field[0]?.horse.appearance} height="min-h-[10rem] sm:min-h-[11rem] md:min-h-[12rem]">
          <div>
          <p className="eyebrow">Quick race</p>
          <h1 className="display mt-1 text-[1.9rem] sm:text-[2.6rem]">Send one to the gates</h1>
          <p className="mt-1 max-w-2xl text-sm text-cream-dim">
            Pick a runner and tell the jockey how to ride. The race is drawn, sealed with a seed commitment and off in ten seconds.
          </p>
          </div>
        </SceneHero>
        <QuickRacePanel />
      </section>

      <section className="grid min-w-0 gap-5 lg:grid-cols-2">
        <RaceBoard title="On the card" icon="stopwatch" note="A race every 3 minutes">
          {upcoming.map((r) => (
            <UpcomingRaceRow key={r.id} race={r} />
          ))}
        </RaceBoard>
        <RaceBoard title="Results" icon="trophy" note="Every replay is reproducible">
          {recent.map((r) => (
            <RecentRaceRow key={r.id} race={r} />
          ))}
        </RaceBoard>
      </section>
    </div>
  );
}

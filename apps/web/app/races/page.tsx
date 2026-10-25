import type { Metadata } from "next";
import { AutoRefresh } from "@/components/AutoRefresh";
import { QuickRacePanel } from "@/components/QuickRacePanel";
import { RecentRaceRow, UpcomingRaceRow } from "@/components/RaceList";
import { raceRepository } from "@/server/repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Races" };

export default async function RacesPage() {
  const now = Date.now();
  const { upcoming, recent } = await raceRepository().listRaces(now);
  const nextChange = Math.min(upcoming[0]?.postTimeMs ?? Infinity, ...recent.filter((r) => r.phase === "live").map((r) => r.endsAtMs ?? Infinity));

  return (
    <div className="grid gap-10">
      <AutoRefresh atMs={Number.isFinite(nextChange) ? nextChange : null} serverNowMs={now} />
      <section id="quick" className="scroll-mt-24">
        <header className="mb-4">
          <p className="eyebrow">Quick race</p>
          <h1 className="display mt-1 text-3xl font-semibold sm:text-4xl">Send one to the gates</h1>
          <p className="mt-2 max-w-2xl text-cream-dim">
            Pick a runner and tell the jockey how to ride. The race is drawn, sealed with a seed commitment and off in ten seconds.
          </p>
        </header>
        <QuickRacePanel />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <header className="mb-3 flex items-baseline justify-between">
            <h2 className="display text-2xl font-semibold">On the card</h2>
            <p className="text-xs text-sage">A race every 3 minutes</p>
          </header>
          <ul className="panel divide-y divide-cream/5 p-1.5">
            {upcoming.map((r) => (
              <UpcomingRaceRow key={r.id} race={r} />
            ))}
          </ul>
        </div>
        <div>
          <header className="mb-3 flex items-baseline justify-between">
            <h2 className="display text-2xl font-semibold">Results</h2>
            <p className="text-xs text-sage">Every replay is reproducible</p>
          </header>
          <ul className="panel divide-y divide-cream/5 p-1.5">
            {recent.map((r) => (
              <RecentRaceRow key={r.id} race={r} />
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

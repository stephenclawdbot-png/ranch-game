import type { Metadata } from "next";
import { AutoRefresh } from "@/components/AutoRefresh";
import { QuickRacePanel } from "@/components/QuickRacePanel";
import { EmptyState, HowItWorks, SceneBand, Section } from "@/components/ui/Page";
import { LivePickBar, RaceBoard, RecentRaceRow, UpcomingRaceRow } from "@/components/RaceList";
import { db } from "@/server/db";
import { raceList } from "@/server/game";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Race card · Kestrel Downs" };

export default async function RacesPage() {
  const now = new Date();
  const nowMs = now.getTime();
  const database = await db();
  const session = await getSession(database);
  const { upcoming, recent } = await raceList(database, now, session?.stable.id ?? null, { upcoming: 8 });
  // Refresh when the next field locks or goes off; every 10 s while one is live (no public end time).
  const marks = upcoming.flatMap((r) => [r.entriesCloseAtMs, r.postTimeMs]).filter((t) => t > nowMs);
  const nextChange = Math.min(...marks, recent.some((r) => r.phase === "live") ? nowMs + 10_000 : Infinity);

  return (
    <div>
      <AutoRefresh atMs={Number.isFinite(nextChange) ? nextChange : null} serverNowMs={nowMs} />
      <SceneBand scene="grandstand" alt="The grandstand at Kestrel Downs" eyebrow="Kestrel Downs · every 15 minutes" title="Race card" testId="races-band" />
      <section id="live" className="scroll-mt-20" aria-label="Live races">
        <LivePickBar />
        <HowItWorks className="mt-3">
          <p>A Live race goes off every 15 minutes, and everyone watches the same race at the same time. The card is published hours ahead: enter now for a race later today.</p>
          <p>Enter your horses until 30 seconds before the off (one stable entry each; you get +10 at local midnight). The Club fills any empty gates with its own horses.</p>
          <p>Every result is sealed before the off and can be replayed and verified afterwards.</p>
        </HowItWorks>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <RaceBoard title="Coming up" note="Entries close 30 seconds before the off">
            {upcoming.map((r) => (
              <UpcomingRaceRow key={r.id} race={r} alsoAt={r.alsoAt} />
            ))}
          </RaceBoard>
          {recent.length ? (
            <RaceBoard title="Results">
              {recent.map((r) => (
                <RecentRaceRow key={r.id} race={r} />
              ))}
            </RaceBoard>
          ) : (
            <section className="min-w-0">
              <h2 className="t-h2 mb-3">Results</h2>
              <EmptyState icon="stopwatch" title="No results yet today" text="A race goes off every 15 minutes at Kestrel Downs. Watch the next one from the card." />
            </section>
          )}
        </div>
      </section>

      <Section id="story" title="Race the Club now" href="/story" linkLabel="Story chapters" className="scroll-mt-20">
        <p className="t-meta -mt-1 mb-3">Solo Story races against rival stables. Free, and you can skip to the result.</p>
        <QuickRacePanel />
      </Section>
    </div>
  );
}

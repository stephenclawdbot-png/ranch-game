import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { QuickRacePanel } from "@/components/QuickRacePanel";
import { EmptyState, HowItWorks, SceneBand, Section } from "@/components/ui/Page";
import { LivePickBar, RaceBoard, RecentRaceRow, UpcomingCard } from "@/components/RaceList";
import { MEETING_RACE_SPACING_MS, MEETING_START_TIMES_UTC, MEETINGS_PER_DAY, RACES_PER_MEETING } from "@thoroughbred/game-core";
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
  // the whole published card: a day of race meetings (sister courses included)
  const { upcoming, recent } = await raceList(database, now, session?.stable.id ?? null, { upcoming: 120 });
  // Refresh when the next field locks or goes off; every 10 s while one is live (no public end time).
  const marks = upcoming.flatMap((r) => [r.entriesCloseAtMs, r.postTimeMs]).filter((t) => t > nowMs);
  const nextChange = Math.min(...marks, recent.some((r) => r.phase === "live") ? nowMs + 10_000 : Infinity);

  return (
    <div>
      <AutoRefresh atMs={Number.isFinite(nextChange) ? nextChange : null} serverNowMs={nowMs} />
      <SceneBand scene="grandstand" alt="The grandstand at Kestrel Downs" eyebrow={`Kestrel Downs · ${MEETINGS_PER_DAY} race meetings a day`} title="Race card" testId="races-band" />
      <section id="live" className="scroll-mt-20" aria-label="Live races">
        <LivePickBar />
        <HowItWorks className="mt-3">
          <p>
            Live races run in race meetings: {MEETINGS_PER_DAY} a day, from {MEETING_START_TIMES_UTC.join(", ")} UTC, {RACES_PER_MEETING} races {MEETING_RACE_SPACING_MS / 60_000} minutes apart. Everyone watches
            the same race at the same time. The card is published a day ahead: enter now for any meeting before your next visit, and look for the races other stables have entered.
          </p>
          <p>
            Enter your horses until 30 seconds before the off (one stable entry each; you get +10 at local midnight). Then the Club fills the empty gates with its own horses; an
            ordinary race no stable entered is called off.
          </p>
          <p>Every result is sealed before the off and can be replayed and verified afterwards.</p>
        </HowItWorks>
        {session && (
          <p className="mt-3">
            <Link href="/races/sponsor" className="btn btn-sm" data-testid="sponsor-entry">
              Sponsor a race
            </Link>{" "}
            <span className="t-meta">Put your stable&rsquo;s name on a race this week.</span>
          </p>
        )}
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <UpcomingCard races={upcoming} note="Entries close 30 seconds before the off" />
          {recent.length ? (
            <RaceBoard title="Results">
              {recent.map((r) => (
                <RecentRaceRow key={r.id} race={r} />
              ))}
            </RaceBoard>
          ) : (
            <section className="min-w-0">
              <h2 className="t-h2 mb-3">Results</h2>
              <EmptyState icon="stopwatch" title="No results yet today" text="The next race meeting is on the card. Enter a horse, or come back to watch it live." />
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

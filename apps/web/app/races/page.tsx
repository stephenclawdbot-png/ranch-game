import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { QuickRacePanel } from "@/components/QuickRacePanel";
import { LivePickBar, RaceBoard, RecentRaceRow, UpcomingRaceRow } from "@/components/RaceList";
import { db } from "@/server/db";
import { raceList } from "@/server/game";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Races" };

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
    <div className="grid gap-8">
      <AutoRefresh atMs={Number.isFinite(nextChange) ? nextChange : null} serverNowMs={nowMs} />
      <section id="live" className="grid scroll-mt-20 gap-3" aria-labelledby="live-h">
        <div>
          <p className="eyebrow">Live · the shared race card</p>
          <h1 id="live-h" className="t-display-xl">
            Races
          </h1>
          <p className="mt-1 max-w-2xl text-lg text-cream-dim">
            A race every 3 minutes, live for everyone at once. Enter your horses until a minute before the off; the Club fills empty gates.
          </p>
        </div>
        <LivePickBar />
        <div className="grid gap-6 lg:grid-cols-2">
          <RaceBoard title="Coming up" note="Entries close 1 minute before the off">
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

      <section id="story" className="grid scroll-mt-20 gap-3" aria-labelledby="story-h">
        <div>
          <p className="eyebrow">Story · club races</p>
          <h2 id="story-h" className="t-display-l">
            Story races
          </h2>
          <p className="mt-1 max-w-2xl text-cream-dim">
            Solo races against the Club&rsquo;s rival stables, whenever you like. Free to enter: no stable entries used. Watch, or skip to the result.
          </p>
          <Link href="/story" className="mt-2 inline-flex min-h-11 items-center font-bold underline decoration-2 underline-offset-4 hover:text-cream" data-testid="story-chapters-link">
            Story chapters, rivals and licences ›
          </Link>
        </div>
        <QuickRacePanel />
      </section>
    </div>
  );
}

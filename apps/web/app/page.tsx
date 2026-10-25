import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Countdown } from "@/components/Countdown";
import { PaddockStable } from "@/components/PaddockStable";
import { RecentRaceRow, UpcomingRaceRow } from "@/components/RaceList";
import { RaceMetaChips } from "@/components/RaceMeta";
import { SilksIcon } from "@/components/Silks";
import { ArrowIcon, ClockIcon } from "@/components/icons";
import { formatClock, formatCredits } from "@/lib/format";
import { raceRepository } from "@/server/repository";

export const dynamic = "force-dynamic";

export default async function PaddockPage() {
  const now = Date.now();
  const repo = raceRepository();
  const { upcoming, recent } = await repo.listRaces(now);
  const live = recent.find((r) => r.phase === "live");
  const next = upcoming[0]!;
  const nextCard = await repo.getRace(next.id, now);
  const nextChange = Math.min(next.postTimeMs, live?.endsAtMs ?? Infinity);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <AutoRefresh atMs={nextChange} serverNowMs={now} />
      <header>
        <p className="eyebrow">The Paddock</p>
        <h1 className="display mt-1 text-3xl font-semibold sm:text-4xl">Good racing today.</h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="panel relative overflow-hidden p-5 sm:p-7" aria-labelledby="next-h" data-testid="next-race">
          <div
            className="pointer-events-none absolute inset-0 opacity-50"
            style={{ background: "radial-gradient(600px 300px at 90% 0%, rgba(201,162,74,.16), transparent 70%), repeating-linear-gradient(100deg, rgba(43,101,72,.10) 0 70px, transparent 70px 140px)" }}
            aria-hidden
          />
          <div className="relative grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="min-w-0">
              <p className="eyebrow flex items-center gap-1.5">
                <ClockIcon className="h-3.5 w-3.5" /> Next off · {formatClock(next.postTimeMs)}
              </p>
              <h2 id="next-h" className="display mt-2 text-3xl font-semibold leading-tight sm:text-[2.6rem]">
                {next.name}
              </h2>
              <div className="mt-3">
                <RaceMetaChips race={next} showPurse />
              </div>
            </div>
            <div className="sm:text-right">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-sage">Off in</p>
              <p className="display text-5xl font-semibold text-cream sm:text-6xl">
                <Countdown targetMs={next.postTimeMs} doneLabel="Off!" />
              </p>
            </div>
          </div>
          <div className="relative mt-6 flex flex-col gap-4 border-t border-cream/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex shrink-0 -space-x-2">
                {nextCard.field.slice(0, 7).map((e) => (
                  <SilksIcon key={e.horse.id} silks={e.horse.appearance.silks} className="h-8 w-8 border-2 border-turf-850" />
                ))}
                {nextCard.field.length > 7 && (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-turf-850 bg-turf-700 text-[0.65rem] font-semibold text-cream">
                    +{nextCard.field.length - 7}
                  </span>
                )}
              </div>
              <p className="text-xs text-sage">{nextCard.field.length} runners declared</p>
            </div>
            <div className="flex gap-2">
              <Link href={`/race/${next.id}`} className="btn btn-brass" data-testid="watch-next">
                Watch live <ArrowIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>
          {live && (
            <Link
              href={`/race/${live.id}`}
              className="relative mt-4 flex items-center gap-3 rounded-xl border border-[#e5584a]/25 bg-[#e5584a]/10 px-4 py-2.5 text-sm hover:border-[#e5584a]/50"
            >
              <span className="live-dot shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                <strong className="font-semibold">Running now:</strong> {live.name}
              </span>
              <span className="shrink-0 font-semibold text-[#f3a197]">Join</span>
            </Link>
          )}
        </section>
        <PaddockStable />
      </div>

      <Link
        href="/races#quick"
        className="panel group flex items-center gap-4 overflow-hidden p-5 transition-colors hover:border-brass/40 sm:p-6"
        data-testid="quick-cta"
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-brass-bright to-brass text-ink">
          <ArrowIcon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="display text-xl font-semibold">Quick race</p>
          <p className="text-sm text-cream-dim">Pick a runner and a riding plan — the gates open ten seconds later. Purses up to {formatCredits(8000)} credits.</p>
        </div>
        <ArrowIcon className="hidden h-5 w-5 text-sage transition-transform group-hover:translate-x-1 group-hover:text-brass sm:block" />
      </Link>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="display text-2xl font-semibold">On the card</h2>
            <Link href="/races" className="text-xs text-sage hover:text-cream">All races</Link>
          </div>
          <ul className="panel divide-y divide-cream/5 p-1.5">
            {upcoming.slice(1).map((r) => (
              <UpcomingRaceRow key={r.id} race={r} />
            ))}
          </ul>
        </section>
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="display text-2xl font-semibold">Recent results</h2>
          </div>
          <ul className="panel divide-y divide-cream/5 p-1.5">
            {recent.slice(0, 4).map((r) => (
              <RecentRaceRow key={r.id} race={r} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

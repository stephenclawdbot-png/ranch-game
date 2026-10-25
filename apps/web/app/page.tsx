import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Countdown } from "@/components/Countdown";
import { PaddockStable } from "@/components/PaddockStable";
import { RaceBoard, RecentRaceRow, UpcomingRaceRow } from "@/components/RaceList";
import { RaceMetaChips } from "@/components/RaceMeta";
import { SilksIcon } from "@/components/Silks";
import { ArrowIcon, PixelIcon } from "@/components/icons";
import { SceneHero } from "@/components/pixel/SceneBackdrop";
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:gap-7">
      <AutoRefresh atMs={nextChange} serverNowMs={now} />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="grid gap-3" data-testid="next-race">
          <SceneHero variant="paddock" runner={nextCard.field[0]?.horse.appearance} overlay={false} height="min-h-[10rem] sm:min-h-[11rem] md:min-h-[12rem]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="eyebrow flex items-center gap-1.5">
                  <PixelIcon name="stopwatch" className="h-4 w-4" /> Next off · {formatClock(next.postTimeMs)}
                </p>
                <h1 className="display mt-1 text-[1.9rem] leading-[1.05] sm:text-[2.6rem]">{next.name}</h1>
                <div className="mt-2">
                  <RaceMetaChips race={next} showPurse />
                </div>
              </div>
              <div className="px-screen hidden shrink-0 px-3 py-1 text-center sm:block">
                <p className="eyebrow !text-[8px] !text-sage">Off in</p>
                <p className="text-5xl leading-none text-brass-bright [text-shadow:0_3px_0_#000]">
                  <Countdown targetMs={next.postTimeMs} doneLabel="Off!" animate />
                </p>
              </div>
            </div>
          </SceneHero>

          <div className="px-panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="px-screen shrink-0 px-2 py-0.5 text-center sm:hidden">
                <p className="eyebrow !text-[8px] !text-sage">Off in</p>
                <p className="text-3xl leading-none text-brass-bright">
                  <Countdown targetMs={next.postTimeMs} doneLabel="Off!" animate />
                </p>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap gap-1">
                  {nextCard.field.slice(0, 8).map((e) => (
                    <SilksIcon key={e.horse.id} silks={e.horse.appearance.silks} className="h-8 w-8" />
                  ))}
                  {nextCard.field.length > 8 && (
                    <span className="chip num h-8 !px-1.5 text-sm text-cream">+{nextCard.field.length - 8}</span>
                  )}
                </div>
                <p className="label mt-1">{nextCard.field.length} runners declared</p>
              </div>
            </div>
            <Link href={`/race/${next.id}`} className="btn btn-brass btn-lg shrink-0" data-testid="watch-next">
              <PixelIcon name="play" className="h-4 w-4" /> Watch live
            </Link>
          </div>

          {live && (
            <Link href={`/race/${live.id}`} className="px-oxblood flex items-center gap-3 px-3 py-2 text-sm hover:brightness-110">
              <span className="live-dot shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                <strong className="display font-normal">Running now:</strong> {live.name}
              </span>
              <span className="display shrink-0 text-brass-bright">Join ›</span>
            </Link>
          )}
        </div>
        <PaddockStable />
      </div>

      <Link href="/races#quick" className="px-panel group flex items-center gap-4 overflow-hidden p-3 sm:p-4" data-testid="quick-cta">
        <div className="px-plate flex h-14 w-14 shrink-0 items-center justify-center !border-[6px]">
          <PixelIcon name="flag" className="h-9 w-9 group-hover:animate-bob" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="display text-2xl">Quick race</p>
          <p className="text-sm text-cream-dim">
            Pick a runner and a riding plan — the gates open ten seconds later. Purses up to{" "}
            <span className="num text-brass-bright">{formatCredits(8000)}</span> credits.
          </p>
        </div>
        <ArrowIcon className="hidden h-4 w-4 text-sage transition-transform group-hover:translate-x-1 group-hover:text-brass sm:block" />
        <div className="sheen" aria-hidden />
      </Link>

      <div className="grid gap-5 lg:grid-cols-2">
        <RaceBoard title="On the card" icon="stopwatch" href="/races" hrefLabel="All races">
          {upcoming.slice(1).map((r) => (
            <UpcomingRaceRow key={r.id} race={r} />
          ))}
        </RaceBoard>
        <RaceBoard title="Recent results" icon="trophy">
          {recent.slice(0, 4).map((r) => (
            <RecentRaceRow key={r.id} race={r} />
          ))}
        </RaceBoard>
      </div>
    </div>
  );
}

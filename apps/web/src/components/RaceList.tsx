import Link from "next/link";
import { formatRaceTime } from "@thoroughbred/shared";
import type { RaceSummary } from "@/server/races";
import { CLASS_LABEL, SURFACE_LABEL, formatClock, formatCredits, furlongs } from "@/lib/format";
import { Countdown } from "./Countdown";
import { WeatherGlyph } from "./RaceMeta";
import { ArrowIcon, PixelIcon } from "./icons";

/** Racecard row: brass time tile · name + conditions · purse. */
export function UpcomingRaceRow({ race }: { race: RaceSummary; featured?: boolean }) {
  return (
    <li>
      <Link
        href={`/race/${race.id}`}
        className="group flex items-center gap-3 px-2 py-2.5 transition-colors hover:bg-[#163a28] sm:gap-4 sm:px-3"
        data-testid="upcoming-race"
      >
        <div className="px-plate flex w-[4.6rem] shrink-0 flex-col items-center py-0.5 text-center">
          <span className="num text-lg leading-none">{formatClock(race.postTimeMs)}</span>
          <span className="num mt-0.5 text-[0.8rem] leading-none text-[#7a1f1f]">
            <Countdown targetMs={race.postTimeMs} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="display truncate text-[1.05rem] text-cream group-hover:text-brass-bright">{race.name}</p>
          <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-sage">
            <WeatherGlyph weather={race.weather} className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {furlongs(race.distanceM)} · {SURFACE_LABEL[race.surface]} · {race.going} · {CLASS_LABEL[race.raceClass]}
              <span className="sm:hidden"> · {race.fieldSize} ran</span>
            </span>
          </p>
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          <p className="num flex items-center justify-end gap-1 text-[1.05rem] text-brass-bright">
            <PixelIcon name="coin" className="h-4 w-4" />
            {formatCredits(race.purse)}
          </p>
          <p className="label">{race.fieldSize} runners</p>
        </div>
        <ArrowIcon className="h-3 w-3 shrink-0 text-sage transition-transform group-hover:translate-x-0.5 group-hover:text-brass" />
      </Link>
    </li>
  );
}

export function RecentRaceRow({ race }: { race: RaceSummary }) {
  return (
    <li>
      <Link
        href={`/race/${race.id}`}
        className="group flex items-center gap-3 px-2 py-2.5 transition-colors hover:bg-[#163a28] sm:gap-4 sm:px-3"
        data-testid="recent-race"
      >
        <div className="flex w-[4.6rem] shrink-0 flex-col items-center text-center">
          <span className="num text-lg leading-none text-cream-dim">{formatClock(race.postTimeMs)}</span>
          {race.phase === "live" ? (
            <span className="chip chip-live mt-1 !px-1.5 !py-0 text-[0.65rem]">
              <span className="live-dot !h-1.5 !w-1.5" /> LIVE
            </span>
          ) : (
            <span className="label mt-1">Result</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-sage">{race.name}</p>
          {race.winner ? (
            <p className="flex min-w-0 items-center gap-1.5">
              <PixelIcon name="rosette" className="h-4 w-4 shrink-0" />
              <span className="display truncate text-[1.05rem] text-cream group-hover:text-brass-bright">{race.winner.name}</span>
              <span className="hidden truncate text-xs text-sage sm:inline">· {race.winner.stableName}</span>
            </p>
          ) : (
            <p className="display text-[1.05rem] text-cream">Running now — watch live</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          {race.winner ? <p className="led text-xl leading-none text-brass-bright">{formatRaceTime(race.winner.timeUs)}</p> : null}
          <p className="label">{furlongs(race.distanceM)}</p>
        </div>
      </Link>
    </li>
  );
}

/** A framed list (racecard board) with a heading tab. */
export function RaceBoard({ title, note, icon, children, href, hrefLabel }: { title: string; note?: string; icon: Parameters<typeof PixelIcon>[0]["name"]; children: React.ReactNode; href?: string; hrefLabel?: string }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-end justify-between gap-2">
        <h2 className="display flex items-center gap-2 text-2xl">
          <PixelIcon name={icon} className="h-6 w-6" />
          {title}
        </h2>
        {href ? (
          <Link href={href} className="label hover:text-cream">
            {hrefLabel} ›
          </Link>
        ) : note ? (
          <p className="label hidden sm:block">{note}</p>
        ) : null}
      </div>
      <ul className="px-panel divide-y-2 divide-dashed divide-[#1f4d35] !p-0">{children}</ul>
    </section>
  );
}

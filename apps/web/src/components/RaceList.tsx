import Link from "next/link";
import { formatRaceTime } from "@thoroughbred/shared";
import type { RaceSummary } from "@/server/races";
import { formatClock, formatCredits } from "@/lib/format";
import { Countdown } from "./Countdown";
import { WeatherGlyph, raceMetaLine } from "./RaceMeta";
import { PixelIcon } from "./icons";

/** Racecard row: post time · name + conditions · purse. */
export function UpcomingRaceRow({ race }: { race: RaceSummary; featured?: boolean }) {
  return (
    <li>
      <Link href={`/race/${race.id}`} className="row-link group gap-3 px-3 py-2.5 sm:gap-4" data-testid="upcoming-race">
        <div className="w-14 shrink-0">
          <p className="num text-lg leading-tight text-cream">{formatClock(race.postTimeMs)}</p>
          <p className="text-sm font-bold text-cream-dim">
            <Countdown targetMs={race.postTimeMs} />
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-title text-cream group-hover:underline">{race.name}</p>
          <p className="t-meta flex items-center gap-1.5">
            <WeatherGlyph weather={race.weather} className="h-4 w-4" />
            <span>
              {raceMetaLine(race)} · {race.fieldSize} runners
            </span>
          </p>
        </div>
        <p className="num hidden shrink-0 items-center gap-1.5 text-cream sm:flex">
          <PixelIcon name="coin" size={16} />
          {formatCredits(race.purse)}
        </p>
      </Link>
    </li>
  );
}

export function RecentRaceRow({ race }: { race: RaceSummary }) {
  return (
    <li>
      <Link href={`/race/${race.id}`} className="row-link group gap-3 px-3 py-2.5 sm:gap-4" data-testid="recent-race">
        <div className="w-14 shrink-0">
          <p className="num text-lg leading-tight text-cream-dim">{formatClock(race.postTimeMs)}</p>
          {race.phase === "live" ? (
            <span className="chip chip-live mt-0.5 !px-1.5 !py-0 text-xs">
              <span className="live-dot !h-1.5 !w-1.5" /> Live
            </span>
          ) : (
            <p className="text-sm font-bold text-sage">Result</p>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-meta">{race.name}</p>
          {race.winner ? (
            <p className="flex min-w-0 items-center gap-1.5">
              <PixelIcon name="rosette" size={16} title="Winner" />
              <span className="t-title text-cream group-hover:underline">{race.winner.name}</span>
              <span className="hidden truncate text-sm text-cream-dim sm:inline">· {race.winner.stableName}</span>
            </p>
          ) : (
            <p className="t-title text-cream">Running now · watch live</p>
          )}
        </div>
        {race.winner && <p className="num shrink-0 text-cream-dim">{formatRaceTime(race.winner.timeUs)}</p>}
      </Link>
    </li>
  );
}

/** A list of races under a section title: rows separated by rules, no heavy frame. */
export function RaceBoard({
  title,
  note,
  children,
  href,
  hrefLabel,
}: {
  title: string;
  note?: string;
  icon?: Parameters<typeof PixelIcon>[0]["name"];
  children: React.ReactNode;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-end justify-between gap-2">
        <h2 className="t-display-m">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="inline-flex min-h-11 items-center text-sm font-bold text-cream-dim underline decoration-2 underline-offset-4 hover:text-cream"
          >
            {hrefLabel}
          </Link>
        ) : note ? (
          <p className="caption hidden sm:block">{note}</p>
        ) : null}
      </div>
      <ul className="surface rows">{children}</ul>
    </section>
  );
}

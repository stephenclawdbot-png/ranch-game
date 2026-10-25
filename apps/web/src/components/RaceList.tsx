import Link from "next/link";
import { formatRaceTime } from "@thoroughbred/shared";
import type { RaceSummary } from "@/server/races";
import { formatClock, formatCredits } from "@/lib/format";
import { Countdown } from "./Countdown";
import { RaceMetaChips } from "./RaceMeta";
import { ArrowIcon } from "./icons";

export function UpcomingRaceRow({ race, featured = false }: { race: RaceSummary; featured?: boolean }) {
  return (
    <li>
      <Link
        href={`/race/${race.id}`}
        className={`group flex items-center gap-4 rounded-2xl border border-transparent px-3 py-3 transition-colors hover:border-brass/20 hover:bg-cream/[0.03] sm:px-4 ${featured ? "" : ""}`}
        data-testid="upcoming-race"
      >
        <div className="w-16 shrink-0 text-center">
          <p className="display text-lg font-semibold leading-none text-cream">{formatClock(race.postTimeMs)}</p>
          <p className="mt-1 text-xs text-brass">
            <Countdown targetMs={race.postTimeMs} />
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-cream">{race.name}</p>
          <div className="mt-1.5 hidden sm:block">
            <RaceMetaChips race={race} showClass={false} />
          </div>
          <p className="mt-0.5 truncate text-xs text-sage sm:hidden">
            {race.distanceM} m · {race.surface} · {race.going} · {race.fieldSize} runners
          </p>
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          <p className="tabular text-sm font-semibold text-brass-bright">{formatCredits(race.purse)}</p>
          <p className="text-xs text-sage">{race.fieldSize} runners</p>
        </div>
        <ArrowIcon className="h-4 w-4 shrink-0 text-sage transition-transform group-hover:translate-x-0.5 group-hover:text-brass" />
      </Link>
    </li>
  );
}

export function RecentRaceRow({ race }: { race: RaceSummary }) {
  return (
    <li>
      <Link
        href={`/race/${race.id}`}
        className="group flex items-center gap-4 rounded-2xl px-3 py-3 transition-colors hover:bg-cream/[0.03] sm:px-4"
        data-testid="recent-race"
      >
        <div className="w-16 shrink-0 text-center">
          <p className="display text-lg font-semibold leading-none text-cream-dim">{formatClock(race.postTimeMs)}</p>
          {race.phase === "live" ? (
            <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-widest text-[#ef7d70]">
              <span className="live-dot" /> Live
            </p>
          ) : (
            <p className="mt-1 text-xs text-sage">Result</p>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-cream-dim">{race.name}</p>
          {race.winner ? (
            <p className="truncate font-semibold text-cream">
              <span className="text-brass">1st</span> {race.winner.name}
              <span className="font-normal text-sage"> · {race.winner.stableName}</span>
            </p>
          ) : (
            <p className="font-semibold text-cream">Running now — watch live</p>
          )}
        </div>
        <div className="shrink-0 text-right text-xs text-sage">
          {race.winner ? <span className="tabular text-sm text-cream">{formatRaceTime(race.winner.timeUs)}</span> : null}
          <p>{race.distanceM} m</p>
        </div>
      </Link>
    </li>
  );
}

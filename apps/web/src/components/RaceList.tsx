"use client";

import Link from "next/link";
import { formatRaceTime } from "@thoroughbred/shared";
import type { RaceSummary } from "@/lib/types";
import { formatClock, formatCredits } from "@/lib/format";
import { useNow } from "@/lib/clock";
import { usePlayerState } from "@/lib/player";
import { Countdown } from "./Countdown";
import { WeatherGlyph, raceMetaLine } from "./RaceMeta";
import { useEntry } from "./entry/EntryProvider";
import { PixelIcon } from "./icons";
import { ActionBar } from "./ui/ActionBar";

/** Racecard row: post time · name + conditions · field so far · Enter (while entries are open). */
export function UpcomingRaceRow({ race }: { race: RaceSummary; featured?: boolean }) {
  const entry = useEntry();
  const now = useNow(1000);
  const open = race.phase === "open" && (now === null || now < race.entriesCloseAtMs);
  return (
    <li className="flex items-stretch" data-testid="upcoming-race" data-race-id={race.id}>
      <Link href={`/race/${race.id}`} className="row-link group min-w-0 flex-1 gap-3 px-3 py-2.5 sm:gap-4">
        <div className="w-14 shrink-0">
          <p className="num text-lg leading-tight text-cream">{formatClock(race.postTimeMs)}</p>
          <p className="text-sm font-bold text-cream-dim">
            <Countdown targetMs={race.postTimeMs} />
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-title truncate text-cream group-hover:underline">
            {race.name}
            {race.mine > 0 && <span className="you-tag ml-2 align-middle">{race.mine > 1 ? `You ×${race.mine}` : "You"}</span>}
          </p>
          <p className="t-meta flex items-center gap-1.5">
            <WeatherGlyph weather={race.weather} className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {raceMetaLine(race)} · {formatCredits(race.purse)} cr
            </span>
          </p>
          <p className="text-xs font-bold text-sage">
            {open ? (
              <>
                {race.fieldSize} entered · closes in <Countdown targetMs={race.entriesCloseAtMs} doneLabel="now" /> · {race.entryCost}{" "}
                {race.entryCost === 1 ? "entry" : "entries"}
              </>
            ) : (
              <>Field locked · {race.fieldSize} runners</>
            )}
          </p>
        </div>
      </Link>
      {open && (
        <div className="flex shrink-0 items-center pr-3">
          <button type="button" className="btn btn-sm" onClick={() => entry.enterLive(race.id)} data-testid="enter-live-race">
            Enter
          </button>
        </div>
      )}
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
          <p className="t-meta">
            {race.name}
            {race.mine > 0 && <span className="you-tag ml-2 align-middle">You</span>}
          </p>
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

/** Live Quick Pick bar on the card: one tap enters your best-fit fresh horse in the next suitable race. */
export function LivePickBar() {
  const state = usePlayerState();
  const entry = useEntry();
  if (!state) return null;
  return (
    <div className="frame-hero flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div>
        <p className="t-title">Quick Pick · Live</p>
        <p className="text-cream-dim">
          Your best-fit fresh horse into the next suitable race on the card. {state.entries.balance} of {state.entries.cap} stable entries left.
        </p>
      </div>
      <ActionBar>
        <button type="button" className="btn btn-brass btn-lg" onClick={entry.quickPickLive} data-testid="live-quick-pick">
          <PixelIcon name="flag" size={32} className="-my-2" /> Enter next Live race
        </button>
      </ActionBar>
    </div>
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

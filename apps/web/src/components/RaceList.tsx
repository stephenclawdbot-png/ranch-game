"use client";

import Link from "next/link";
import { useState } from "react";
import { formatRaceTime } from "@thoroughbred/shared";
import type { RaceSummary } from "@/lib/types";
import { CLASS_LABEL, SURFACE_LABEL, formatClock, formatDistance } from "@/lib/format";
import { useNow } from "@/lib/clock";
import { usePlayerState } from "@/lib/player";
import { Countdown } from "./Countdown";
import { SilksIcon } from "./Silks";
import { useEntry } from "./entry/EntryProvider";
import { PixelIcon } from "./icons";
import { ActionBar } from "./ui/ActionBar";
import { Section } from "./ui/Page";

/** A 64-px race tile: the track surface as pixel texture (rail on top) with the post time in Jersey. */
export function TrackTile({ surface, children, className }: { surface: RaceSummary["surface"]; children: React.ReactNode; className?: string }) {
  return (
    <span className={`track-tile track-${surface} ${className ?? ""}`} title={`${SURFACE_LABEL[surface]} track`}>
      <span className="track-plate">{children}</span>
    </span>
  );
}

/** "3 stables entered" (Club runners never count). */
export function stablesLabel(n: number): string {
  return n === 0 ? "No stables entered yet" : `${n} ${n === 1 ? "stable" : "stables"} entered`;
}

/** Racecard row: track tile with the time · name (never truncated) · two facts · Enter. `busy` flags one of the busiest races on the card. */
export function UpcomingRaceRow({ race, alsoAt, busy = false }: { race: RaceSummary; alsoAt?: string[]; featured?: boolean; busy?: boolean }) {
  const entry = useEntry();
  const now = useNow(1000);
  const open = race.phase === "open" && (now === null || now < race.entriesCloseAtMs);
  return (
    <li
      className={`flex items-center gap-3 px-3 py-3 sm:px-4 ${race.mine > 0 ? "yours" : ""} ${race.sponsor ? "shadow-[inset_3px_0_0_var(--color-brass)]" : ""}`}
      data-testid="upcoming-race"
      data-race-id={race.id}
      data-sponsored={race.sponsor ? (race.sponsor.mine ? "mine" : "1") : undefined}
      data-stables={race.stables}
    >
      <Link href={`/race/${race.id}`} className="group flex min-w-0 flex-1 items-center gap-3">
        <TrackTile surface={race.surface}>
          <span className="score block text-[1.375rem] leading-none">{formatClock(race.postTimeMs)}</span>
          <span className="block text-[0.6875rem] font-bold leading-4 opacity-90">
            <Countdown targetMs={race.postTimeMs} />
          </span>
        </TrackTile>
        <span className="grid min-w-0 gap-0.5">
          <span className="t-title group-hover:underline">
            {race.name}
            {race.mine > 0 && <span className="tag tag-you ml-2 !h-5 align-middle !text-[0.6875rem]">{race.mine > 1 ? `You ×${race.mine}` : "You"}</span>}
            {busy && (
              <span className="tag tag-good ml-2 !h-5 align-middle !text-[0.6875rem]" data-testid="busy-race" title="One of the busiest races on the card">
                Busy
              </span>
            )}
          </span>
          <span className="t-meta">
            {formatDistance(race.distanceM)} {SURFACE_LABEL[race.surface].toLowerCase()} · {CLASS_LABEL[race.raceClass]}
          </span>
          <span className="caption">
            {open ? (
              <>
                <span data-testid="stables-entered">{stablesLabel(race.stables)}</span> · closes in <Countdown targetMs={race.entriesCloseAtMs} doneLabel="now" />
              </>
            ) : (
              <>
                Field locked · {race.fieldSize} runners, {race.stables} from stables
              </>
            )}
          </span>
          {race.sponsor && <SponsorLine sponsor={race.sponsor} />}
          {alsoAt && alsoAt.length > 0 && (
            <span className="caption">
              Also running at {alsoAt.join(", ")}
            </span>
          )}
        </span>
      </Link>
      {open && (
        <button type="button" className="btn btn-sm shrink-0" onClick={() => entry.enterLive(race.id)} data-testid="enter-live-race">
          Enter
        </button>
      )}
    </li>
  );
}

/** How many of the busiest races (2+ stables) carry the Busy flag. */
const BUSY_FLAGS = 3;

/** The busiest races on the card: the most stables entered, at least two, soonest first on a tie. */
export function busiestRaces(races: readonly RaceSummary[], n = BUSY_FLAGS): Set<string> {
  return new Set(
    races
      .filter((r) => r.phase === "open" && r.stables >= 2)
      .sort((a, b) => b.stables - a.stables || a.postTimeMs - b.postTimeMs)
      .slice(0, n)
      .map((r) => r.id),
  );
}

const meetingDay = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { weekday: "short" });

/**
 * The published card (a day of race meetings): by meeting, soonest first, or every race sorted by
 * the stables entered so far ("Most stables"), with the busiest flagged either way.
 */
export function UpcomingCard({ races, note }: { races: RaceSummary[]; note?: string }) {
  const [sort, setSort] = useState<"meeting" | "busy">("meeting");
  const busy = busiestRaces(races);
  const meetings: { startMs: number; races: RaceSummary[] }[] = [];
  for (const r of races) {
    const m = meetings.find((x) => x.startMs === r.meetingStartMs);
    if (m) m.races.push(r);
    else meetings.push({ startMs: r.meetingStartMs, races: [r] });
  }
  const byStables = [...races].sort((a, b) => b.stables - a.stables || a.postTimeMs - b.postTimeMs);
  const row = (r: RaceSummary) => <UpcomingRaceRow key={r.id} race={r} alsoAt={r.alsoAt} busy={busy.has(r.id)} />;
  return (
    <Section title="Coming up" aside={note ? <span className="caption hidden sm:block">{note}</span> : undefined} className="min-w-0 !mt-0" testId="upcoming-card">
      <div className="segmented mb-3" role="group" aria-label="Order the card">
        <button type="button" aria-pressed={sort === "meeting"} onClick={() => setSort("meeting")} data-testid="sort-meeting">
          By meeting
        </button>
        <button type="button" aria-pressed={sort === "busy"} onClick={() => setSort("busy")} data-testid="sort-busy">
          Most stables
        </button>
      </div>
      {sort === "meeting" ? (
        <div className="grid gap-5">
          {meetings.map((m) => {
            const entered = m.races.reduce((a, r) => a + r.stables, 0);
            return (
              <section key={m.startMs} aria-label={`Race meeting from ${formatClock(m.startMs)}`} data-testid="meeting">
                <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2">
                  <span className="t-title">
                    Race meeting · {meetingDay(m.startMs)} {formatClock(m.startMs)}
                  </span>
                  <span className="caption">
                    {m.races.length} {m.races.length === 1 ? "race" : "races"} · {entered} {entered === 1 ? "stable entry" : "stable entries"}
                  </span>
                </h3>
                <ul className="surface rows">{m.races.map(row)}</ul>
              </section>
            );
          })}
        </div>
      ) : (
        <ul className="surface rows" data-testid="busiest-list">
          {byStables.map(row)}
        </ul>
      )}
    </Section>
  );
}

/** "Sponsored by ..." with the sponsor's silks (Sponsor a race). */
export function SponsorLine({ sponsor, className }: { sponsor: NonNullable<RaceSummary["sponsor"]>; className?: string }) {
  return (
    <span className={`caption inline-flex items-center gap-1.5 ${className ?? ""}`} data-testid="race-sponsor">
      <SilksIcon silks={sponsor.silks} className="h-5 w-5" />
      {sponsor.mine ? "Sponsored by you" : `Sponsored by ${sponsor.stableName}`}
    </span>
  );
}

export function RecentRaceRow({ race }: { race: RaceSummary }) {
  return (
    <li>
      <Link href={`/race/${race.id}`} className="row-link group gap-3 px-3 py-3 sm:px-4" data-testid="recent-race">
        <TrackTile surface={race.surface}>
          <span className="score block text-[1.375rem] leading-none">{formatClock(race.postTimeMs)}</span>
          {race.phase === "live" ? <span className="block text-[0.6875rem] font-extrabold leading-4 text-[#ffb3a8]">● LIVE</span> : <span className="block text-[0.6875rem] font-bold leading-4 opacity-90">Result</span>}
        </TrackTile>
        <span className="grid min-w-0 flex-1 gap-0.5">
          {race.winner ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="t-title group-hover:underline">{race.winner.name}</span>
              {race.mine > 0 && <span className="tag tag-you !h-5 !text-[0.6875rem]">You</span>}
            </span>
          ) : (
            <span className="t-title">Running now · watch live</span>
          )}
          <span className="t-meta">{race.winner ? `Won the ${race.name}` : race.name}</span>
        </span>
        {race.winner ? <span className="score shrink-0 text-[1.375rem] text-cream-dim">{formatRaceTime(race.winner.timeUs)}</span> : <span className="tag tag-live shrink-0">Watch</span>}
      </Link>
    </li>
  );
}

/** Live Quick Pick: one tap enters your best-fit fresh horse in the next suitable race. */
export function LivePickBar() {
  const state = usePlayerState();
  const entry = useEntry();
  if (!state) return null;
  return (
    <div className="frame-hero mt-4 grid gap-3 p-4 sm:flex sm:items-center sm:justify-between sm:p-5">
      <div>
        <p className="tag tag-ready">Quick Pick · Live</p>
        <p className="t-hero mt-2">Your best-fit horse, next race</p>
        <p className="t-meta">
          {state.entries.balance} of {state.entries.cap} stable entries left today
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

/** A list of races under a section head: paper rows separated by dotted rules. */
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
    <Section title={title} href={href} linkLabel={hrefLabel} aside={note ? <span className="caption hidden sm:block">{note}</span> : undefined} className="min-w-0 !mt-0">
      <ul className="surface rows">{children}</ul>
    </Section>
  );
}

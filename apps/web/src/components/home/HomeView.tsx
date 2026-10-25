"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Horse } from "@thoroughbred/shared";
import type { RaceSummary } from "@/server/races";
import { horseSummary, recommendIndex } from "@/lib/aptitude";
import { useNow } from "@/lib/clock";
import { STYLE_LABEL, SURFACE_LABEL, formatClock, formatCountdown, formatCredits, formatDistance, ordinal } from "@/lib/format";
import { horseRecord, pendingRaces, type PendingRace, type PlayerState, usePlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";
import { Countdown } from "../Countdown";
import { HorsePortrait } from "../HorsePortrait";
import { RaceBoard, RecentRaceRow } from "../RaceList";
import { raceMetaLine } from "../RaceMeta";
import { useEntry } from "../entry/EntryProvider";
import { PLAN_HINT } from "../entry/EntryForm";
import { PixelIcon, type IconName } from "../icons";
import { SceneBackdrop } from "../pixel/SceneBackdrop";
import { ActionBar } from "../ui/ActionBar";
import { SectionHeader } from "../ui/SectionHeader";

interface ClubProps {
  next: RaceSummary;
  live: RaceSummary | null;
  recent: RaceSummary[];
}

/** Home: your next action first; club racing (spectating) is secondary. */
export function HomeView(props: ClubProps) {
  const state = usePlayerState();
  if (state === undefined) return <div className="min-h-[60vh]" aria-busy />;
  if (state === null) return <Welcome {...props} />;
  return <Yard state={state} {...props} />;
}

// ---------------------------------------------------------------------------
// Signed out: watch now, then join
// ---------------------------------------------------------------------------

const PILLARS: { icon: IconName; title: string; text: string }[] = [
  { icon: "horseshoe", title: "Own six horses", text: "Sprinters, stayers, closers. Each has a trip, a surface and a style." },
  { icon: "flag", title: "Race in a minute", text: "Pick a horse and a plan. The gates open ten seconds later." },
  { icon: "star", title: "Read the form", text: "Every result comes with the why: pace, fit and sectionals." },
];

function Welcome({ next, live, recent }: ClubProps) {
  return (
    <div className="grid gap-8">
      <section className="grid gap-4 md:grid-cols-[1fr_22rem] md:items-end">
        <div>
          <h1 className="t-display-xl">Run a racing stable.</h1>
          <p className="mt-2 max-w-xl text-lg text-cream-dim">Six horses are waiting. Your first race is about a minute away.</p>
          <ActionBar className="md:mt-5">
            <Link href="/play" className="btn btn-brass btn-lg" data-testid="found-stable">
              <PixelIcon name="horseshoe" size={32} className="-my-2" /> Found your stable · free
            </Link>
          </ActionBar>
        </div>
        <ClubNext next={next} live={live} />
      </section>

      <ul className="grid gap-3 sm:grid-cols-3">
        {PILLARS.map((p) => (
          <li key={p.title} className="surface flex items-start gap-3 p-3">
            <PixelIcon name={p.icon} size={32} />
            <div>
              <p className="t-title">{p.title}</p>
              <p className="text-sm text-cream-dim">{p.text}</p>
            </div>
          </li>
        ))}
      </ul>

      <RaceBoard title="Recent results" href="/races" hrefLabel="All races">
        {recent.slice(0, 4).map((r) => (
          <RecentRaceRow key={r.id} race={r} />
        ))}
      </RaceBoard>
    </div>
  );
}

/** The next club race as a scene window with a countdown: watchable with zero setup. */
function ClubNext({ next, live, compact = false }: { next: RaceSummary; live: RaceSummary | null; compact?: boolean }) {
  return (
    <section className="surface overflow-hidden !p-0" data-testid="next-race" aria-labelledby="next-race-h">
      {!compact && (
        <div className="relative h-36">
          <SceneBackdrop variant="paddock" />
          <div className="plate-ink absolute bottom-2 left-2 px-2 py-1">
            <p className="text-xs font-bold text-cream-dim">Off in</p>
            <p className="score text-[2.5rem] leading-none text-cream">
              <Countdown targetMs={next.postTimeMs} doneLabel="Off" animate />
            </p>
          </div>
        </div>
      )}
      <Link href={`/race/${next.id}`} className="row-link group gap-3 px-3 py-2" data-testid="watch-next">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-cream-dim">
            Next club race · {formatClock(next.postTimeMs)}
            {compact && (
              <>
                {" "}
                · off in <Countdown targetMs={next.postTimeMs} doneLabel="now" className="text-cream" />
              </>
            )}
          </p>
          <p id="next-race-h" className="t-title text-cream group-hover:underline">
            {next.name}
          </p>
          <p className="t-meta">
            {raceMetaLine(next)} · {next.fieldSize} runners
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-sm font-extrabold text-cream">
          <PixelIcon name="play" className="h-3 w-3" /> Watch
        </span>
      </Link>
      {live && (
        <Link href={`/race/${live.id}`} className="row-link group gap-2 border-t-2 border-line px-3 py-2 text-sm">
          <span className="chip chip-live !px-1.5 !py-0 text-xs">
            <span className="live-dot !h-1.5 !w-1.5" /> Live
          </span>
          <span className="min-w-0 flex-1 truncate font-bold text-cream group-hover:underline">{live.name}</span>
          <span className="font-extrabold">Join ›</span>
        </Link>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Signed in: next best action, stable pulse, then club racing
// ---------------------------------------------------------------------------

function Yard({ state, next, live, recent }: ClubProps & { state: PlayerState }) {
  const { horses } = usePlayerHorses(state.player.playerId, state.player.silks);
  const now = useNow(1000);
  const pending = pendingRaces(state);
  // Your own race: running or about to start -> watch it; finished but unseen -> see result (no spoilers).
  const upcomingMine = now === null ? undefined : pending.find((p) => p.postTimeMs > now - 90_000);
  const unseen = pending.filter((p) => p !== upcomingMine);
  const rec = useMemo(() => (horses ? recommendIndex(horses, (i) => horseRecord(state, i).starts) : 0), [horses, state]);
  const history = state.progress.history.slice(0, 3);

  return (
    <div className="grid gap-8">
      <div>
        <p className="eyebrow">{state.player.stableName}</p>
        <h1 className="t-display-xl">{history.length === 0 ? "Your first race" : "Up next"}</h1>
      </div>

      {unseen.length > 0 && !upcomingMine && (
        <p className="surface-2 flex flex-wrap items-center gap-2 px-3 py-2 text-sm" role="status">
          <PixelIcon name="stopwatch" size={16} />
          <span>
            While you were away: <strong>{unseen.length === 1 ? "1 result is ready" : `${unseen.length} results are ready`}</strong>. No spoilers until you watch.
          </span>
        </p>
      )}

      {upcomingMine ? (
        <YourRace race={upcomingMine} now={now ?? 0} />
      ) : unseen[0] ? (
        <ResultReady race={unseen[0]} />
      ) : horses ? (
        <ReadyHorse horse={horses[rec]!} index={rec} />
      ) : (
        <div className="frame-hero h-64 opacity-60" aria-busy />
      )}

      <section aria-labelledby="pulse-h">
        <SectionHeader id="pulse-h" title="Your horses" href="/stable" linkLabel="Stable" />
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-6 md:px-0" data-testid="stable-pulse">
          {(horses ?? Array.from({ length: 6 }, () => null)).map((h, i) => {
            const racing = pending.some((p) => p.horseIndex === i && now !== null && p.postTimeMs > now - 90_000);
            return (
              <li key={h?.id ?? i} className="shrink-0">
                {h ? (
                  <Link href={`/horse/${h.id}`} className="surface flex w-36 items-center gap-2 p-1.5 hover:brightness-110 md:w-auto">
                    <HorsePortrait appearance={h.appearance} scale="thumb" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-extrabold">{h.name}</span>
                      <span className="flex items-center gap-1.5 text-xs font-bold text-cream-dim">
                        <span aria-hidden className={`h-2 w-2 ${racing ? "bg-brass" : "bg-positive"}`} />
                        {racing ? "Racing" : "Ready"}
                      </span>
                    </span>
                  </Link>
                ) : (
                  <span className="surface block h-[3.75rem] w-36 opacity-60 md:w-auto" />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {history.length > 0 && (
        <section aria-labelledby="runs-h">
          <SectionHeader id="runs-h" title="Your latest runs" />
          <ul className="surface rows">
            {history.map((h) => (
              <li key={h.raceId}>
                <Link href={`/race/${h.raceId}`} className="row-link group gap-3 px-3 py-2">
                  <span className="num w-10 shrink-0 text-lg text-cream">{ordinal(h.position)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-extrabold group-hover:underline">{h.horseName}</span>
                    <span className="t-meta block truncate">
                      {h.raceName} · {h.fieldSize} ran
                    </span>
                  </span>
                  <span className={`num shrink-0 ${h.prize > 0 ? "text-positive" : "text-sage"}`}>{h.prize > 0 ? `+${formatCredits(h.prize)}` : "–"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="club-h" className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionHeader id="club-h" title="Club racing" href="/races" linkLabel="Today’s card" />
          <ClubNext next={next} live={live} compact />
        </div>
        <RaceBoard title="Recent results">
          {recent.slice(0, 3).map((r) => (
            <RecentRaceRow key={r.id} race={r} />
          ))}
        </RaceBoard>
      </section>
    </div>
  );
}

function ReadyHorse({ horse, index }: { horse: Horse; index: number }) {
  const entry = useEntry();
  return (
    <section className="frame-hero p-3 sm:p-4" aria-labelledby="ready-h" data-testid="up-next">
      <div className="flex gap-4">
        <div className="hidden shrink-0 bg-inset sm:block">
          <HorsePortrait appearance={horse.appearance} scale={2} title={horse.name} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="shrink-0 bg-inset sm:hidden">
              <HorsePortrait appearance={horse.appearance} scale={1} />
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-positive">
                <span aria-hidden>✓</span> Ready to race
              </p>
              <h2 id="ready-h" className="t-display-l">
                {horse.name}
              </h2>
              <p className="t-meta">
                {STYLE_LABEL[horse.style]} · best {formatDistance(horse.preferredDistanceM)} on {SURFACE_LABEL[horse.preferredSurface].toLowerCase()}
              </p>
            </div>
          </div>
          <p className="mt-3 max-w-prose text-cream-dim">{horseSummary(horse)}</p>
          <p className="mt-2 text-sm text-cream-dim">
            <strong className="text-cream">Natural plan, {STYLE_LABEL[horse.style].toLowerCase()}:</strong> {PLAN_HINT[horse.style]}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ActionBar>
              <button type="button" className="btn btn-brass btn-lg" onClick={() => entry.open(index)} data-testid="race-now">
                <PixelIcon name="flag" size={32} className="-my-2" /> Race {horse.name}
              </button>
            </ActionBar>
            <Link href="/stable" className="btn-ghost inline-flex min-h-11 items-center font-bold">
              Choose another horse
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function YourRace({ race, now }: { race: PendingRace; now: number }) {
  const startsIn = race.postTimeMs - now;
  return (
    <section className="frame-hero p-4" aria-labelledby="yours-h" data-testid="up-next">
      <p className="text-sm font-extrabold text-cream-dim">{startsIn > 0 ? "Your race is about to start" : "Your race is running"}</p>
      <h2 id="yours-h" className="t-display-l">
        {race.horseName}
      </h2>
      <p className="t-meta">Quick race · {startsIn > 0 ? `off in ${formatCountdown(startsIn)}` : "live now"}</p>
      <ActionBar className="mt-4">
        <Link href={`/race/${race.raceId}`} className="btn btn-brass btn-lg">
          <PixelIcon name="play" className="h-4 w-4" /> Watch {race.horseName}
        </Link>
      </ActionBar>
    </section>
  );
}

function ResultReady({ race }: { race: PendingRace }) {
  return (
    <section className="frame-hero p-4" aria-labelledby="ready-result-h" data-testid="up-next">
      <p className="text-sm font-extrabold text-cream-dim">▶ Result ready</p>
      <h2 id="ready-result-h" className="t-display-l">
        {race.horseName}&rsquo;s race
      </h2>
      <p className="t-meta">Quick race at {formatClock(race.postTimeMs)}. We haven&rsquo;t told you how it went.</p>
      <ActionBar className="mt-4">
        <Link href={`/race/${race.raceId}`} className="btn btn-brass btn-lg">
          <PixelIcon name="play" className="h-4 w-4" /> See the result
        </Link>
      </ActionBar>
    </section>
  );
}

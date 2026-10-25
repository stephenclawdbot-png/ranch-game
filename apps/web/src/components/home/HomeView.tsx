"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Horse } from "@thoroughbred/shared";
import type { RaceSummary } from "@/server/races";
import { horseSummary, recommendIndex } from "@/lib/aptitude";
import { useNow } from "@/lib/clock";
import { STYLE_LABEL, SURFACE_LABEL, formatClock, formatCountdown, formatCredits, formatDistance, ordinal } from "@/lib/format";
import { pendingRaces, recentlyRun, type PendingRace, type PlayerState, usePlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";
import { Countdown } from "../Countdown";
import { HorsePortrait } from "../HorsePortrait";
import { RaceBoard, RecentRaceRow } from "../RaceList";
import { raceMetaLine } from "../RaceMeta";
import { useEntry } from "../entry/EntryProvider";
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
  {
    icon: "horseshoe",
    title: "Own six horses",
    text: "Sprinters, stayers, closers. Each has a trip, a surface and a style.",
  },
  {
    icon: "flag",
    title: "Story races",
    text: "Take on the club's rival stables. Watch, or skip to the result.",
  },
  {
    icon: "stopwatch",
    title: "Live races",
    text: "A shared race every 3 minutes. Everyone watches the same race.",
  },
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
            Next live race · {formatClock(next.postTimeMs)}
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
  const exclude = useMemo(() => recentlyRun(state, now ?? 0), [state, now]);
  const rec = useMemo(() => (horses ? recommendIndex(horses, exclude) : 0), [horses, exclude]);

  return (
    <div className="grid gap-8">
      <div>
        <p className="eyebrow">{state.player.stableName}</p>
        <h1 className="t-display-xl">Up next</h1>
      </div>

      {upcomingMine ? (
        <YourRace race={upcomingMine} now={now ?? 0} />
      ) : unseen[0] ? (
        <ResultReady race={unseen[0]} count={unseen.length} />
      ) : horses ? (
        <QuickPickHero horse={horses[rec]!} index={rec} firstRace={state.progress.history.length === 0} />
      ) : (
        <div className="frame-hero h-64 opacity-60" aria-busy />
      )}

      <YourRaces state={state} now={now} />

      <section aria-labelledby="pulse-h">
        <SectionHeader id="pulse-h" title="Your horses" href="/stable" linkLabel="Stable" />
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-6 md:px-0" data-testid="stable-pulse">
          {(horses ?? Array.from({ length: 6 }, () => null)).map((h, i) => {
            const racing = pending.some((p) => p.horseIndex === i && now !== null && p.postTimeMs > now - 90_000);
            const rested = !racing && exclude.includes(i);
            return (
              <li key={h?.id ?? i} className="shrink-0 md:shrink">
                {h ? (
                  <Link href={`/horse/${h.id}`} className="surface flex h-full w-44 items-center gap-2 p-1.5 hover:brightness-110 md:w-auto">
                    <HorsePortrait appearance={h.appearance} scale="thumb" />
                    <span className="min-w-0">
                      <span className="block text-sm font-extrabold leading-tight">{h.name}</span>
                      <span className="flex items-center gap-1.5 text-xs font-bold text-cream-dim">
                        <span aria-hidden className={`h-2 w-2 ${racing ? "bg-brass" : rested ? "bg-sage" : "bg-positive"}`} />
                        {racing ? "Racing" : rested ? "Ran recently" : "Fresh"}
                      </span>
                    </span>
                  </Link>
                ) : (
                  <span className="surface block h-[3.75rem] w-44 opacity-60 md:w-auto" />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="club-h" className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionHeader id="club-h" title="Live races" href="/races#live" linkLabel="Live card" />
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

/** Your races inbox: unseen races first (live / result ready, never the result), then recent runs. */
function YourRaces({ state, now }: { state: PlayerState; now: number | null }) {
  const pending = pendingRaces(state);
  const history = state.progress.history.slice(0, 5);
  if (pending.length === 0 && history.length === 0) return null;
  return (
    <section aria-labelledby="inbox-h">
      <SectionHeader id="inbox-h" title="Your races" />
      <ul className="surface rows" data-testid="your-races">
        {pending.map((p) => {
          const startsIn = now === null ? 0 : p.postTimeMs - now;
          const status = startsIn > 0 ? `Off in ${formatCountdown(startsIn)}` : startsIn > -90_000 ? "Live" : "▶ Result ready";
          return (
            <li key={p.raceId}>
              <Link href={`/race/${p.raceId}`} className="row-link group gap-3 px-3 py-2" data-testid="inbox-race">
                <span className={`chip shrink-0 ${status === "Live" ? "chip-live" : "text-cream"}`}>
                  {status === "Live" && <span className="live-dot !h-1.5 !w-1.5" />}
                  {status}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-extrabold group-hover:underline">{p.horseName}</span>
                  <span className="t-meta block">Story race · {formatClock(p.postTimeMs)} · result hidden until you open it</span>
                </span>
              </Link>
            </li>
          );
        })}
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
              <span className={`num shrink-0 ${h.prize > 0 ? "text-positive" : "text-sage"}`}>
                {h.prize > 0 ? `+${formatCredits(h.prize)}` : "–"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The default next action: Quick Pick enters your best-suited fresh horse in the next race. */
function QuickPickHero({ horse, index, firstRace }: { horse: Horse; index: number; firstRace: boolean }) {
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
              <p className="text-sm font-extrabold text-cream-dim">{firstRace ? "Story · your first club race" : "Story · next club race"}</p>
              <h2 id="ready-h" className="t-display-l">
                {horse.name}
              </h2>
              <p className="t-meta">
                <span className="text-positive">✓ Fresh</span> · {STYLE_LABEL[horse.style]} · best {formatDistance(horse.preferredDistanceM)} on{" "}
                {SURFACE_LABEL[horse.preferredSurface].toLowerCase()}
              </p>
            </div>
          </div>
          <p className="mt-3 max-w-prose text-cream-dim">
            Quick Pick sends your best-suited fresh horse to the next Story race, ridden to its natural style. {horseSummary(horse)}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ActionBar>
              <button type="button" className="btn btn-brass btn-lg" onClick={entry.quickPick} data-testid="quick-pick">
                <PixelIcon name="flag" size={32} className="-my-2" /> Enter next race
              </button>
            </ActionBar>
            <button
              type="button"
              className="btn-ghost inline-flex min-h-11 items-center font-bold"
              onClick={() => entry.open(index, { picker: true })}
            >
              Choose horse &amp; plan
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Secondary Quick Pick when the primary action is about a race you already entered. */
function QuickPickAgain() {
  const entry = useEntry();
  return (
    <button type="button" className="btn" onClick={entry.quickPick} data-testid="quick-pick">
      Enter another race
    </button>
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
      <p className="t-meta">Story race · {startsIn > 0 ? `off in ${formatCountdown(startsIn)}` : "running now"}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ActionBar>
          <Link href={`/race/${race.raceId}`} className="btn btn-brass btn-lg">
            <PixelIcon name="play" className="h-4 w-4" /> Watch {race.horseName}
          </Link>
        </ActionBar>
        <QuickPickAgain />
      </div>
    </section>
  );
}

function ResultReady({ race, count }: { race: PendingRace; count: number }) {
  return (
    <section className="frame-hero p-4" aria-labelledby="ready-result-h" data-testid="up-next">
      <p className="text-sm font-extrabold text-cream-dim">▶ {count > 1 ? `While you were away: ${count} results are ready` : "Result ready"}</p>
      <h2 id="ready-result-h" className="t-display-l">
        {race.horseName}&rsquo;s race
      </h2>
      <p className="t-meta">Story race at {formatClock(race.postTimeMs)}. We haven&rsquo;t told you how it went.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ActionBar>
          <Link href={`/race/${race.raceId}`} className="btn btn-brass btn-lg">
            <PixelIcon name="play" className="h-4 w-4" /> See the result
          </Link>
        </ActionBar>
        <QuickPickAgain />
      </div>
    </section>
  );
}

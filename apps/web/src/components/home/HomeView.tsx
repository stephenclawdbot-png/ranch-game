"use client";

import Link from "next/link";
import type { ActiveEntry, InboxView, RaceSummary, StableHorse } from "@/lib/types";
import { horseSummary } from "@/lib/aptitude";
import { useNow } from "@/lib/clock";
import { STYLE_LABEL, SURFACE_LABEL, formatClock, formatCountdown, formatDistance, ordinal } from "@/lib/format";
import { recommendHorse, usePlayerState, type PlayerState } from "@/lib/player";
import { Countdown } from "../Countdown";
import { HorsePortrait } from "../HorsePortrait";
import { RaceBoard, RecentRaceRow } from "../RaceList";
import { raceMetaLine } from "../RaceMeta";
import { conditionLabel } from "../entry/EntryForm";
import { useEntry } from "../entry/EntryProvider";
import { PixelIcon, type IconName } from "../icons";
import { SceneBackdrop } from "../pixel/SceneBackdrop";
import { ActionBar } from "../ui/ActionBar";
import { SectionHeader } from "../ui/SectionHeader";

interface ClubProps {
  next: RaceSummary | null;
  live: RaceSummary | null;
  recent: RaceSummary[];
}

/** A race you're in counts as "yours to watch" from entry until a few minutes after the off. */
const WATCH_WINDOW_MS = 4 * 60_000;

/** Home: your next action first; the shared Live card second. */
export function HomeView(props: ClubProps) {
  const state = usePlayerState();
  // While one of your races is pending, refresh so results land without a reload.
  const pending = !!state && (state.active.length > 0 || state.inbox.some((i) => !i.read));
  usePlayerState({ pollMs: pending ? 10_000 : undefined });
  if (state === undefined) return <div className="min-h-[60vh]" aria-busy />;
  if (state === null) return <Welcome {...props} />;
  return <Yard state={state} {...props} />;
}

// ---------------------------------------------------------------------------
// Signed out: watch now, then join
// ---------------------------------------------------------------------------

const PILLARS: { icon: IconName; title: string; text: string }[] = [
  { icon: "horseshoe", title: "Own a stable", text: "Sprinters, stayers, closers. Each has a trip, a surface and a style, all from its genes." },
  { icon: "flag", title: "Story races", text: "Take on the Club's rival stables. Watch, or skip to the result." },
  { icon: "stopwatch", title: "Live races", text: "A shared race every 3 minutes. Everyone watches the same race." },
];

function Welcome({ next, live, recent }: ClubProps) {
  return (
    <div className="grid gap-8">
      <section className="grid gap-4 md:grid-cols-[1fr_22rem] md:items-end">
        <div>
          <h1 className="t-display-xl">Run a racing stable.</h1>
          <p className="mt-2 max-w-xl text-lg text-cream-dim">Your first horses are waiting. Your first race is about a minute away.</p>
          <ActionBar className="md:mt-5">
            <Link href="/play" className="btn btn-brass btn-lg" data-testid="found-stable">
              <PixelIcon name="horseshoe" size={32} className="-my-2" /> Found your stable · free
            </Link>
          </ActionBar>
        </div>
        {next && <ClubNext next={next} live={live} />}
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

      {recent.length > 0 && (
        <RaceBoard title="Recent results" href="/races" hrefLabel="All races">
          {recent.slice(0, 4).map((r) => (
            <RecentRaceRow key={r.id} race={r} />
          ))}
        </RaceBoard>
      )}
    </div>
  );
}

/** The next Live race as a scene window with a countdown: watchable with zero setup. */
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
            {raceMetaLine(next)} · {next.fieldSize} entered
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
// Signed in: next best action, your races, stable pulse, then the Live card
// ---------------------------------------------------------------------------

function Yard({ state, next, live, recent }: ClubProps & { state: PlayerState }) {
  const now = useNow(1000);
  // Your own race: about to start or running -> watch it; finished but unseen -> see the result (no spoilers).
  const upcomingMine = now === null ? undefined : [...state.active].sort((a, b) => a.postTimeMs - b.postTimeMs).find((a) => a.postTimeMs > now - WATCH_WINDOW_MS);
  const unseen = state.inbox.filter((i) => !i.read && i.raceId && i.raceId !== upcomingMine?.raceId);
  const rec = recommendHorse(state);
  const entry = useEntry();

  return (
    <div className="grid gap-8">
      <div>
        <p className="eyebrow">{state.stableName}</p>
        <h1 className="t-display-xl">Up next</h1>
      </div>

      {upcomingMine ? (
        <YourRace race={upcomingMine} now={now ?? 0} />
      ) : unseen[0] ? (
        <ResultReady item={unseen[0]} count={unseen.length} horseName={state.horses.find((h) => h.id === unseen[0]!.horseId)?.horse.name} />
      ) : rec ? (
        <QuickPickHero s={rec} firstRace={state.runs.length === 0} />
      ) : (
        <section className="frame-hero p-4" data-testid="up-next">
          <p className="text-cream-dim">All your horses are resting or entered. They can race again soon.</p>
        </section>
      )}

      <YourRaces state={state} now={now} />

      <section aria-labelledby="pulse-h">
        <SectionHeader id="pulse-h" title="Your horses" href="/stable" linkLabel="Stable" />
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-4 md:px-0" data-testid="stable-pulse">
          {state.horses.map((s) => {
            const racing = s.lockedRaceId !== null;
            const cond = conditionLabel(s);
            return (
              <li key={s.id} className="shrink-0 md:shrink">
                <Link href={`/horse/${s.id}`} className="surface flex h-full w-48 items-center gap-2 p-1.5 hover:brightness-110 md:w-auto">
                  <HorsePortrait appearance={s.horse.appearance} scale="thumb" />
                  <span className="min-w-0">
                    <span className="block text-sm font-extrabold leading-tight">{s.horse.name}</span>
                    <span className="flex items-center gap-1.5 text-xs font-bold text-cream-dim">
                      <span aria-hidden className={`h-2 w-2 ${racing ? "bg-brass" : s.block || s.condition === "tired" ? "bg-sage" : "bg-positive"}`} />
                      {racing ? "Entered" : cond.text}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="club-h" className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-3">
          <SectionHeader id="club-h" title="Live races" href="/races#live" linkLabel="Live card" />
          {next && <ClubNext next={next} live={live} compact />}
          <button type="button" className="btn w-fit" onClick={entry.quickPickLive} data-testid="live-quick-pick">
            <PixelIcon name="flag" size={16} /> Enter next Live race ({state.entries.balance} entries left)
          </button>
        </div>
        {recent.length > 0 && (
          <RaceBoard title="Recent results">
            {recent.slice(0, 3).map((r) => (
              <RecentRaceRow key={r.id} race={r} />
            ))}
          </RaceBoard>
        )}
      </section>
    </div>
  );
}

function statusOf(a: ActiveEntry, now: number | null): { text: string; live: boolean } {
  const startsIn = now === null ? 0 : a.postTimeMs - now;
  if (startsIn > 0) return { text: `Off in ${formatCountdown(startsIn)}`, live: false };
  if (startsIn > -WATCH_WINDOW_MS) return { text: "Live", live: true };
  return { text: "Result soon", live: false };
}

/** Your races: entered and live first, then results (unseen ones never say how it went). */
function YourRaces({ state, now }: { state: PlayerState; now: number | null }) {
  const inbox = state.inbox.filter((i) => i.raceId).slice(0, 6);
  if (state.active.length === 0 && inbox.length === 0) return null;
  return (
    <section aria-labelledby="inbox-h">
      <SectionHeader id="inbox-h" title="Your races" />
      <ul className="surface rows" data-testid="your-races">
        {state.active.map((a) => {
          const st = statusOf(a, now);
          return (
            <li key={`${a.raceId}:${a.horseId}`}>
              <Link href={`/race/${a.raceId}`} className="row-link group gap-3 px-3 py-2" data-testid="inbox-race" data-state={st.live ? "live" : "entered"}>
                <span className={`chip shrink-0 ${st.live ? "chip-live" : "text-cream"}`}>
                  {st.live && <span className="live-dot !h-1.5 !w-1.5" />}
                  {st.text}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-extrabold group-hover:underline">{a.horseName}</span>
                  <span className="t-meta block truncate">
                    {a.kind === "live" ? "Live" : "Story"} · {a.raceName} · {formatClock(a.postTimeMs)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        {inbox.map((i) => (
          <InboxRow key={i.id} item={i} horseName={state.horses.find((h) => h.id === i.horseId)?.horse.name} />
        ))}
      </ul>
    </section>
  );
}

function InboxRow({ item, horseName }: { item: InboxView; horseName?: string }) {
  const pos = typeof item.data?.position === "number" ? (item.data.position as number) : null;
  const prize = typeof item.data?.prize === "number" ? (item.data.prize as number) : 0;
  return (
    <li>
      <Link href={`/race/${item.raceId}`} className="row-link group gap-3 px-3 py-2" data-testid="inbox-result" data-read={item.read ? "1" : "0"}>
        {item.read ? (
          <span className="num w-10 shrink-0 text-lg text-cream">{pos ? ordinal(pos) : "–"}</span>
        ) : (
          <span className="chip shrink-0 text-cream">▶ Result ready</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-extrabold group-hover:underline">{horseName ?? "Your horse"}</span>
          <span className="t-meta block truncate">{item.read ? item.title : "We haven’t told you how it went."}</span>
        </span>
        {item.read && <span className={`num shrink-0 ${prize > 0 ? "text-positive" : "text-sage"}`}>{prize > 0 ? `+${prize}` : "–"}</span>}
      </Link>
    </li>
  );
}

/** The default next action: Quick Pick runs your best-suited fresh horse in a Story race (or enter the Live card). */
function QuickPickHero({ s, firstRace }: { s: StableHorse; firstRace: boolean }) {
  const entry = useEntry();
  const horse = s.horse;
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
                <span className={conditionLabel(s).tone}>✓ {conditionLabel(s).text}</span> · {STYLE_LABEL[horse.style]} · best{" "}
                {formatDistance(horse.preferredDistanceM)} on {SURFACE_LABEL[horse.preferredSurface].toLowerCase()} · {s.starts}/{s.maxStarts} starts
              </p>
            </div>
          </div>
          <p className="mt-3 max-w-prose text-cream-dim">{horseSummary(horse)}</p>
          <p className="caption mt-1">Quick Pick sends your best-suited fresh horse, ridden to its natural style. Story races are free.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ActionBar>
              <button type="button" className="btn btn-brass btn-lg" onClick={entry.quickPick} data-testid="quick-pick">
                <PixelIcon name="flag" size={32} className="-my-2" /> Race now
              </button>
            </ActionBar>
            <button type="button" className="btn-ghost inline-flex min-h-11 items-center font-bold" onClick={() => entry.open(s.id, { picker: true })}>
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
      Story race
    </button>
  );
}

function YourRace({ race, now }: { race: ActiveEntry; now: number }) {
  const startsIn = race.postTimeMs - now;
  return (
    <section className="frame-hero p-4" aria-labelledby="yours-h" data-testid="up-next">
      <p className="text-sm font-extrabold text-cream-dim">{startsIn > 0 ? "Your race is about to start" : "Your race is running"}</p>
      <h2 id="yours-h" className="t-display-l">
        {race.horseName}
      </h2>
      <p className="t-meta">
        {race.kind === "live" ? "Live" : "Story"} · {race.raceName} · {startsIn > 0 ? `off in ${formatCountdown(startsIn)}` : "running now"}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ActionBar>
          <Link href={`/race/${race.raceId}`} className="btn btn-brass btn-lg" data-testid="watch-mine">
            <PixelIcon name="play" className="h-4 w-4" /> Watch {race.horseName}
          </Link>
        </ActionBar>
        <QuickPickAgain />
      </div>
    </section>
  );
}

function ResultReady({ item, count, horseName }: { item: InboxView; count: number; horseName?: string }) {
  return (
    <section className="frame-hero p-4" aria-labelledby="ready-result-h" data-testid="up-next">
      <p className="text-sm font-extrabold text-cream-dim">▶ {count > 1 ? `While you were away: ${count} results are ready` : "Result ready"}</p>
      <h2 id="ready-result-h" className="t-display-l">
        {horseName ?? "Your horse"}&rsquo;s race
      </h2>
      <p className="t-meta">Run at {formatClock(item.createdAtMs)}. We haven&rsquo;t told you how it went.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ActionBar>
          <Link href={`/race/${item.raceId}`} className="btn btn-brass btn-lg" data-testid="see-result">
            <PixelIcon name="play" className="h-4 w-4" /> See the result
          </Link>
        </ActionBar>
        <QuickPickAgain />
      </div>
    </section>
  );
}

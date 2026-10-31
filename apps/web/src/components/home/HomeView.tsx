"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ActiveEntry, DailyGoalView, InboxView, RaceSummary, StableHorse } from "@/lib/types";
import type { HorseAppearance } from "@thoroughbred/shared";
import { useNow } from "@/lib/clock";
import { STYLE_LABEL, SURFACE_LABEL, formatClock, formatCountdown, formatDistance, ordinal } from "@/lib/format";
import { recommendHorse, usePlayerState, type PlayerState } from "@/lib/player";
import { Countdown } from "../Countdown";
import { HorsePortrait } from "../HorsePortrait";
import { conditionLabel } from "../entry/EntryForm";
import { useEntry } from "../entry/EntryProvider";
import { PixelIcon } from "../icons";
import { ActionBar } from "../ui/ActionBar";
import { Section } from "../ui/Page";
import { Diorama } from "../diorama/Diorama";
import { DioramaSlot } from "../diorama/DioramaSlot";
import { Wordmark } from "../SiteNav";
import { StableNews } from "../moments/StableNews";
import { TodayTiles } from "./TodayTiles";
import { EstateStage, YARD, salutation, type EstatePlaque } from "./EstateStage";

interface ClubProps {
  next: RaceSummary | null;
  live: RaceSummary | null;
  recent: RaceSummary[];
  /** Closed playtest: founding a stable needs an invite code. */
  inviteOnly?: boolean;
}

/** A race you're in counts as "yours to watch" from entry until a few minutes after the off. */
const WATCH_WINDOW_MS = 4 * 60_000;

/** Home: your yard (scene), the one next action, Today, your horses, then what's on the course. */
export function HomeView(props: ClubProps) {
  const state = usePlayerState();
  // While one of your races is pending, refresh so results land without a reload.
  const pending = !!state && (state.active.length > 0 || state.inbox.some((i) => !i.read && i.raceId));
  usePlayerState({ pollMs: pending ? 10_000 : undefined });
  if (state === undefined) return <div className="min-h-[60vh]" aria-busy />;
  if (state === null) return <Welcome {...props} />;
  return <Yard state={state} {...props} />;
}

// ---------------------------------------------------------------------------
// Signed out: the live race first, the wordmark, one call to action
// ---------------------------------------------------------------------------

const CHAPTERS: { scene: "barn" | "paddock" | "grandstand"; eyebrow: string; title: string; text: string }[] = [
  {
    scene: "barn",
    eyebrow: "Your stable",
    title: "Raise champions, foal by foal.",
    text: "Every horse is born from real genetics: its coat, its build, its trip and its temperament. Care for them, train them, and breed the next generation.",
  },
  {
    scene: "paddock",
    eyebrow: "Story",
    title: "Take on the rival stables.",
    text: "A career against the Club's houses: small fields, big ambitions. Win your licences and step up to the County Circuit.",
  },
  {
    scene: "grandstand",
    eyebrow: "Live at Kestrel Downs",
    title: "Three race meetings a day. Everyone watches the same finish.",
    text: "Enter Live races against real stables. Every result is sealed before the off and replayable to the last stride.",
  },
];

function Welcome({ next, live, recent, inviteOnly }: ClubProps) {
  return (
    <div>
      <section className="landing bleed" data-testid="home-band" aria-label="Post Time">
        <Diorama scene="track-dusk" aspect={null} priority label="Racehorses cantering down to the post at dusk" style={{ position: "absolute", inset: 0 }} />
        <div className="landing-fade" aria-hidden />
        <div className="landing-hero">
          <p className="eyebrow">A racing stable game · free</p>
          <span className="landing-wordmark">
            <Wordmark />
          </span>
          <h1 className="landing-title">Breed a dynasty. Race it live.</h1>
          <p className="landing-sub">{inviteOnly ? "We're in a small closed playtest. Got an invite? Your stable is one tap away." : "Found a stable in one tap, no email. Your first race is about a minute away."}</p>
          <div className="landing-actions">
            <Link href="/play" className="btn btn-brass btn-lg" data-testid="found-stable">
              <PixelIcon name="horseshoe" size={32} className="-my-2" /> {inviteOnly ? "I have an invite" : "Found your stable"}
            </Link>
            {(live ?? next) && (
              <Link href={`/race/${(live ?? next)!.id}`} className="btn btn-lg" data-testid="watch-next">
                {live ? (
                  <>
                    <span className="live-dot" /> Watch live
                  </>
                ) : (
                  <>
                    Watch the next race · <Countdown targetMs={next!.postTimeMs} doneLabel="off" />
                  </>
                )}
              </Link>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-0">
        {CHAPTERS.map((c, i) => (
          <section key={c.scene} className={`chapter bleed ${i % 2 ? "chapter-right" : ""}`} aria-labelledby={`ch-${c.scene}`}>
            <DioramaSlot scene={c.scene} alt="" priority={false} />
            <div className="chapter-fade" aria-hidden />
            <div className="chapter-body">
              <p className="eyebrow">{c.eyebrow}</p>
              <h2 id={`ch-${c.scene}`} className="chapter-title">
                {c.title}
              </h2>
              <p className="chapter-text">{c.text}</p>
            </div>
          </section>
        ))}
      </div>

      {recent.length > 0 && (
        <Section title="Latest results" href="/races" linkLabel="Race card" className="mx-auto max-w-5xl">
          <ul className="surface rows">
            {recent.slice(0, 3).map((r) => (
              <ResultRow key={r.id} race={r} />
            ))}
          </ul>
        </Section>
      )}
      <div className="mx-auto mt-10 grid max-w-3xl justify-items-center gap-3 text-center">
        <p className="t-h2">Your first horses are waiting.</p>
        <Link href="/play" className="btn btn-brass btn-lg">
          <PixelIcon name="horseshoe" size={32} className="-my-2" /> {inviteOnly ? "I have an invite" : "Found your stable"}
        </Link>
      </div>
    </div>
  );
}

function ResultRow({ race }: { race: RaceSummary }) {
  return (
    <li>
      <Link href={`/race/${race.id}`} className="row-link gap-3 px-4 py-3" data-testid="recent-race">
        <PixelIcon name="rosette" size={32} />
        <span className="min-w-0 flex-1">
          <span className="t-title block">{race.winner ? race.winner.name : "Running now"}</span>
          <span className="t-meta block">{race.winner ? `Won the ${race.name}` : race.name}</span>
        </span>
        <span className="chev">›</span>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Signed in
// ---------------------------------------------------------------------------

function greeting(now: number | null): string {
  if (now === null) return " ";
  const d = new Date(now);
  const day = d.toLocaleDateString("en-GB", { weekday: "long" });
  const h = d.getHours();
  return `${day} ${h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night"}`;
}

function Yard({ state, next, live }: ClubProps & { state: PlayerState }) {
  const now = useNow(1000);
  // Your own race: about to start or running -> watch it; finished but unseen -> see the result (no spoilers).
  const upcomingMine = now === null ? undefined : [...state.active].sort((a, b) => a.postTimeMs - b.postTimeMs).find((a) => a.postTimeMs > now - WATCH_WINDOW_MS);
  const unseen = state.inbox.filter((i) => !i.read && i.raceId && i.raceId !== upcomingMine?.raceId && i.kind !== SPONSOR_NOTE);
  const rec = recommendHorse(state);
  const entry = useEntry();
  // The hero features one horse's run: skip that run below, not every horse in the same race.
  const heroRun = upcomingMine ? { raceId: upcomingMine.raceId, horseId: upcomingMine.horseId } : unseen[0]?.raceId ? { raceId: unseen[0].raceId, horseId: unseen[0].horseId } : null;
  const horseOf = (id: string | null | undefined) => state.horses.find((h) => h.id === id);

  const plaques: EstatePlaque[] = [
    {
      id: "racecourse",
      label: "Racecourse",
      status: live ? "Live now" : next && now !== null ? (next.postTimeMs > now ? `Off in ${formatCountdown(next.postTimeMs - now)}` : "At the post") : undefined,
      href: "/races",
      at: [YARD.arch],
    },
    { id: "barn", label: "The Barn", status: `${state.horses.length} ${state.horses.length === 1 ? "horse" : "horses"}`, href: "/stable", at: [YARD.stallsMid, YARD.stallsLeft] },
    { id: "trophy", label: "Trophy Room", href: "/trophies", at: [YARD.tower] },
    { id: "breeding", label: "Breeding Barn", href: "/breeding", at: [YARD.stallsRight, YARD.stallsRightIn, YARD.stallsLeft] },
    { id: "gallops", label: "Gallops", href: rec ? `/horse/${rec.id}/training` : "/stable", at: [YARD.hayLow] },
    { id: "sales", label: "Sales Ring", href: "/market", at: [YARD.trough] },
  ];

  return (
    <div>
      <EstateStage eyebrow={`${state.stableName} · ${greeting(now)}`} greeting={`${salutation(now)}, trainer.`} plaques={plaques}>
        {upcomingMine ? (
          <YourRace race={upcomingMine} now={now ?? 0} appearance={horseOf(upcomingMine.horseId)?.horse.appearance} />
        ) : unseen[0] ? (
          <ResultReady item={unseen[0]} count={unseen.length} horse={horseOf(unseen[0].horseId)} />
        ) : rec ? (
          <QuickPickHero s={rec} firstRace={state.runs.length === 0} />
        ) : (
          <Hero tag={<span className="tag">Resting</span>} title="Your horses are resting" testId="up-next" body="They're entered or recovering, and can race again soon. A groom builds their bond meanwhile.">
            <Link href="/stable" className="btn btn-lg w-full sm:w-auto">
              Go to the stable
            </Link>
          </Hero>
        )}
        {next && <NextRaceCard next={next} live={live} entries={state.entries.balance} />}
      </EstateStage>

      <Link href="/week" className="surface mt-4 flex items-center justify-between gap-3 p-4" data-testid="home-week">
        <span className="flex items-center gap-3">
          <PixelIcon name="trophy" size={32} />
          <span>
            <span className="t-title block">Road to Saturday</span>
            <span className="caption block">This week&rsquo;s Feature, your Qualifiers and the League line</span>
          </span>
        </span>
        <span className="btn btn-sm">This week</span>
      </Link>

      <TodayTiles refreshKey={`${state.credits}:${state.horses.length}:${state.runs.length}`} />

      <DailyGoalsCard goals={state.goals ?? []} />

      <YourRaces state={state} now={now} skip={heroRun} />

      <StableNews items={state.news ?? []} />

      <Section id="pulse-h" title="Your horses" href="/stable" linkLabel="Stable">
        <ul className="-mx-[var(--gutter)] flex gap-3 overflow-x-auto px-[var(--gutter)] pb-2 md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] md:px-0" data-testid="stable-pulse">
          {state.horses.map((s) => {
            const racing = s.lockedRaceId !== null;
            const cond = conditionLabel(s);
            const tone = racing ? "dot-brass" : s.block || s.condition === "tired" ? "dot-warn" : "dot-pos";
            return (
              <li key={s.id} className="shrink-0">
                <Link href={`/horse/${s.id}`} className="surface flex w-40 flex-col gap-2 p-3 md:w-auto">
                  <span className="well grid h-[128px] place-items-center overflow-hidden">
                    <HorsePortrait appearance={s.horse.appearance} scale={1} />
                  </span>
                  <span className="t-title leading-tight">{s.horse.name}</span>
                  <span className="flex items-center gap-1.5 text-[0.8125rem] font-bold text-cream-dim">
                    <i className={`dot ${tone}`} aria-hidden />
                    {racing ? "Entered" : cond.text}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>

    </div>
  );
}

/** Featured card (Estate panel): the horse's portrait in a well, the story, then the actions. */
function Hero({
  tag,
  title,
  body,
  appearance,
  children,
  testId,
  footer,
}: {
  tag: ReactNode;
  title: ReactNode;
  body: ReactNode;
  appearance?: HorseAppearance;
  children: ReactNode;
  testId: string;
  footer?: ReactNode;
}) {
  return (
    <section className="frame-hero p-4" data-testid={testId} aria-labelledby={`${testId}-h`}>
      <div className="flex items-start gap-4">
        {appearance && (
          <span className="well grid h-[96px] w-[96px] shrink-0 place-items-center overflow-hidden md:h-[128px] md:w-[128px]">
            <span className="md:hidden">
              <HorsePortrait appearance={appearance} scale="thumb" />
            </span>
            <span className="hidden md:block">
              <HorsePortrait appearance={appearance} scale={1} />
            </span>
          </span>
        )}
        <div className="min-w-0 flex-1">
          {tag}
          <h2 id={`${testId}-h`} className="t-hero mt-1.5">
            {title}
          </h2>
          <p className="mt-1 text-[0.875rem] leading-5 text-cream-dim">{body}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">{children}</div>
      {footer}
    </section>
  );
}

/** The next race on the shared card: name, conditions, a broadcast countdown, Enter and Watch. */
function NextRaceCard({ next, live, entries }: { next: RaceSummary; live: RaceSummary | null; entries: number }) {
  const entry = useEntry();
  return (
    <section className="surface p-4" data-testid="next-race" aria-labelledby="next-race-h">
      {live && (
        <Link href={`/race/${live.id}`} className="mb-3 flex items-center gap-2 text-[0.8125rem] font-bold text-cream-dim">
          <span className="tag tag-live">
            <span className="live-dot" /> Live
          </span>
          <span className="min-w-0 flex-1 truncate">{live.name}</span>
          <span className="link inline-flex items-center gap-1">
            Watch <PixelIcon name="arrow" size={12} />
          </span>
        </Link>
      )}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Next on the card</p>
          <h3 id="next-race-h" className="t-serif mt-0.5 text-[1.375rem] leading-7">
            {next.name}
          </h3>
          <p className="t-meta">
            {formatDistance(next.distanceM)} · {SURFACE_LABEL[next.surface]} · {entries} {entries === 1 ? "entry" : "entries"} left today
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="score block text-[2.25rem] leading-none text-brass-hi">
            <Countdown targetMs={next.postTimeMs} doneLabel="Off" />
          </span>
          <span className="eyebrow !text-sage">to post</span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <button type="button" className="btn btn-brass" onClick={entry.quickPickLive} data-testid="live-quick-pick">
          <PixelIcon name="flag" size={32} className="-my-2" /> Enter your best fit
        </button>
        <Link href={`/race/${next.id}`} className="btn" data-testid="watch-next">
          Watch
        </Link>
      </div>
    </section>
  );
}

/** The default next action: Quick Pick runs your best-suited fresh horse in a Story race. */
function QuickPickHero({ s, firstRace }: { s: StableHorse; firstRace: boolean }) {
  const entry = useEntry();
  const horse = s.horse;
  return (
    <Hero
      testId="up-next"
      appearance={horse.appearance}
      tag={
        <span className="tag tag-ready">
          <PixelIcon name="star" size={12} /> {firstRace ? "Your first race" : "Ready to race"}
        </span>
      }
      title={`${horse.name} is ready`}
      body={`${STYLE_LABEL[horse.style]} · best at ${formatDistance(horse.preferredDistanceM)} on ${SURFACE_LABEL[horse.preferredSurface].toLowerCase()}. A Story race against the Club is free.`}
    >
      <ActionBar>
        <button type="button" className="btn btn-brass btn-lg" onClick={entry.quickPick} data-testid="quick-pick">
          <PixelIcon name="flag" size={32} className="-my-2" /> Race {horse.name} now
        </button>
      </ActionBar>
      <button type="button" className="btn-ghost btn justify-self-start" onClick={() => entry.open(s.id, { picker: true })}>
        Choose horse &amp; plan
      </button>
    </Hero>
  );
}

/** Secondary Story race when the primary action is about a race you already entered. */
function QuickPickAgain() {
  const entry = useEntry();
  return (
    <button type="button" className="btn-ghost btn justify-self-start" onClick={entry.quickPick} data-testid="quick-pick">
      Or start a Story race
    </button>
  );
}

function YourRace({ race, now, appearance }: { race: ActiveEntry; now: number; appearance?: HorseAppearance }) {
  const startsIn = race.postTimeMs - now;
  return (
    <Hero
      testId="up-next"
      appearance={appearance}
      tag={
        startsIn > 0 ? (
          <span className="tag tag-ready">Off in {formatCountdown(startsIn)}</span>
        ) : (
          <span className="tag tag-live">
            <span className="live-dot" /> Running now
          </span>
        )
      }
      title={`${race.horseName} is in the ${race.raceName}`}
      body={race.kind === "live" ? "A Live race at Kestrel Downs: everyone watches the same finish." : "A Story race against the Club."}
    >
      <ActionBar>
        <Link href={`/race/${race.raceId}`} className="btn btn-brass btn-lg" data-testid="watch-mine">
          <PixelIcon name="stopwatch" size={32} className="-my-2" /> Watch {race.horseName}
        </Link>
      </ActionBar>
      <QuickPickAgain />
    </Hero>
  );
}

function ResultReady({ item, count, horse }: { item: InboxView; count: number; horse?: StableHorse }) {
  const name = horse?.horse.name ?? "Your horse";
  return (
    <Hero
      testId="up-next"
      appearance={horse?.horse.appearance}
      tag={
        <span className="tag tag-ready">
          <PixelIcon name="play" size={12} /> {count > 1 ? `${count} results ready` : "Result ready"}
        </span>
      }
      title={`${name} has run`}
      body={`Off at ${formatClock(item.createdAtMs)}. The replay is waiting; we haven't said how it went.`}
    >
      <ActionBar>
        <Link href={`/race/${item.raceId}`} className="btn btn-brass btn-lg" data-testid="see-result">
          <PixelIcon name="stopwatch" size={32} className="-my-2" /> Watch the finish
        </Link>
      </ActionBar>
      <QuickPickAgain />
    </Hero>
  );
}

/** Today's three goals: a tick or an empty box, the job, and what it pays. No streaks. */
function DailyGoalsCard({ goals }: { goals: DailyGoalView[] }) {
  if (goals.length === 0) return null;
  const left = goals.filter((g) => !g.done).length;
  return (
    <Section id="goals-h" title="Today's goals" testId="daily-goals" aside={<span className="eyebrow">{left} to do</span>}>
      <ul className="surface rows">
        {goals.map((g) => (
          <li key={g.goal} className="flex items-center gap-3 px-4 py-3" data-testid={`goal-${g.goal}`} data-done={g.done ? "1" : "0"}>
            {g.done ? (
              <span className="shrink-0 font-bold text-brass-hi" aria-hidden>
                ✓
              </span>
            ) : (
              <span className="h-4 w-4 shrink-0 rounded-sm border-2 border-cream-dim" aria-hidden />
            )}
            <span className={`t-title min-w-0 flex-1 ${g.done ? "text-cream-dim" : ""}`}>
              <span className="sr-only">{g.done ? "Done: " : "To do: "}</span>
              {g.label}
            </span>
            <span className={`num shrink-0 ${g.done ? "reward" : "text-cream-dim"}`}>+{g.credits}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function statusOf(a: ActiveEntry, now: number | null): { text: string; live: boolean } {
  const startsIn = now === null ? 0 : a.postTimeMs - now;
  if (startsIn > 0) return { text: `Off in ${formatCountdown(startsIn)}`, live: false };
  if (startsIn > -WATCH_WINDOW_MS) return { text: "Live", live: true };
  return { text: "Result soon", live: false };
}

/** Your races: entered and live first, then results (unseen ones never say how it went). */
function YourRaces({ state, now, skip }: { state: PlayerState; now: number | null; skip: { raceId: string; horseId: string | null } | null }) {
  const isHero = (raceId: string | null, horseId: string | null) => !!skip && raceId === skip.raceId && (skip.horseId === null || horseId === skip.horseId);
  const active = state.active.filter((a) => !isHero(a.raceId, a.horseId));
  const inbox = state.inbox.filter((i) => i.raceId && !isHero(i.raceId, i.horseId)).slice(0, 5);
  if (active.length === 0 && inbox.length === 0) return null;
  return (
    <Section id="inbox-h" title="Your races" href="/me/races" linkLabel="All" testId="your-races-section">
      <ul className="surface rows" data-testid="your-races">
        {active.map((a) => {
          const st = statusOf(a, now);
          return (
            <li key={`${a.raceId}:${a.horseId}`}>
              <Link href={`/race/${a.raceId}`} className="row-link gap-3 px-4 py-3" data-testid="inbox-race" data-state={st.live ? "live" : "entered"}>
                <span className={`tag shrink-0 ${st.live ? "tag-live" : "tag-ready"}`}>
                  {st.live && <span className="live-dot" />}
                  {st.text}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="t-title block">{a.horseName}</span>
                  <span className="t-meta block line-clamp-2">
                    {a.kind === "live" ? "Live" : "Story"} · {a.raceName}
                  </span>
                </span>
                <span className="chev">›</span>
              </Link>
            </li>
          );
        })}
        {inbox.map((i) => (
          <InboxRow key={i.id} item={i} horseName={state.horses.find((h) => h.id === i.horseId)?.horse.name} />
        ))}
      </ul>
    </Section>
  );
}

/** Inbox kind of a sponsored race's result note (packages/db sponsorship.ts). */
const SPONSOR_NOTE = "race_sponsor";

function InboxRow({ item, horseName }: { item: InboxView; horseName?: string }) {
  if (item.kind === SPONSOR_NOTE) {
    return (
      <li>
        <Link href={`/race/${item.raceId}`} className="row-link gap-3 px-4 py-3" data-testid="inbox-sponsor" data-read={item.read ? "1" : "0"}>
          <span className="tag tag-ready shrink-0">Sponsor</span>
          <span className="min-w-0 flex-1">
            <span className="t-title block">Your sponsored race</span>
            <span className="t-meta block line-clamp-2">{item.read ? item.title : "It has been run: watch the finish."}</span>
          </span>
          <span className="chev">›</span>
        </Link>
      </li>
    );
  }
  const pos = typeof item.data?.position === "number" ? (item.data.position as number) : null;
  const prize = typeof item.data?.prize === "number" ? (item.data.prize as number) : 0;
  return (
    <li>
      <Link href={`/race/${item.raceId}`} className="row-link gap-3 px-4 py-3" data-testid="inbox-result" data-read={item.read ? "1" : "0"}>
        {item.read ? <span className="score w-10 shrink-0 text-center text-[1.75rem]">{pos ? ordinal(pos) : "–"}</span> : (
          <span className="tag tag-ready shrink-0">
            <PixelIcon name="play" size={12} /> Ready
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="t-title block">{horseName ?? "Your horse"}</span>
          <span className="t-meta block line-clamp-2">{item.read ? item.title : "We haven’t told you how it went."}</span>
        </span>
        {item.read && prize > 0 ? <span className="reward shrink-0">+{prize}</span> : <span className="chev">›</span>}
      </Link>
    </li>
  );
}


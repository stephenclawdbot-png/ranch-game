"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChapterView, StoryRaceView, StoryView } from "@/lib/competitionTypes";
import { CLASS_LABEL, STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance, ordinal } from "@/lib/format";
import { api, usePlayerState } from "@/lib/player";
import type { RaceClass } from "@thoroughbred/shared";
import { JoinNudge } from "../PlayerGate";
import { Silks } from "../Silks";
import { GradeBadge } from "../StatBars";
import { PixelIcon } from "../icons";
import { ErrorNote } from "../ui/ErrorNote";
import { PositionBadge } from "../ui/PositionBadge";
import { TrackTile } from "../RaceList";
import { HowItWorks, SceneArt, SceneBand } from "../ui/Page";

type Mode = "watch" | "instant";

function RaceAction({ race, chapter }: { race: StoryRaceView; chapter: ChapterView }) {
  const router = useRouter();
  const state = usePlayerState();
  const [open, setOpen] = useState(false);
  const [horseId, setHorseId] = useState<string>(race.bestHorse?.id ?? "");
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ready = (state?.horses ?? []).filter((h) => h.block === null);

  if (!chapter.unlocked) {
    return (
      <p className="caption flex items-center gap-1.5 text-cream-dim">
        <span className="tag tag-locked">Locked</span> Needs a {chapter.licenceRequired.name}
      </p>
    );
  }
  if (!race.bestHorse) return <p className="caption text-cream-dim">None of your horses can race right now. Story races are free whenever one is ready.</p>;

  async function go(mode: Mode) {
    setBusy(mode);
    setError(null);
    try {
      const res = await api<{ raceId: string }>("/api/story/race", { body: { raceKey: race.key, horseId: horseId || undefined, pick: horseId ? undefined : "auto", instant: mode === "instant" } });
      router.push(`/race/${res.raceId}`);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-sm w-fit" onClick={() => setOpen(true)} data-testid="story-race-open" data-race-key={race.key}>
        Race {race.bestHorse.name}
      </button>
    );
  }
  return (
    <div className="surface-2 grid gap-3 p-3" data-testid="story-race-sheet">
      <label className="grid gap-1">
        <span className="label text-cream-dim">Horse</span>
        <select className="field min-h-11" value={horseId} onChange={(e) => setHorseId(e.target.value)} data-testid="story-horse">
          {ready.map((h) => (
            <option key={h.id} value={h.id}>
              {h.horse.name} · {STYLE_LABEL[h.horse.style]} · {h.horse.preferredDistanceM.toLocaleString("en-GB")} m {h.horse.preferredSurface}
              {h.id === race.bestHorse?.id ? " (best fit)" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-brass" disabled={busy !== null} onClick={() => go("watch")} data-testid="story-watch">
          <PixelIcon name="stopwatch" size={32} className="-my-2" /> {busy === "watch" ? "Going to post…" : "Watch the race"}
        </button>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => go("instant")} data-testid="story-instant">
          {busy === "instant" ? "Running…" : "Skip to result"}
        </button>
        <button type="button" className="btn-ghost min-h-11 px-2 font-bold" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error !== null && <ErrorNote error={error} />}
    </div>
  );
}

function RaceCard({ race, chapter, rivals }: { race: StoryRaceView; chapter: ChapterView; rivals: StoryView["rivals"] }) {
  const names = race.rivals.map((id) => rivals.find((r) => r.id === id)).filter(Boolean) as StoryView["rivals"];
  return (
    <li id={`race-${race.key}`} className="surface grid scroll-mt-28 content-start gap-3 p-4" data-testid="story-race" data-race-key={race.key} data-won={race.won || undefined}>
      <div className="flex items-start gap-3">
        <TrackTile surface={race.surface}>
          <span className="score block text-[1.375rem] leading-none">{race.order}</span>
          <span className="block text-[0.6875rem] font-bold leading-4 opacity-90">Race</span>
        </TrackTile>
        <div className="min-w-0 flex-1">
          <h3 className="t-title">{race.name}</h3>
          <p className="t-meta">
            {formatDistance(race.distanceM)} {SURFACE_LABEL[race.surface].toLowerCase()} · {CLASS_LABEL[race.raceClass as RaceClass] ?? race.raceClass} · {race.track}
          </p>
        </div>
        {race.won ? (
          <span className="tag tag-you shrink-0">✓ Won</span>
        ) : (
          <span className="shrink-0 text-right">
            <span className="reward block">+{formatCredits(race.firstWinReward)}</span>
            <span className="caption block">first win</span>
          </span>
        )}
      </div>
      <p className="t-meta line-clamp-2">{race.intro}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="caption text-cream-dim">Rivals:</span>
        {names.map((r) => (
          <span key={r.id} className="flex items-center gap-1.5 text-sm font-bold text-cream">
            <Silks silks={r.silks} cap={false} className="h-[16px] w-5" /> {r.name}
          </span>
        ))}
      </div>
      {race.bestHorse && chapter.unlocked && (
        <p className="flex items-center gap-2 text-sm text-cream-dim">
          <GradeBadge grade={race.bestHorse.grade} size="sm" /> Your best fit: <span className="font-bold text-cream">{race.bestHorse.name}</span>
        </p>
      )}
      <RaceAction race={race} chapter={chapter} />
    </li>
  );
}

function ChapterPanel({ chapter, view }: { chapter: ChapterView; view: StoryView }) {
  const pct = Math.min(100, Math.round((Math.min(chapter.wins, chapter.winsToComplete) * 100) / chapter.winsToComplete));
  return (
    <section className="grid gap-4" aria-labelledby={`ch-${chapter.id}`} data-testid="story-chapter" data-chapter={chapter.id}>
      <div className="frame-hero grid gap-3 overflow-hidden p-4 sm:p-5">
        <div className="relative -mx-4 -mt-4 h-28 overflow-hidden sm:-mx-5 sm:-mt-5 [--bh:112px] [--k:1] md:h-40 md:[--bh:160px]">
          <SceneArt scene={chapter.number % 2 ? "paddock" : "grandstand"} alt="" />
          <span className="absolute bottom-2 left-4 tag tag-ready">Chapter {chapter.number}</span>
        </div>
        <div>
          <p className="eyebrow">{chapter.tagline}</p>
          <h2 id={`ch-${chapter.id}`} className="t-hero">
            {chapter.title}
          </h2>
        </div>
        <p className="t-meta line-clamp-3">{chapter.complete ? chapter.outro : chapter.intro}</p>
        <div className="grid gap-1">
          <div className="flex justify-between text-sm font-bold">
            <span className="text-cream">
              {Math.min(chapter.wins, chapter.winsToComplete)} of {chapter.winsToComplete} wins
              {chapter.complete ? " · complete ✓" : ""}
            </span>
            <span className="text-cream-dim">
              {formatCredits(chapter.earned)} / {formatCredits(chapter.cap)} credits
            </span>
          </div>
          <div className="flex gap-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={chapter.winsToComplete} aria-valuenow={Math.min(chapter.wins, chapter.winsToComplete)} aria-label="Chapter progress" data-pct={pct}>
            {Array.from({ length: chapter.winsToComplete }, (_, i) => (
              <span key={i} className={`pip ${i < chapter.wins ? "on" : ""}`} />
            ))}
          </div>
          <p className="caption text-cream-dim">
            {chapter.unlocked ? (
              <>
                Reward: <span className="font-bold text-cream">{chapter.licenceEarned.name}</span> ({chapter.licenceEarned.unlocks}). First wins pay in full; replays pay a little, up to
                the chapter&rsquo;s credit cap.
              </>
            ) : (
              <>Locked: needs a {chapter.licenceRequired.name}. Win three races of the previous chapter.</>
            )}
          </p>
        </div>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {chapter.races.map((r) => (
          <RaceCard key={r.key} race={r} chapter={chapter} rivals={view.rivals} />
        ))}
      </ul>
    </section>
  );
}

export function StoryScreen({ view, signedIn }: { view: StoryView; signedIn: boolean }) {
  const [tab, setTab] = useState(view.current);
  const chapter = view.chapters.find((c) => c.id === tab) ?? view.chapters[0]!;
  const beat = (raceKey: string | null, position: number) => {
    if (!raceKey) return null;
    const r = view.chapters.flatMap((c) => c.races).find((x) => x.key === raceKey);
    return r ? (position === 1 ? r.win : r.loss) : null;
  };
  return (
    <div className="grid gap-6">
      <SceneBand scene="paddock" alt="The paddock" eyebrow="Your career, solo" title="Story" />
      <HowItWorks className="-mt-2">
        <p>From the Club to the Classics, against named rival stables. Story races are free (no stable entries) and you can watch or skip to the result.</p>
        <p>Win three races in a chapter to earn its licence, which opens bigger Live races. First wins pay in full; replays pay a little, up to the chapter&rsquo;s credit cap.</p>
      </HowItWorks>

      {!signedIn && <JoinNudge compact />}

      <section className="surface flex flex-wrap items-center gap-3 p-4" aria-label="Your licence" data-testid="story-licence">
        <PixelIcon name="shield" size={32} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="t-title text-cream">{view.licence.name}</p>
          <p className="t-meta">Live races open to you: {view.licence.unlocks.join("; ")}.</p>
        </div>
      </section>

      <div className="tabs -mx-[var(--gutter)] !px-[var(--gutter)] baize-scope" role="tablist" aria-label="Chapters">
        {view.chapters.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={tab === c.id} aria-pressed={tab === c.id} onClick={() => setTab(c.id)} data-testid="chapter-tab">
            {c.title}
            {c.complete ? " ✓" : c.unlocked ? "" : " · locked"}
          </button>
        ))}
      </div>

      <ChapterPanel chapter={chapter} view={view} />

      {view.recent.length > 0 && (
        <section aria-labelledby="recent-h">
          <h2 id="recent-h" className="t-h2 mb-3">
            Latest from the paddock
          </h2>
          <ul className="surface rows" data-testid="story-recent">
            {view.recent.map((r) => (
              <li key={r.raceId}>
                <Link href={`/race/${r.raceId}`} className="row-link gap-3 px-3 py-2">
                  {r.position > 0 ? <PositionBadge position={r.position} size="sm" /> : <span className="chip shrink-0">▶ Watch</span>}
                  <span className="min-w-0 flex-1">
                    <span className="t-title block truncate text-cream">{r.name}</span>
                    <span className="t-meta block">
                      {r.horseName}
                      {r.position > 0 ? ` · ${ordinal(r.position)} of ${r.fieldSize}` : " · result after the race"}
                    </span>
                    {r.position > 0 && beat(r.raceKey, r.position) && <span className="caption mt-0.5 block text-cream-dim">{beat(r.raceKey, r.position)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="rivals-h">
        <h2 id="rivals-h" className="t-h2 mb-3">
          Rival stables
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="story-rivals">
          {view.rivals.map((r) => (
            <li key={r.id} className="surface grid content-start gap-2 p-4" data-testid="rival">
              <div className="flex items-center gap-3">
                <Silks silks={r.silks} className="h-[39px] w-12 shrink-0" />
                <div className="min-w-0">
                  <p className="t-title text-cream">{r.name}</p>
                  <p className="t-meta">
                    {r.trainer} · <span className="chip !px-1.5 !py-0 text-xs">{r.personality}</span>
                  </p>
                </div>
              </div>
              <p className="t-meta line-clamp-3">{r.bio}</p>
              <p className="text-sm italic text-cream">&ldquo;{r.greeting}&rdquo;</p>
              {r.met ? (
                <p className="caption font-bold text-cream-dim">
                  Head to head: ahead {r.record.ahead} · behind {r.record.behind}
                </p>
              ) : (
                <p className="caption text-cream-dim">Not met yet.</p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

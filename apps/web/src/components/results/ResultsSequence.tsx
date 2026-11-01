"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { RaceReplay } from "@thoroughbred/shared";
import type { InjuryCard, RaceCard } from "@/lib/types";
import * as gc from "@thoroughbred/game-core";
import { analyseRace } from "@/lib/raceAnalysis";
import { energyTrace } from "@/lib/energyTrace";
import { tryNext } from "@/lib/tryNext";
import { raceStory } from "@/lib/raceStory";
import { readyHorses, usePlayerState } from "@/lib/player";
import { prefersCalm } from "@/lib/settings";
import { enterStoryRace } from "../entry/EntryForm";
import { ErrorNote } from "../ui/ErrorNote";
import { useEntry } from "../entry/EntryProvider";
import { PixelIcon } from "../icons";
import { ActionBar } from "../ui/ActionBar";
import { FullResults } from "./FullResults";
import { PhotoFinishCard } from "./PhotoFinishCard";
import { ResultBoard } from "./ResultBoard";
import { RewardCounter } from "./RewardCounter";
import { Verdict } from "./Verdict";
import { WhyCard } from "./WhyCard";
import { WhyRead } from "../onboarding/WhyRead";
import { FirstWinMoment } from "../moments/FirstWinMoment";
import { claimFirstWinMoment, type FirstWinOf } from "@/lib/firstWin";

export interface Settlement {
  /** Credits this result paid (purse + Story reward), settled on the server. */
  prize: number;
  position: number;
  /** True the first time the owner sees this result: stage the reveal and run the count-up. */
  fresh: boolean;
  storyReward?: number;
  firstWin?: boolean;
  ratingBefore?: number;
  ratingAfter?: number | null;
  /** One honest line from the rating rule on why the mark moved (or held); null when there is nothing to explain. */
  ratingWhy?: string | null;
  /** Your horse at the off (fatigue, hours since hard work), for the Why card's "try next". */
  atOff?: { fatigue: number; hoursSinceHardWork: number | null } | null;
  /** An injury picked up in this race, named (shown under the result). */
  injury?: InjuryCard | null;
  /** This win was the stable's first, or the horse's first (the owner's moment, V-08). */
  firstWinOf?: FirstWinOf | null;
}

/** podium -> rewards -> why -> next (each stage stays; the sequence never loops). */
const STAGES = ["board", "reward", "why", "next"] as const;
type Stage = (typeof STAGES)[number];
const DELAY: Record<Stage, number> = {
  board: 0,
  reward: 1100,
  why: 2300,
  next: 3100,
};

/** One-shot pixel confetti for a win (<= 1.2 s, skipped when motion is calm). */
function Confetti() {
  const colors = ["#f2c86a", "#f3e7c9", "#b0392e", "#7fc3ee", "#5aa66f"];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 20 }, (_, i) => (
        <span
          key={i}
          className="absolute bottom-0 h-2 w-2"
          style={{
            left: `${(i * 37) % 100}%`,
            background: colors[i % colors.length],
            animation: `float-up 1000ms steps(10) ${(i % 6) * 40}ms 1 both`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * The staged result reveal for /race/[id]: result board, then the credits roll-up (your
 * horse only), then the "why" card, then the next actions. Skippable; instant when calm.
 * Render it only once the official result exists (`feed.final`).
 */
export function ResultsSequence({
  replay,
  card,
  highlightHorseId,
  settlement,
}: {
  replay: RaceReplay;
  card: RaceCard;
  highlightHorseId?: string;
  settlement: Settlement | null;
}) {
  const [stage, setStage] = useState<Stage>("board");
  const [calm, setCalm] = useState(true);
  const nextRef = useRef<HTMLDivElement>(null);
  const mine = highlightHorseId ? card.field.find((e) => e.horse.id === highlightHorseId) : undefined;
  const winner = card.field.find((e) => e.horse.id === replay.result.finishOrder[0]?.horseId);
  const subject = mine ?? winner;
  const analysis = useMemo(() => (subject ? analyseRace(replay, subject.horse.id, subject.horse, subject.tactic) : null), [replay, subject]);
  const energy = useMemo(() => (subject ? energyTrace(replay, subject.horse.id) : null), [replay, subject]);
  // "Try next": only for your own runner, from what you could see (racecard, fit, your horse's condition)
  const tips = useMemo(
    () =>
      mine && analysis
        ? tryNext({
            analysis,
            horse: mine.horse,
            race: { distanceM: replay.race.distanceM, surface: replay.race.surface, going: replay.race.going },
            course: gc.courseByName(card.track ?? card.course?.name),
            gate: mine.gate,
            weightLb: mine.weightLb ?? null,
            fieldWeightsLb: card.field.filter((e) => e !== mine && typeof e.weightLb === "number").map((e) => e.weightLb!),
            atOff: settlement?.atOff ?? null,
          })
        : [],
    [mine, analysis, replay, card, settlement?.atOff],
  );
  // The verdict: one reason from the engine's record of the run, and (your own runner) one change.
  const state = usePlayerState();
  const myStable = mine ? (state?.horses.find((h) => h.id === mine.horse.id) ?? null) : null;
  const fresh = useMemo(() => {
    if (!mine) return null;
    const others = readyHorses(state).filter((h) => h.id !== mine.horse.id && h.ranToday === 0 && h.condition !== "tired");
    return others.sort((a, b) => b.horse.stats.speed + b.horse.stats.stamina - (a.horse.stats.speed + a.horse.stats.stamina))[0] ?? null;
  }, [state, mine]);
  const story = useMemo(
    () => (analysis && subject ? raceStory({ horseId: subject.horse.id, analysis, horse: subject.horse, replay, tips, yours: Boolean(mine), freshAlternative: fresh?.horse.name ?? null }) : null),
    [analysis, subject, replay, tips, mine, fresh],
  );
  const changeRunner = story?.change ? (story.change.kind === "fresh_horse" ? fresh : myStable) : null;
  const verdictLeads = Boolean(changeRunner && !changeRunner.block);
  // A replay opened later (already settled) has nothing to stage: show it all at once.
  const staged = Boolean(mine && settlement?.fresh);

  useEffect(() => {
    const c = prefersCalm();
    setCalm(c);
    if (c || !staged) {
      setStage("next");
      return;
    }
    const timers = STAGES.slice(1).map((s) => setTimeout(() => setStage((cur) => (STAGES.indexOf(cur) < STAGES.indexOf(s) ? s : cur)), DELAY[s]));
    return () => timers.forEach(clearTimeout);
  }, [staged]);

  useEffect(() => {
    if (stage === "next" && staged) nextRef.current?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true });
  }, [stage, staged]);

  // The player was watching the stage above: bring the fresh reveal (podium, credits, confetti)
  // into view instead of leaving them looking at horses pulling up. Once, and only for a fresh result.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!staged) return;
    const el = rootRef.current;
    if (el && el.getBoundingClientRect().top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: prefersCalm() ? "auto" : "smooth", block: "start" });
  }, [staged]);

  const at = (s: Stage) => STAGES.indexOf(stage) >= STAGES.indexOf(s);
  const won = settlement?.position === 1;

  // The owner's moment for a first win (V-08): once per horse, on the fresh result only
  const [moment, setMoment] = useState<FirstWinOf | null>(null);
  useEffect(() => {
    if (!mine || !settlement || settlement.position !== 1 || !settlement.firstWinOf) return;
    let store: Storage | null = null;
    try {
      store = window.localStorage;
    } catch {
      store = null;
    }
    if (claimFirstWinMoment({ horseId: mine.horse.id, firstWinOf: settlement.firstWinOf, fresh: settlement.fresh }, store)) setMoment(settlement.firstWinOf);
  }, [mine, settlement]);

  return (
    <div ref={rootRef} className="relative grid scroll-mt-28 gap-4" data-testid="results-sequence">
      {stage !== "next" && (
        <div className="flex justify-end">
          <button type="button" className="btn-ghost min-h-11 text-sm font-bold" onClick={() => setStage("next")}>
            Skip to the end ›
          </button>
        </div>
      )}
      {/*
        Your own runner (first-hour playtest, lighter result page): your result, then the verdict
        (why, the one change, Try again) above everything else; the photo card, the board and the
        race in numbers follow. Another stable's race: the photo card and the board lead.
      */}
      {!mine && (
        <>
          <PhotoFinishCard replay={replay} card={card} highlightHorseId={highlightHorseId} settlement={null} />
          <ResultBoard replay={replay} card={card} highlightHorseId={highlightHorseId} />
        </>
      )}
      {mine && moment && (
        <FirstWinMoment
          of={moment}
          horseId={mine.horse.id}
          horseName={mine.horse.name}
          appearance={mine.horse.appearance}
          stableName={mine.stableName ?? null}
          raceName={card.config.name}
          onShare={() => rootRef.current?.querySelector<HTMLButtonElement>('[data-testid="save-photo-card"]')?.click()}
          onClose={() => setMoment(null)}
        />
      )}
      {mine && settlement && at("reward") && (
        <div className="fade-up">
          <RewardCounter
            horseName={mine.horse.name}
            position={settlement.position}
            fieldSize={card.field.length}
            prize={settlement.prize}
            fresh={settlement.fresh}
          />
        </div>
      )}
      {mine && story && at("why") && (
        <div className="fade-up">
          <WhyRead raceId={card.id} enabled>
            <Verdict story={story} horse={myStable} tactic={mine.tactic} fresh={fresh} live={card.kind === "live"} />
          </WhyRead>
        </div>
      )}
      {mine && settlement && at("reward") && (
        <p className="caption px-1" data-testid="settlement-detail">
          {card.kind === "story"
            ? settlement.firstWin
              ? `Story reward: first win in this race, +${settlement.storyReward}.`
              : `Story reward +${settlement.storyReward ?? 0} for running (the first win in each Story race pays much more).`
            : "Purse paid by the Club, settled on the server."}
          {settlement.ratingAfter != null && settlement.ratingBefore != null && settlement.ratingAfter !== settlement.ratingBefore
            ? ` Rating ${settlement.ratingBefore} → ${settlement.ratingAfter}.`
            : ""}
          {/* The why behind the mark (playtest fix 14), from the rule's own expected scores. */}
          {settlement.ratingWhy && (
            <>
              {" "}
              {settlement.ratingWhy}{" "}
              <Link href="/wiki/ratings-and-form" className="underline decoration-dotted underline-offset-2">
                How the mark is set
              </Link>
              .
            </>
          )}
        </p>
      )}
      {mine && (
        <div className="relative grid gap-4">
          {won && !calm && staged && <Confetti />}
          <PhotoFinishCard replay={replay} card={card} highlightHorseId={highlightHorseId} settlement={settlement} />
          <ResultBoard replay={replay} card={card} highlightHorseId={highlightHorseId} />
        </div>
      )}
      {analysis && subject && at("why") && (
        <div className="fade-up">
          <WhyRead raceId={card.id} enabled={Boolean(mine)}>
            <WhyCard analysis={analysis} horseName={subject.horse.name} isYours={Boolean(mine)} tips={tips} lead={mine ? null : (story?.reason ?? null)} energy={energy} />
          </WhyRead>
        </div>
      )}
      {at("next") && (
        <div ref={nextRef} className="fade-up">
          <NextActions
            card={card}
            mine={
              mine
                ? {
                    id: mine.horse.id,
                    name: mine.horse.name,
                    tactic: mine.tactic,
                  }
                : null
            }
            secondary={verdictLeads}
          />
        </div>
      )}
      <FullResults replay={replay} card={card} highlightHorseId={highlightHorseId} />
    </div>
  );
}

/** What next: race again (same horse and plan, one tap), try a new plan, or go back to the stable. */
export function NextActions({
  card,
  mine,
  secondary = false,
}: {
  card: RaceCard;
  /** The verdict above offers the primary action: these are plain buttons. */
  secondary?: boolean;
  mine: {
    id: string;
    name: string;
    tactic: RaceCard["field"][number]["tactic"];
  } | null;
}) {
  const router = useRouter();
  const state = usePlayerState();
  const entry = useEntry();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const horse = mine ? state?.horses.find((h) => h.id === mine.id) : undefined;

  if (!mine || !state) {
    return (
      <section className="flex flex-wrap items-center gap-3" aria-label="What next">
        <ActionBar>
          {state ? (
            <button type="button" className="btn btn-brass btn-lg" onClick={entry.quickPick}>
              <PixelIcon name="flag" size={32} className="-my-2" /> Enter a Story race
            </button>
          ) : (
            <Link href="/play" className="btn btn-brass btn-lg">
              <PixelIcon name="flag" size={32} className="-my-2" /> Found your stable
            </Link>
          )}
        </ActionBar>
        <Link href="/races#live" className="btn-ghost inline-flex min-h-11 items-center font-bold">
          Live card
        </Link>
      </section>
    );
  }

  async function again() {
    if (!horse) return;
    setBusy(true);
    setError(null);
    try {
      const { raceId } = await enterStoryRace(horse.id, { tactic: mine!.tactic, intensity: "normal" });
      router.push(`/race/${raceId}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  // The verdict's "try again with the change" is the screen's one primary action when it is on offer.
  const Primary = secondary ? Fragment : ActionBar;
  const cls = secondary ? "btn" : "btn btn-brass btn-lg";
  return (
    <section className="grid gap-2" aria-label="What next">
      <div className="flex flex-wrap items-center gap-3">
        <Primary>
          {card.kind === "story" ? (
            <button type="button" className={cls} onClick={again} disabled={!horse || !!horse.block || busy} data-testid="race-again">
              {!secondary && <PixelIcon name="flag" size={32} className="-my-2" />} {busy ? "Entering…" : horse?.block ? horse.block : `Race ${mine.name} again${secondary ? ", same plan" : ""}`}
            </button>
          ) : (
            <button type="button" className={cls} onClick={entry.quickPickLive} data-testid="live-quick-pick">
              {!secondary && <PixelIcon name="flag" size={32} className="-my-2" />} Enter next Live race
            </button>
          )}
        </Primary>
        {card.kind === "story" && (
          <button type="button" className="btn" onClick={() => entry.open(mine.id)}>
            Try a different plan
          </button>
        )}
        <button type="button" className="btn" onClick={entry.quickPick}>
          {card.kind === "story" ? "Quick Pick" : "Story race"}
        </button>
        <Link href="/stable" className="btn-ghost inline-flex min-h-11 items-center font-bold">
          Back to the stable
        </Link>
      </div>
      {error !== null && <ErrorNote error={error} />}
      {card.kind === "story" && <p className="caption">Race again: same horse, same plan, a new field. Quick Pick: your best-suited fresh horse.</p>}
    </section>
  );
}

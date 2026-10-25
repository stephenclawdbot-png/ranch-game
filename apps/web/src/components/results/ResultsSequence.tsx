"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RaceReplay } from "@thoroughbred/shared";
import type { RaceCard } from "@/server/races";
import { analyseRace } from "@/lib/raceAnalysis";
import { usePlayerState } from "@/lib/player";
import { prefersCalm } from "@/lib/settings";
import { usePlayerHorses } from "@/lib/useStable";
import { enterQuickRace } from "../entry/EntryForm";
import { useEntry } from "../entry/EntryProvider";
import { PixelIcon } from "../icons";
import { ActionBar } from "../ui/ActionBar";
import { FullResults } from "./FullResults";
import { ResultBoard } from "./ResultBoard";
import { RewardCounter } from "./RewardCounter";
import { WhyCard } from "./WhyCard";

export interface Settlement {
  prize: number;
  position: number;
  /** True when this page view settled it (credits just landed): runs the count-up. */
  fresh: boolean;
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

  const at = (s: Stage) => STAGES.indexOf(stage) >= STAGES.indexOf(s);
  const won = settlement?.position === 1;

  return (
    <div className="relative grid gap-4" data-testid="results-sequence">
      {stage !== "next" && (
        <div className="flex justify-end">
          <button type="button" className="btn-ghost min-h-11 text-sm font-bold" onClick={() => setStage("next")}>
            Skip to the end ›
          </button>
        </div>
      )}
      <div className="relative">
        {won && !calm && staged && <Confetti />}
        <ResultBoard replay={replay} card={card} highlightHorseId={highlightHorseId} />
      </div>
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
      {analysis && subject && at("why") && (
        <div className="fade-up">
          <WhyCard analysis={analysis} horseName={subject.horse.name} isYours={Boolean(mine)} />
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
}: {
  card: RaceCard;
  mine: {
    id: string;
    name: string;
    tactic: RaceCard["field"][number]["tactic"];
  } | null;
}) {
  const router = useRouter();
  const state = usePlayerState();
  const entry = useEntry();
  const { horses } = usePlayerHorses(state?.player.playerId, state?.player.silks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const index = mine ? Number(mine.id.split("-").pop()) : -1;
  const horse = index >= 0 ? horses?.[index] : undefined;

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
    if (!state || !horse) return;
    setBusy(true);
    setError(null);
    try {
      const raceId = await enterQuickRace(state, horse, index, mine!.tactic);
      router.push(`/race/${raceId}`);
    } catch (e) {
      setError(`Couldn't enter (${(e as Error).message}).`);
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-2" aria-label="What next">
      <div className="flex flex-wrap items-center gap-3">
        <ActionBar>
          <button type="button" className="btn btn-brass btn-lg" onClick={again} disabled={!horse || busy} data-testid="race-again">
            <PixelIcon name="flag" size={32} className="-my-2" /> {busy ? "Entering…" : `Race ${mine.name} again`}
          </button>
        </ActionBar>
        <button type="button" className="btn" onClick={() => entry.open(index)}>
          Try a different plan
        </button>
        <button type="button" className="btn" onClick={entry.quickPick}>
          Quick Pick
        </button>
        <Link href="/stable" className="btn-ghost inline-flex min-h-11 items-center font-bold">
          Back to the stable
        </Link>
      </div>
      {error && (
        <p className="text-sm font-bold text-negative" role="alert">
          {error}
        </p>
      )}
      {card.kind === "quick" && <p className="caption">Race again: same horse, same plan, a new field. Quick Pick: your best-suited fresh horse.</p>}
    </section>
  );
}

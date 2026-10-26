"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CupRunView } from "@/lib/competitionTypes";
import { ordinal, shortHash } from "@/lib/format";
import { refreshPlayer } from "@/lib/player";
import { RaceViewerClient } from "../RaceViewerClient";
import { PixelIcon } from "../icons";
import { PositionBadge } from "../ui/PositionBadge";
import { ConditionChips, CupBadge, RaceTime, StatTile } from "./bits";

/**
 * A Cup Run in the race viewer. The Cup is a time trial against a fixed field, so the run is
 * already decided when it's shown (no Live race is involved); the result card is held back
 * until the finish plays out, or until the viewer skips to it.
 */
export function CupRunScreen({ run }: { run: CupRunView }) {
  const [revealed, setRevealed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (run.mine) void refreshPlayer().catch(() => undefined);
  }, [run.mine]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      let h = w * 0.5625;
      // Phones: same tall stage as the race page (big fields stay readable), up to ~half the screen.
      if (window.innerWidth < 640) h = Math.max(h, Math.min(w * 1.05, window.innerHeight * 0.48));
      setHeight(Math.round(Math.min(620, Math.max(220, h))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="grid gap-4 md:gap-5">
      <p className="sr-only" aria-live="assertive">
        {revealed ? `${run.horseName} ran ${ordinal(run.position)} against the field, ${ordinal(run.rank)} of ${run.of} today.` : ""}
      </p>
      <section aria-labelledby="cup-run-h" className="-mx-4 -mt-4 md:mx-0 md:mt-0">
        <div className="flex h-11 items-center gap-2 bg-ink px-3">
          <span className="chip chip-brass shrink-0">
            <PixelIcon name="trophy" size={16} /> Daily Cup
          </span>
          <h1 id="cup-run-h" className="min-w-0 flex-1 truncate font-extrabold" data-testid="cup-run-title">
            {run.horseName} · {run.day}
          </h1>
        </div>
        <div
          ref={stageRef}
          className="relative h-[clamp(220px,calc((min(100vw,75rem)-3rem)*0.5625),620px)] overflow-hidden bg-surface-1"
          style={{ height: height ?? undefined }}
          role="img"
          aria-label={`Daily Cup run of ${run.horseName}. The result is below.`}
          data-testid="cup-stage"
        >
          <RaceViewerClient replay={run.replay} highlightHorseId={run.entrantId} height={height ?? 420} autoplay onFinished={() => setRevealed(true)} />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <ConditionChips distanceM={run.conditions.distanceM} surface={run.conditions.surface} going={run.conditions.going} weather={run.conditions.weather} />
      </div>

      {revealed ? (
        <section className="frame-hero grid gap-3 p-3 sm:p-4" aria-labelledby="cup-result-h" data-testid="cup-result">
          <div className="flex items-center gap-3">
            <PositionBadge position={run.position} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 id="cup-result-h" className="t-h2">
                {run.position === 1 ? "Beat the whole field!" : `${ordinal(run.position)} against the field`}
              </h2>
              <p className="t-meta">
                {run.horseName} · {run.stableName}
              </p>
            </div>
            <CupBadge badge={run.badge} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile label="Time" testId="cup-time">
              <RaceTime us={run.timeUs} />
            </StatTile>
            <StatTile label="Today's rank">
              {ordinal(run.rank)} of {run.of}
            </StatTile>
            <StatTile label="Top">{Math.max(1, Math.round(run.percentile / 10))}%</StatTile>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/cup" className="btn btn-brass" data-testid="cup-board-link">
              See today&rsquo;s board
            </Link>
            <Link href="/" className="btn">
              Home
            </Link>
          </div>
        </section>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn" onClick={() => setRevealed(true)} data-testid="cup-skip">
            Skip to the result
          </button>
          <p className="caption text-cream-dim">A time trial: the run was decided when you entered. Nothing here is live.</p>
        </div>
      )}

      <p className="caption text-cream-dim">
        {run.sealed
          ? `Sealed: today's seed (fingerprint ${shortHash(run.seedCommitment, 8)}) is revealed when the Cup closes, then anyone can re-run this result.`
          : `Seed revealed. Fingerprint ${shortHash(run.seedCommitment, 8)}: re-run it with the race engine to check this time.`}
      </p>
    </div>
  );
}

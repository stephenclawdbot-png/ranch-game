"use client";

/**
 * The what-if replay page's stage: the counterfactual re-run played in the race viewer (both
 * Trackside and 3D) in what-if mode: a WHAT IF badge throughout, no finale and no credits. The
 * comparison sits under it.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RaceReplay } from "@thoroughbred/shared";
import { courseByName } from "@thoroughbred/game-core";
import type { WhatIfView } from "@/lib/whatIf";
import { RaceViewerClient } from "../RaceViewerClient";
import { WhatIfResult, WhatIfTag } from "./WhatIfResult";

export function WhatIfReplay({ v }: { v: WhatIfView }) {
  const [replay, setReplay] = useState<RaceReplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/races/${encodeURIComponent(v.raceId)}/what-if/replay?horseId=${encodeURIComponent(v.horseId)}&change=${encodeURIComponent(v.changeKey)}`)
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as RaceReplay & { message?: string };
        if (!r.ok) throw new Error(data.message ?? "Couldn't load the what-if.");
        if (live) setReplay(data);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [v.raceId, v.horseId, v.changeKey]);

  // One stage height (as on the race page): 16:9, taller on phones, within the screen.
  const stageRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const vh = window.innerHeight;
      let h = w * 0.5625;
      if (window.innerWidth < 640) h = Math.max(h, Math.min(w * 1.05, vh * 0.48));
      setHeight(Math.round(Math.min(620, Math.max(260, h))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="grid gap-4 md:gap-5">
      <section aria-labelledby="what-if-name" className="-mx-[var(--gutter)] -mt-4 md:mx-0 md:mt-0">
        <div className="race-plate">
          <WhatIfTag className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="eyebrow !text-[0.625rem] !text-sage">{v.label}</p>
            <h1 id="what-if-name" className="t-serif text-[1.25rem] leading-6 line-clamp-2 md:text-[1.625rem] md:leading-8">
              {v.raceName}
            </h1>
          </div>
        </div>
        <div ref={stageRef} className="relative h-[clamp(260px,calc((min(100vw,75rem)-3rem)*0.5625),620px)] overflow-hidden bg-surface-1" style={{ height: height ?? undefined }} data-testid="what-if-stage">
          {replay ? (
            <RaceViewerClient replay={replay} whatIf height={height ?? 420} highlightHorseId={v.horseId} mineHorseIds={[v.horseId]} autoplay course={courseByName(v.track)} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-cream-dim">{error ?? "Re-running the race…"}</div>
          )}
        </div>
      </section>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="surface p-3 sm:p-4" aria-label="What if, compared with the official result">
          <WhatIfResult v={v} />
        </section>
        <div className="grid content-start gap-3">
          <Link href={`/race/${v.raceId}`} className="btn w-fit" data-testid="what-if-official">
            ‹ The official race
          </Link>
          <p className="text-sm text-cream-dim">
            This replay is a what-if: the race as it would have gone with one change. The official result, its replay and the form book are unchanged.
          </p>
        </div>
      </div>
    </div>
  );
}

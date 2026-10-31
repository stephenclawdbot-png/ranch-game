"use client";

/**
 * A quick race's page: the race in the viewer (Trackside and 3D) in its unofficial mode (the
 * what-if mode with the race's own badge: race call and battle graphic, no finale or credits),
 * then the result, the photo strip when it was close, and "Share clip".
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RaceReplay } from "@thoroughbred/shared";
import { courseByName } from "@thoroughbred/game-core";
import { formatDistance, GOING_LABEL, ordinal, STYLE_LABEL, SURFACE_LABEL } from "@/lib/format";
import { lengthsText, raceTimeText } from "@/lib/formBook";
import { GRADE_WORD, type QuickRaceView } from "@/lib/quickRaces";
import { RaceViewerClient } from "../RaceViewerClient";
import { ShareClip } from "../race/ShareClip";
import { HashValue } from "../ui/HashValue";

/** The photo strip, only for a close finish (client-only: canvas). */
const ClosePhoto = dynamic(
  () =>
    import("@thoroughbred/race-viewer").then((m) => {
      const Photo = ({ replay }: { replay: RaceReplay }) =>
        m.isCloseFinish(replay) ? (
          <section className="surface grid gap-2 p-3" aria-label="Photo finish" data-testid="quick-photo">
            <p className="caption">{m.isPhotoFinish(replay) ? "Photo finish" : "Close finish"}</p>
            <m.PhotoFinish model={m.photoFinishModel(replay)} />
          </section>
        ) : null;
      return Photo;
    }),
  { ssr: false },
);

export function QuickTag({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span className={`whatif-tag ${className}`} data-testid="quick-tag">
      {label}
    </span>
  );
}

const INTENSITY_WORD: Record<string, string> = { conservative: "a steady ride", normal: "a normal ride", all_out: "an all-out ride" };

export function QuickReplay({ v }: { v: QuickRaceView }) {
  const [replay, setReplay] = useState<RaceReplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/quick/${encodeURIComponent(v.id)}/replay`)
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as RaceReplay & { message?: string };
        if (!r.ok) throw new Error(data.message ?? "Couldn't load the race.");
        if (live) setReplay(data);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [v.id]);

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

  const course = courseByName(v.track);
  const again = v.mode === "daily" ? "/quick?tab=daily" : `/quick?tab=${v.mode}${v.yours ? `&horse=${v.horseId}` : ""}`;
  const mine = v.rows.find((r) => r.mine);
  return (
    <div className="grid gap-4 md:gap-5">
      <section aria-labelledby="quick-name" className="-mx-[var(--gutter)] -mt-4 md:mx-0 md:mt-0">
        <div className="race-plate">
          <QuickTag label={v.badge} className="hidden shrink-0 sm:inline-flex" />
          <div className="min-w-0 flex-1">
            <p className="eyebrow !text-[0.625rem] !text-sage">
              {v.track} · {formatDistance(v.distanceM)} {SURFACE_LABEL[v.surface].toLowerCase()} · {GOING_LABEL[v.going].toLowerCase()}
            </p>
            <h1 id="quick-name" className="t-serif text-[1.25rem] leading-6 line-clamp-2 md:text-[1.625rem] md:leading-8">
              {v.raceName}
            </h1>
          </div>
        </div>
        <div ref={stageRef} className="relative h-[clamp(260px,calc((min(100vw,75rem)-3rem)*0.5625),620px)] overflow-hidden bg-surface-1" style={{ height: height ?? undefined }} data-testid="quick-stage">
          {replay ? (
            <RaceViewerClient replay={replay} whatIf whatIfBadge={v.badge} height={height ?? 420} highlightHorseId={v.horseId} mineHorseIds={v.yours ? [v.horseId] : []} autoplay course={course} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-cream-dim">{error ?? "Loading the race…"}</div>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="surface grid gap-4 p-3 sm:p-4" aria-label="The result (unofficial)" data-testid="quick-result">
          <div className="grid gap-1">
            <QuickTag label={v.badge} className="w-fit" />
            <p className="t-h2" data-testid="quick-headline">
              {v.mode === "ghost" && v.ghost ? v.ghost.line : v.headline}
            </p>
            {v.mode === "ghost" && <p className="text-sm text-cream-dim">{v.headline}</p>}
            {v.mode === "daily" && v.daily && (
              <p className="text-sm" data-testid="quick-daily-line">
                <b>
                  {ordinal(v.position)} in the race · {v.daily.rank ? `${ordinal(v.daily.rank)} of ${v.daily.entrants} on the day` : "unranked"} · {v.daily.points}{" "}
                  {v.daily.points === 1 ? "point" : "points"}
                </b>
                {v.daily.top && <span className="tag tag-ready ml-2">Top 10%</span>}
                <span className="block text-cream-dim">
                  {v.stableName}: {STYLE_LABEL[v.daily.plan.tactic].toLowerCase()}, {INTENSITY_WORD[v.daily.plan.intensity]}, {GRADE_WORD(v.daily.plan.grade)}
                </span>
              </p>
            )}
          </div>

          <ol className="grid gap-0.5 text-sm" data-testid="quick-rows">
            {v.rows.map((r) => (
              <li key={r.horseId} className={`flex items-baseline gap-2 px-1.5 py-1 ${r.mine ? "whatif-mine font-extrabold" : ""}`}>
                <span className="num w-8 shrink-0 text-right">{ordinal(r.position)}</span>
                <span className="min-w-0 flex-1">
                  {v.mode === "daily" ? (
                    <span className="block truncate">{r.name}</span>
                  ) : (
                    <Link href={`/horse/${r.horseId}`} className="block truncate hover:underline">
                      {r.name}
                    </Link>
                  )}
                  {(r.stableName || r.officialPosition) && (
                    <span className="block truncate text-xs font-normal text-cream-dim">
                      {r.mine && v.mode === "daily" ? "your ride" : r.stableName}
                      {r.officialPosition ? `${r.stableName ? " · " : ""}${ordinal(r.officialPosition)} in the real race` : ""}
                    </span>
                  )}
                </span>
                <span className="num shrink-0 text-xs text-cream-dim">{r.position === 1 ? raceTimeText(r.timeUs) : lengthsText(r.behindMm)}</span>
              </li>
            ))}
          </ol>

          {replay && <ClosePhoto replay={replay} />}

          {v.match && v.match.records.length > 0 && (
            <div data-testid="quick-h2h">
              <p className="caption mb-1">Match record (unofficial head-to-head)</p>
              <ul className="grid gap-0.5 text-sm">
                {v.match.records.map((r) => (
                  <li key={r.opponentId} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {v.horseName} v {r.opponentName}
                    </span>
                    <span className="num shrink-0">
                      {r.won}–{r.lost}
                      {r.meetings > r.won + r.lost ? `, ${r.meetings - r.won - r.lost} dead heat` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {v.daily && (
            <div className="grid gap-1 text-xs text-cream-dim" data-testid="quick-daily-seed">
              <span>
                The day&rsquo;s sealed seed fingerprint: <HashValue value={v.daily.seedCommitment} />
              </span>
              {v.daily.seed ? (
                <span>
                  Revealed seed: <HashValue value={v.daily.seed} />
                </span>
              ) : (
                <span>The seed itself is revealed once the day is over (00:00 UTC).</span>
              )}
            </div>
          )}
          <p className="text-xs text-cream-dim">{v.note}</p>
        </section>

        <div className="grid content-start gap-3">
          {mine && (
            <p className="text-sm">
              {v.horseName} finished {ordinal(mine.position)} of {v.fieldSize}.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {v.mode !== "daily" && (
              <Link href={again} className="btn btn-brass" data-testid="quick-again">
                {v.mode === "match" ? "Another match race" : "Another ghost race"}
              </Link>
            )}
            <Link href={`/quick?tab=${v.mode}`} className="btn" data-testid="quick-hub">
              ‹ Quick races
            </Link>
            {v.ghost && (
              <Link href={`/race/${v.ghost.sourceRaceId}`} className="btn" data-testid="quick-source">
                The real race
              </Link>
            )}
            {replay && (
              <ShareClip replay={replay} course={course} courseName={v.track} highlightHorseId={v.horseId} mineHorseIds={v.yours ? [v.horseId] : []} />
            )}
          </div>
          <p className="text-sm text-cream-dim">
            {v.mode === "daily"
              ? "The daily challenge is for points and badges only."
              : "This race is unofficial: it never appears on the form book, the ratings or anyone's record, and costs no fatigue, credits or entries."}
          </p>
        </div>
      </div>
    </div>
  );
}

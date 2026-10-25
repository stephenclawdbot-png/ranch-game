"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RaceCard } from "@/server/races";
import { fitCheck } from "@/lib/aptitude";
import { useClockSkew, useNow } from "@/lib/clock";
import { useLiveRaceFeed } from "@/lib/liveRaceFeed";
import { CLASS_LABEL, STYLE_LABEL, formatClock, formatCountdown, ordinal } from "@/lib/format";
import { settleRace, usePlayerState } from "@/lib/player";
import { RaceMetaChips } from "../RaceMeta";
import { RaceViewerClient } from "../RaceViewerClient";
import { PixelIcon } from "../icons";
import { Digits } from "../Countdown";
import { SceneBackdrop } from "../pixel/SceneBackdrop";
import { ResultsSequence, type Settlement } from "../results/ResultsSequence";
import { FitList } from "../ui/FitChip";
import { Saddlecloth } from "./Saddlecloth";
import { FairnessPanel } from "./FairnessPanel";
import { FieldList } from "./FieldList";

type Phase = "loading" | "pre" | "live" | "result";

/**
 * The race page is a live broadcast: the client only ever holds the race up to "now"
 * (useLiveRaceFeed polls /api/races/:id/live). The result, seed reveal, settlement and
 * fairness check appear only once the server sends `final`, i.e. after the finish has
 * been broadcast. There is no way to skip ahead.
 *
 * Layout (phone first): broadcast plate + full-bleed stage at the top; below it your
 * runner's fit check and the field (pre/live) or the staged results (after the finish).
 */
export function RaceExperience({ card, serverNowMs }: { card: RaceCard; serverNowMs: number }) {
  const { config } = card;
  const ssrSkew = useClockSkew(serverNowMs);
  const now = useNow(200);
  const state = usePlayerState();
  const { feed, error: feedError } = useLiveRaceFeed(card.id);
  // The feed measures the server clock on every poll; prefer it over the page-render estimate.
  const skew = feed ? feed.clockOffsetMs : ssrSkew;
  const localPost = config.postTimeMs - skew;
  /** The complete replay (result + seed): only present once the race is over on the broadcast clock. */
  const replay = feed?.final ?? null;

  const [settlement, setSettlement] = useState<Settlement | null>(null);

  const mine = state && card.playerId === state.player.playerId ? (card.field.find((e) => e.isPlayer) ?? null) : null;
  const highlightHorseId = mine?.horse.id;

  const phase: Phase = now === null ? "loading" : replay ? "result" : now < localPost ? "pre" : "live";

  // Settle once per raceId (client-side ledger until Milestone C).
  useEffect(() => {
    if (phase !== "result" || !replay || !mine || !state) return;
    const rec = replay.result.finishOrder.find((f) => f.horseId === mine.horse.id);
    if (!rec) return;
    const index = Number(mine.horse.id.split("-").pop());
    const fresh = settleRace({
      raceId: card.id,
      raceName: config.name,
      horseIndex: index,
      horseName: mine.horse.name,
      position: rec.position,
      fieldSize: card.field.length,
      prize: rec.prize,
      postTimeMs: config.postTimeMs,
      distanceM: config.distanceM,
      surface: config.surface,
    });
    setSettlement((s) => s ?? { prize: rec.prize, position: rec.position, fresh });
  }, [phase, replay, mine, state, card.id, card.field.length, config]);

  // Tab title: countdown before the off, LIVE while running (no result in the title, ever before the finish).
  const baseTitle = useRef<string | null>(null);
  useEffect(() => {
    baseTitle.current ??= document.title;
    const base = baseTitle.current;
    if (phase === "pre" && now !== null) document.title = `Off in ${formatCountdown(localPost - now)} · ${config.name}`;
    else if (phase === "live") document.title = `LIVE · ${config.name}`;
    else document.title = base;
  }, [phase, now, localPost, config.name]);
  useEffect(
    () => () => {
      if (baseTitle.current) document.title = baseTitle.current;
    },
    [],
  );

  // One stage height for countdown and viewer, so the page doesn't jump at the off.
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageHeight, setStageHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const vh = window.innerHeight;
      let h = w * 0.5625;
      if (window.innerWidth < 640) h = Math.max(h, w * 0.62);
      h = Math.min(620, Math.max(220, h));
      if (vh < 560) h = Math.min(h, Math.max(200, vh - 60));
      setStageHeight(Math.round(h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const remaining = now === null ? null : localPost - now;
  const status =
    phase === "pre" ? (
      <span className="chip chip-ink shrink-0 !text-cream">
        <PixelIcon name="stopwatch" size={16} /> Off in <span className="tabular">{formatCountdown(remaining ?? 0)}</span>
      </span>
    ) : phase === "live" ? (
      <span className="chip chip-live shrink-0">
        <span className="live-dot !h-2 !w-2" /> Live
      </span>
    ) : phase === "result" ? (
      <span className="chip chip-cream shrink-0">✓ Result</span>
    ) : (
      <span className="chip shrink-0 opacity-0">…</span>
    );

  const myRec = replay && mine ? replay.result.finishOrder.find((f) => f.horseId === mine.horse.id) : undefined;
  const winnerName = replay ? card.field.find((e) => e.horse.id === replay.result.finishOrder[0]?.horseId)?.horse.name : undefined;
  const announcement =
    phase === "pre" && remaining !== null && remaining < 10_000
      ? "Gates loading."
      : phase === "live"
        ? "They're off."
        : phase === "result" && !myRec && winnerName
          ? `Result official. ${winnerName} won.`
          : "";

  return (
    <div className="grid gap-4 md:gap-5">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <p className="sr-only" aria-live="assertive">
        {myRec && mine ? `${mine.horse.name} finished ${ordinal(myRec.position)}.` : ""}
      </p>

      <section aria-labelledby="race-name" className="-mx-4 -mt-4 md:mx-0 md:mt-0">
        {/* broadcast plate: status · race name · seal */}
        <div className="flex h-11 items-center gap-2 bg-ink px-3">
          {status}
          <h1 id="race-name" className="min-w-0 flex-1 truncate font-extrabold" data-testid="race-name">
            {config.name}
          </h1>
          <a href="#fair-h" className="flex shrink-0 items-center gap-1 text-sm font-bold text-cream-dim hover:text-cream" title="This race is sealed: tap for details">
            <PixelIcon name="shield" size={16} /> {replay ? "Sealed ✓" : "Sealed"}
          </a>
        </div>
        <div
          ref={stageRef}
          className="relative h-[clamp(220px,calc((min(100vw,75rem)-3rem)*0.5625),620px)] overflow-hidden bg-surface-1"
          style={{ height: stageHeight ?? undefined }}
          data-testid="race-stage"
          role="img"
          aria-label={`${config.name}: ${phase === "pre" ? "pre-race" : phase === "live" ? "race in progress" : "replay"}. The field and results are listed below.`}
        >
          {phase === "pre" || phase === "loading" ? (
            <PreRace localPost={localPost} now={now} card={card} />
          ) : feed ? (
            <div data-testid="viewer" className="h-full">
              <RaceViewerClient feed={feed} highlightHorseId={highlightHorseId} height={stageHeight ?? 420} autoplay />
            </div>
          ) : (
            <div className="flex h-full min-h-56 flex-col items-center justify-center gap-2 text-cream-dim">
              <PixelIcon name={feedError ? "cross" : "flag"} size={32} />
              {feedError ? `Couldn't reach the track (${feedError}). Retrying…` : "They're under starter's orders…"}
            </div>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="t-meta">
          {card.kind === "quick" ? "Quick race" : "Club card"} · {CLASS_LABEL[config.raceClass]} · post {formatClock(config.postTimeMs)}
        </p>
        <RaceMetaChips race={config} showPurse showClass={false} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-4">
          {phase === "result" && replay ? (
            <ResultsSequence replay={replay} card={card} highlightHorseId={highlightHorseId} settlement={mine ? settlement : null} />
          ) : (
            <>
              {mine && (
                <section className="surface p-3 sm:p-4" aria-labelledby="yours-h">
                  <p className="flex items-center gap-2 text-sm font-bold text-cream-dim">
                    <span className="you-tag">You</span> Your runner wears the brass marker
                  </p>
                  <h2 id="yours-h" className="t-display-m mt-1">
                    {mine.horse.name}
                  </h2>
                  <p className="t-meta mb-2">
                    Gate {mine.gate} · riding as a {STYLE_LABEL[mine.tactic].toLowerCase()}
                  </p>
                  <FitList fits={fitCheck(mine.horse, mine.tactic, config)} showDetail />
                </section>
              )}
              <FieldList card={card} highlightHorseId={highlightHorseId} open={phase !== "live"} />
            </>
          )}
        </div>
        <div className="grid content-start gap-4">
          <FairnessPanel card={card} replay={phase === "result" ? replay : null} />
          {phase !== "result" && (
            <Link href={mine ? "/stable" : "/races"} className="btn-ghost inline-flex min-h-11 w-fit items-center font-bold">
              ‹ {mine ? "Back to the stable" : "Today’s card"}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function PreRace({ localPost, now, card }: { localPost: number; now: number | null; card: RaceCard }) {
  const remaining = now === null ? null : localPost - now;
  const loading = remaining !== null && remaining < 10_000;
  const text = remaining === null ? "–:––" : formatCountdown(remaining);
  return (
    <div className="relative flex h-full min-h-52 w-full flex-col items-center justify-center overflow-hidden px-4 text-center">
      <SceneBackdrop variant="grandstand" />
      {/* Starting stalls, one per runner, with saddlecloth numbers */}
      <div className="absolute bottom-[6%] left-1/2 flex -translate-x-1/2 items-end gap-[3px] sm:gap-1" aria-hidden>
        {card.field.map((e) => (
          <div
            key={e.gate}
            className="flex h-10 w-6 items-start justify-center pt-1 sm:h-14 sm:w-9"
            style={{ background: "linear-gradient(#f3e7c9 0 4px, #1f4d35 4px calc(100% - 4px), #0f2a1d calc(100% - 4px))", boxShadow: e.isPlayer ? "0 0 0 2px #0b0f0c, 0 0 0 4px #d9a441" : "0 0 0 2px #0b0f0c" }}
          >
            <Saddlecloth gate={e.gate} className="!h-5 !w-5 !text-xs sm:!h-6 sm:!w-6 sm:!text-[0.85rem]" />
          </div>
        ))}
      </div>
      <div className="plate-ink relative -mt-8 px-4 py-2 sm:-mt-14">
        <p className="text-sm font-bold text-cream">{loading ? "Gates loading" : "Going down to post"}</p>
        <p className="score text-[3.75rem] leading-none text-cream" data-testid="countdown">
          <Digits text={text} />
        </p>
        <p className="text-sm font-semibold text-cream-dim">
          {card.field.length} runners · off at {formatClock(card.config.postTimeMs)}
        </p>
      </div>
    </div>
  );
}

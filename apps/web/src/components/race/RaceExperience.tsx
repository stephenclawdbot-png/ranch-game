"use client";

import { trackClient } from "@/lib/telemetry";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { MyRaceResult, RaceCard } from "@/lib/types";
import { fitCheck } from "@/lib/aptitude";
import { useClockSkew, useNow } from "@/lib/clock";
import { useLiveRaceFeed } from "@/lib/liveRaceFeed";
import { CLASS_LABEL, STYLE_LABEL, formatClock, formatCountdown, ordinal } from "@/lib/format";
import { refreshPlayer, usePlayerState } from "@/lib/player";
import { useEntry } from "../entry/EntryProvider";
import { RaceMetaChips } from "../RaceMeta";
import { RaceViewerClient } from "../RaceViewerClient";
import { PixelIcon } from "../icons";
import { Digits } from "../Countdown";
import { DioramaSlot } from "../diorama/DioramaSlot";
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
  const router = useRouter();
  const entry = useEntry();
  const ssrSkew = useClockSkew(serverNowMs);
  const now = useNow(200);
  const state = usePlayerState();
  // The broadcast exists once the field is locked (gates drawn); while entries are open the
  // page shows the field so far and refreshes itself when entries close.
  const { feed, error: feedError } = useLiveRaceFeed(card.id, card.fieldLocked);
  // The feed measures the server clock on every poll; prefer it over the page-render estimate.
  const skew = feed ? feed.clockOffsetMs : ssrSkew;
  const localPost = config.postTimeMs - skew;
  const localClose = card.entriesCloseAtMs - skew;
  /** The complete replay (result + seed): only present once the race is over on the broadcast clock. */
  const replay = feed?.final ?? null;

  const [settlement, setSettlement] = useState<Settlement | null>(null);

  const mine = card.field.find((e) => e.mine) ?? null;
  const highlightHorseId = mine?.horse.id;

  const phase: Phase = now === null ? "loading" : replay ? "result" : now < localPost ? "pre" : "live";

  // Entries open: refresh the server-rendered card when they close (the field locks then),
  // and keep checking every few seconds until the locked field arrives.
  useEffect(() => {
    if (card.fieldLocked) return;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      router.refresh();
      t = setTimeout(tick, 3000);
    };
    t = setTimeout(tick, Math.max(1000, localClose - Date.now() + 1500));
    return () => clearTimeout(t);
  }, [card.fieldLocked, localClose, router]);

  // Telemetry: a race watched through to the finish on this page (no outcome is sent).
  const sawLive = useRef(false);
  const watched = useRef(false);
  useEffect(() => {
    if (phase === "live") sawLive.current = true;
    if (phase === "result" && sawLive.current && !watched.current) {
      watched.current = true;
      trackClient({ name: "race_watched", raceId: card.id });
    }
  }, [phase, card.id]);

  // Your result comes from the server (settled there, once); this only shows it.
  useEffect(() => {
    if (phase !== "result" || !replay || !mine || settlement) return;
    let cancelled = false;
    fetch(`/api/races/${encodeURIComponent(card.id)}/me`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<MyRaceResult>) : null))
      .then((res) => {
        const r = res?.runners.find((x) => x.horseId === mine.horse.id) ?? res?.runners[0];
        if (cancelled || !res || !r) return;
        setSettlement({ prize: r.prize + r.storyReward, position: r.position, fresh: res.firstView, storyReward: r.storyReward, firstWin: r.firstWin, ratingBefore: r.ratingBefore, ratingAfter: r.ratingAfter });
        void refreshPlayer().catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [phase, replay, mine, settlement, card.id]);

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
      // Phones (portrait): a taller stage (the HUD strip, minimap and controls sit on it), up
      // to about half the screen so the field list and results stay reachable.
      if (window.innerWidth < 640) h = Math.max(h, Math.min(w * 0.82, vh * 0.48));
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

      <section aria-labelledby="race-name" className="-mx-[var(--gutter)] -mt-4 md:mx-0 md:mt-0">
        {/* broadcast plate: status · race name · seal */}
        <div className="flex h-11 items-center gap-2 bg-ink px-3">
          {status}
          <h1 id="race-name" className="min-w-0 flex-1 truncate font-extrabold" data-testid="race-name">
            {config.name}
          </h1>
          <a
            href="#fair-h"
            className="flex shrink-0 items-center gap-1 text-sm font-bold text-cream-dim hover:text-cream"
            title="This race is sealed: tap for details"
          >
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
            <PreRace localPost={localPost} localClose={localClose} now={now} card={card} />
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
          {card.kind === "story" ? "Story race" : "Live race"} · {CLASS_LABEL[config.raceClass]} · post {formatClock(config.postTimeMs)}
        </p>
        <RaceMetaChips race={config} showPurse={card.kind === "live"} showClass={false} />
        {card.status === "open" && state && card.kind === "live" && (
          <button type="button" className="btn btn-sm" onClick={() => entry.enterLive(card.id)} data-testid="enter-this-race">
            Enter a horse
          </button>
        )}
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
                  <h2 id="yours-h" className="t-h2 mt-1">
                    {mine.horse.name}
                  </h2>
                  <p className="t-meta mb-2">
                    {mine.gate ? `Gate ${mine.gate}` : "Gate drawn when entries close"} · riding as a {STYLE_LABEL[mine.tactic].toLowerCase()}
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
            <Link href={mine ? "/" : "/races"} className="btn-ghost inline-flex min-h-11 w-fit items-center font-bold">
              ‹ {mine ? "Back home" : "Today’s card"}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function PreRace({ localPost, localClose, now, card }: { localPost: number; localClose: number; now: number | null; card: RaceCard }) {
  const remaining = now === null ? null : localPost - now;
  const entriesOpen = !card.fieldLocked && (now === null || now < localClose);
  const loading = remaining !== null && remaining < 10_000;
  const text = remaining === null ? "–:––" : formatCountdown(remaining);
  const closeText = now === null ? "–:––" : formatCountdown(Math.max(0, localClose - now));
  return (
    <div className="relative flex h-full min-h-52 w-full flex-col items-center justify-center overflow-hidden px-4 text-center">
      <DioramaSlot scene="track-dusk" alt="Horses cantering down to post at dusk" />
      {/* Starting stalls, one per runner, with saddlecloth numbers (empty until the field locks) */}
      <div className="absolute bottom-[6%] left-1/2 flex -translate-x-1/2 items-end gap-[3px] sm:gap-1" aria-hidden>
        {(card.fieldLocked ? card.field : Array.from({ length: card.targetRunners }, (_, i) => card.field[i] ?? null)).map((e, i) => (
          <div
            key={e ? `${e.horse.id}` : `empty-${i}`}
            className="flex h-10 w-6 items-start justify-center pt-1 sm:h-14 sm:w-9"
            style={{
              background: "linear-gradient(#f3e7c9 0 4px, #1f4d35 4px calc(100% - 4px), #0f2a1d calc(100% - 4px))",
              boxShadow: e?.mine ? "0 0 0 2px #0b0f0c, 0 0 0 4px #d9a441" : "0 0 0 2px #0b0f0c",
              opacity: e ? 1 : 0.45,
            }}
          >
            {e && e.gate > 0 && <Saddlecloth gate={e.gate} className="!h-5 !w-5 !text-xs sm:!h-6 sm:!w-6 sm:!text-[0.85rem]" />}
          </div>
        ))}
      </div>
      <div className="plate-ink relative -mt-8 px-4 py-2 sm:-mt-14">
        <p className="text-sm font-bold text-cream">{entriesOpen ? "Entries open" : loading ? "Gates loading" : "Going down to post"}</p>
        <p className="score text-[3.75rem] leading-none text-cream" data-testid="countdown">
          <Digits text={entriesOpen ? closeText : text} />
        </p>
        <p className="text-sm font-semibold text-cream-dim">
          {entriesOpen
            ? `${card.field.length} entered · entries close ${formatClock(card.entriesCloseAtMs)} · off ${formatClock(card.config.postTimeMs)}`
            : `${card.field.length} runners · off at ${formatClock(card.config.postTimeMs)}`}
        </p>
      </div>
    </div>
  );
}

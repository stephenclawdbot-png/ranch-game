"use client";

import { trackClient } from "@/lib/telemetry";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { SilksIcon } from "../Silks";
import { PaddockParade, type ParadeRunner } from "./PaddockParade";
import { ResultsSequence, type Settlement } from "../results/ResultsSequence";
import { PhotoFinishCard } from "../results/PhotoFinishCard";
import { FitList } from "../ui/FitChip";
import { Saddlecloth } from "./Saddlecloth";
import { FairnessPanel } from "./FairnessPanel";
import { FieldList } from "./FieldList";
import { ShareReplay } from "./ShareReplay";
import { CourseStrip } from "./CourseMap";
import { courseByName } from "@thoroughbred/game-core";

type Phase = "loading" | "pre" | "live" | "result";

/**
 * The viewer takes over the stage this long before the off (ms): its build-up (paddock, going
 * down to post, loading the stalls; ~24 s) plays to the real clock, with a few seconds to load.
 */
const BUILD_UP_LEAD_MS = 32_000;

/**
 * The race page is a live broadcast: the client only ever holds the race up to "now"
 * (useLiveRaceFeed polls /api/races/:id/live). The result, seed reveal, settlement and
 * fairness check appear only once the server sends `final`, i.e. after the finish has
 * been broadcast. There is no way to skip ahead.
 *
 * Layout (phone first): broadcast plate + full-bleed stage at the top; below it your
 * runner's fit check and the field (pre/live) or the staged results (after the finish).
 */
export function RaceExperience({ card, serverNowMs, initialTimeSec }: { card: RaceCard; serverNowMs: number; initialTimeSec?: number }) {
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
  // The build-up before the off plays in the viewer (both views), from the locked field and the
  // broadcast clock: it never delays the off, and a late arrival joins wherever the clock is.
  const buildUp = phase === "pre" && card.fieldLocked && !!feed && now !== null && feed.broadcastStartMs - now < BUILD_UP_LEAD_MS;
  const paradeRunners = useMemo<ParadeRunner[]>(
    () => card.field.map((e) => ({ id: e.horse.id, name: e.horse.name, gate: e.gate, appearance: e.horse.appearance, stableName: e.stableName, form: e.form })),
    [card.field],
  );
  const paddock = useMemo(() => <PaddockParade runners={paradeRunners} />, [paradeRunners]);

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

  // The finish as an event plays in the stage first (photograph, replay, weighed in, the placed
  // horses' cards); the result board and credits below wait for it when the race was watched
  // live. If the viewer never starts it (paused, skipped ahead), they show after a few seconds.
  const [finale, setFinale] = useState<"pending" | "running" | "done">("pending");
  useEffect(() => {
    if (phase !== "result" || finale !== "pending") return;
    const t = setTimeout(() => setFinale((f) => (f === "pending" ? "done" : f)), 6000);
    return () => clearTimeout(t);
  }, [phase, finale]);
  const holdResults = phase === "result" && sawLive.current && finale !== "done";
  // The finale's cards: each runner's stable (name and photo) and jockey from the racecard.
  const connections = useMemo(
    () =>
      Object.fromEntries(
        card.field.map((e) => [e.horse.id, { stableName: e.stableName, stablePhotoUrl: e.stablePhotoUrl ?? null, jockey: e.jockey?.cardName ?? e.gear.find((g) => /jockey|journeyman/i.test(g)) ?? null }]),
      ),
    [card.field],
  );
  const mineIds = useMemo(() => card.field.filter((e) => e.mine).map((e) => e.horse.id), [card.field]);

  // Your result comes from the server (settled there, once); this only shows it.
  useEffect(() => {
    if (phase !== "result" || !replay || !mine || settlement) return;
    let cancelled = false;
    fetch(`/api/races/${encodeURIComponent(card.id)}/me`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<MyRaceResult>) : null))
      .then((res) => {
        const r = res?.runners.find((x) => x.horseId === mine.horse.id) ?? res?.runners[0];
        if (cancelled || !res || !r) return;
        setSettlement({ prize: r.prize + r.storyReward, position: r.position, fresh: res.firstView, storyReward: r.storyReward, firstWin: r.firstWin, ratingBefore: r.ratingBefore, ratingAfter: r.ratingAfter, atOff: r.atOff ?? null });
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
      if (window.innerWidth < 640) h = Math.max(h, Math.min(w * 1.05, vh * 0.48));
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
        <div className="race-plate">
          {status}
          <div className="min-w-0 flex-1">
            <p className="eyebrow !text-[0.625rem] !text-sage">
              {card.kind === "story" ? "Story race" : "Live race"} · {CLASS_LABEL[config.raceClass]}
            </p>
            <h1 id="race-name" className="t-serif text-[1.25rem] leading-6 line-clamp-2 md:text-[1.625rem] md:leading-8" data-testid="race-name">
              {config.name}
            </h1>
            {card.sponsor && (
              <p className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-cream-dim" data-testid="race-sponsor-header">
                <SilksIcon silks={card.sponsor.silks} className="h-6 w-6" />
                {card.sponsor.mine ? "Sponsored by your stable" : `Sponsored by ${card.sponsor.stableName}`}
              </p>
            )}
          </div>
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
          {(phase === "pre" || phase === "loading") && !buildUp ? (
            <PreRace localPost={localPost} localClose={localClose} now={now} card={card} runners={paradeRunners} />
          ) : feed ? (
            <div data-testid="viewer" className="h-full">
              <RaceViewerClient
                feed={feed}
                highlightHorseId={highlightHorseId}
                mineHorseIds={mineIds}
                connections={connections}
                onFinale={setFinale}
                height={stageHeight ?? 420}
                initialTimeSec={initialTimeSec}
                autoplay
                course={courseByName(card.track)}
                paddock={paddock}
              />
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
        <RaceMetaChips race={config} showPurse={card.kind === "live"} showClass={false} trend={card.groundTrend} />
        {card.status === "open" && state && card.kind === "live" && (
          <button type="button" className="btn btn-sm" onClick={() => entry.enterLive(card.id)} data-testid="enter-this-race">
            Enter a horse
          </button>
        )}
        {phase === "result" && <ShareReplay card={card} horseName={mine?.horse.name ?? winnerName ?? "The winner"} />}
      </div>

      <CourseStrip track={card.track} distanceM={config.distanceM} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-4">
          {phase === "result" && replay && holdResults ? (
            <p className="t-meta" data-testid="finale-hold">
              The result is being called in the stage above…
            </p>
          ) : phase === "result" && replay ? (
            <>
              <PhotoFinishCard replay={replay} card={card} highlightHorseId={highlightHorseId} settlement={mine ? settlement : null} />
              <ResultsSequence replay={replay} card={card} highlightHorseId={highlightHorseId} settlement={mine ? settlement : null} />
            </>
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

function PreRace({ localPost, localClose, now, card, runners }: { localPost: number; localClose: number; now: number | null; card: RaceCard; runners: readonly ParadeRunner[] }) {
  const remaining = now === null ? null : localPost - now;
  const entriesOpen = !card.fieldLocked && (now === null || now < localClose);
  const loading = remaining !== null && remaining < 10_000;
  const text = remaining === null ? "–:––" : formatCountdown(remaining);
  const closeText = now === null ? "–:––" : formatCountdown(Math.max(0, localClose - now));
  // The broadcast before the off: the runners parade in the paddock, then they
  // canter down to post (last 25 s) and the stalls fill.
  const toPost = remaining !== null && remaining < 25_000;
  return (
    <div className="relative flex h-full min-h-52 w-full flex-col items-center justify-center overflow-hidden px-4 text-center">
      {toPost ? <DioramaSlot scene="track-dusk" alt="Horses cantering down to post at dusk" /> : <PaddockParade runners={runners} />}
      {/* Starting stalls, one per runner, with saddlecloth numbers (empty until the field locks) */}
      <div className={`absolute bottom-[6%] left-1/2 flex -translate-x-1/2 items-end gap-[3px] sm:gap-1 ${toPost ? "" : "hidden"}`} aria-hidden>
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
      <div className="race-countdown relative -mt-8 sm:-mt-14">
        <p className="eyebrow">{entriesOpen ? "Entries open" : loading ? "Gates loading" : toPost ? "Going down to post" : "In the paddock"}</p>
        <p className="t-serif mt-0.5 text-[1.125rem] leading-6 text-cream md:text-[1.375rem] md:leading-7">{card.config.name}</p>
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

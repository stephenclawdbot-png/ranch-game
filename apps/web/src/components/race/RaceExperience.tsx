"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RaceReplay } from "@thoroughbred/shared";
import type { RaceCard } from "@/server/races";
import { useClockSkew, useNow } from "@/lib/clock";
import { CLASS_LABEL, formatClock, formatCountdown, formatCredits, ordinal } from "@/lib/format";
import { getPlayerState, settleRace, usePlayerState } from "@/lib/player";
import { RaceMetaChips } from "../RaceMeta";
import { RaceViewerClient } from "../RaceViewerClient";
import { ArrowIcon, PixelIcon } from "../icons";
import { Digits } from "../Countdown";
import { Silks } from "../Silks";
import { SceneBackdrop } from "../pixel/SceneBackdrop";
import { Saddlecloth } from "./Saddlecloth";
import { FairnessPanel } from "./FairnessPanel";
import { FieldList } from "./FieldList";
import { ResultsTable } from "./ResultsTable";

type Phase = "loading" | "pre" | "live" | "result";

const REVEALED_KEY = "thoroughbred:revealed";

function revealedIds(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(REVEALED_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function wasRevealed(id: string): boolean {
  return revealedIds().includes(id);
}
function markRevealed(id: string): void {
  try {
    const ids = revealedIds().filter((x) => x !== id);
    window.localStorage.setItem(REVEALED_KEY, JSON.stringify([id, ...ids].slice(0, 50)));
  } catch {
    /* storage unavailable: results simply wait for the real-time finish */
  }
}

function durationMs(r: RaceReplay): number {
  return Math.ceil((r.totalTicks * 1000) / r.tickHz);
}

export function RaceExperience({ card, serverNowMs }: { card: RaceCard; serverNowMs: number }) {
  const { config } = card;
  const skew = useClockSkew(serverNowMs);
  const now = useNow(200);
  const state = usePlayerState();
  const localPost = config.postTimeMs - skew;

  const [replay, setReplay] = useState<RaceReplay | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [viewerDone, setViewerDone] = useState(false);
  // If this browser already saw the finish (e.g. fast-forwarded, then reloaded), show the result straight away.
  useEffect(() => {
    if (wasRevealed(card.id) || getPlayerState()?.progress.settled[card.id]) setViewerDone(true);
  }, [card.id]);
  const [settlement, setSettlement] = useState<{ prize: number; position: number; fresh: boolean } | null>(null);

  const mine = state && card.playerId === state.player.playerId ? card.field.find((e) => e.isPlayer) ?? null : null;
  const highlightHorseId = mine?.horse.id;

  // Fetch the replay at (or after) post time. The server answers 425 until then.
  const started = now !== null && now >= localPost;
  useEffect(() => {
    if (!started || replay) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async (n: number) => {
      try {
        const res = await fetch(`/api/races/${encodeURIComponent(card.id)}/replay`);
        if (res.status === 425 && n < 20) {
          timer = setTimeout(() => attempt(n + 1), 400);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RaceReplay;
        if (!cancelled) setReplay(data);
      } catch (e) {
        if (!cancelled) setReplayError((e as Error).message);
      }
    };
    attempt(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [started, replay, card.id]);

  const endsAt = replay ? localPost + durationMs(replay) : null;
  const phase: Phase =
    now === null ? "loading" : now < localPost ? "pre" : replay && (viewerDone || (endsAt !== null && now >= endsAt)) ? "result" : "live";

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

  const onFinished = useCallback(() => {
    markRevealed(card.id);
    setViewerDone(true);
  }, [card.id]);

  // One stage height for countdown and viewer, so the page doesn't jump at the off.
  // 16:9 like the 480x270 native canvas; taller on phones (>= ~70vw) and never taller
  // than a landscape phone's viewport.
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageHeight, setStageHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let h = w * 0.5625;
      if (vw < 640) h = Math.max(h, vw * 0.7);
      h = Math.min(620, Math.max(240, h));
      if (vh < 560) h = Math.min(h, Math.max(220, vh - 70));
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

  const statusPill =
    phase === "pre" ? (
      <span className="chip chip-brass">
        <PixelIcon name="stopwatch" className="h-3.5 w-3.5" />
        <span className="num font-normal">Off in {formatCountdown(localPost - (now ?? 0))}</span>
      </span>
    ) : phase === "live" ? (
      <span className="chip chip-live">
        <span className="live-dot !h-2 !w-2" /> LIVE
      </span>
    ) : phase === "result" ? (
      <span className="chip chip-cream">
        <PixelIcon name="check" className="h-3.5 w-3.5" /> Result official
      </span>
    ) : (
      <span className="chip opacity-0">…</span>
    );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:gap-5">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">
            {card.kind === "quick" ? "Quick race" : "Club card"} · {CLASS_LABEL[config.raceClass]} · Post {formatClock(config.postTimeMs)}
          </span>
          <span className="ml-auto">{statusPill}</span>
        </div>
        <h1 className="display text-[1.9rem] sm:text-[2.6rem]" data-testid="race-name">
          {config.name}
        </h1>
        <RaceMetaChips race={config} showPurse />
      </header>

      {settlement && mine && (
        <div
          className={`${settlement.position === 1 ? "px-panel" : "px-panel-quiet"} relative flex flex-col gap-3 overflow-hidden p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4`}
          data-testid="settlement"
          role="status"
        >
          {settlement.position === 1 && <Confetti />}
          <div className="relative flex items-center gap-3">
            <div className="relative shrink-0">
              <Silks silks={mine.horse.appearance.silks} className="h-14 w-14 drop-shadow-[3px_3px_0_rgba(0,0,0,0.5)]" />
              {settlement.position <= 3 && <PixelIcon name="rosette" className="absolute -bottom-1 -right-2 h-7 w-7 animate-bob" />}
            </div>
            <div className="min-w-0">
              <p className="eyebrow">{settlement.position === 1 ? "Winner!" : "Your runner"}</p>
              <p className="display text-xl text-balance sm:text-2xl">
                {mine.horse.name} finished {ordinal(settlement.position)} of {card.field.length}
              </p>
              <p className="text-sm text-cream-dim">
                {settlement.prize > 0 ? (
                  <>
                    <strong className="num font-normal text-brass-bright">+{formatCredits(settlement.prize)} credits</strong>{" "}
                    {settlement.fresh ? "added to your stable account." : "were credited to your stable."}
                  </>
                ) : (
                  "Out of the prize money this time."
                )}
              </p>
            </div>
          </div>
          <Link href={`/races?horse=${mine.horse.id.split("-").pop()}#quick`} className="btn btn-brass relative shrink-0">
            <PixelIcon name="flag" className="h-4 w-4" /> Race again <ArrowIcon className="h-3 w-3" />
          </Link>
        </div>
      )}

      <section aria-label="Race" className="px-screen -mx-1 !p-0 sm:mx-0">
        {/* broadcast info plate */}
        <div className="flex items-center gap-2 bg-[#14110a] px-2 py-1 sm:px-3" aria-hidden>
          <span className="led shrink-0 bg-brass px-1.5 text-lg leading-tight text-[#241505]">TBRC</span>
          <span className="led min-w-0 flex-1 truncate text-lg leading-tight tracking-wider text-cream-dim">
            {config.name.toUpperCase()} · {card.field.length} RUNNERS
          </span>
          {phase === "live" ? (
            <span className="led flex shrink-0 items-center gap-1.5 text-lg leading-tight text-[#ff8a7a]">
              <span className="live-dot !h-2 !w-2" /> LIVE
            </span>
          ) : phase === "result" ? (
            <span className="led shrink-0 text-lg leading-tight text-[#9fe0a8]">FINAL</span>
          ) : (
            <span className="led shrink-0 text-lg leading-tight text-brass-bright">PRE-RACE</span>
          )}
        </div>
        <div
          ref={stageRef}
          className="relative h-[clamp(240px,calc((min(100vw,72rem)-3rem)*0.5625),620px)] overflow-hidden bg-turf-900"
          style={{ height: stageHeight ?? undefined }}
          data-testid="race-stage"
        >
          {phase === "pre" || phase === "loading" ? (
            <PreRace localPost={localPost} now={now} card={card} />
          ) : replay ? (
            <div data-testid="viewer" className="h-full">
              <RaceViewerClient
                replay={replay}
                highlightHorseId={highlightHorseId}
                onFinished={onFinished}
                height={stageHeight ?? 420}
                startAtMs={localPost}
                autoplay
              />
            </div>
          ) : (
            <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 text-sm text-sage">
              <PixelIcon name={replayError ? "cross" : "flag"} className="h-8 w-8 animate-bob" />
              {replayError ? `Couldn't load the race (${replayError}). Refresh to retry.` : "They're under starter's orders…"}
            </div>
          )}
          {/* scanlines: a faint broadcast texture over the stage edges only */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ boxShadow: "inset 0 0 0 2px rgba(0,0,0,.6), inset 0 0 0 4px rgba(217,164,65,.12)" }}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0">
          {phase === "result" && replay ? (
            <ResultsTable replay={replay} card={card} highlightHorseId={highlightHorseId} />
          ) : (
            <FieldList card={card} highlightHorseId={highlightHorseId} />
          )}
        </div>
        <FairnessPanel card={card} replay={phase === "result" ? replay : null} />
      </div>
    </div>
  );
}

/** Pixel confetti for a win: square bits falling in steps (decorative). */
function Confetti() {
  const colors = ["#f2c86a", "#f3e7c9", "#b0392e", "#7fc3ee", "#5aa66f"];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 22 }, (_, i) => (
        <span
          key={i}
          className="absolute h-2 w-2"
          style={{
            left: `${(i * 37) % 100}%`,
            bottom: `-${(i % 4) * 6}px`,
            background: colors[i % colors.length],
            animation: `float-up ${1400 + (i % 5) * 300}ms steps(14) ${(i % 7) * 180}ms infinite`,
          }}
        />
      ))}
    </div>
  );
}

function PreRace({ localPost, now, card }: { localPost: number; now: number | null; card: RaceCard }) {
  const remaining = now === null ? null : localPost - now;
  const loading = remaining !== null && remaining < 10_000;
  const text = remaining === null ? "–:––" : formatCountdown(remaining);
  return (
    <div className="relative flex h-full min-h-56 w-full flex-col items-center justify-center overflow-hidden px-4 text-center">
      <SceneBackdrop variant="grandstand" />
      <div aria-hidden className="absolute inset-0 bg-[#08150e]/45" />
      {/* Starting stalls, one per runner, with saddlecloth numbers */}
      <div className="absolute bottom-[8%] left-1/2 flex -translate-x-1/2 items-end gap-[3px] sm:gap-1" aria-hidden>
        {card.field.map((e) => (
          <div key={e.gate} className="flex flex-col items-center">
            <div
              className={`flex h-10 w-6 items-start justify-center pt-1 sm:h-16 sm:w-9 ${loading ? "animate-bob" : ""}`}
              style={{
                background: "linear-gradient(#f3e7c9 0 4px, #1f4d35 4px calc(100% - 4px), #0f2a1d calc(100% - 4px))",
                boxShadow: "0 0 0 2px #0b0f0c, inset 3px 0 0 #2c6645",
              }}
            >
              <Saddlecloth gate={e.gate} className="!h-5 !w-5 !text-[0.7rem] sm:!h-6 sm:!w-6 sm:!text-[0.85rem]" />
            </div>
          </div>
        ))}
      </div>
      <div className="relative -mt-10 sm:-mt-16">
        <p className="eyebrow mx-auto w-fit bg-[#08150e]/85 px-1.5 py-0.5 !text-brass-bright">{loading ? "Gates loading" : "Going down to post"}</p>
        <p
          className="px-screen mt-2 inline-block px-3 py-1 text-6xl leading-none text-brass-bright [text-shadow:0_4px_0_#000] sm:px-5 sm:text-8xl"
          data-testid="countdown"
        >
          <Digits text={text} />
        </p>
        <p className="mx-auto mt-2 w-fit bg-[#08150e]/85 px-2 py-0.5 text-sm font-semibold text-cream">
          {card.field.length} runners · off at {formatClock(card.config.postTimeMs)}
        </p>
      </div>
    </div>
  );
}

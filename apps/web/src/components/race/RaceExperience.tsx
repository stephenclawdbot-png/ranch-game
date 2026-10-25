"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RaceReplay } from "@thoroughbred/shared";
import type { RaceCard } from "@/server/races";
import { useClockSkew, useNow } from "@/lib/clock";
import { CLASS_LABEL, formatClock, formatCountdown, formatCredits, ordinal } from "@/lib/format";
import { settleRace, usePlayerState } from "@/lib/player";
import { RaceMetaChips } from "../RaceMeta";
import { RaceViewerClient } from "../RaceViewerClient";
import { ArrowIcon } from "../icons";
import { FairnessPanel } from "./FairnessPanel";
import { FieldList } from "./FieldList";
import { ResultsTable } from "./ResultsTable";

type Phase = "loading" | "pre" | "live" | "result";

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
  const [settlement, setSettlement] = useState<{ prize: number; position: number; fresh: boolean } | null>(null);
  /** Did this page see the race before the off? Then it watches live; otherwise it opens on the result. */
  const arrivedAt = useRef<number | null>(null);
  if (arrivedAt.current === null && now !== null) arrivedAt.current = now;

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
  const watchedLive = arrivedAt.current !== null && endsAt !== null && arrivedAt.current < endsAt;

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

  const onFinished = useCallback(() => setViewerDone(true), []);

  const statusPill =
    phase === "pre" ? (
      <span className="chip !border-brass/40 !text-brass-bright">
        Off in <span className="tabular font-semibold">{formatCountdown(localPost - (now ?? 0))}</span>
      </span>
    ) : phase === "live" ? (
      <span className="chip !border-[#e5584a]/40 !text-[#f3a197]">
        <span className="live-dot" /> Live
      </span>
    ) : phase === "result" ? (
      <span className="chip">Result official</span>
    ) : (
      <span className="chip opacity-0">…</span>
    );

  const viewerProps = useMemo(
    () => (watchedLive ? { startAtMs: localPost, autoplay: true } : { autoplay: false }),
    [watchedLive, localPost],
  );

  return (
    <div className="grid gap-6">
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="eyebrow">
            {card.kind === "quick" ? "Quick race" : "Club card"} · {CLASS_LABEL[config.raceClass]}
          </span>
          <span className="text-sage">· Post {formatClock(config.postTimeMs)}</span>
          <span className="ml-auto">{statusPill}</span>
        </div>
        <h1 className="display text-3xl font-semibold leading-tight sm:text-4xl" data-testid="race-name">
          {config.name}
        </h1>
        <RaceMetaChips race={config} showPurse />
      </header>

      {settlement && mine && (
        <div
          className="panel flex flex-col gap-3 border-brass/40 bg-gradient-to-r from-brass/15 to-transparent p-4 sm:flex-row sm:items-center sm:justify-between"
          data-testid="settlement"
          role="status"
        >
          <div>
            <p className="eyebrow">{settlement.position === 1 ? "Winner!" : "Your runner"}</p>
            <p className="display text-xl font-semibold">
              {mine.horse.name} finished {ordinal(settlement.position)} of {card.field.length}
            </p>
            <p className="text-sm text-cream-dim">
              {settlement.prize > 0 ? (
                <>
                  <strong className="text-brass-bright">+{formatCredits(settlement.prize)} credits</strong>{" "}
                  {settlement.fresh ? "added to your stable account." : "were credited to your stable."}
                </>
              ) : (
                "Out of the prize money this time."
              )}
            </p>
          </div>
          <Link href={`/races?horse=${mine.horse.id.split("-").pop()}#quick`} className="btn btn-brass shrink-0">
            Race again <ArrowIcon className="h-4 w-4" />
          </Link>
        </div>
      )}

      <section aria-label="Race" className="grid gap-4">
        <div className="relative overflow-hidden rounded-2xl border border-brass/15 bg-turf-900" data-testid="race-stage">
          {phase === "pre" || phase === "loading" ? (
            <PreRace localPost={localPost} now={now} card={card} />
          ) : replay ? (
            <div data-testid="viewer">
              <RaceViewerClient replay={replay} highlightHorseId={highlightHorseId} onFinished={onFinished} {...viewerProps} />
            </div>
          ) : (
            <div className="flex aspect-[16/9] items-center justify-center text-sm text-sage">
              {replayError ? `Couldn't load the race (${replayError}). Refresh to retry.` : "They're under starter's orders…"}
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
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

function PreRace({ localPost, now, card }: { localPost: number; now: number | null; card: RaceCard }) {
  const remaining = now === null ? null : localPost - now;
  const loading = remaining !== null && remaining < 10_000;
  return (
    <div className="relative flex aspect-[16/9] min-h-64 w-full flex-col items-center justify-center overflow-hidden px-6 text-center">
      {/* Turf stripes */}
      <div
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "repeating-linear-gradient(100deg, rgba(43,101,72,.35) 0 60px, rgba(31,77,55,.35) 60px 120px), radial-gradient(ellipse at 50% 120%, rgba(201,162,74,.18), transparent 60%)",
        }}
        aria-hidden
      />
      <div className="absolute inset-x-0 top-[22%] h-px bg-cream/25" aria-hidden />
      <div className="absolute inset-x-0 bottom-[22%] h-px bg-cream/25" aria-hidden />
      {/* Starting stalls */}
      <div className="absolute bottom-[24%] left-1/2 flex -translate-x-1/2 gap-1 opacity-70" aria-hidden>
        {card.field.map((e) => (
          <div key={e.gate} className="flex h-10 w-5 items-end justify-center rounded-t-sm border border-cream/30 bg-ink/40 pb-0.5 text-[0.55rem] font-bold text-cream/70 sm:h-14 sm:w-7">
            {e.gate}
          </div>
        ))}
      </div>
      <div className="relative">
        <p className="eyebrow">{loading ? "Gates loading" : "Going down to post"}</p>
        <p className="display mt-2 text-6xl font-semibold tabular text-cream drop-shadow-[0_4px_20px_rgba(0,0,0,0.6)] sm:text-8xl" data-testid="countdown">
          {remaining === null ? "–:––" : formatCountdown(remaining)}
        </p>
        <p className="mt-2 text-sm text-cream-dim">
          {card.field.length} runners · off at {formatClock(card.config.postTimeMs)}
        </p>
      </div>
    </div>
  );
}

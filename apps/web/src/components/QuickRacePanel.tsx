"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { RunningStyle } from "@thoroughbred/shared";
import { STYLE_BLURB, STYLE_LABEL, SURFACE_LABEL, formatDistance } from "@/lib/format";
import { horseRecord, usePlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";
import { HorsePortrait } from "./HorsePortrait";
import { JoinNudge } from "./PlayerGate";
import { Stall } from "./Stall";
import { ArrowIcon, PixelIcon } from "./icons";

const TACTICS: RunningStyle[] = ["front", "stalker", "closer"];
/** Where the jockey sits in the pack (index in a 7-cell lane, 6 = leader). */
const TACTIC_POS: Record<RunningStyle, number> = { front: 6, stalker: 4, closer: 0 };

function StepHeading({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <legend className="mb-2 flex items-center gap-2">
      <span className="num flex h-6 w-6 items-center justify-center bg-brass text-sm text-[#241505]">{n}</span>
      <span className="display text-lg">{children}</span>
    </legend>
  );
}

/** Tiny pixel race diagram: the pack as cells, your horse in brass. */
function PackDiagram({ pos, active }: { pos: number; active: boolean }) {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <span
          key={i}
          className="h-2.5 w-2.5"
          style={{
            background: i === pos ? (active ? "#f2c86a" : "#d9a441") : "#2c6645",
            boxShadow: i === pos ? "0 0 0 2px #0b0f0c" : undefined,
          }}
        />
      ))}
      <span className="ml-1 h-3.5 w-[3px] bg-cream" />
    </span>
  );
}

export function QuickRacePanel() {
  const router = useRouter();
  const state = usePlayerState();
  const { horses } = usePlayerHorses(state?.player.playerId, state?.player.silks);
  const [horseIndex, setHorseIndex] = useState(0);
  const [tactic, setTactic] = useState<RunningStyle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preselect from ?horse=N (links from the stable and horse pages).
  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get("horse"));
    if (Number.isInteger(n) && n >= 0 && n < 6) setHorseIndex(n);
  }, []);

  if (state === undefined) return <div className="px-panel h-96 animate-pulse opacity-50" />;
  if (state === null) return <JoinNudge compact />;

  const horse = horses?.[horseIndex];
  const chosenTactic = tactic ?? horse?.style ?? "stalker";

  async function enter() {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/races/quick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId: state.player.playerId,
          horseIndex,
          tactic: chosenTactic,
          silks: state.player.silks,
          stableName: state.player.stableName,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { raceId } = (await res.json()) as { raceId: string };
      router.push(`/race/${raceId}`);
    } catch (e) {
      setError(`Couldn't enter the race (${(e as Error).message}). Please try again.`);
      setBusy(false);
    }
  }

  return (
    <div className="px-panel min-w-0 p-3 sm:p-5" data-testid="quick-race">
      <fieldset className="min-w-0">
        <StepHeading n={1}>Choose your runner</StepHeading>
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2 pt-1 sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-6">
          {(horses ?? Array.from({ length: 6 }, () => null)).map((h, i) => {
            const selected = i === horseIndex;
            const rec = horseRecord(state, i);
            return (
              <button
                key={h?.id ?? i}
                type="button"
                disabled={!h}
                aria-pressed={selected}
                onClick={() => {
                  setHorseIndex(i);
                  setTactic(null);
                }}
                className={`px-panel-quiet group w-36 shrink-0 snap-start text-left transition-transform sm:w-auto ${
                  selected ? "px-select -translate-y-1" : "hover:-translate-y-0.5"
                }`}
                data-testid="pick-horse"
              >
                <Stall className="aspect-[4/3]" tone={selected ? "wood" : "green"}>
                  {h && (
                    <div className="absolute inset-x-0 bottom-[4%] top-[6%] flex justify-center">
                      <HorsePortrait appearance={h.appearance} className={`h-full w-auto ${selected ? "animate-bob" : ""}`} />
                    </div>
                  )}
                </Stall>
                <div className="px-1.5 pb-1 pt-1.5">
                  <p className="display truncate text-[0.95rem]">{h?.name ?? "…"}</p>
                  <p className="truncate text-[0.7rem] text-sage">
                    {h ? `${formatDistance(h.preferredDistanceM)} · ${SURFACE_LABEL[h.preferredSurface]}` : " "}
                  </p>
                  <p className="num text-[0.75rem] text-cream-dim">
                    {rec.starts} starts · {rec.wins} wins
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-4 min-w-0">
        <StepHeading n={2}>Riding instructions</StepHeading>
        <div className="grid gap-2 sm:grid-cols-3">
          {TACTICS.map((t) => {
            const selected = chosenTactic === t;
            return (
              <label
                key={t}
                className={`px-panel-quiet flex cursor-pointer flex-col gap-1.5 p-2.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-brass-bright ${
                  selected ? "px-select" : "hover:brightness-110"
                }`}
              >
                <input type="radio" name="tactic" value={t} checked={selected} onChange={() => setTactic(t)} className="sr-only" />
                <span className="flex items-center justify-between gap-2">
                  <span className="display flex items-center gap-2 text-[1.05rem]">
                    <span className={`h-3 w-3 ${selected ? "bg-brass-bright" : "bg-[#0a1912]"}`} style={{ boxShadow: "0 0 0 2px #0b0f0c" }} aria-hidden />
                    {STYLE_LABEL[t]}
                  </span>
                  {horse?.style === t && <span className="chip chip-brass !py-0 text-[0.65rem]">natural</span>}
                </span>
                <PackDiagram pos={TACTIC_POS[t]} active={selected} />
                <span className="text-xs leading-snug text-sage">{STYLE_BLURB[t]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-col gap-3 border-t-2 border-dashed border-[#1f4d35] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-xs text-sage">
          <PixelIcon name="stopwatch" className="h-4 w-4 shrink-0" />
          The club draws a field of 8–12 and the conditions. Gates load ten seconds after entry. Free to enter.
        </p>
        <button type="button" className="btn btn-brass btn-lg shrink-0" disabled={!horse || busy} onClick={enter} data-testid="enter-race">
          <PixelIcon name="flag" className="h-5 w-5" />
          <span className="max-w-[14rem] truncate">{busy ? "Entering…" : `Enter ${horse?.name ?? "race"}`}</span>
          <ArrowIcon className="h-3 w-3" />
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-claret">{error}</p>}
    </div>
  );
}

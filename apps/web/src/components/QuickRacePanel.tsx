"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { RunningStyle } from "@thoroughbred/shared";
import { STYLE_BLURB, STYLE_LABEL, SURFACE_LABEL, formatDistance } from "@/lib/format";
import { horseRecord, usePlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";
import { HorsePortrait } from "./HorsePortrait";
import { JoinNudge } from "./PlayerGate";
import { ArrowIcon } from "./icons";

const TACTICS: RunningStyle[] = ["front", "stalker", "closer"];

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

  if (state === undefined) return <div className="panel h-96 animate-pulse opacity-50" />;
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
    <div className="panel min-w-0 p-4 sm:p-6" data-testid="quick-race">
      <fieldset className="min-w-0">
        <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-cream-dim">1 · Choose your runner</legend>
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2 sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-6">
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
                className={`w-36 shrink-0 snap-start rounded-xl border p-2 text-left transition-colors sm:w-auto ${
                  selected ? "border-brass/70 bg-brass/10" : "border-cream/10 bg-turf-950/40 hover:border-cream/25"
                }`}
                data-testid="pick-horse"
              >
                <div className="aspect-[4/3] overflow-hidden rounded-lg bg-turf-950/70">
                  {h && <HorsePortrait appearance={h.appearance} className="mx-auto h-full" backdrop={false} />}
                </div>
                <p className="mt-1.5 truncate text-sm font-semibold">{h?.name ?? "…"}</p>
                <p className="truncate text-[0.7rem] text-sage">
                  {h ? `${formatDistance(h.preferredDistanceM)} · ${SURFACE_LABEL[h.preferredSurface]}` : " "}
                </p>
                <p className="tabular text-[0.7rem] text-cream-dim">
                  {rec.starts} starts · {rec.wins} wins
                </p>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-5 min-w-0">
        <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-cream-dim">2 · Riding instructions</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {TACTICS.map((t) => {
            const selected = chosenTactic === t;
            return (
              <label
                key={t}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brass-bright ${
                  selected ? "border-brass/70 bg-brass/10" : "border-cream/10 bg-turf-950/40 hover:border-cream/25"
                }`}
              >
                <input type="radio" name="tactic" value={t} checked={selected} onChange={() => setTactic(t)} className="sr-only" />
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? "border-brass-bright" : "border-cream/30"}`}
                  aria-hidden
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-brass-bright" />}
                </span>
                <span>
                  <span className="block text-sm font-semibold">
                    {STYLE_LABEL[t]}
                    {horse?.style === t && <span className="ml-2 text-[0.65rem] font-semibold uppercase tracking-wider text-brass">natural</span>}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-sage">{STYLE_BLURB[t]}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5 flex flex-col gap-3 border-t border-cream/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-sage">
          The club draws a field of 8–12 and the conditions. Gates load ten seconds after entry. Free to enter.
        </p>
        <button type="button" className="btn btn-brass shrink-0" disabled={!horse || busy} onClick={enter} data-testid="enter-race">
          {busy ? "Entering…" : `Enter ${horse?.name ?? "race"}`}
          <ArrowIcon className="h-4 w-4" />
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-claret">{error}</p>}
    </div>
  );
}

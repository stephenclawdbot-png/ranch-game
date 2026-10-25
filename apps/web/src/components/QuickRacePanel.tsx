"use client";

import { useEffect, useState } from "react";
import { usePlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";
import { recommendIndex } from "@/lib/aptitude";
import { EntryForm } from "./entry/EntryForm";
import { JoinNudge } from "./PlayerGate";
import { useEntry } from "./entry/EntryProvider";
import { PixelIcon } from "./icons";
import { ActionBar } from "./ui/ActionBar";

/** Story races on /races: Quick Pick first (the primary action), the manual picker second. */
export function QuickRacePanel() {
  const state = usePlayerState();
  const { horses } = usePlayerHorses(state?.player.playerId, state?.player.silks);
  const [initial, setInitial] = useState<number | null>(null);
  const entry = useEntry();

  // Preselect from ?horse=N (old links), else the recommended horse.
  useEffect(() => {
    if (!horses || initial !== null) return;
    const n = Number(new URLSearchParams(window.location.search).get("horse") ?? "x");
    setInitial(Number.isInteger(n) && n >= 0 && n < horses.length ? n : recommendIndex(horses));
  }, [horses, initial]);

  if (state === undefined) return <div className="surface h-96 opacity-50" aria-busy />;
  if (state === null) return <JoinNudge compact />;
  return (
    <div className="grid gap-3">
      <div className="frame-hero flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div>
          <p className="t-title">Quick Pick</p>
          <p className="text-cream-dim">Your best-suited fresh horse, ridden to its natural style. Watch, skip to the result, or watch later.</p>
        </div>
        <ActionBar>
          <button type="button" className="btn btn-brass btn-lg" onClick={entry.quickPick} data-testid="quick-pick">
            <PixelIcon name="flag" size={32} className="-my-2" /> Enter next race
          </button>
        </ActionBar>
      </div>
      <details className="surface group" open>
        <summary className="flex min-h-12 items-center justify-between gap-2 px-3 font-extrabold">
          Or choose the horse and plan yourself
          <span aria-hidden className="text-cream-dim group-open:rotate-90">
            ▸
          </span>
        </summary>
        <div className="border-t-2 border-line p-3 sm:p-4">
          <EntryForm state={state} horses={horses} initialIndex={initial ?? 0} inline />
        </div>
      </details>
    </div>
  );
}

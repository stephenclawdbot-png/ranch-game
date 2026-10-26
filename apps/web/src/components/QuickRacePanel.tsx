"use client";

import { useEffect, useState } from "react";
import { recommendHorse, usePlayerState } from "@/lib/player";
import { EntryForm } from "./entry/EntryForm";
import { JoinNudge } from "./PlayerGate";
import { useEntry } from "./entry/EntryProvider";
import { PixelIcon } from "./icons";

/** Story races on /races: Quick Pick first (the primary action), the manual picker second. */
export function QuickRacePanel() {
  const state = usePlayerState();
  const [initial, setInitial] = useState<string | null>(null);
  const entry = useEntry();

  // Preselect from ?horse=<id>, else the recommended horse.
  useEffect(() => {
    if (!state || initial !== null) return;
    const q = new URLSearchParams(window.location.search).get("horse");
    setInitial(state.horses.some((h) => h.id === q) ? q : (recommendHorse(state)?.id ?? state.horses[0]?.id ?? ""));
  }, [state, initial]);

  if (state === undefined) return <div className="surface h-96 opacity-50" aria-busy />;
  if (state === null) return <JoinNudge compact />;
  return (
    <div className="grid gap-3">
      <div className="surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="t-title">Quick Pick · Story</p>
          <p className="t-meta">Your best-suited fresh horse, ridden to its natural style.</p>
        </div>
        <button type="button" className="btn shrink-0" onClick={entry.quickPick} data-testid="quick-pick">
          <PixelIcon name="flag" size={32} className="-my-2" /> Race now
        </button>
      </div>
      <details className="surface group" open>
        <summary className="flex min-h-12 items-center justify-between gap-2 px-4 font-extrabold">
          Or choose the horse and plan yourself
          <span aria-hidden className="text-cream-dim group-open:rotate-90">
            ▸
          </span>
        </summary>
        <div className="border-t-2 border-line p-3 sm:p-4">{initial !== null && <EntryForm key={initial} state={state} initialHorseId={initial || null} inline />}</div>
      </details>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { usePlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";
import { recommendIndex } from "@/lib/aptitude";
import { EntryForm } from "./entry/EntryForm";
import { JoinNudge } from "./PlayerGate";

/** Inline quick-race entry on /races (the same form as the entry sheet, with the runner picker). */
export function QuickRacePanel() {
  const state = usePlayerState();
  const { horses } = usePlayerHorses(state?.player.playerId, state?.player.silks);
  const [initial, setInitial] = useState<number | null>(null);

  // Preselect from ?horse=N (old links), else the recommended horse.
  useEffect(() => {
    if (!horses || initial !== null) return;
    const n = Number(new URLSearchParams(window.location.search).get("horse") ?? "x");
    setInitial(Number.isInteger(n) && n >= 0 && n < horses.length ? n : recommendIndex(horses));
  }, [horses, initial]);

  if (state === undefined) return <div className="surface h-96 opacity-50" aria-busy />;
  if (state === null) return <JoinNudge compact />;
  return (
    <div className="surface p-3 sm:p-4">
      <EntryForm state={state} horses={horses} initialIndex={initial ?? 0} inline />
    </div>
  );
}

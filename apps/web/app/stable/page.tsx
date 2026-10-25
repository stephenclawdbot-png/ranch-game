"use client";

import Link from "next/link";
import { HorseCard } from "@/components/HorseCard";
import { PlayerGate } from "@/components/PlayerGate";
import { Silks } from "@/components/Silks";
import { formatCredits } from "@/lib/format";
import { horseRecord, totals, type PlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";

function Stable({ state }: { state: PlayerState }) {
  const { horses, error } = usePlayerHorses(state.player.playerId, state.player.silks);
  const t = totals(state);
  return (
    <div>
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <Silks silks={state.player.silks} className="h-16 w-16 shrink-0 drop-shadow-lg sm:h-20 sm:w-20" />
          <div className="min-w-0">
            <p className="eyebrow">Your stable</p>
            <h1 className="display truncate text-3xl font-semibold sm:text-4xl" data-testid="stable-name">
              {state.player.stableName}
            </h1>
            <Link href="/play" className="mt-1 inline-block text-xs text-sage underline decoration-cream/20 underline-offset-4 hover:text-cream">
              Edit name &amp; colours
            </Link>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 sm:flex sm:gap-3">
          {[
            ["Credits", formatCredits(state.progress.credits)],
            ["Starts", String(t.starts)],
            ["Wins", String(t.wins)],
          ].map(([k, v]) => (
            <div key={k} className="panel-quiet px-4 py-2.5 sm:min-w-24">
              <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-sage">{k}</dt>
              <dd className="display tabular text-xl font-semibold text-cream">{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="rule my-6" />

      {error && <p className="panel-quiet p-4 text-sm text-claret">Couldn&rsquo;t load your horses ({error}). Try refreshing.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {horses
          ? horses.map((h, i) => <HorseCard key={h.id} horse={h} index={i} record={horseRecord(state, i)} />)
          : Array.from({ length: 6 }, (_, i) => <div key={i} className="panel h-[30rem] animate-pulse opacity-60" />)}
      </div>
    </div>
  );
}

export default function StablePage() {
  return <PlayerGate>{(state) => <Stable state={state} />}</PlayerGate>;
}

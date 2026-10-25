"use client";

import Link from "next/link";
import { HorseCard } from "@/components/HorseCard";
import { StatTile } from "@/components/PaddockStable";
import { PlayerGate } from "@/components/PlayerGate";
import { Silks } from "@/components/Silks";
import { PixelIcon } from "@/components/icons";
import { SceneHero } from "@/components/pixel/SceneBackdrop";
import { formatCredits } from "@/lib/format";
import { horseRecord, totals, type PlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";

function Stable({ state }: { state: PlayerState }) {
  const { horses, error } = usePlayerHorses(state.player.playerId, state.player.silks);
  const t = totals(state);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <SceneHero variant="stable" overlay={false} height="min-h-[10rem] sm:min-h-[11rem] md:min-h-[12rem]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-end gap-3">
            <Silks silks={state.player.silks} className="h-16 w-16 shrink-0 drop-shadow-[3px_3px_0_rgba(0,0,0,0.5)] sm:h-20 sm:w-20" />
            <div className="min-w-0">
              <p className="eyebrow">Your stable</p>
              <h1 className="display truncate text-[1.9rem] sm:text-[2.6rem]" data-testid="stable-name">
                {state.player.stableName}
              </h1>
              <Link href="/play" className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-cream-dim hover:text-brass-bright">
                <PixelIcon name="pencil" className="h-3.5 w-3.5" /> Edit name &amp; colours
              </Link>
            </div>
          </div>
          <dl className="grid grid-cols-[1.5fr_1fr_1fr] gap-1.5 sm:w-[22rem]">
            <StatTile icon="coin" label="Credits" value={formatCredits(state.progress.credits)} />
            <StatTile icon="flag" label="Starts" value={String(t.starts)} />
            <StatTile icon="trophy" label="Wins" value={String(t.wins)} />
          </dl>
        </div>
      </SceneHero>

      <div className="flex items-end justify-between">
        <h2 className="display flex items-center gap-2 text-2xl">
          <PixelIcon name="horseshoe" className="h-6 w-6" /> The string
        </h2>
        <p className="label">{horses?.length ?? 6} horses in training</p>
      </div>

      {error && <p className="px-oxblood p-3 text-sm">Couldn&rsquo;t load your horses ({error}). Try refreshing.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {horses
          ? horses.map((h, i) => <HorseCard key={h.id} horse={h} index={i} record={horseRecord(state, i)} />)
          : Array.from({ length: 6 }, (_, i) => <div key={i} className="px-panel h-[30rem] animate-pulse opacity-60" />)}
      </div>
    </div>
  );
}

export default function StablePage() {
  return <PlayerGate>{(state) => <Stable state={state} />}</PlayerGate>;
}

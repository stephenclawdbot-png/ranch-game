"use client";

import Link from "next/link";
import { formatCredits, ordinal } from "@/lib/format";
import { totals, usePlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";
import { HorsePortrait } from "./HorsePortrait";
import { JoinNudge } from "./PlayerGate";
import { Silks } from "./Silks";
import { ArrowIcon, PixelIcon, type IconName } from "./icons";

export function StatTile({ icon, label, value, testId }: { icon: IconName; label: string; value: string; testId?: string }) {
  return (
    <div className="px-inset flex items-center gap-1.5 px-1.5 py-1">
      <PixelIcon name={icon} className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
      <div className="min-w-0">
        <dt className="label leading-none">{label}</dt>
        <dd className="num truncate text-lg leading-tight text-cream" data-testid={testId}>
          {value}
        </dd>
      </div>
    </div>
  );
}

export function PaddockStable() {
  const state = usePlayerState();
  const { horses } = usePlayerHorses(state?.player.playerId, state?.player.silks);
  if (state === undefined) return <div className="px-panel h-full min-h-72 animate-pulse opacity-50" />;
  if (state === null) return <JoinNudge compact />;
  const t = totals(state);
  const last = state.progress.history.slice(0, 3);
  return (
    <section className="px-panel flex h-full flex-col p-3 sm:p-4" aria-labelledby="mystable-h" data-testid="paddock-stable">
      <div className="flex items-center gap-3">
        <Silks silks={state.player.silks} className="h-14 w-14 shrink-0 drop-shadow-[3px_3px_0_rgba(0,0,0,0.45)]" />
        <div className="min-w-0">
          <p className="eyebrow">Your stable</p>
          <h2 id="mystable-h" className="display truncate text-xl">
            {state.player.stableName}
          </h2>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[1.5fr_1fr_1fr] gap-1.5">
        <StatTile icon="coin" label="Credits" value={formatCredits(state.progress.credits)} />
        <StatTile icon="flag" label="Runs" value={String(t.starts)} />
        <StatTile icon="trophy" label="Wins" value={String(t.wins)} />
      </dl>
      <div className="mt-3 grid grid-cols-6 gap-1">
        {(horses ?? []).map((h) => (
          <Link
            key={h.id}
            href={`/horse/${h.id}`}
            title={h.name}
            className="relative block aspect-square overflow-hidden bg-[#163a28] shadow-[0_0_0_2px_#0b0f0c,inset_0_-3px_0_#0a1912] transition-transform hover:-translate-y-1"
          >
            <HorsePortrait appearance={h.appearance} className="absolute inset-0 h-[112%] w-[112%]" />
          </Link>
        ))}
      </div>
      <div className="mt-3 flex-1">
        <p className="label">Latest runs</p>
        {last.length === 0 ? (
          <p className="mt-1 text-sm text-cream-dim">No runs yet — your first quick race is one tap away.</p>
        ) : (
          <ul className="mt-1 grid gap-1 text-sm">
            {last.map((h) => (
              <li key={h.raceId}>
                <Link href={`/race/${h.raceId}`} className="flex items-center gap-2 hover:text-brass-bright">
                  <span className={`num w-9 shrink-0 ${h.position === 1 ? "text-brass-bright" : "text-cream-dim"}`}>{ordinal(h.position)}</span>
                  <span className="min-w-0 flex-1 truncate">{h.horseName}</span>
                  <span className="num text-xs text-sage">{h.prize > 0 ? `+${formatCredits(h.prize)}` : "–"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link href="/stable" className="btn btn-sm mt-3 w-full">
        <PixelIcon name="stable" className="h-4 w-4" /> Visit the stable <ArrowIcon className="h-3 w-3" />
      </Link>
    </section>
  );
}

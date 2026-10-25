"use client";

import Link from "next/link";
import { formatCredits, ordinal } from "@/lib/format";
import { totals, usePlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";
import { HorsePortrait } from "./HorsePortrait";
import { JoinNudge } from "./PlayerGate";
import { Silks } from "./Silks";
import { ArrowIcon } from "./icons";

export function PaddockStable() {
  const state = usePlayerState();
  const { horses } = usePlayerHorses(state?.player.playerId, state?.player.silks);
  if (state === undefined) return <div className="panel h-full min-h-72 animate-pulse opacity-50" />;
  if (state === null) return <JoinNudge compact />;
  const t = totals(state);
  const last = state.progress.history.slice(0, 3);
  return (
    <section className="panel flex h-full flex-col p-5" aria-labelledby="mystable-h" data-testid="paddock-stable">
      <div className="flex items-center gap-3">
        <Silks silks={state.player.silks} className="h-12 w-12 shrink-0" />
        <div className="min-w-0">
          <p className="eyebrow">Your stable</p>
          <h2 id="mystable-h" className="display truncate text-xl font-semibold">
            {state.player.stableName}
          </h2>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {[
          ["Credits", formatCredits(state.progress.credits)],
          ["Runs", String(t.starts)],
          ["Wins", String(t.wins)],
        ].map(([k, v]) => (
          <div key={k} className="panel-quiet px-3 py-2">
            <dt className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-sage">{k}</dt>
            <dd className="display tabular text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex -space-x-3">
        {(horses ?? []).map((h) => (
          <Link key={h.id} href={`/horse/${h.id}`} title={h.name} className="relative h-12 w-12 overflow-hidden rounded-full border-2 border-turf-850 bg-turf-700 transition-transform hover:z-10 hover:-translate-y-0.5">
            <HorsePortrait appearance={h.appearance} backdrop={false} className="absolute -left-1 top-0 h-14 w-14" />
          </Link>
        ))}
      </div>
      <div className="mt-4 flex-1">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-sage">Latest runs</p>
        {last.length === 0 ? (
          <p className="mt-1.5 text-sm text-cream-dim">No runs yet — your first quick race is one tap away.</p>
        ) : (
          <ul className="mt-1.5 grid gap-1.5 text-sm">
            {last.map((h) => (
              <li key={h.raceId}>
                <Link href={`/race/${h.raceId}`} className="flex items-center gap-2 hover:text-brass-bright">
                  <span className={`w-9 shrink-0 font-semibold ${h.position === 1 ? "text-brass-bright" : "text-cream-dim"}`}>{ordinal(h.position)}</span>
                  <span className="min-w-0 flex-1 truncate">{h.horseName}</span>
                  <span className="tabular text-xs text-sage">{h.prize > 0 ? `+${formatCredits(h.prize)}` : "–"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link href="/stable" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brass-bright hover:text-cream">
        Visit the stable <ArrowIcon className="h-4 w-4" />
      </Link>
    </section>
  );
}

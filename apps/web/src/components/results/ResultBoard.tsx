import Link from "next/link";
import { formatRaceTime, type RaceReplay } from "@thoroughbred/shared";
import type { RaceCard } from "@/server/races";
import { SilksIcon } from "../Silks";
import { PositionBadge } from "../ui/PositionBadge";

/** Podium (1-2-3: silks, names, margins, time) plus your row when you finished outside the top 3. */
export function ResultBoard({ replay, card, highlightHorseId }: { replay: RaceReplay; card: RaceCard; highlightHorseId?: string }) {
  const byId = new Map(card.field.map((e) => [e.horse.id, e]));
  const order = replay.result.finishOrder;
  const mine = order.find((f) => f.horseId === highlightHorseId);
  const rows = order.slice(0, 3);
  if (mine && mine.position > 3) rows.push(mine);

  return (
    <section className="surface p-3 sm:p-4" aria-labelledby="board-h" data-testid="result-board">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="board-h" className="t-display-m">
          Result
        </h2>
        <p className="t-meta">
          Winning time <span className="num text-cream">{formatRaceTime(replay.result.winningTimeUs)}</span>
          {replay.result.photoFinish && <span className="chip chip-cream ml-2">Photo finish</span>}
        </p>
      </div>
      <ol className="mt-3 grid gap-1.5">
        {rows.map((f, i) => {
          const e = byId.get(f.horseId);
          const me = f.horseId === highlightHorseId;
          return (
            <li key={f.horseId}>
              {i === 3 && (
                <p className="caption py-1 pl-1" aria-hidden>
                  …
                </p>
              )}
              <div
                className={`${me ? "is-selected" : "surface-2"} flex items-center gap-3 p-2`}
                style={{
                  animation: `fade-up 240ms steps(4) ${i * 160}ms both`,
                }}
              >
                <PositionBadge position={f.position} size={f.position === 1 ? "lg" : "md"} />
                {e && <SilksIcon silks={e.horse.appearance.silks} className="h-9 w-9" />}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2">
                    <Link href={`/horse/${f.horseId}`} className={`font-extrabold hover:underline ${f.position === 1 ? "text-lg" : ""}`}>
                      <span data-testid={f.position === 1 ? "winner-name" : undefined}>{e?.horse.name ?? f.horseId}</span>
                    </Link>
                    {me && <span className="you-tag">You</span>}
                  </p>
                  <p className="t-meta truncate">{e?.stableName}</p>
                </div>
                <p className="shrink-0 text-right text-sm font-bold text-cream-dim">
                  {f.position === 1 ? <span className="num text-cream">{formatRaceTime(f.finishTimeUs)}</span> : <>{f.marginLabel}</>}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

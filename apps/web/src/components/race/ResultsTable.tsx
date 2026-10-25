import Link from "next/link";
import { formatRaceTime, type RaceReplay } from "@thoroughbred/shared";
import type { RaceCard } from "@/server/races";
import { formatCredits } from "@/lib/format";
import { SilksIcon } from "../Silks";

export function ResultsTable({ replay, card, highlightHorseId }: { replay: RaceReplay; card: RaceCard; highlightHorseId?: string }) {
  const byId = new Map(card.field.map((e) => [e.horse.id, e]));
  const { result } = replay;
  return (
    <section aria-labelledby="results-h">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="results-h" className="display text-2xl font-semibold">
          Result
        </h2>
        <p className="text-xs text-sage">
          Winning time <span className="tabular text-cream">{formatRaceTime(result.winningTimeUs)}</span>
          {result.photoFinish && <span className="ml-2 text-brass">· Photo finish</span>}
        </p>
      </div>
      <div className="panel overflow-hidden">
        <table className="w-full text-left text-sm" data-testid="results-table">
          <thead className="border-b border-cream/10 text-[0.65rem] uppercase tracking-[0.14em] text-sage">
            <tr>
              <th scope="col" className="w-12 py-2.5 pl-4 font-semibold">Pos</th>
              <th scope="col" className="py-2.5 pl-2 font-semibold">Horse</th>
              <th scope="col" className="hidden py-2.5 pr-5 font-semibold sm:table-cell">Time</th>
              <th scope="col" className="py-2.5 font-semibold">Margin</th>
              <th scope="col" className="py-2.5 pr-4 text-right font-semibold">Prize</th>
            </tr>
          </thead>
          <tbody>
            {result.finishOrder.map((f) => {
              const e = byId.get(f.horseId);
              const me = f.horseId === highlightHorseId;
              const podium = f.position <= 3;
              return (
                <tr
                  key={f.horseId}
                  className={`border-b border-cream/5 last:border-0 ${me ? "bg-brass/10 shadow-[inset_3px_0_0_var(--color-brass)]" : ""}`}
                  data-testid="result-row"
                >
                  <td className="py-2.5 pl-4">
                    <span
                      className={`display flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold tabular ${
                        f.position === 1
                          ? "bg-gradient-to-b from-brass-bright to-brass text-ink"
                          : podium
                            ? "border border-brass/50 text-brass-bright"
                            : "text-cream-dim"
                      }`}
                    >
                      {f.position}
                    </span>
                  </td>
                  <td className="w-full max-w-0 py-2.5 pl-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      {e && <SilksIcon silks={e.horse.appearance.silks} className="h-8 w-8" />}
                      <div className="min-w-0">
                        <Link href={`/horse/${f.horseId}`} className="block truncate font-semibold text-cream hover:text-brass-bright">
                          <span data-testid={f.position === 1 ? "winner-name" : undefined}>{e?.horse.name ?? f.horseId}</span>
                          {me && <span className="ml-2 hidden align-middle text-[0.6rem] font-bold uppercase tracking-wider text-brass sm:inline">Yours</span>}
                        </Link>
                        <p className="truncate text-xs text-sage">
                          {e?.stableName}
                          <span className="tabular sm:hidden"> · {formatRaceTime(f.finishTimeUs)}</span>
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap py-2.5 pr-5 tabular text-cream-dim sm:table-cell">{formatRaceTime(f.finishTimeUs)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-2 text-cream-dim">{f.position === 1 ? "—" : f.marginLabel}</td>
                  <td className={`py-2.5 pr-4 text-right tabular ${f.prize > 0 ? "font-semibold text-brass-bright" : "text-sage"}`}>
                    {f.prize > 0 ? formatCredits(f.prize) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

import Link from "next/link";
import { formatRaceTime, type RaceReplay } from "@thoroughbred/shared";
import type { RaceCard } from "@/lib/types";
import { formatCredits, ordinal } from "@/lib/format";
import { SilksIcon } from "../Silks";
import { Saddlecloth } from "../race/Saddlecloth";

/** The full official result, collapsed by default (the board above shows what matters). */
export function FullResults({
  replay,
  card,
  highlightHorseId,
  open = false,
}: {
  replay: RaceReplay;
  card: RaceCard;
  highlightHorseId?: string;
  open?: boolean;
}) {
  const byId = new Map(card.field.map((e) => [e.horse.id, e]));
  return (
    <details className="surface group" open={open}>
      <summary className="flex min-h-12 items-center justify-between gap-2 px-3 font-extrabold">
        Full result · {replay.result.finishOrder.length} runners
        <span aria-hidden className="text-cream-dim group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="overflow-x-auto border-t-2 border-line">
        <table className="w-full text-left text-sm" data-testid="results-table">
          <thead>
            <tr className="label">
              <th scope="col" className="py-2 pl-3 font-bold">
                Pos
              </th>
              <th scope="col" className="py-2 pl-1 font-bold">
                Horse
              </th>
              <th scope="col" className="hidden py-2 pr-4 font-bold sm:table-cell">
                Time
              </th>
              <th scope="col" className="py-2 pr-2 font-bold">
                Btn
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-bold">
                Prize
              </th>
            </tr>
          </thead>
          <tbody>
            {replay.result.finishOrder.map((f) => {
              const e = byId.get(f.horseId);
              const me = f.horseId === highlightHorseId;
              return (
                <tr key={f.horseId} className={`border-t-2 border-line ${me ? "bg-surface-2" : ""}`} data-testid="result-row">
                  <td className="num py-2 pl-3">{ordinal(f.position)}</td>
                  <td className="w-full max-w-0 py-2 pl-1">
                    <div className="flex min-w-0 items-center gap-2">
                      {e && <Saddlecloth gate={e.gate} />}
                      {e && <SilksIcon silks={e.horse.appearance.silks} className="h-7 w-7" />}
                      <div className="min-w-0">
                        <Link href={`/horse/${f.horseId}`} className="block font-extrabold hover:underline">
                          {e?.horse.name ?? f.horseId}
                          {me && <span className="you-tag ml-2 align-middle">You</span>}
                        </Link>
                        <p className="line-clamp-2 text-xs font-semibold text-sage">{e?.stableName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="tabular hidden whitespace-nowrap py-2 pr-4 text-cream-dim sm:table-cell">{formatRaceTime(f.finishTimeUs)}</td>
                  <td className="whitespace-nowrap py-2 pr-2 text-cream-dim">{f.position === 1 ? "–" : f.marginLabel}</td>
                  <td className={`num py-2 pr-3 text-right ${f.prize > 0 ? "text-cream" : "text-sage"}`}>
                    {f.prize > 0 ? formatCredits(f.prize) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

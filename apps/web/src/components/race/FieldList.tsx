import Link from "next/link";
import type { RaceCard } from "@/server/races";
import { STYLE_SHORT, formatDistance } from "@/lib/format";
import { SilksIcon } from "../Silks";
import { GradeBadge } from "../StatBars";
import { Saddlecloth } from "./Saddlecloth";

/** The declared field: cloth number, silks, name, plan, trip and three key grades. Your runner gets a YOU tag. */
export function FieldList({ card, highlightHorseId, open = true }: { card: RaceCard; highlightHorseId?: string; open?: boolean }) {
  return (
    <details className="surface group" open={open} aria-labelledby="field-h">
      <summary className="flex min-h-12 items-center justify-between gap-2 px-3">
        <h2 id="field-h" className="t-display-m">
          The field
        </h2>
        <span className="text-sm font-bold text-cream-dim">
          {card.field.length} runners <span aria-hidden className="inline-block group-open:rotate-90">▸</span>
        </span>
      </summary>
      <table className="w-full border-t-2 border-line text-left text-sm" data-testid="field-table">
        <thead>
          <tr className="label">
            <th scope="col" className="w-12 py-2 pl-3 font-bold">No.</th>
            <th scope="col" className="py-2 pl-1 font-bold">Runner</th>
            <th scope="col" className="hidden py-2 pr-4 font-bold sm:table-cell">Plan</th>
            <th scope="col" className="hidden py-2 pr-4 font-bold md:table-cell">Best trip</th>
            <th scope="col" className="whitespace-nowrap py-2 pr-3 text-right font-bold" title="Speed · Stamina · Burst grades">
              Spd · Sta · Brs
            </th>
          </tr>
        </thead>
        <tbody>
          {card.field.map((e) => {
            const me = e.horse.id === highlightHorseId;
            const s = e.horse.stats;
            return (
              <tr key={e.horse.id} className={`border-t-2 border-line ${me ? "bg-surface-2 shadow-[inset_4px_0_0_#d9a441]" : ""}`} data-testid={me ? "my-runner" : undefined}>
                <td className="py-2 pl-3">
                  <Saddlecloth gate={e.gate} />
                </td>
                <td className="w-full max-w-0 py-2 pl-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <SilksIcon silks={e.horse.appearance.silks} className="h-8 w-8" />
                    <div className="min-w-0">
                      <Link href={`/horse/${e.horse.id}`} className="block truncate font-extrabold hover:underline">
                        {e.horse.name}
                        {me && <span className="you-tag ml-2 align-middle">You</span>}
                      </Link>
                      <p className="truncate text-xs font-semibold text-sage">
                        {e.stableName}
                        <span className="sm:hidden"> · {STYLE_SHORT[e.tactic]}</span>
                      </p>
                    </div>
                  </div>
                </td>
                <td className="hidden whitespace-nowrap py-2 pr-4 font-semibold text-cream-dim sm:table-cell">{STYLE_SHORT[e.tactic]}</td>
                <td className="hidden whitespace-nowrap py-2 pr-4 font-semibold text-cream-dim md:table-cell">{formatDistance(e.horse.preferredDistanceM)}</td>
                <td className="py-2 pl-2 pr-3">
                  <span className="flex justify-end gap-1" aria-label={`Speed ${s.speed}, stamina ${s.stamina}, burst ${s.burst}`}>
                    <GradeBadge value={s.speed} size="sm" />
                    <GradeBadge value={s.stamina} size="sm" />
                    <GradeBadge value={s.burst} size="sm" />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

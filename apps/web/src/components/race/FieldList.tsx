import Link from "next/link";
import type { RaceCard } from "@/server/races";
import { STYLE_SHORT, formatDistance } from "@/lib/format";
import { SilksIcon } from "../Silks";
import { statGrade } from "../StatBars";

export function FieldList({ card, highlightHorseId }: { card: RaceCard; highlightHorseId?: string }) {
  return (
    <section aria-labelledby="field-h">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="field-h" className="display text-2xl font-semibold">
          The field
        </h2>
        <p className="text-xs text-sage">{card.field.length} declared runners</p>
      </div>
      <div className="panel overflow-hidden">
        <table className="w-full text-left text-sm" data-testid="field-table">
          <thead className="border-b border-cream/10 text-[0.65rem] uppercase tracking-[0.14em] text-sage">
            <tr>
              <th scope="col" className="w-12 py-2.5 pl-4 font-semibold">Gate</th>
              <th scope="col" className="py-2.5 pl-2 font-semibold">Runner</th>
              <th scope="col" className="hidden py-2.5 font-semibold sm:table-cell">Ride</th>
              <th scope="col" className="hidden py-2.5 font-semibold md:table-cell">Trip</th>
              <th scope="col" className="py-2.5 pr-4 text-right font-semibold" title="Speed / Stamina / Burst grades">
                Spd·Sta·Brs
              </th>
            </tr>
          </thead>
          <tbody>
            {card.field.map((e) => {
              const me = e.horse.id === highlightHorseId;
              return (
                <tr
                  key={e.horse.id}
                  className={`border-b border-cream/5 last:border-0 ${me ? "bg-brass/10 shadow-[inset_3px_0_0_var(--color-brass)]" : ""}`}
                  data-testid={me ? "my-runner" : undefined}
                >
                  <td className="py-2.5 pl-4">
                    <span className="display flex h-7 w-7 items-center justify-center rounded-md border border-cream/20 bg-ink/40 text-sm font-semibold tabular">
                      {e.gate}
                    </span>
                  </td>
                  <td className="py-2.5 pl-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <SilksIcon silks={e.horse.appearance.silks} className="h-8 w-8" />
                      <div className="min-w-0">
                        <Link href={`/horse/${e.horse.id}`} className="block truncate font-semibold text-cream hover:text-brass-bright">
                          {e.horse.name}
                          {me && <span className="ml-2 hidden align-middle text-[0.6rem] font-bold uppercase tracking-wider text-brass sm:inline">Yours</span>}
                        </Link>
                        <p className="truncate text-xs text-sage">
                          {e.stableName}
                          <span className="sm:hidden"> · {STYLE_SHORT[e.tactic]}</span>
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden py-2.5 text-cream-dim sm:table-cell">{STYLE_SHORT[e.tactic]}</td>
                  <td className="hidden py-2.5 tabular text-cream-dim md:table-cell">{formatDistance(e.horse.preferredDistanceM)}</td>
                  <td className="py-2.5 pr-4 text-right font-mono text-xs tracking-wider text-cream">
                    {statGrade(e.horse.stats.speed)}·{statGrade(e.horse.stats.stamina)}·{statGrade(e.horse.stats.burst)}
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

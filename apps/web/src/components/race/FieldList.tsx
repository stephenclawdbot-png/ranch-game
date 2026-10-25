import Link from "next/link";
import type { RaceCard } from "@/server/races";
import { STYLE_SHORT, formatDistance } from "@/lib/format";
import { SilksIcon } from "../Silks";
import { GRADE_COLOR, statGrade } from "../StatBars";
import { PixelIcon } from "../icons";
import { Saddlecloth } from "./Saddlecloth";

function Grade({ v }: { v: number }) {
  const g = statGrade(v);
  return <span style={{ color: GRADE_COLOR[g] }}>{g}</span>;
}

export function FieldList({ card, highlightHorseId }: { card: RaceCard; highlightHorseId?: string }) {
  return (
    <section aria-labelledby="field-h">
      <div className="mb-2 flex items-end justify-between">
        <h2 id="field-h" className="display flex items-center gap-2 text-2xl">
          <PixelIcon name="horseshoe" className="h-6 w-6" /> The field
        </h2>
        <p className="label">{card.field.length} declared runners</p>
      </div>
      <div className="px-panel overflow-hidden !p-0">
        <table className="w-full text-left text-sm" data-testid="field-table">
          <thead className="bg-[#0a1912]">
            <tr className="label">
              <th scope="col" className="w-12 py-2 pl-3 font-normal">No.</th>
              <th scope="col" className="py-2 pl-2 font-normal">Runner</th>
              <th scope="col" className="hidden py-2 pr-4 font-normal sm:table-cell">Ride</th>
              <th scope="col" className="hidden py-2 pr-4 font-normal md:table-cell">Trip</th>
              <th scope="col" className="whitespace-nowrap py-2 pr-3 text-right font-normal" title="Speed / Stamina / Burst grades">
                Spd Sta Brs
              </th>
            </tr>
          </thead>
          <tbody>
            {card.field.map((e) => {
              const me = e.horse.id === highlightHorseId;
              return (
                <tr
                  key={e.horse.id}
                  className={`border-t-2 border-dashed border-[#1f4d35] ${me ? "bg-[#d9a441]/15 shadow-[inset_4px_0_0_#f2c86a]" : ""}`}
                  data-testid={me ? "my-runner" : undefined}
                >
                  <td className="py-2 pl-3">
                    <Saddlecloth gate={e.gate} />
                  </td>
                  <td className="w-full max-w-0 py-2 pl-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <SilksIcon silks={e.horse.appearance.silks} className="h-9 w-9" />
                      <div className="min-w-0">
                        <Link href={`/horse/${e.horse.id}`} className="display block truncate text-[1.02rem] text-cream hover:text-brass-bright">
                          {e.horse.name}
                          {me && <span className="chip chip-brass ml-2 hidden !py-0 align-middle text-[0.6rem] sm:inline-flex">YOURS</span>}
                        </Link>
                        <p className="truncate text-xs text-sage">
                          {e.stableName}
                          <span className="sm:hidden"> · {STYLE_SHORT[e.tactic]}</span>
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap py-2 pr-4 text-cream-dim sm:table-cell">{STYLE_SHORT[e.tactic]}</td>
                  <td className="num hidden whitespace-nowrap py-2 pr-4 text-cream-dim md:table-cell">{formatDistance(e.horse.preferredDistanceM)}</td>
                  <td className="num whitespace-nowrap py-2 pl-2 pr-3 text-right text-base tracking-[0.3em]">
                    <Grade v={e.horse.stats.speed} />
                    <Grade v={e.horse.stats.stamina} />
                    <Grade v={e.horse.stats.burst} />
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

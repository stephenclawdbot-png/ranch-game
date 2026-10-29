import Link from "next/link";
import type { RaceCard } from "@/lib/types";
import { SEX_LABEL, STYLE_SHORT, coatLabel, formatDistance } from "@/lib/format";
import { SilksIcon } from "../Silks";
import { GradeBadge } from "../StatBars";
import { Saddlecloth } from "./Saddlecloth";

/**
 * The racecard (REDESIGN §4.3): the declared field as printed matter. Cloth number and silks,
 * the horse (age, colour, sex), its connections, form figures and official rating, the plan,
 * best trip and three key grades. Your runner is marked. Form and rating come from the stud
 * book (settled races before this one), never from this race.
 */
export function FieldList({ card, highlightHorseId, open = true }: { card: RaceCard; highlightHorseId?: string; open?: boolean }) {
  return (
    <details className="racecard print group" open={open} aria-labelledby="field-h">
      <summary className="racecard-head">
        <span className="min-w-0">
          <span className="racecard-eyebrow">Racecard · {formatDistance(card.config.distanceM)}</span>
          <h2 id="field-h" className="racecard-title">
            The field
          </h2>
        </span>
        <span className="text-sm font-bold text-cream-dim">
          {card.fieldLocked ? `${card.field.length} runners` : `${card.field.length} entered · the Club fills the field to ${card.targetRunners}`}{" "}
          <span aria-hidden className="inline-block group-open:rotate-90">
            ▸
          </span>
        </span>
      </summary>
      <table className="racecard-table" data-testid="field-table">
        <thead>
          <tr>
            <th scope="col" className="w-12 pl-3">
              No.
            </th>
            <th scope="col">Horse</th>
            <th scope="col" className="text-right" title="Last three finishes, oldest first (0 = outside the first nine)">
              Form
            </th>
            <th scope="col" className="text-right" title="Official rating">
              OR
            </th>
            <th scope="col" className="hidden sm:table-cell">
              Plan
            </th>
            <th scope="col" className="hidden md:table-cell">
              Best trip
            </th>
            <th scope="col" className="pr-3 text-right" title="Speed · Stamina · Burst grades">
              <span className="hidden sm:inline">Spd · Sta · Brs</span>
              <span className="sm:hidden">Grades</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {card.field.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-3 text-cream-dim">
                No entries yet. Empty gates are filled by the Club&rsquo;s horses when entries close.
              </td>
            </tr>
          )}
          {card.field.map((e) => {
            const me = e.horse.id === highlightHorseId;
            const s = e.horse.stats;
            const h = e.horse;
            return (
              <tr key={h.id} className={me ? "is-mine" : undefined} data-testid={me ? "my-runner" : undefined}>
                <td className="pl-3">{e.gate > 0 ? <Saddlecloth gate={e.gate} /> : <span className="text-cream-dim">–</span>}</td>
                <td className="w-full max-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <SilksIcon silks={h.appearance.silks} className="h-9 w-9 shrink-0" />
                    <div className="min-w-0">
                      <Link href={`/horse/${h.id}`} className="racecard-name">
                        {h.name}
                        {me && <span className="you-tag ml-2 align-middle">You</span>}
                      </Link>
                      <p className="racecard-meta">
                        {h.age > 0 ? `${h.age}yo ` : ""}
                        {coatLabel(h.appearance).toLowerCase()} {SEX_LABEL[h.sex].toLowerCase()} · {e.stableName}
                        <span className="sm:hidden"> · {STYLE_SHORT[e.tactic]}</span>
                      </p>
                    </div>
                  </div>
                </td>
                <td className="racecard-fig text-right" data-testid="runner-form">
                  {e.form ?? "–"}
                </td>
                <td className="racecard-fig text-right">{e.rating ?? "–"}</td>
                <td className="hidden whitespace-nowrap font-semibold text-cream-dim sm:table-cell">{STYLE_SHORT[e.tactic]}</td>
                <td className="hidden whitespace-nowrap font-semibold text-cream-dim md:table-cell">{formatDistance(h.preferredDistanceM)}</td>
                <td className="pr-3">
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

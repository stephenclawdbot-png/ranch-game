/**
 * A what-if re-run next to the official result: your new position and beaten distance, the
 * first five (and yours) both ways, and your horse's sectionals both ways. Always labelled
 * "What if (not official)". Client-safe (no hooks), used in the sheet and on the what-if page.
 */
import Link from "next/link";
import { ordinal } from "@/lib/format";
import { lengthsText, raceTimeText } from "@/lib/formBook";
import { placesGained, type WhatIfRow, type WhatIfRunnerLine, type WhatIfView } from "@/lib/whatIf";

export function WhatIfTag({ className = "" }: { className?: string }) {
  return (
    <span className={`whatif-tag ${className}`} data-testid="what-if-tag">
      What if · not official
    </span>
  );
}

function verdict(v: WhatIfView): string {
  const d = placesGained(v);
  const a = ordinal(v.official.position);
  const b = ordinal(v.whatIf.position);
  if (d > 0) return `${a} → ${b}: ${d === 1 ? "one place" : `${d} places`} better`;
  if (d < 0) return `${a} → ${b}: ${-d === 1 ? "one place" : `${-d} places`} worse`;
  const mm = v.official.behindMm - v.whatIf.behindMm;
  if (v.whatIf.position === 1) {
    return `Still wins (${raceTimeText(v.whatIf.timeUs)} vs ${raceTimeText(v.official.timeUs)})`;
  }
  if (Math.abs(mm) < 150) return `${b} again, about the same distance back`;
  return `${b} again, ${mm > 0 ? "closer to" : "further from"} the winner`;
}

function beaten(l: WhatIfRunnerLine): string {
  return l.position === 1 ? "Won" : `${lengthsText(l.behindMm)} behind the winner`;
}

function Table({ title, rows, testId }: { title: string; rows: WhatIfRow[]; testId: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <p className="caption mb-1">{title}</p>
      <ol className="grid gap-0.5 text-sm">
        {rows.map((r, i) => (
          <li key={r.horseId} className={`flex items-baseline gap-1.5 px-1.5 py-1 ${r.mine ? "whatif-mine font-extrabold" : ""} ${i > 0 && r.position > rows[i - 1]!.position + 1 ? "mt-1 border-t border-dashed border-line" : ""}`}>
            <span className="num w-7 shrink-0 text-right">{ordinal(r.position)}</span>
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="num shrink-0 text-xs text-cream-dim">{r.position === 1 ? raceTimeText(r.timeUs) : lengthsText(r.behindMm)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const SEG = ["Early", "Middle", "Late"] as const;

export function WhatIfResult({ v, watchHref, onAnother }: { v: WhatIfView; watchHref?: string; onAnother?: () => void }) {
  const d = placesGained(v);
  return (
    <div className="grid gap-4" data-testid="what-if-result">
      <div className="grid gap-1.5">
        <WhatIfTag className="w-fit" />
        <p className="font-bold text-cream-dim">{v.label}</p>
        <p className={`t-h2 ${d > 0 ? "text-positive" : d < 0 ? "text-negative" : ""}`} data-testid="what-if-verdict">
          {verdict(v)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2" data-testid="what-if-yours">
        {(
          [
            ["Official", v.official],
            ["What if", v.whatIf],
          ] as const
        ).map(([k, l]) => (
          <div key={k} className={`inset grid gap-0.5 p-2.5 ${k === "What if" ? "whatif-card" : ""}`}>
            <span className="caption">{k}</span>
            <span className="num text-[1.75rem] leading-8">{ordinal(l.position)}</span>
            <span className="text-sm font-bold">{beaten(l)}</span>
            <span className="num text-xs text-cream-dim">{raceTimeText(l.timeUs)}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Table title="Official" rows={v.officialTop} testId="what-if-official-table" />
        <Table title="What if" rows={v.whatIfTop} testId="what-if-table" />
      </div>

      <div data-testid="what-if-sectionals">
        <p className="caption mb-1">{v.horseName}&rsquo;s sectionals (thirds of the trip)</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-cream-dim">
              <th className="py-0.5 font-bold" />
              {SEG.map((s) => (
                <th key={s} className="py-0.5 text-right font-bold">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Official", v.official.sectionals],
                ["What if", v.whatIf.sectionals],
              ] as const
            ).map(([k, s]) => (
              <tr key={k} className={k === "What if" ? "font-extrabold" : ""}>
                <td className="py-0.5">{k}</td>
                {s.map((x, i) => {
                  const faster = k === "What if" && x < v.official.sectionals[i]! - 0.004;
                  const slower = k === "What if" && x > v.official.sectionals[i]! + 0.004;
                  return (
                    <td key={i} className={`num py-0.5 text-right ${faster ? "text-positive" : slower ? "text-negative" : ""}`}>
                      {x.toFixed(2)}s
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-cream-dim">
        Same field, same gates, same going and the same sealed seed, so the same luck for every horse: only this one change is different. Not a result: no credits, no
        rating, nothing on the form book.
      </p>

      <div className="flex flex-wrap gap-2">
        {watchHref && (
          <Link href={watchHref} className="btn btn-brass" data-testid="what-if-watch">
            Watch the what-if
          </Link>
        )}
        {onAnother && (
          <button type="button" className="btn" onClick={onAnother} data-testid="what-if-another">
            Try another change
          </button>
        )}
      </div>
    </div>
  );
}

export function whatIfHref(v: Pick<WhatIfView, "raceId" | "horseId" | "changeKey">): string {
  return `/race/${v.raceId}/what-if?horse=${v.horseId}&change=${encodeURIComponent(v.changeKey)}`;
}

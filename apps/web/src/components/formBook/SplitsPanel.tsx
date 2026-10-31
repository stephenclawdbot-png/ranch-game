"use client";

/**
 * Splits (the form book): win-place-runs and average beaten distance by going, trip, surface,
 * course, tactic, jockey, draw and rest, from settled runs only (game-core formSplits). The best
 * and worst condition lead; buckets under the minimum sample are greyed and never picked.
 */
import { useState } from "react";
import type { SplitsView } from "@/lib/types";
import { DIMENSION_LABEL, DISTANCE_BAND_RANGE, avgLengthsText, bestWorstText, bucketLabel, recordText } from "@/lib/formBook";

/** Splits shown on a phone before "All splits". */
const PHONE_GROUPS = 3;

export function SplitsPanel({ splits, subject, empty }: { splits: SplitsView; subject: string; empty?: string }) {
  const [all, setAll] = useState(false);
  const bw = bestWorstText(splits);
  if (splits.total.runs === 0) {
    return <p className="surface t-meta p-4">{empty ?? `No settled runs yet: ${subject}'s splits fill in after the first result.`}</p>;
  }
  return (
    <div className="grid gap-3" data-testid="splits">
      <div className="surface grid gap-1 p-4">
        <p className="font-extrabold text-cream">
          {subject}: {recordText(splits.total)}
          <span className="t-meta"> · beaten {avgLengthsText(splits.total.avgBeatenMm)} on average</span>
        </p>
        {bw ? (
          <ul className="grid gap-0.5 text-sm" data-testid="splits-best-worst">
            <li>
              <span className="font-extrabold text-positive">Best:</span> <span className="text-cream">{bw.best}</span>
            </li>
            <li>
              <span className="font-extrabold text-negative">Worst:</span> <span className="text-cream">{bw.worst}</span>
            </li>
          </ul>
        ) : (
          <p className="t-meta" data-testid="splits-best-worst">
            Nothing stands out yet: best and worst need at least two conditions with {splits.minRuns}+ runs each.
          </p>
        )}
        <p className="caption">
          W-2-3 = wins, seconds, thirds. Btn = average distance behind the winner (winners count 0). Greyed: under {splits.minRuns} runs, too few to read much into.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {splits.groups.map((g, i) => (
          <section key={g.dimension} className={`surface p-3 ${i >= PHONE_GROUPS && !all ? "hidden sm:block" : ""}`} aria-label={`By ${DIMENSION_LABEL[g.dimension] ?? g.dimension}`} data-testid={`splits-${g.dimension}`}>
            <h3 className="label mb-1">{DIMENSION_LABEL[g.dimension] ?? g.dimension}</h3>
            <table className="splits-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Condition</span>
                  </th>
                  <th scope="col" className="text-right">
                    W-2-3
                  </th>
                  <th scope="col" className="text-right">
                    Runs
                  </th>
                  <th scope="col" className="text-right">
                    Btn
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.buckets.map((b) => {
                  const isBest = splits.best?.dimension === g.dimension && splits.best.bucket.key === b.key;
                  const isWorst = splits.worst?.dimension === g.dimension && splits.worst.bucket.key === b.key;
                  return (
                    <tr key={b.key} className={b.small ? "is-small" : ""} title={b.small ? `Small sample: under ${splits.minRuns} runs` : undefined}>
                      <th scope="row" className="font-bold">
                        <span title={g.dimension === "distance" ? DISTANCE_BAND_RANGE[b.key] : undefined}>{bucketLabel(g.dimension, b.key)}</span>
                        {isBest && <span className="ml-1 text-xs font-extrabold text-positive">best</span>}
                        {isWorst && <span className="ml-1 text-xs font-extrabold text-negative">worst</span>}
                      </th>
                      <td className="num text-right">
                        {b.wins}-{b.seconds}-{b.thirds}
                      </td>
                      <td className="num text-right">{b.runs}</td>
                      <td className="num text-right">{avgLengthsText(b.avgBeatenMm)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      {splits.groups.length > PHONE_GROUPS && (
        <button type="button" className="btn btn-sm w-fit sm:hidden" onClick={() => setAll((a) => !a)} data-testid="splits-all">
          {all ? "Fewer splits" : `${splits.groups.length - PHONE_GROUPS} more splits: ${splits.groups.slice(PHONE_GROUPS, PHONE_GROUPS + 2).map((g) => (DIMENSION_LABEL[g.dimension] ?? g.dimension).toLowerCase()).join(", ")}…`}
        </button>
      )}
    </div>
  );
}

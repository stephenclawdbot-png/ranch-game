"use client";

import type { FacilitiesView } from "@/lib/horseLife";
import { formatCredits } from "@/lib/format";
import { ErrorNote } from "../ui/ErrorNote";
import { PixelIcon } from "../icons";
import { SceneBand } from "../ui/Page";
import { CellBar, useAction } from "./common";

/** Stable facilities: one-off credit purchases (no running costs, ever). */
export function FacilitiesBoard({ view }: { view: FacilitiesView }) {
  const action = useAction();
  return (
    <div className="grid gap-6">
      <SceneBand scene="stable" alt="Your stable yard" eyebrow={`${formatCredits(view.credits)} credits · one-off upgrades, no running costs`} title="Facilities" />
      <ul className="grid gap-3 md:grid-cols-2">
        {view.items.map((it) => {
          const short = it.nextCost !== null && it.nextCost > view.credits;
          const fromZero = it.key === "stalls" ? 6 : 0;
          return (
            <li key={it.key} className="surface grid content-start gap-2 p-4" data-testid={`facility-${it.key}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="t-h2">{it.name}</h2>
                <span className="tag" data-testid="facility-level">
                  {it.levelLabel}
                </span>
              </div>
              <CellBar value={it.level - fromZero} max={it.maxLevel - fromZero} cells={Math.min(18, it.maxLevel - fromZero)} label={`${it.name}: ${it.levelLabel}`} />
              <p className="t-meta">{it.blurb}</p>
              <div className="surface-2 grid gap-1 p-3 text-sm">
                <p>
                  <span className="label mr-2">Now</span>
                  {it.now}
                </p>
                {it.next && (
                  <p>
                    <span className="label mr-2">Next</span>
                    <span className="font-bold text-positive">{it.next}</span>
                  </p>
                )}
              </div>
              {it.nextCost === null ? (
                <p className="text-sm font-bold text-positive">✓ Fully upgraded</p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-1">
                    <PixelIcon name="coin" size={32} />
                    <span className="score text-[1.875rem] leading-none">{formatCredits(it.nextCost)}</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={short || action.busy !== null}
                    onClick={() => action.run(it.key, "/api/facilities", { body: { facility: it.key, toLevel: it.level + 1 } })}
                    data-testid={`buy-${it.key}`}
                  >
                    {action.busy === it.key ? "Upgrading…" : short ? `Need ${formatCredits(it.nextCost - view.credits)} more` : "Upgrade"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {action.error != null && action.busy === null && <ErrorNote error={action.error} />}
    </div>
  );
}

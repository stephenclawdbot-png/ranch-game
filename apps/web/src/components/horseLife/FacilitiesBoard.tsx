"use client";

import type { FacilitiesView } from "@/lib/horseLife";
import { formatCredits } from "@/lib/format";
import { ErrorNote } from "../ui/ErrorNote";
import { CellBar, useAction } from "./common";

/** Stable facilities: one-off credit purchases (no running costs, ever). */
export function FacilitiesBoard({ view }: { view: FacilitiesView }) {
  const action = useAction();
  return (
    <div className="grid gap-5">
      <header>
        <h1 className="t-display-l">Facilities</h1>
        <p className="t-meta">
          <span className="num text-cream">{formatCredits(view.credits)}</span> credits · one-off upgrades, no running costs
        </p>
      </header>
      <ul className="grid gap-3 md:grid-cols-2">
        {view.items.map((it) => {
          const short = it.nextCost !== null && it.nextCost > view.credits;
          const fromZero = it.key === "stalls" ? 6 : 0;
          return (
            <li key={it.key} className="surface grid content-start gap-2 p-4" data-testid={`facility-${it.key}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="t-display-m">{it.name}</h2>
                <span className="chip text-cream" data-testid="facility-level">
                  {it.levelLabel}
                </span>
              </div>
              <CellBar value={it.level - fromZero} max={it.maxLevel - fromZero} cells={Math.min(18, it.maxLevel - fromZero)} label={`${it.name}: ${it.levelLabel}`} />
              <p className="text-sm text-cream-dim">{it.blurb}</p>
              <p className="text-sm">
                <span className="font-bold text-cream-dim">Now:</span> {it.now}
                {it.next && (
                  <>
                    <br />
                    <span className="font-bold text-cream-dim">Next:</span> <span className="text-positive">{it.next}</span>
                  </>
                )}
              </p>
              {it.nextCost === null ? (
                <p className="text-sm font-bold text-positive">✓ Fully upgraded</p>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm w-fit"
                  disabled={short || action.busy !== null}
                  onClick={() => action.run(it.key, "/api/facilities", { body: { facility: it.key, toLevel: it.level + 1 } })}
                  data-testid={`buy-${it.key}`}
                >
                  {action.busy === it.key ? "Upgrading…" : short ? `${formatCredits(it.nextCost)} cr · need ${formatCredits(it.nextCost - view.credits)} more` : `Upgrade · ${formatCredits(it.nextCost)} cr`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {action.error != null && action.busy === null && <ErrorNote error={action.error} />}
    </div>
  );
}

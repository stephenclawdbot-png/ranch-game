import type { RaceAnalysis } from "@/lib/raceAnalysis";
import type { TryNextTip } from "@/lib/tryNext";
import { ordinal } from "@/lib/format";
import { FitList } from "../ui/FitChip";

const PACE_TEXT = {
  fast: "Fast early pace",
  even: "Even pace",
  slow: "Slow early pace",
} as const;
const SEG_LABEL = { early: "Early", middle: "Middle", late: "Late" } as const;

/** "Why" card: pace, running positions, sectionals and fit, explained in one or two sentences. */
export function WhyCard({ analysis, horseName, isYours, tips = [] }: { analysis: RaceAnalysis; horseName: string; isYours: boolean; tips?: TryNextTip[] }) {
  const a = analysis;
  return (
    <section className="surface p-3 sm:p-4" aria-labelledby="why-h" data-testid="why-card">
      <h2 id="why-h" className="t-h2">
        {isYours ? "Why it went that way" : `Why ${horseName} won`}
      </h2>
      <p className="mt-2 max-w-prose text-lg">{a.summary}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="label">Running positions</p>
          <ol className="mt-1 flex flex-wrap items-center gap-1 text-sm font-bold" aria-label={`Positions: ${a.runningLine.map(ordinal).join(", ")}`}>
            {a.runningLine.map((p, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && (
                  <span aria-hidden className="text-sage">
                    →
                  </span>
                )}
                <span className="chip text-cream">
                  {["¼", "½", "¾", "Finish"][i]} <strong>{ordinal(p)}</strong>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 label">Pace</p>
          <p className="font-bold">{PACE_TEXT[a.pace]}</p>
        </div>
        <div>
          <p className="label">Sectionals (thirds of the trip)</p>
          <ul className="mt-1 grid gap-1.5">
            {a.sectionals.map((s) => (
              <li key={s.segment} className="grid grid-cols-[4rem_1fr_6.5rem] items-center gap-2 text-sm">
                <span className="font-bold text-cream-dim">{SEG_LABEL[s.segment]}</span>
                <span className="h-3 bg-[#050b08] p-[2px]" aria-hidden>
                  <span
                    className="block h-full bg-cream-dim"
                    style={{
                      width: `${Math.max(6, Math.round(s.score * 100))}%`,
                    }}
                  />
                </span>
                <span className="font-bold">
                  {s.timeS.toFixed(1)}s · {s.rank === 1 ? "fastest" : ordinal(s.rank)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4">
        <p className="label mb-1">Fit</p>
        <FitList fits={a.fits} showDetail />
      </div>

      {isYours && tips.length > 0 && (
        <div className="mt-4 border-t-2 border-dotted border-line pt-3" data-testid="try-next">
          <p className="label mb-1">Worth trying next</p>
          <ol className="grid gap-1.5">
            {tips.map((t, i) => (
              <li key={t.id} className="flex gap-2 text-[0.9375rem]" data-tip={t.id}>
                <span className="num w-5 shrink-0 font-bold text-brass-hi" aria-hidden>
                  {i + 1}.
                </span>
                <span>{t.text}</span>
              </li>
            ))}
          </ol>
          <p className="caption mt-2">Suggestions from what you could see: the racecard, the fit and your horse&rsquo;s condition at the off. Racing has luck in it; none of this is a promise.</p>
        </div>
      )}
    </section>
  );
}

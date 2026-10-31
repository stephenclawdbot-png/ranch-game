import { ENERGY_LOW, energyHeadline, energySummary, type EnergyTrace } from "@/lib/energyTrace";

const W = 240;
const H = 64;
const PAD = 4;
const y = (e: number) => PAD + (1 - Math.max(0, Math.min(1000, e)) / 1000) * (H - 2 * PAD);
const points = (vals: readonly number[]) => vals.map((e, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${y(e).toFixed(1)}`).join(" ");

/**
 * The horse's energy over the race (first-hour playtest: "ran out of energy" made visible), from
 * the engine's own tank in the replay frames: a line from the off to the finish, the typical
 * rival's dashed beside it, the finish marked, and where it ran low. The whole line is also in
 * words (the image's label and "In words"), so nothing depends on seeing the chart.
 */
export function EnergyLine({ trace, horseName }: { trace: EnergyTrace; horseName: string }) {
  const summary = energySummary(trace, horseName);
  const lowAt = trace.lowWithM !== null ? Math.max(0, Math.min(1, 1 - trace.lowWithM / Math.max(1, trace.distanceM))) : null;
  return (
    <figure className="grid gap-1.5" data-testid="energy-line" data-low-with-m={trace.lowWithM ?? ""}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="label">Energy over the race</span>
        <span className="flex items-center gap-3 text-[0.75rem] font-bold text-cream-dim" aria-hidden>
          <span className="flex items-center gap-1">
            <i className="inline-block h-[2px] w-4 bg-brass-hi" /> {horseName}
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block w-4 border-t-2 border-dashed border-cream-dim" /> Typical rival
          </span>
        </span>
      </figcaption>
      <div className="relative h-16 bg-[#050b08]">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label={summary}>
          {/* "Running on empty": the engine's tiring line */}
          <line x1={0} x2={W} y1={y(ENERGY_LOW)} y2={y(ENERGY_LOW)} stroke="currentColor" className="text-negative" strokeOpacity={0.5} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          <polyline points={points(trace.field)} fill="none" stroke="currentColor" className="text-cream-dim" strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          <polyline points={points(trace.mine)} fill="none" stroke="currentColor" className="text-brass-hi" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* The finish post */}
        <span className="absolute inset-y-0 right-0 w-[3px] bg-[repeating-linear-gradient(#f3e7c9_0_4px,#0b0f0c_4px_8px)]" aria-hidden />
        {lowAt !== null && (
          <span className="absolute inset-y-0 border-l-2 border-dotted border-negative" style={{ left: `${(lowAt * 100).toFixed(1)}%` }} aria-hidden data-testid="energy-low-mark" />
        )}
      </div>
      <div className="relative flex justify-between text-[0.75rem] font-bold text-cream-dim" aria-hidden>
        <span>Off · full</span>
        {lowAt !== null && lowAt > 0.18 && lowAt < 0.82 && (
          <span className="absolute -translate-x-1/2 text-negative" style={{ left: `${(lowAt * 100).toFixed(1)}%` }}>
            ran low
          </span>
        )}
        <span>Finish</span>
      </div>
      <p className="text-sm font-bold" data-testid="energy-headline">
        {energyHeadline(trace, horseName)}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer font-bold text-cream-dim">In words</summary>
        <p className="mt-1 max-w-prose" data-testid="energy-summary">
          {summary}
        </p>
      </details>
    </figure>
  );
}

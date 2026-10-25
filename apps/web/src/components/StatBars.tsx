import type { HorseStats } from "@thoroughbred/shared";

export const STAT_LABELS: { key: keyof HorseStats; label: string; hint: string }[] = [
  { key: "speed", label: "Speed", hint: "Top cruising speed" },
  { key: "stamina", label: "Stamina", hint: "How long the pace can be held" },
  { key: "burst", label: "Burst", hint: "Acceleration and finishing kick" },
  { key: "durability", label: "Durability", hint: "Resistance to fatigue" },
  { key: "adaptability", label: "Adaptability", hint: "Copes with unfamiliar trip, going and surface" },
  { key: "temperament", label: "Temperament", hint: "Composure; low means keen and erratic" },
];

/** 0..1000 -> letter grade, the way a form guide would summarise it. */
export function statGrade(v: number): string {
  if (v >= 850) return "S";
  if (v >= 720) return "A";
  if (v >= 600) return "B";
  if (v >= 480) return "C";
  if (v >= 360) return "D";
  return "E";
}

export function StatBars({ stats, compact = false }: { stats: HorseStats; compact?: boolean }) {
  return (
    <dl className={compact ? "grid grid-cols-2 gap-x-4 gap-y-2" : "grid gap-3"}>
      {STAT_LABELS.map(({ key, label, hint }) => {
        const v = stats[key];
        return (
          <div key={key} title={hint}>
            <div className="flex items-baseline justify-between text-xs">
              <dt className="font-medium text-cream-dim">{label}</dt>
              <dd className="tabular text-cream">
                <span className="mr-1.5 text-[0.65rem] font-semibold text-brass">{statGrade(v)}</span>
                {v}
              </dd>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cream/8" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={1000} aria-valuenow={v}>
              <div className="h-full rounded-full bg-gradient-to-r from-brass-deep via-brass to-brass-bright" style={{ width: `${v / 10}%` }} />
            </div>
          </div>
        );
      })}
    </dl>
  );
}

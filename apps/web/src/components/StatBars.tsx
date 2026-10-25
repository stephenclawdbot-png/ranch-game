import type { HorseStats } from "@thoroughbred/shared";

export const STAT_LABELS: { key: keyof HorseStats; label: string; short: string; hint: string }[] = [
  { key: "speed", label: "Speed", short: "SPD", hint: "Top cruising speed" },
  { key: "stamina", label: "Stamina", short: "STA", hint: "How long the pace can be held" },
  { key: "burst", label: "Burst", short: "BRS", hint: "Acceleration and finishing kick" },
  { key: "durability", label: "Durability", short: "DUR", hint: "Resistance to fatigue" },
  { key: "adaptability", label: "Adaptability", short: "ADP", hint: "Copes with unfamiliar trip, going and surface" },
  { key: "temperament", label: "Temperament", short: "TMP", hint: "Composure; low means keen and erratic" },
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

export const GRADE_COLOR: Record<string, string> = {
  S: "#ff9ad5",
  A: "#f2c86a",
  B: "#8fd18a",
  C: "#7fc3ee",
  D: "#cdbf9c",
  E: "#9a8f7a",
};

/** Segmented pixel meter (20 cells; each cell = 50 points; the last lit cell shows partial). */
export function PixelMeter({ value, label, max = 1000, cells = 20 }: { value: number; label: string; max?: number; cells?: number }) {
  const lit = (value / max) * cells;
  const grade = statGrade(value);
  return (
    <div
      className="flex h-3 gap-[2px] bg-[#050b08] p-[2px]"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      {Array.from({ length: cells }, (_, i) => {
        const on = i < Math.floor(lit);
        const half = !on && i < lit;
        return (
          <span
            key={i}
            className="h-full flex-1"
            style={{
              background: on ? GRADE_COLOR[grade] : half ? `${GRADE_COLOR[grade]}66` : "#173025",
              boxShadow: on ? "inset 0 -2px 0 rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.35)" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

export function GradeBadge({ value, className }: { value: number; className?: string }) {
  const g = statGrade(value);
  return (
    <span className={`num inline-flex h-5 w-5 items-center justify-center bg-[#050b08] text-[0.8rem] leading-none ${className ?? ""}`} style={{ color: GRADE_COLOR[g] }}>
      {g}
    </span>
  );
}

export function StatBars({ stats, compact = false }: { stats: HorseStats; compact?: boolean }) {
  return (
    <dl className={compact ? "grid grid-cols-2 gap-x-4 gap-y-2" : "grid gap-3"}>
      {STAT_LABELS.map(({ key, label, short, hint }) => {
        const v = stats[key];
        return (
          <div key={key} title={hint}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <dt className="label !text-cream-dim">{compact ? short : label}</dt>
              <dd className="flex items-center gap-1.5">
                <GradeBadge value={v} />
                <span className="num text-sm text-cream">{v}</span>
              </dd>
            </div>
            <PixelMeter value={v} label={label} cells={compact ? 12 : 20} />
          </div>
        );
      })}
    </dl>
  );
}

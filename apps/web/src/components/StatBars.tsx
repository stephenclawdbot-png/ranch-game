import type { HorseStats } from "@thoroughbred/shared";
import { statGrade as grade, type Grade } from "@/lib/aptitude";

export const STAT_LABELS: { key: keyof HorseStats; label: string; short: string; hint: string }[] = [
  { key: "speed", label: "Speed", short: "Spd", hint: "Top cruising speed" },
  { key: "stamina", label: "Stamina", short: "Sta", hint: "How long the pace can be held" },
  { key: "burst", label: "Burst", short: "Brs", hint: "Acceleration and finishing kick" },
  { key: "durability", label: "Durability", short: "Dur", hint: "Resistance to fatigue" },
  { key: "adaptability", label: "Adaptability", short: "Adp", hint: "Copes with an unfamiliar trip, going and surface" },
  { key: "temperament", label: "Temperament", short: "Tmp", hint: "Composure; low means keen and erratic" },
];

/** 0..1000 -> letter grade, the way a form guide would summarise it. */
export function statGrade(v: number): string {
  return grade(v);
}

/**
 * One warm-to-cool ramp (always shown with the letter, never colour alone). Every value is
 * >= 4.5:1 on surface-1 and on the inset well.
 */
export const GRADE_COLOR: Record<string, string> = {
  S: "#d9a441",
  A: "#d9a441",
  B: "#2b6a41",
  C: "#2b6a41",
  D: "#7a6548",
  E: "#7a6548",
};
/** Grade letter colour on paper-2 (all >= 4.5:1). */
export const GRADE_TEXT: Record<string, string> = { S: "#8a5d14", A: "#8a5d14", B: "#2b6a41", C: "#2b6a41", D: "#5a4630", E: "#5a4630" };

/** Segmented meter: 10 cells of 100 points; the last lit cell shows a partial. */
export function PixelMeter({ value, label, max = 1000, cells = 10 }: { value: number; label: string; max?: number; cells?: number }) {
  const lit = (value / max) * cells;
  const color = GRADE_COLOR[statGrade(value)];
  return (
    <div
      className="flex h-4 gap-[2px] bg-ink p-[2px]"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      {Array.from({ length: cells }, (_, i) => {
        const on = i < Math.floor(lit);
        const part = !on && i < lit;
        return <span key={i} className="h-full flex-1" style={{ background: on ? color : part ? `${color}88` : "#ecdfbd" }} />;
      })}
    </div>
  );
}

/** Letter grade tile (S–E). */
export function GradeBadge({
  value,
  grade: g,
  className,
  size = "md",
}: {
  value?: number;
  grade?: Grade | string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const letter = g ?? statGrade(value ?? 0);
  const dim = size === "lg" ? "h-10 w-10 text-[2rem]" : size === "sm" ? "h-6 w-6 text-[1.25rem]" : "h-7 w-7 text-[1.375rem]";
  return (
    <span
      className={`score inline-flex shrink-0 items-center justify-center bg-paper-2 leading-none shadow-[inset_0_0_0_1px_#b59a62] ${dim} ${className ?? ""}`}
      style={{ color: GRADE_TEXT[letter] ?? "#1d140a" }}
    >
      {letter}
    </span>
  );
}

/**
 * Ability bars: grade + 10-cell bar. Exact numbers are shown only on request (`showNumbers`),
 * so the list stays scannable (overview first, detail on demand). Numbers are always in the
 * accessible name of each meter.
 */
export function StatBars({ stats, compact = false, showNumbers = false }: { stats: HorseStats; compact?: boolean; showNumbers?: boolean }) {
  return (
    <dl className={compact ? "grid grid-cols-2 gap-x-4 gap-y-2" : "grid gap-2.5"}>
      {STAT_LABELS.map(({ key, label, hint }) => {
        const v = stats[key];
        return (
          <div key={key} className="grid grid-cols-[6.75rem_1.75rem_1fr_auto] items-center gap-2" title={hint}>
            <dt className="text-sm font-bold text-cream-dim">{label}</dt>
            <dd className="contents">
              <GradeBadge value={v} size="sm" />
              <PixelMeter value={v} label={`${label} ${v} of 1000`} />
              <span className={`num w-9 text-right text-sm text-cream ${showNumbers ? "" : "sr-only"}`}>{v}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

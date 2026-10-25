import type { HorseStats } from "@thoroughbred/shared";
import { GRADE_COLOR, STAT_LABELS, statGrade } from "./StatBars";

/** Form-guide grade board: one big pixel letter grade per ability. */
export function StatRadar({ stats, className }: { stats: HorseStats; className?: string }) {
  return (
    <ul className={`grid grid-cols-3 gap-2 ${className ?? ""}`} aria-label={STAT_LABELS.map(({ key, label }) => `${label} ${stats[key]}`).join(", ")}>
      {STAT_LABELS.map(({ key, short, label }) => {
        const g = statGrade(stats[key]);
        return (
          <li key={key} className="px-inset flex flex-col items-center py-1.5" title={label}>
            <span className="num text-4xl leading-none" style={{ color: GRADE_COLOR[g], textShadow: "0 3px 0 #000" }}>
              {g}
            </span>
            <span className="label mt-1">{short}</span>
          </li>
        );
      })}
    </ul>
  );
}

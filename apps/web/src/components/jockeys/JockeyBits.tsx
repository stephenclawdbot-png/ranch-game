import Link from "next/link";
import type { JockeyCard } from "@/server/jockeys";
import { GradeBadge, PixelMeter } from "../StatBars";

export const STAGE_LABEL = { apprentice: "Apprentice", prime: "Prime", veteran: "Veteran" } as const;

/** One row of a jockey list: grade, racecard name, stage, stable and winners. */
export function JockeyRow({ j, extra }: { j: JockeyCard; extra?: React.ReactNode }) {
  return (
    <li className={j.mine ? "yours" : undefined}>
      <Link href={`/jockeys/${j.id}`} className="row-link gap-3 px-3 py-2.5" data-testid="jockey-row">
        <GradeBadge grade={j.grade} />
        <span className="min-w-0 flex-1">
          <span className="t-title block truncate">
            {j.name}
            {j.claimLb > 0 && <span className="t-meta"> ({j.claimLb})</span>}
          </span>
          <span className="t-meta block truncate">
            {STAGE_LABEL[j.stage]}
            {j.stage === "apprentice" ? ` · potential ${j.potential}` : ""} · {j.stableName ?? "Club freelancer"}
            {j.retiring ? " · retiring" : ""}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="score block text-[1.25rem] leading-none">{extra ?? j.winsThisSeason}</span>
          <span className="caption block">{extra ? "" : "wins"}</span>
        </span>
        <span className="chev">›</span>
      </Link>
    </li>
  );
}

/** A skill as an A-E bar with the potential range ("C to A"). */
export function SkillBar({ s }: { s: JockeyCard["skills"][number] }) {
  return (
    <li className="grid gap-1 px-3 py-2" data-testid="jockey-skill">
      <span className="flex items-center gap-2">
        <GradeBadge grade={s.grade} size="sm" />
        <span className="t-title flex-1">{s.label}</span>
        <span className="t-meta shrink-0">potential {s.potential}</span>
      </span>
      <PixelMeter value={s.value} label={`${s.label} ${s.value} of 1000`} />
      <span className="caption">{s.effect}</span>
    </li>
  );
}

import Link from "next/link";
import type { ContractView } from "@thoroughbred/db";
import { formatCredits } from "@/lib/format";
import type { JockeyCard } from "@/server/jockeys";
import { LocalTime } from "../competition/LocalTime";
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

const MORALE_TAG = { happy: "tag tag-good", unsettled: "tag tag-you", wants_out: "tag tag-live" } as const;

/** A contract as rows: wage, length and end, promised vs actual rides, morale (Phase 2). */
export function ContractRows({ c, mine }: { c: ContractView; mine: boolean }) {
  const short = c.ridesThisWeek < c.promisedRides;
  return (
    <>
      <li className="flex items-center gap-3 px-3 py-2">
        <span className="t-meta w-28 shrink-0">Wage</span>
        <span className="min-w-0 flex-1" data-testid="contract-wage">
          {formatCredits(c.wage)} cr a week
          {c.freeWeeksLeft > 0 ? <span className="t-meta"> · free for {c.freeWeeksLeft} more {c.freeWeeksLeft === 1 ? "week" : "weeks"} (apprentice)</span> : null}
          {c.unpaid ? <span className="t-meta"> · unpaid: leaves at Sunday&apos;s window</span> : null}
        </span>
      </li>
      <li className="flex items-center gap-3 px-3 py-2">
        <span className="t-meta w-28 shrink-0">Contract</span>
        <span className="min-w-0 flex-1">
          {c.lengthLabel} · ends <LocalTime ms={c.endsAtMs} withDate />
        </span>
      </li>
      <li className="flex items-center gap-3 px-3 py-2">
        <span className="t-meta w-28 shrink-0">Rides</span>
        <span className="min-w-0 flex-1" data-testid="contract-rides">
          {c.ridesThisWeek} of {c.promisedRides} promised this week
          {c.ridesLastWeek !== null ? <span className="t-meta"> · {c.ridesLastWeek} last week</span> : null}
          {mine && short && c.promisedRides > 0 ? <span className="t-meta"> · book {firstPlural(c.promisedRides - c.ridesThisWeek)} more</span> : null}
        </span>
      </li>
      <li className="flex items-center gap-3 px-3 py-2">
        <span className="t-meta w-28 shrink-0">Morale</span>
        <span className="min-w-0 flex-1">
          <span className={MORALE_TAG[c.morale]} data-testid="contract-morale">
            {c.moraleLabel}
          </span>
          {c.brokenWeeks > 0 && c.morale !== "wants_out" ? <span className="t-meta"> · short of rides last week; two weeks running and they can leave</span> : null}
          {c.morale === "wants_out" ? <span className="t-meta"> · can leave at Sunday&apos;s window</span> : null}
        </span>
      </li>
      <li className="flex items-center gap-3 px-3 py-2">
        <span className="t-meta w-28 shrink-0">Buyout</span>
        <span className="min-w-0 flex-1">{formatCredits(c.buyout)} cr</span>
      </li>
    </>
  );
}

const firstPlural = (n: number) => `${n} ${n === 1 ? "ride" : "rides"}`;

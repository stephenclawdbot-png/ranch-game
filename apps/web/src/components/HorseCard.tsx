import Link from "next/link";
import type { Horse, HorseRecord } from "@thoroughbred/shared";
import { COAT_LABEL, SEX_LABEL, STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { HorsePortrait } from "./HorsePortrait";
import { StatBars } from "./StatBars";
import { SilksIcon } from "./Silks";

export function recordLine(r: HorseRecord): string {
  if (r.starts === 0) return "Unraced";
  return `${r.starts} ${r.starts === 1 ? "start" : "starts"} · ${r.wins} ${r.wins === 1 ? "win" : "wins"}`;
}

export function HorseCard({ horse, record, index }: { horse: Horse; record: HorseRecord; index: number }) {
  return (
    <article className="panel group flex flex-col overflow-hidden" data-testid="horse-card">
      <Link href={`/horse/${horse.id}`} className="relative block rounded-t-[1.2rem] focus-visible:outline-offset-[-2px]">
        <div className="relative aspect-[5/4] overflow-hidden bg-gradient-to-b from-turf-800 to-turf-950">
          <HorsePortrait appearance={horse.appearance} className="absolute inset-x-0 bottom-0 mx-auto h-full transition-transform duration-500 group-hover:scale-[1.03]" />
          <div className="absolute left-3 top-3 flex items-center gap-1.5">
            <span className="chip !bg-ink/60 backdrop-blur">{STYLE_LABEL[horse.style]}</span>
          </div>
          <SilksIcon silks={horse.appearance.silks} className="absolute right-3 top-3 h-8 w-8" />
        </div>
        <div className="px-4 pt-3">
          <h2 className="display truncate text-xl font-semibold leading-tight">{horse.name}</h2>
          <p className="mt-0.5 text-xs text-sage">
            {horse.age}yo {SEX_LABEL[horse.sex].toLowerCase()} · {COAT_LABEL[horse.appearance.coat]}
          </p>
        </div>
      </Link>
      <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-3">
        <div className="flex flex-wrap gap-1.5">
          <span className="chip">
            Trip <strong className="font-semibold text-cream">{formatDistance(horse.preferredDistanceM)}</strong>
          </span>
          <span className="chip">
            Likes <strong className="font-semibold text-cream">{SURFACE_LABEL[horse.preferredSurface]}</strong>
          </span>
        </div>
        <StatBars stats={horse.stats} compact />
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-cream/8 pt-3">
          <div className="text-xs leading-tight">
            <p className="text-sage">Record</p>
            <p className="tabular font-medium text-cream" title={`${record.wins} wins, ${record.places} seconds, ${record.shows} thirds`}>
              {recordLine(record)} <span className="text-brass">· {formatCredits(record.earnings)} cr</span>
            </p>
          </div>
          <Link href={`/races?horse=${index}#quick`} className="btn btn-ghost !min-h-9 !px-4 text-sm">
            Race
          </Link>
        </div>
      </div>
    </article>
  );
}

"use client";

import Link from "next/link";
import type { Horse, HorseRecord } from "@thoroughbred/shared";
import { COAT_LABEL, SEX_LABEL, STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { HorsePortrait } from "./HorsePortrait";
import { StatBars } from "./StatBars";
import { SilksIcon } from "./Silks";
import { Stall } from "./Stall";
import { PixelIcon } from "./icons";
import { useTilt } from "./pixel/useTilt";

export function recordLine(r: HorseRecord): string {
  if (r.starts === 0) return "Unraced";
  return `${r.starts} ${r.starts === 1 ? "start" : "starts"} · ${r.wins} ${r.wins === 1 ? "win" : "wins"}`;
}

export function HorseCard({ horse, record, index }: { horse: Horse; record: HorseRecord; index: number }) {
  const ref = useTilt<HTMLElement>(5);
  return (
    <div className="flex" style={{ animation: `fade-up 420ms steps(6) ${index * 70}ms both` }}>
    <article ref={ref} className="tilt px-panel group flex w-full flex-col !p-0" data-testid="horse-card">
      <Link href={`/horse/${horse.id}`} className="relative block focus-visible:outline-offset-[-3px]">
        <Stall className="aspect-[5/4]">
          <div className="parallax absolute inset-x-0 bottom-[6%] top-[8%] flex justify-center" style={{ ["--depth" as string]: 12 }}>
            <HorsePortrait appearance={horse.appearance} className="h-full w-auto max-w-full drop-shadow-[4px_4px_0_rgba(0,0,0,0.35)]" />
          </div>
          <div className="parallax absolute left-2 top-2" style={{ ["--depth" as string]: 18 }}>
            <span className="chip chip-cream">{STYLE_LABEL[horse.style]}</span>
          </div>
          <div className="parallax absolute right-2 top-2" style={{ ["--depth" as string]: 18 }}>
            <SilksIcon silks={horse.appearance.silks} className="h-9 w-9" />
          </div>
          <div className="sheen" aria-hidden />
        </Stall>
        <div className="px-plate relative z-10 mx-2 -mt-5 sm:mx-3">
          <h2 className="display truncate text-xl !text-[#1d140a] [text-shadow:none]">{horse.name}</h2>
          <p className="truncate text-xs font-semibold text-[#5c4a2e]">
            {horse.age}yo {SEX_LABEL[horse.sex].toLowerCase()} · {COAT_LABEL[horse.appearance.coat]}
          </p>
        </div>
      </Link>
      <div className="flex flex-1 flex-col gap-3 px-3 pb-3 pt-3">
        <div className="flex flex-wrap gap-1.5">
          <span className="chip">
            Trip <strong className="num font-normal text-cream">{formatDistance(horse.preferredDistanceM)}</strong>
          </span>
          <span className="chip">
            Likes <strong className="text-cream">{SURFACE_LABEL[horse.preferredSurface]}</strong>
          </span>
        </div>
        <StatBars stats={horse.stats} compact />
        <div className="mt-auto flex items-center justify-between gap-3 border-t-2 border-dashed border-[#1f4d35] pt-3">
          <div className="min-w-0 text-xs leading-tight">
            <p className="label">Record</p>
            <p className="mt-0.5 truncate font-semibold text-cream" title={`${record.wins} wins, ${record.places} seconds, ${record.shows} thirds`}>
              {recordLine(record)}{" "}
              <span className="num inline-flex items-center gap-1 font-normal text-brass-bright">
                · <PixelIcon name="coin" className="h-3 w-3" /> {formatCredits(record.earnings)}
              </span>
            </p>
          </div>
          <Link href={`/races?horse=${index}#quick`} className="btn btn-brass btn-sm shrink-0">
            <PixelIcon name="flag" className="h-4 w-4" /> Race
          </Link>
        </div>
      </div>
    </article>
    </div>
  );
}

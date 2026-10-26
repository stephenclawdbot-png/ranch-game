import type { Going, Surface, Weather } from "@thoroughbred/shared";
import { formatRaceTime } from "@thoroughbred/shared";
import type { CupBadge as CupBadgeT } from "@/lib/competitionTypes";
import { GOING_LABEL, SURFACE_LABEL, WEATHER_LABEL, formatDistance, furlongs } from "@/lib/format";
import { WeatherGlyph } from "../RaceMeta";

/** Race time m:ss.cc in tabular numerals. */
export function RaceTime({ us, className }: { us: number; className?: string }) {
  return <span className={`tabular ${className ?? ""}`}>{formatRaceTime(us)}</span>;
}

/** Distance · surface · going (· weather) as chips. */
export function ConditionChips({ distanceM, surface, going, weather }: { distanceM: number; surface: Surface; going?: Going; weather?: Weather }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Conditions">
      <li className="chip">
        {formatDistance(distanceM)} <span className="text-cream-dim">({furlongs(distanceM)})</span>
      </li>
      <li className="chip">{SURFACE_LABEL[surface]}</li>
      {going && <li className="chip">Going: {GOING_LABEL[going]}</li>}
      {weather && (
        <li className="chip">
          <WeatherGlyph weather={weather} className="h-4 w-4" /> {WEATHER_LABEL[weather]}
        </li>
      )}
    </ul>
  );
}

const BADGE_TEXT: Record<CupBadgeT, string> = { gold: "Gold", silver: "Silver", bronze: "Bronze", top10: "Top 10%", finisher: "Finisher" };
const BADGE_CLASS: Record<CupBadgeT, string> = { gold: "chip-brass", silver: "chip-cream", bronze: "chip-cream", top10: "chip", finisher: "chip" };

/** Cup standing badge (always with words). */
export function CupBadge({ badge }: { badge: CupBadgeT }) {
  return <span className={`chip ${BADGE_CLASS[badge]} shrink-0`}>{BADGE_TEXT[badge]}</span>;
}

/** Small label-value tile that wraps rather than truncates. */
export function StatTile({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="inset min-w-0 px-3 py-2" data-testid={testId}>
      <p className="label text-cream-dim">{label}</p>
      <p className="font-extrabold break-words text-cream">{children}</p>
    </div>
  );
}

export function tierLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

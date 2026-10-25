import type { RaceConfig } from "@thoroughbred/shared";
import { CLASS_LABEL, GOING_LABEL, SURFACE_LABEL, WEATHER_LABEL, formatCredits, formatDistance, furlongs } from "@/lib/format";

export function WeatherGlyph({ weather, className }: { weather: RaceConfig["weather"]; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-3.5 w-3.5"} aria-hidden {...p}>
      {weather === "clear" && <><circle cx="12" cy="12" r="4" /><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>}
      {weather === "overcast" && <path d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 18Z" />}
      {weather === "rain" && <><path d="M7 14h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 14Z" /><path d="m9 17-1 3m5-3-1 3m5-3-1 3" /></>}
      {weather === "dusk" && <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />}
    </svg>
  );
}

/** Distance · surface · going · weather · class chips. */
export function RaceMetaChips({
  race,
  showPurse = false,
  showClass = true,
}: {
  race: Pick<RaceConfig, "distanceM" | "surface" | "going" | "weather" | "raceClass" | "purse">;
  showPurse?: boolean;
  showClass?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="chip">
        <strong className="font-semibold text-cream">{formatDistance(race.distanceM)}</strong>
        <span className="text-sage">{furlongs(race.distanceM)}</span>
      </span>
      <span className="chip">{SURFACE_LABEL[race.surface]} · {GOING_LABEL[race.going]}</span>
      <span className="chip">
        <WeatherGlyph weather={race.weather} />
        {WEATHER_LABEL[race.weather]}
      </span>
      {showClass && <span className="chip">{CLASS_LABEL[race.raceClass]}</span>}
      {showPurse && <span className="chip border-brass/30 text-brass-bright">Purse {formatCredits(race.purse)}</span>}
    </div>
  );
}

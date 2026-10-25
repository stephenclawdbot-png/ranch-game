import type { RaceConfig } from "@thoroughbred/shared";
import { CLASS_LABEL, GOING_LABEL, SURFACE_LABEL, WEATHER_LABEL, formatCredits, formatDistance, furlongs } from "@/lib/format";
import { PixelIcon, type IconName } from "./icons";

const WEATHER_ICON: Record<RaceConfig["weather"], IconName> = { clear: "sun", overcast: "cloud", rain: "rain", dusk: "moon" };

export function WeatherGlyph({ weather, className }: { weather: RaceConfig["weather"]; className?: string }) {
  return <PixelIcon name={WEATHER_ICON[weather]} className={className ?? "h-4 w-4"} />;
}

/** Distance · surface · going · weather · class tags. */
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
        <strong className="num font-normal text-cream">{formatDistance(race.distanceM)}</strong>
        <span className="text-sage">{furlongs(race.distanceM)}</span>
      </span>
      <span className="chip">
        {SURFACE_LABEL[race.surface]} · {GOING_LABEL[race.going]}
      </span>
      <span className="chip">
        <WeatherGlyph weather={race.weather} />
        {WEATHER_LABEL[race.weather]}
      </span>
      {showClass && <span className="chip">{CLASS_LABEL[race.raceClass]}</span>}
      {showPurse && (
        <span className="chip chip-brass">
          <PixelIcon name="coin" className="h-3.5 w-3.5" />
          <span className="num font-normal">Purse {formatCredits(race.purse)}</span>
        </span>
      )}
    </div>
  );
}

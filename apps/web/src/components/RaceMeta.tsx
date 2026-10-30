import type { RaceConfig } from "@thoroughbred/shared";
import { CLASS_LABEL, GOING_LABEL, SURFACE_LABEL, WEATHER_LABEL, formatCredits, formatDistance, furlongs } from "@/lib/format";
import { PixelIcon, type IconName } from "./icons";

const WEATHER_ICON: Record<RaceConfig["weather"], IconName> = { clear: "sun", overcast: "cloud", rain: "rain", dusk: "moon" };

export function WeatherGlyph({ weather, className }: { weather: RaceConfig["weather"]; className?: string }) {
  return <PixelIcon name={WEATHER_ICON[weather]} className={className ?? "h-4 w-4"} title={WEATHER_LABEL[weather]} />;
}

type MetaRace = Pick<RaceConfig, "distanceM" | "surface" | "going" | "weather" | "raceClass" | "purse">;

const TREND_TITLE = { drying: "The ground is drying out since yesterday", softening: "Rain has softened the ground since yesterday" } as const;

/**
 * Distance · surface · going · weather · class tags (flat chips; nothing brass). `trend` adds the
 * ground's direction to the going ("soft, drying"); steady ground shows no word.
 */
export function RaceMetaChips({ race, showPurse = false, showClass = true, trend = null }: { race: MetaRace; showPurse?: boolean; showClass?: boolean; trend?: "drying" | "softening" | "steady" | null }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="chip">
        <strong className="num text-cream">{formatDistance(race.distanceM)}</strong>
        <span>{furlongs(race.distanceM)}</span>
      </span>
      <span className="chip" data-testid="race-ground" title={trend && trend !== "steady" ? TREND_TITLE[trend] : undefined}>
        {SURFACE_LABEL[race.surface]} · {GOING_LABEL[race.going].toLowerCase()}
        {trend && trend !== "steady" && <span className="text-cream-dim">, {trend}</span>}
      </span>
      <span className="chip">
        <WeatherGlyph weather={race.weather} className="h-4 w-4" />
        {WEATHER_LABEL[race.weather]}
      </span>
      {showClass && <span className="chip">{CLASS_LABEL[race.raceClass]}</span>}
      {showPurse && (
        <span className="chip">
          <PixelIcon name="coin" size={16} />
          <span className="num text-cream">{formatCredits(race.purse)}</span>
        </span>
      )}
    </div>
  );
}

/** One-line conditions for list rows: "1,400 m · Dirt, good · Handicap". */
export function raceMetaLine(race: Pick<RaceConfig, "distanceM" | "surface" | "going" | "raceClass">): string {
  return `${formatDistance(race.distanceM)} · ${SURFACE_LABEL[race.surface]}, ${GOING_LABEL[race.going].toLowerCase()} · ${CLASS_LABEL[race.raceClass]}`;
}

/**
 * Ground & weather (This week): every course's going and weather for the days the card has
 * published (exact), then a 4-day outlook (likely going, chance of rain). Players plan entries
 * around it: a horse that hates heavy ground waits for the dry spell, or runs on the all-weather.
 */
import type { Going, Surface } from "@thoroughbred/shared";
import type { GroundView } from "@/lib/competitionTypes";
import { GOING_LABEL, SURFACE_LABEL } from "@/lib/format";
import { WeatherGlyph } from "../RaceMeta";
import { PixelIcon } from "../icons";

const SEASON_LABEL: Record<GroundView["yearSeason"], string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };
const SEASON_NOTE: Record<GroundView["yearSeason"], string> = {
  spring: "Showers come and go: mostly good or soft ground.",
  summer: "Long dry spells: fast, firm ground, soft only after a wet spell.",
  autumn: "The rain sets in: soft and heavy ground, the odd good day.",
  winter: "The wettest time: heavy ground, and a frost can stop the turf.",
};

type Course = GroundView["courses"][number];

const weekday = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const going = (g: Going | undefined) => (g ? GOING_LABEL[g].toLowerCase() : "–");

/** The going on each surface the course races, today ("Turf soft, drying · Dirt good"). */
function todayLine(c: Course): string {
  const d = c.days[0];
  if (!d) return "";
  return c.surfaces
    .map((s: Surface) => {
      if (s === "turf" && d.frost) return "Turf frozen off";
      const trend = s !== "synthetic" && d.trend !== "steady" ? `, ${d.trend}` : "";
      return `${SURFACE_LABEL[s]} ${going(d.going[s])}${trend}`;
    })
    .join(" · ");
}

function outlookIcon(rainPct: number) {
  return rainPct >= 50 ? "rain" : rainPct >= 25 ? "overcast" : "clear";
}

function CourseGround({ c }: { c: Course }) {
  const today = c.days[0];
  // the strip follows the turf (every course races it); a frost day shows "frost"
  const main: Surface = c.surfaces.includes("turf") ? "turf" : c.surfaces[0]!;
  return (
    <li className="inset grid min-w-0 gap-2 p-3" data-testid="ground-course">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="font-bold text-cream" title={c.character}>
          {c.name}
        </p>
        {today && (
          <p className="flex items-center gap-1 text-sm">
            <WeatherGlyph weather={today.sky} className="h-4 w-4" />
            {today.frost ? "Frost" : today.sky === "rain" ? "Rain" : today.sky === "overcast" ? "Overcast" : "Clear"}
          </p>
        )}
      </div>
      <p className="text-sm font-semibold" data-testid="ground-today">
        {todayLine(c)}
      </p>
      <ol className="grid grid-cols-6 gap-1 text-center" aria-label={`${c.name}: ${SURFACE_LABEL[main].toLowerCase()} going by day`}>
        {c.days.map((d, i) => (
          <li key={d.day} className="grid justify-items-center gap-0.5 rounded-sm bg-surface-1 px-0.5 py-1" title="On the card: the real going">
            <span className="label">{i === 0 ? "Today" : weekday(d.dayStartMs)}</span>
            <WeatherGlyph weather={d.sky} className="h-4 w-4" />
            <span className="text-xs font-bold text-cream">{main === "turf" && d.frost ? "frost" : going(d.going[main])}</span>
          </li>
        ))}
        {c.outlook.map((o) => (
          <li key={o.day} className="grid justify-items-center gap-0.5 px-0.5 py-1 text-cream-dim" title={`Outlook: likely ${going(o.likelyGoing[main])}, ${o.rainChancePct}% chance of rain${o.frostChancePct ? `, ${o.frostChancePct}% frost` : ""}`}>
            <span className="label">{weekday(o.dayStartMs)}</span>
            <WeatherGlyph weather={outlookIcon(o.rainChancePct)} className="h-4 w-4 opacity-70" />
            <span className="text-xs font-semibold">{going(o.likelyGoing[main])}</span>
            <span className="text-[0.6875rem] tabular">{o.rainChancePct}%</span>
          </li>
        ))}
      </ol>
    </li>
  );
}

export function GroundWeather({ ground }: { ground: GroundView }) {
  return (
    <section className="surface grid gap-3 p-4" aria-labelledby="gw-h" data-testid="week-ground">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="gw-h" className="t-h2 flex items-center gap-2">
          <PixelIcon name="rain" size={32} />
          Ground &amp; weather
        </h2>
        <span className="chip" data-testid="ground-season">
          {SEASON_LABEL[ground.yearSeason]} · season {ground.season}
        </span>
      </div>
      <p className="caption">
        {SEASON_NOTE[ground.yearSeason]} Each course has its own weather: rain softens the ground, dry days firm it up again, faster where it drains well.
      </p>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ground.courses.map((c) => (
          <CourseGround key={c.courseId} c={c} />
        ))}
      </ul>
      <p className="caption">
        Bright days are on the card, so their going is the real thing. Faded days are the outlook: the most likely turf going and the chance of rain. Dirt rides good unless it is very wet; synthetic is always good.
      </p>
    </section>
  );
}

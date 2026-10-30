import * as gc from "@thoroughbred/game-core";
import { CALENDAR_HOME_COURSE, RULES } from "@thoroughbred/db";
import { GOING_LABEL, SURFACE_LABEL } from "@/lib/format";
import { Callout, Facts, GameLink, H2, H3, Lead, List, P, Table, WikiLink, pct } from "../kit";

const CLOCK = { epochMs: RULES.seasonEpochMs };
const SEASON_LABEL: Record<gc.YearSeason, string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };
const GOINGS = ["firm", "good", "soft", "heavy"] as const;
/** Four years of 16 weeks from launch: every time of year four times, at every course. */
const SAMPLE_DAYS = 28 * 4 * 4;

/** Turf going share by time of year over the sample (live from the climate model). */
function goingByTimeOfYear() {
  const first = Math.floor(RULES.seasonEpochMs / gc.MS_PER_DAY);
  const counts = new Map<gc.YearSeason, { n: number; rain: number; frost: number; going: Record<string, number> }>();
  for (const course of gc.COURSES) {
    for (let d = first; d < first + SAMPLE_DAYS; d++) {
      const day = gc.courseDay(CLOCK, course.id, d);
      const c = counts.get(day.yearSeason) ?? { n: 0, rain: 0, frost: 0, going: {} };
      c.n++;
      if (day.sky === "rain") c.rain++;
      if (day.frost) c.frost++;
      const g = gc.goingFor("turf", day.moisture, day.sky === "rain");
      c.going[g] = (c.going[g] ?? 0) + 1;
      counts.set(day.yearSeason, c);
    }
  }
  return gc.YEAR_SEASONS.map((s) => ({ season: s, ...counts.get(s)! }));
}

/** Share of a count as a whole percent. */
const share = (n: number, of: number) => `${Math.round((100 * n) / of)}%`;

/** Each course's weather character: how often it rains and how its turf rides over the sample. */
function courseCharacter() {
  const first = Math.floor(RULES.seasonEpochMs / gc.MS_PER_DAY);
  return gc.COURSES.map((course) => {
    let rain = 0;
    let soft = 0;
    for (let d = first; d < first + SAMPLE_DAYS; d++) {
      const day = gc.courseDay(CLOCK, course.id, d);
      if (day.sky === "rain") rain++;
      const g = gc.goingFor("turf", day.moisture, day.sky === "rain");
      if (g === "soft" || g === "heavy") soft++;
    }
    return { course, rain: share(rain, SAMPLE_DAYS), soft: share(soft, SAMPLE_DAYS), drying: gc.dryingPermille(course, gc.SEASON_CLIMATE.summer, "clear") };
  });
}

/** Season numbers around launch with their time of year: "Season 1 Spring, 2 Summer ...". */
function seasonRota(): string {
  return [1, 2, 3, 4].map((n) => `season ${n} ${SEASON_LABEL[gc.yearSeasonOf(n)].toLowerCase()}`).join(", ");
}

export default function WeatherAndGoingPage() {
  const years = goingByTimeOfYear();
  const courses = courseCharacter();
  const [firm, good, soft] = gc.TURF_GOING_BANDS;
  return (
    <>
      <Lead>
        Every racecourse has its own weather and its own ground. Rain softens the turf, dry days firm it up again, and the time of year sets the odds: summer is fast ground, winter is
        heavy. The going on the race card is the real ground at that course on the day, and the <GameLink href="/week">This week</GameLink> page forecasts the next few days so you can
        plan your entries.
      </Lead>

      <H2 id="seasons">The time of year</H2>
      <P>
        The year turns with the racing season: each {RULES.seasonMs / gc.MS_PER_DAY}-day season is one time of year, in the order spring, summer, autumn, winter, so a full year is{" "}
        {(4 * RULES.seasonMs) / gc.MS_PER_DAY / 7} weeks ({seasonRota()}, and round again). The current season and its time of year are shown at the top of the Ground &amp; weather
        section on This week.
      </P>
      <Table
        head={["Time of year", "Wet days", ...GOINGS.map((g) => `${GOING_LABEL[g]} turf`), "Frost"]}
        rows={years.map((y) => [
          SEASON_LABEL[y.season],
          share(y.rain, y.n),
          ...GOINGS.map((g) => share(y.going[g] ?? 0, y.n)),
          y.frost ? share(y.frost, y.n) : "never",
        ])}
        caption="Share of days over four years at all six courses, straight from the weather model. Early autumn still rides like summer: the ground carries over from one season to the next."
      />
      <List
        items={[
          <>
            <b>Spring</b>: showers come and go. Mostly good or soft ground.
          </>,
          <>
            <b>Summer</b>: long dry spells ({pct(gc.SEASON_CLIMATE.summer.rainAfterDry)} chance of rain after a dry day). Firm and good ground; soft only after a wet spell.
          </>,
          <>
            <b>Autumn</b>: the rain sets in. Soft and heavy ground, the odd good day.
          </>,
          <>
            <b>Winter</b>: the wettest time, and the ground dries slowest. Heavy ground, and on a clear, cold day a frost can stop the turf.
          </>,
        ]}
      />

      <H2 id="weather">Weather: wet and dry spells</H2>
      <P>
        Each course has its own weather every day. Rain is more likely after a wet day than after a dry one, so wet and dry spells last: in autumn a course has a{" "}
        {pct(gc.SEASON_CLIMATE.autumn.rainAfterRain)} chance of more rain after a wet day but only {pct(gc.SEASON_CLIMATE.autumn.rainAfterDry)} after a dry one (before the course&rsquo;s own
        rainfall). A dry day is clear or overcast. On clear evenings in autumn and winter the evening meeting runs at dusk under the lights; that is only the look of the broadcast, the ground
        is dry.
      </P>

      <H2 id="going">How the going is worked out</H2>
      <P>
        The ground holds water. A wet day adds {gc.SEASON_CLIMATE.autumn.rainfall} to {gc.SEASON_CLIMATE.autumn.rainfall + gc.SEASON_CLIMATE.autumn.rainfallSpread} points of moisture
        (out of 1,000) in autumn; a clear day dries a share of it, an overcast day {pct(gc.OVERCAST_DRYING_PERMILLE)} as much, a wet day none. The going follows from the moisture and the
        surface:
      </P>
      <Table
        head={["Surface", "Going"]}
        rows={[
          [SURFACE_LABEL.turf, `${GOING_LABEL.firm} below ${firm}, ${GOING_LABEL.good.toLowerCase()} below ${good}, ${GOING_LABEL.soft.toLowerCase()} below ${soft}, ${GOING_LABEL.heavy.toLowerCase()} from ${soft}. Never firm while it rains.`],
          [SURFACE_LABEL.dirt, `${GOING_LABEL.good} until the track is very wet (moisture ${gc.DIRT_HEAVY_FROM}+), then ${GOING_LABEL.heavy.toLowerCase()}.`],
          [SURFACE_LABEL.synthetic, `Always ${GOING_LABEL.good.toLowerCase()}: the all-weather drains whatever the sky does.`],
        ]}
      />
      <P>
        Weather and going always agree: you never see rain on firm ground. How much soft or heavy going costs a horse depends on its adaptability (and a mudlark loves it): see{" "}
        <WikiLink slug="stats-and-aptitudes" />. Soft-ground shoes take the edge off it: see <WikiLink slug="entering-a-race" />.
      </P>
      <Callout tone="tip" title="Drying or softening">
        <p>
          The race page shows which way the ground is moving next to the going: <b>drying</b> when it has dried noticeably since the day before, <b>softening</b> after rain (a change of{" "}
          {gc.TREND_STEP} moisture points or more). A soft but drying track is on its way back to good.
        </p>
      </Callout>

      <H2 id="courses">Each course&rsquo;s weather</H2>
      <P>
        The six courses share the time of year but not the weather. A course with more rain gets more wet spells; one that drains well dries faster (a clear summer day dries the share
        shown, out of 1,000).
      </P>
      <Table
        head={["Course", "Surfaces", "Wet days", "Soft or heavy turf", "Summer drying"]}
        rows={courses.map((c) => [c.course.name, c.course.surfaces.map((s) => SURFACE_LABEL[s]).join(", "), c.rain, c.soft, `${c.drying} / 1,000`])}
        caption="Over four years, every time of year. Bellmont and Kestrel Downs drain fast and ride quickest; Harrowgate's clay and Saltmarsh's sea rain make them the softest."
      />
      <P>
        A race always runs at a course that races its surface: synthetic only at {gc.coursesFor("synthetic").map((c) => c.name).join(" and ")}, dirt at{" "}
        {gc.coursesFor("dirt").map((c) => c.name).join(", ")}, turf everywhere. The Weekend Feature, its Plate and the Season Finals run at {CALENDAR_HOME_COURSE.weekend_feature}, the
        Feature Qualifiers at {CALENDAR_HOME_COURSE.feature_qualifier}.
      </P>

      <H2 id="frost">Frost</H2>
      <P>
        In winter, a clear day brings frost {pct(gc.SEASON_CLIMATE.winter.frostChance)} of the time. Frost stops the <b>turf</b> at that course for the day: its dirt and synthetic still race,
        and turf races go to another course. A big race whose home course is frozen moves too. If every turf course is frozen at once, the turf race moves to the all-weather.
      </P>

      <H2 id="forecast">The forecast</H2>
      <P>
        <GameLink href="/week">This week</GameLink> has a Ground &amp; weather section listing every course. The days already on the race card (it is published{" "}
        {RULES.cardHorizonMs / gc.MS_PER_HOUR} hours ahead) show the real going and weather. The next {gc.OUTLOOK_DAYS} days are an <b>outlook</b>: the most likely going and the chance of rain,
        worked out from the last day on the card with the same odds the weather uses. Like any forecast, it can be wrong: a dry spell can break early.
      </P>
      <Facts
        rows={[
          ["Exact", `Every day with a race on the card (${RULES.cardHorizonMs / gc.MS_PER_HOUR} hours ahead)`],
          ["Outlook", `${gc.OUTLOOK_DAYS} more days: likely going and chance of rain`],
          ["Weekend Feature", "Likely going from Monday, the real going once it is on the card"],
        ]}
      />
      <H3>Planning around it</H3>
      <List
        items={[
          <>A horse that hates soft ground: wait for a dry spell, pick a fast-draining course, or run it on the all-weather.</>,
          <>A mudlark or a horse with high adaptability: autumn and winter are its time.</>,
          <>Check Saturday&rsquo;s likely going on Monday before you pick which horse to qualify for the Weekend Feature.</>,
        ]}
      />
    </>
  );
}

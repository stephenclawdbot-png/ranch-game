/**
 * Seasons, weather and ground (owner request 2026-10-30): each racecourse has its own weather
 * and its own ground, which evolve day by day, and the time of year changes both.
 *
 *   - Time of year: Spring, Summer, Autumn and Winter rotate with the 4-week racing season
 *     (`yearSeasonOf`), so one "year" is 16 real weeks.
 *   - Weather per course per UTC day: a two-state Markov chain (wet or dry), so wet and dry
 *     spells persist. Its odds come from the time of year, scaled by the course's `rainBias`.
 *     A dry day is clear or overcast; a clear winter day can bring frost, and frost stops the
 *     turf at that course for the day (dirt and synthetic still race).
 *   - Ground moisture 0..1000 per course: a wet day adds rain, a dry day dries a share of it
 *     (more on a clear day, faster on a well-drained course and in summer).
 *   - Going comes from moisture and surface (`goingFor`): turf uses firm..heavy, dirt is good
 *     or heavy when very wet, synthetic is always good. A wet day is never firm.
 *
 * Determinism: the chain for a course runs day by day from the start of season 1 (the clock's
 * epoch), so the ground on any day follows exactly from the day before, across season
 * boundaries too. Each (course, racing season) draws its days from its own stream,
 * `seedFrom("climate", courseId, season)`: like the card's per-slot picks (`card-slot:<index>`
 * hashed in packages/db card.ts), the seed is built from public values only, so every server
 * agrees without coordination and anyone could work the future weather out. The forecast
 * (`forecast`) only shows what we choose: exact conditions for the published card, a
 * probabilistic outlook after that.
 *
 * Integer maths only (permille, moisture units); no clocks: time is passed in.
 */
import type { Going, Surface, Weather } from "@thoroughbred/shared";
import { COURSES, courseById, type Course, type CourseId } from "./courses";
import { CARD_HORIZON_MS, meetingStartsOn } from "./meetings";
import { Rng, seedFrom } from "./rng";
import { MS_PER_DAY, MS_PER_HOUR, SEASON_DAYS, type SeasonClock } from "./time";

// ---------------------------------------------------------------------------
// Time of year
// ---------------------------------------------------------------------------

export const YEAR_SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type YearSeason = (typeof YEAR_SEASONS)[number];

/**
 * Phase of the time-of-year rotation: racing season n is `YEAR_SEASONS[(n + phase) mod 4]`.
 * 3 makes season 11 (12 Oct to 8 Nov 2026, with the season-1 epoch of 5 Jan 2026) Autumn, as
 * it is outside; season 12 is Winter, 13 Spring, 14 Summer, then round again (a 16-week year).
 */
export const YEAR_SEASON_PHASE = 3;

/** Time of year for a racing season number (1-based; any integer works). */
export function yearSeasonOf(season: number): YearSeason {
  return YEAR_SEASONS[(((season + YEAR_SEASON_PHASE) % 4) + 4) % 4]!;
}

/** Racing season of a UTC day index (days since 1970-01-01). Unlike `seasonOf`, days before season 1 get season 0, -1, ... */
export function climateSeasonOfDay(clock: SeasonClock, day: number): number {
  return Math.floor((day * MS_PER_DAY - clock.epochMs) / (SEASON_DAYS * MS_PER_DAY)) + 1;
}

/** The climate knobs of one time of year. All chances are permille. */
export interface SeasonClimate {
  /** Chance of rain on a day that follows a dry day (scaled by the course's rainBias). Low = long dry spells. */
  rainAfterDry: number;
  /** Chance of rain on a day that follows a wet day (scaled by half the course's rainBias offset). High = wet spells persist. */
  rainAfterRain: number;
  /** Moisture a wet day adds: this much plus a random 0..`rainfallSpread`. */
  rainfall: number;
  /** Random extra rainfall on a wet day, 0..this. */
  rainfallSpread: number;
  /** Share of the moisture a clear day dries, permille, for an average-draining course (drainage 500). */
  dryingPermille: number;
  /** Chance that a dry day is overcast rather than clear. */
  overcastChance: number;
  /** Chance that a clear day brings frost (turf abandoned at that course). Winter only. */
  frostChance: number;
  /** Where the ground starts before season 1 (moisture 0..1000); only the very first season sees it. */
  startMoisture: number;
}

/**
 * Starting values, tuned so a year feels like British flat racing (game-core climate.test.ts
 * checks the shape over many days; KNOBS §6a):
 *   Spring  showery (about 1 day in 3 wet); mostly good or soft (turf, all courses: firm 20%,
 *           good 37%, soft 26%, heavy 17%).
 *   Summer  long dry spells (1 day in 7 wet); firm 57%, good 30%, soft 10%, heavy 3%.
 *   Autumn  wet (2 days in 5); starts from summer's ground, then soft and heavy: firm 16%,
 *           good 26%, soft 25%, heavy 33%.
 *   Winter  wettest, slowest drying: good 11%, soft 24%, heavy 63%; frost on about 1 day in 10
 *           at each course.
 * The courses differ around these: Bellmont and Kestrel Downs drain fast and stay quicker,
 * Harrowgate (clay moor, rainy) and Saltmarsh (rainiest, though sandy) ride softer.
 */
export const SEASON_CLIMATE: Record<YearSeason, SeasonClimate> = {
  spring: { rainAfterDry: 220, rainAfterRain: 500, rainfall: 70, rainfallSpread: 100, dryingPermille: 160, overcastChance: 450, frostChance: 0, startMoisture: 450 },
  summer: { rainAfterDry: 100, rainAfterRain: 400, rainfall: 80, rainfallSpread: 100, dryingPermille: 110, overcastChance: 300, frostChance: 0, startMoisture: 250 },
  autumn: { rainAfterDry: 300, rainAfterRain: 580, rainfall: 80, rainfallSpread: 120, dryingPermille: 115, overcastChance: 500, frostChance: 0, startMoisture: 600 },
  winter: { rainAfterDry: 330, rainAfterRain: 600, rainfall: 80, rainfallSpread: 120, dryingPermille: 85, overcastChance: 550, frostChance: 400, startMoisture: 700 },
};

/** Rain chances never exceed this after the course's rainBias (no course is wet every day). */
export const MAX_RAIN_CHANCE = 900;
/** Drying on an overcast day, permille of a clear day's. Wet days don't dry. */
export const OVERCAST_DRYING_PERMILLE = 600;
/**
 * Drainage scaling: a course dries `(DRAINAGE_BASE + drainage) / (DRAINAGE_BASE + 500)` times as
 * fast as an average one. With 250, the clay moor (400) dries 0.87×, the sandy coast (900) 1.53×.
 */
export const DRAINAGE_BASE = 250;

// ---------------------------------------------------------------------------
// Going
// ---------------------------------------------------------------------------

/** Turf going by moisture: below 1st firm, below 2nd good, below 3rd soft, else heavy. */
export const TURF_GOING_BANDS = [250, 500, 750] as const;
/** Dirt rides good until the ground is very wet, then heavy (sloppy) from this moisture. */
export const DIRT_HEAVY_FROM = 900;

/** Going for a surface at this moisture. A wet day is never firm (rain on firm ground reads good). */
export function goingFor(surface: Surface, moisture: number, wet = false): Going {
  if (surface === "synthetic") return "good";
  if (surface === "dirt") return moisture >= DIRT_HEAVY_FROM ? "heavy" : "good";
  const [f, g, s] = TURF_GOING_BANDS;
  if (moisture < f) return wet ? "good" : "firm";
  if (moisture < g) return "good";
  if (moisture < s) return "soft";
  return "heavy";
}

// ---------------------------------------------------------------------------
// The day-by-day chain
// ---------------------------------------------------------------------------

/** A dry day's sky; a wet day is "rain". ("dusk" is a lighting look added per race: `raceGround`.) */
export type Sky = "clear" | "overcast" | "rain";

export interface CourseDay {
  courseId: CourseId;
  /** UTC day index (days since 1970-01-01). */
  day: number;
  /** Racing season the day belongs to. */
  season: number;
  yearSeason: YearSeason;
  sky: Sky;
  /** Ground moisture at race time, 0..1000 (after the day's rain or drying). */
  moisture: number;
  /** Frost: the turf at this course does not race today. */
  frost: boolean;
}

/** Rain chance today given yesterday, permille, after the course's rainBias. */
export function rainChance(course: Course, climate: SeasonClimate, wetYesterday: boolean): number {
  if (!wetYesterday) return Math.min(MAX_RAIN_CHANCE, Math.floor((climate.rainAfterDry * course.rainBias) / 1000));
  // persistence moves half as far as the onset: a wet course gets more spells, not endless ones
  return Math.min(MAX_RAIN_CHANCE, Math.floor((climate.rainAfterRain * (1000 + Math.floor((course.rainBias - 1000) / 2))) / 1000));
}

/** Share of moisture a day dries at this course, permille (0 on a wet day). */
export function dryingPermille(course: Course, climate: SeasonClimate, sky: Sky): number {
  if (sky === "rain") return 0;
  const clear = Math.floor((climate.dryingPermille * (DRAINAGE_BASE + course.drainage)) / (DRAINAGE_BASE + 500));
  return sky === "clear" ? clear : Math.floor((clear * OVERCAST_DRYING_PERMILLE) / 1000);
}

interface ChainState {
  wet: boolean;
  moisture: number;
}

/** One day forward. `draws` are four uniform permille rolls (rain, rainfall, overcast, frost). */
function step(course: Course, climate: SeasonClimate, prev: ChainState, draws: readonly number[]): { sky: Sky; moisture: number; frost: boolean } {
  const wet = draws[0]! < rainChance(course, climate, prev.wet);
  const sky: Sky = wet ? "rain" : draws[2]! < climate.overcastChance ? "overcast" : "clear";
  let moisture = prev.moisture;
  if (wet) moisture += climate.rainfall + Math.floor((draws[1]! * (climate.rainfallSpread + 1)) / 1000);
  else moisture -= Math.floor((moisture * dryingPermille(course, climate, sky)) / 1000);
  moisture = Math.max(0, Math.min(1000, moisture));
  const frost = sky === "clear" && draws[3]! < climate.frostChance;
  return { sky, moisture, frost };
}

const seasonCache = new Map<string, CourseDay[]>();
const CACHE_MAX = 600;

/** The 28 days of one racing season at one course (memoised; pure). */
function seasonDays(clock: SeasonClock, courseId: CourseId, season: number): CourseDay[] {
  const key = `${clock.epochMs}:${courseId}:${season}`;
  const hit = seasonCache.get(key);
  if (hit) return hit;
  const course = courseById(courseId);
  const yearSeason = yearSeasonOf(season);
  const climate = SEASON_CLIMATE[yearSeason];
  // The chain is continuous from season 1: each season starts from the last day of the one
  // before. Seasons before 1 (days before launch) start fresh from their own start moisture.
  let prev: ChainState;
  if (season > 1) {
    const before = seasonDays(clock, courseId, season - 1);
    const last = before[before.length - 1]!;
    prev = { wet: last.sky === "rain", moisture: last.moisture };
  } else prev = { wet: false, moisture: climate.startMoisture };
  const rng = new Rng(seedFrom("climate", courseId, season));
  const firstDay = Math.floor((clock.epochMs + (season - 1) * SEASON_DAYS * MS_PER_DAY) / MS_PER_DAY);
  const out: CourseDay[] = [];
  for (let i = 0; i < SEASON_DAYS; i++) {
    const draws = [rng.int(1000), rng.int(1000), rng.int(1000), rng.int(1000)];
    const s = step(course, climate, prev, draws);
    out.push({ courseId, day: firstDay + i, season, yearSeason, ...s });
    prev = { wet: s.sky === "rain", moisture: s.moisture };
  }
  if (seasonCache.size >= CACHE_MAX) seasonCache.clear();
  seasonCache.set(key, out);
  return out;
}

/** Drops the memoised seasons (tests use it to prove a cold computation gives the same days). */
export function clearClimateCache(): void {
  seasonCache.clear();
}

/**
 * The weather and ground at a course on a UTC day. Computing the first day of a later season
 * walks every season since launch once per course (a few hundred days; memoised after that).
 */
export function courseDay(clock: SeasonClock, courseId: CourseId, day: number): CourseDay {
  const season = climateSeasonOfDay(clock, day);
  if (season < 1) {
    // before launch: a free-standing season, walked from its own start
    const days = seasonDays(clock, courseId, season);
    return days[day - days[0]!.day]!;
  }
  // walk up from the newest cached season so a cold start doesn't recurse deeply
  for (let s = 1; s < season; s += 8) seasonDays(clock, courseId, s);
  const days = seasonDays(clock, courseId, season);
  return days[day - days[0]!.day]!;
}

/** UTC day index of a time. */
export const utcDayOf = (ms: number): number => Math.floor(ms / MS_PER_DAY);

/** Turf at this course is abandoned for frost on the day of `postTimeMs`. */
export function turfAbandoned(clock: SeasonClock, courseId: CourseId, postTimeMs: number): boolean {
  return courseDay(clock, courseId, utcDayOf(postTimeMs)).frost;
}

/**
 * From this UTC hour a clear day's races look like dusk (lighting only; the ground is dry),
 * by time of year: the evening meeting (19:00 UTC) runs at dusk in autumn and winter, and
 * its last races in spring. Summer evenings stay light.
 */
export const DUSK_FROM_HOUR_UTC: Record<YearSeason, number | null> = { spring: 20, summer: null, autumn: 17, winter: 16 };

export interface RaceGround {
  going: Going;
  weather: Weather;
  /** Moisture trend into race day: see `groundTrend`. */
  trend: GroundTrend;
}

/** The going and weather of a race at a course on a surface at `postTimeMs`. */
export function raceGround(clock: SeasonClock, courseId: CourseId, surface: Surface, postTimeMs: number): RaceGround {
  const d = courseDay(clock, courseId, utcDayOf(postTimeMs));
  const hour = Math.floor((postTimeMs - utcDayOf(postTimeMs) * MS_PER_DAY) / MS_PER_HOUR);
  const dusk = DUSK_FROM_HOUR_UTC[d.yearSeason];
  const weather: Weather = d.sky === "clear" && dusk !== null && hour >= dusk ? "dusk" : d.sky;
  return { going: goingFor(surface, d.moisture, d.sky === "rain"), weather, trend: groundTrend(clock, courseId, d.day) };
}

// ---------------------------------------------------------------------------
// Trend and forecast
// ---------------------------------------------------------------------------

export type GroundTrend = "drying" | "softening" | "steady";

/** Moisture change from the day before that counts as drying or softening. */
export const TREND_STEP = 50;

/** Ground trend into a day at a course, from the day before (on the racecard: "soft, drying"). */
export function groundTrend(clock: SeasonClock, courseId: CourseId, day: number): GroundTrend {
  const today = courseDay(clock, courseId, day).moisture;
  const before = courseDay(clock, courseId, day - 1).moisture;
  return today - before >= TREND_STEP ? "softening" : before - today >= TREND_STEP ? "drying" : "steady";
}

/** Days of outlook after the exact (published) days. */
export const OUTLOOK_DAYS = 4;

/** A day the card has published: the real conditions. */
export interface ForecastDay {
  day: number;
  dayStartMs: number;
  yearSeason: YearSeason;
  sky: Sky;
  /** Going on each surface the course races (turf missing on a frost day). */
  going: Partial<Record<Surface, Going>>;
  frost: boolean;
  trend: GroundTrend;
}

/** A day beyond the published card: a forecast from the last published day, not the answer. */
export interface OutlookDay {
  day: number;
  dayStartMs: number;
  yearSeason: YearSeason;
  /** Chance of rain, percent. */
  rainChancePct: number;
  /** Chance of frost stopping the turf, percent (0 outside winter). */
  frostChancePct: number;
  /** Most likely going on each surface the course races. */
  likelyGoing: Partial<Record<Surface, Going>>;
}

export interface CourseForecast {
  courseId: CourseId;
  name: string;
  surfaces: readonly Surface[];
  days: ForecastDay[];
  outlook: OutlookDay[];
}

/** The last UTC day with a published race: its first meeting starts inside the card horizon. */
export function lastPublishedDay(clock: SeasonClock, nowMs: number, horizonMs = CARD_HORIZON_MS): number {
  const edge = nowMs + horizonMs;
  let day = utcDayOf(edge);
  if (day * MS_PER_DAY + meetingStartsOn(clock, day * MS_PER_DAY)[0]! > edge) day--;
  return day;
}

function forecastDay(clock: SeasonClock, course: Course, day: number): ForecastDay {
  const d = courseDay(clock, course.id, day);
  const going: Partial<Record<Surface, Going>> = {};
  for (const s of course.surfaces) if (!(s === "turf" && d.frost)) going[s] = goingFor(s, d.moisture, d.sky === "rain");
  return { day, dayStartMs: day * MS_PER_DAY, yearSeason: d.yearSeason, sky: d.sky, going, frost: d.frost, trend: groundTrend(clock, course.id, day) };
}

/**
 * Ground and weather per course: the exact conditions from today to the last day the card has
 * published (`horizonMs`, the card's 24 h), then an `OUTLOOK_DAYS` outlook. The outlook is an
 * honest forecast: it propagates the chance of rain and the expected moisture forward from the
 * last published day with the same climate odds, and never reads the real future days.
 */
export function forecast(clock: SeasonClock, nowMs: number, horizonMs = CARD_HORIZON_MS): CourseForecast[] {
  const today = utcDayOf(nowMs);
  const last = Math.max(today, lastPublishedDay(clock, nowMs, horizonMs));
  return COURSES.map((course) => {
    const days: ForecastDay[] = [];
    for (let d = today; d <= last; d++) days.push(forecastDay(clock, course, d));
    const base = courseDay(clock, course.id, last);
    let pWet = base.sky === "rain" ? 1000 : 0; // permille
    let moisture = base.moisture;
    const outlook: OutlookDay[] = [];
    for (let k = 1; k <= OUTLOOK_DAYS; k++) {
      const day = last + k;
      const yearSeason = yearSeasonOf(climateSeasonOfDay(clock, day));
      const c = SEASON_CLIMATE[yearSeason];
      pWet = Math.floor((pWet * rainChance(course, c, true) + (1000 - pWet) * rainChance(course, c, false)) / 1000);
      const pDry = 1000 - pWet;
      const pClear = Math.floor((pDry * (1000 - c.overcastChance)) / 1000);
      const pOvercast = pDry - pClear;
      // expected drying share over the dry outcomes, then expected rain added
      const dry = Math.floor((pClear * dryingPermille(course, c, "clear") + pOvercast * dryingPermille(course, c, "overcast")) / 1000);
      moisture = moisture - Math.floor((moisture * dry) / 1000) + Math.floor((pWet * (c.rainfall + Math.floor(c.rainfallSpread / 2))) / 1000);
      moisture = Math.max(0, Math.min(1000, moisture));
      const likelyGoing: Partial<Record<Surface, Going>> = {};
      for (const s of course.surfaces) likelyGoing[s] = goingFor(s, moisture, pWet >= 500);
      outlook.push({
        day,
        dayStartMs: day * MS_PER_DAY,
        yearSeason,
        rainChancePct: Math.floor((pWet + 5) / 10),
        frostChancePct: Math.floor((Math.floor((pClear * c.frostChance) / 1000) + 5) / 10),
        likelyGoing,
      });
    }
    return { courseId: course.id, name: course.name, surfaces: course.surfaces, days, outlook };
  });
}

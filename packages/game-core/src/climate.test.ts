import { describe, expect, it } from "vitest";
import {
  OUTLOOK_DAYS,
  SEASON_CLIMATE,
  TURF_GOING_BANDS,
  YEAR_SEASONS,
  clearClimateCache,
  climateSeasonOfDay,
  courseDay,
  dryingPermille,
  forecast,
  goingFor,
  groundTrend,
  lastPublishedDay,
  rainChance,
  raceGround,
  turfAbandoned,
  yearSeasonOf,
  type CourseDay,
  type YearSeason,
} from "./climate";
import { COURSES, courseById, type Course } from "./courses";
import { MS_PER_DAY, MS_PER_HOUR } from "./time";

const EPOCH = Date.UTC(2026, 0, 5); // packages/db RULES.seasonEpochMs (season 1 starts on a Monday)
const clock = { epochMs: EPOCH };
const FIRST = EPOCH / MS_PER_DAY;
/** Four years of 16 weeks: every time of year 4 times. */
const DAYS = 28 * 4 * 4;

function allDays(): CourseDay[] {
  const out: CourseDay[] = [];
  for (const c of COURSES) for (let d = FIRST; d < FIRST + DAYS; d++) out.push(courseDay(clock, c.id, d));
  return out;
}

const share = (xs: CourseDay[], f: (d: CourseDay) => boolean) => xs.filter(f).length / xs.length;
const turf = (d: CourseDay) => goingFor("turf", d.moisture, d.sky === "rain");

describe("time of year", () => {
  it("rotates with the racing season; season 11 (Oct-Nov 2026) is autumn", () => {
    expect([11, 12, 13, 14, 15].map(yearSeasonOf)).toEqual(["autumn", "winter", "spring", "summer", "autumn"]);
    expect(yearSeasonOf(1)).toBe("spring");
    expect(yearSeasonOf(-2)).toBe(yearSeasonOf(2));
    expect(climateSeasonOfDay(clock, Date.UTC(2026, 9, 30) / MS_PER_DAY)).toBe(11);
    expect(climateSeasonOfDay(clock, FIRST)).toBe(1);
    expect(climateSeasonOfDay(clock, FIRST - 1)).toBe(0);
  });
});

describe("climate model", () => {
  const days = allDays();
  const by = (s: YearSeason) => days.filter((d) => d.yearSeason === s);

  it("is deterministic: a cold recomputation gives the same days", () => {
    const sample = [FIRST + 3, FIRST + 200, FIRST + 301, FIRST + DAYS - 1];
    const before = COURSES.flatMap((c) => sample.map((d) => courseDay(clock, c.id, d)));
    clearClimateCache();
    // compute the latest first this time (a cold start far from launch)
    const after = COURSES.flatMap((c) => [...sample].reverse().map((d) => courseDay(clock, c.id, d))).reverse();
    expect(after.map((d) => JSON.stringify(d)).sort()).toEqual(before.map((d) => JSON.stringify(d)).sort());
  });

  it("the ground follows from the day before, across season boundaries too", () => {
    for (const c of COURSES) {
      for (let d = FIRST + 1; d < FIRST + DAYS; d++) {
        const prev = courseDay(clock, c.id, d - 1);
        const today = courseDay(clock, c.id, d);
        if (today.sky === "rain") expect(today.moisture).toBeGreaterThanOrEqual(prev.moisture);
        else expect(today.moisture).toBeLessThanOrEqual(prev.moisture);
        expect(today.moisture).toBeGreaterThanOrEqual(0);
        expect(today.moisture).toBeLessThanOrEqual(1000);
      }
    }
  });

  it("seasons differ the expected way: summer firm, autumn and winter soft and heavy", () => {
    const firm = (s: YearSeason) => share(by(s), (d) => turf(d) === "firm");
    const heavy = (s: YearSeason) => share(by(s), (d) => turf(d) === "heavy");
    const wet = (s: YearSeason) => share(by(s), (d) => d.sky === "rain");
    expect(firm("summer")).toBeGreaterThan(0.45);
    expect(firm("summer")).toBeGreaterThan(firm("spring") + 0.2);
    expect(firm("spring")).toBeGreaterThan(firm("winter"));
    expect(firm("summer")).toBeGreaterThan(firm("autumn") * 2);
    expect(share(by("summer"), (d) => turf(d) === "firm" || turf(d) === "good")).toBeGreaterThan(0.8);
    expect(share(by("spring"), (d) => turf(d) === "good" || turf(d) === "soft")).toBeGreaterThan(0.5);
    expect(share(by("autumn"), (d) => turf(d) === "soft" || turf(d) === "heavy")).toBeGreaterThan(0.5);
    expect(heavy("winter")).toBeGreaterThan(0.5);
    expect(heavy("winter")).toBeGreaterThan(heavy("autumn"));
    expect(heavy("autumn")).toBeGreaterThan(heavy("summer") * 4);
    expect(wet("summer")).toBeLessThan(0.2);
    expect(wet("autumn")).toBeGreaterThan(wet("summer") * 2);
  });

  it("wet and dry spells persist (a Markov chain, not independent days)", () => {
    for (const s of YEAR_SEASONS) {
      const xs = by(s);
      let wetAfterWet = 0;
      let afterWet = 0;
      let wetAfterDry = 0;
      let afterDry = 0;
      for (let i = 1; i < xs.length; i++) {
        if (xs[i]!.courseId !== xs[i - 1]!.courseId || xs[i]!.day !== xs[i - 1]!.day + 1) continue;
        if (xs[i - 1]!.sky === "rain") {
          afterWet++;
          if (xs[i]!.sky === "rain") wetAfterWet++;
        } else {
          afterDry++;
          if (xs[i]!.sky === "rain") wetAfterDry++;
        }
      }
      expect(wetAfterWet / afterWet).toBeGreaterThan(wetAfterDry / afterDry + 0.15);
    }
  });

  it("weather and going are always consistent: never rain on firm, on any surface", () => {
    for (const d of days) {
      for (const s of ["turf", "dirt", "synthetic"] as const) {
        const g = goingFor(s, d.moisture, d.sky === "rain");
        if (d.sky === "rain") expect(g).not.toBe("firm");
        if (s === "synthetic") expect(g).toBe("good");
        if (s === "dirt") expect(["good", "heavy"]).toContain(g);
      }
    }
    for (const c of COURSES) {
      for (let d = FIRST; d < FIRST + 120; d++) {
        for (const hour of [7, 13, 19, 20]) {
          for (const s of c.surfaces) {
            const r = raceGround(clock, c.id, s, d * MS_PER_DAY + hour * MS_PER_HOUR);
            if (r.weather === "rain") expect(r.going).not.toBe("firm");
            const day = courseDay(clock, c.id, d);
            expect(r.weather === "dusk" ? "clear" : r.weather).toBe(day.sky);
          }
        }
      }
    }
  });

  it("turf going bands: firm, good, soft, heavy as the ground gets wetter", () => {
    const [f, g, s] = TURF_GOING_BANDS;
    expect([0, f - 1, f, g - 1, g, s - 1, s, 1000].map((m) => goingFor("turf", m))).toEqual(["firm", "firm", "good", "good", "soft", "soft", "heavy", "heavy"]);
    expect(goingFor("turf", 0, true)).toBe("good");
  });

  it("drainage dries faster; rainBias brings more rain", () => {
    const c = SEASON_CLIMATE.autumn;
    const base = courseById("ashcombe");
    const mk = (o: Partial<Course>): Course => ({ ...base, ...o });
    expect(dryingPermille(mk({ drainage: 900 }), c, "clear")).toBeGreaterThan(dryingPermille(mk({ drainage: 300 }), c, "clear"));
    expect(dryingPermille(base, c, "overcast")).toBeLessThan(dryingPermille(base, c, "clear"));
    expect(dryingPermille(base, c, "rain")).toBe(0);
    expect(rainChance(mk({ rainBias: 1300 }), c, false)).toBeGreaterThan(rainChance(mk({ rainBias: 900 }), c, false));
    expect(rainChance(mk({ rainBias: 1300 }), c, true)).toBeGreaterThan(rainChance(mk({ rainBias: 900 }), c, true));
    // over the years: the rainiest course has the most wet days, the fast-draining dry ones
    // ride quicker than the clay moor
    const of = (id: string) => days.filter((d) => d.courseId === id);
    const mean = (xs: CourseDay[]) => xs.reduce((a, d) => a + d.moisture, 0) / xs.length;
    expect(share(of("saltmarsh"), (d) => d.sky === "rain")).toBeGreaterThan(share(of("bellmont"), (d) => d.sky === "rain"));
    expect(mean(of("kestrel_downs"))).toBeLessThan(mean(of("harrowgate")));
    expect(mean(of("bellmont"))).toBeLessThan(mean(of("ashcombe")));
  });

  it("frost: winter only, on clear days, and it only stops the turf", () => {
    const frosty = days.filter((d) => d.frost);
    expect(frosty.length).toBeGreaterThan(0);
    for (const d of frosty) {
      expect(d.yearSeason).toBe("winter");
      expect(d.sky).toBe("clear");
    }
    const winter = by("winter");
    expect(frosty.length / winter.length).toBeGreaterThan(0.03);
    expect(frosty.length / winter.length).toBeLessThan(0.2);
    const d = frosty[0]!;
    const at = d.day * MS_PER_DAY + 13 * MS_PER_HOUR;
    expect(turfAbandoned(clock, d.courseId, at)).toBe(true);
    expect(turfAbandoned(clock, d.courseId, at + MS_PER_DAY)).toBe(courseDay(clock, d.courseId, d.day + 1).frost);
    // the forecast shows no turf going that day; the other surfaces still race
    const f = forecast(clock, at - 12 * MS_PER_HOUR).find((x) => x.courseId === d.courseId)!;
    const fd = f.days.find((x) => x.day === d.day)!;
    expect(fd.frost).toBe(true);
    expect(fd.going.turf).toBeUndefined();
    for (const s of courseById(d.courseId).surfaces.filter((s) => s !== "turf")) expect(fd.going[s]).toBeDefined();
  });

  it("dusk is a lighting look on clear evenings in autumn and winter, never in summer", () => {
    const evening = (s: YearSeason) => {
      const xs = by(s).filter((d) => d.sky === "clear");
      return xs.map((d) => raceGround(clock, d.courseId, "turf", d.day * MS_PER_DAY + 19 * MS_PER_HOUR).weather);
    };
    expect(new Set(evening("winter"))).toEqual(new Set(["dusk"]));
    expect(new Set(evening("summer"))).toEqual(new Set(["clear"]));
    const morning = by("winter").filter((d) => d.sky === "clear").map((d) => raceGround(clock, d.courseId, "turf", d.day * MS_PER_DAY + 7 * MS_PER_HOUR).weather);
    expect(new Set(morning)).toEqual(new Set(["clear"]));
  });

  it("trend words follow the moisture change from the day before", () => {
    for (const c of COURSES) {
      for (let d = FIRST + 1; d < FIRST + 200; d++) {
        const t = groundTrend(clock, c.id, d);
        const delta = courseDay(clock, c.id, d).moisture - courseDay(clock, c.id, d - 1).moisture;
        expect(t).toBe(delta >= 50 ? "softening" : delta <= -50 ? "drying" : "steady");
      }
    }
  });
});

describe("forecast", () => {
  it("published days are exact; the next four are an outlook", () => {
    const now = Date.UTC(2026, 9, 30, 10, 0); // after the first meeting: tomorrow is published too
    const fc = forecast(clock, now);
    expect(fc.map((c) => c.courseId)).toEqual(COURSES.map((c) => c.id));
    const today = Math.floor(now / MS_PER_DAY);
    for (const c of fc) {
      expect(c.days.map((d) => d.day)).toEqual([today, today + 1]);
      for (const d of c.days) {
        const cd = courseDay(clock, c.courseId, d.day);
        expect(d.sky).toBe(cd.sky);
        expect(d.frost).toBe(cd.frost);
        for (const s of c.surfaces) {
          if (s === "turf" && cd.frost) continue;
          expect(d.going[s]).toBe(raceGround(clock, c.courseId, s, d.dayStartMs + 13 * MS_PER_HOUR).going);
        }
      }
      expect(c.outlook.map((o) => o.day)).toEqual([today + 2, today + 3, today + 4, today + 5]);
      expect(c.outlook).toHaveLength(OUTLOOK_DAYS);
      for (const o of c.outlook) {
        expect(o.rainChancePct).toBeGreaterThanOrEqual(0);
        expect(o.rainChancePct).toBeLessThanOrEqual(100);
        for (const s of c.surfaces) expect(o.likelyGoing[s]).toBeDefined();
        if (o.yearSeason !== "winter") expect(o.frostChancePct).toBe(0);
      }
      // the first outlook day's rain chance is the chain's own odds from the last published day
      const last = courseDay(clock, c.courseId, today + 1);
      const course = courseById(c.courseId);
      expect(c.outlook[0]!.rainChancePct).toBe(Math.floor((rainChance(course, SEASON_CLIMATE[c.outlook[0]!.yearSeason], last.sky === "rain") + 5) / 10));
    }
  });

  it("the outlook never reads the real future: it depends only on the last published day", () => {
    // Recompute the outlook from the last published day's state alone and compare.
    const now = Date.UTC(2026, 10, 3, 16, 0);
    const fc = forecast(clock, now);
    const again = forecast(clock, now);
    expect(again).toEqual(fc);
    // A course whose last published day matches another time's state gives the same outlook
    // shape: here, two days with identical state at one course yield identical outlooks.
    const seen = new Map<string, string>();
    let matched = 0;
    for (let d = FIRST + 30; d < FIRST + 400 && matched < 3; d++) {
      const at = d * MS_PER_DAY + 10 * MS_PER_HOUR;
      const f = forecast(clock, at)[0]!;
      const last = courseDay(clock, f.courseId, f.days.at(-1)!.day);
      const key = `${last.sky === "rain"}:${last.moisture}:${f.outlook.map((o) => o.yearSeason).join()}`;
      const shape = JSON.stringify(f.outlook.map(({ day: _d, dayStartMs: _s, ...o }) => o));
      if (seen.has(key)) {
        expect(shape).toBe(seen.get(key));
        matched++;
      } else seen.set(key, shape);
    }
  });

  it("only the days the card has published are exact", () => {
    const d = Date.UTC(2026, 9, 30) / MS_PER_DAY;
    // 03:00: the card reaches 03:00 tomorrow, before tomorrow's first meeting
    expect(lastPublishedDay(clock, d * MS_PER_DAY + 3 * MS_PER_HOUR)).toBe(d);
    // 07:00 on the dot: tomorrow's 07:00 race is published
    expect(lastPublishedDay(clock, d * MS_PER_DAY + 7 * MS_PER_HOUR)).toBe(d + 1);
    expect(forecast(clock, d * MS_PER_DAY + 3 * MS_PER_HOUR)[0]!.days).toHaveLength(1);
  });
});

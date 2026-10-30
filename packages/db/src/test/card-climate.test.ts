/**
 * The Live card follows the climate model (game-core climate.ts): every race runs at a course
 * that races its surface that day, with that course's going and weather on the race day, so
 * the card is consistent (no rain on firm ground) and changes with the time of year. Sisters
 * stay on courses that race the surface.
 */
import { describe, expect, it } from "vitest";
import { gc } from "../gameCore";
import { RULES } from "../rules";
import { cardSlotAt, coursesRacing, placeRace, sisterCourse, slotIndexAt, slotPostTime } from "../services/card";

const clock = { epochMs: RULES.seasonEpochMs };
/** Season 11 (autumn) starts 12 Oct 2026; a 16-week year from there covers every time of year. */
const FROM = slotIndexAt(new Date(Date.UTC(2026, 9, 12)));
const SLOTS = gc.SLOTS_PER_DAY * 7 * 16;

const card = Array.from({ length: SLOTS }, (_, i) => FROM + i)
  .map((i) => ({ i, slot: cardSlotAt(i) }))
  .filter((x): x is { i: number; slot: NonNullable<ReturnType<typeof cardSlotAt>> } => x.slot !== null);

describe("the Live card follows the climate", () => {
  it("course, surface, going and weather always agree, calendar races included", () => {
    expect(card.length).toBeGreaterThan(gc.LIVE_RACES_PER_DAY * 7 * 16 - 10);
    let calendar = 0;
    for (const { slot } of card) {
      const c = slot.conditions as { track: string; surface: "turf" | "dirt" | "synthetic"; going: string; weather: string; calendar?: unknown };
      const course = gc.courseByName(c.track);
      expect(course, c.track).not.toBeNull();
      expect(course!.surfaces).toContain(c.surface);
      const ground = gc.raceGround(clock, course!.id, c.surface, slot.postTime.getTime());
      expect([c.going, c.weather]).toEqual([ground.going, ground.weather]);
      if (c.weather === "rain") expect(c.going).not.toBe("firm");
      if (c.surface === "turf") expect(gc.turfAbandoned(clock, course!.id, slot.postTime.getTime())).toBe(false);
      if (c.surface === "synthetic") expect(c.going).toBe("good");
      expect(slot.name.startsWith(`${c.track} `)).toBe(true);
      if (c.calendar) calendar++;
    }
    expect(calendar).toBeGreaterThan(16 * 5); // qualifiers, Weekend Features, Plates, Finals
  });

  it("the time of year shows: summer cards ride firmer than winter ones", () => {
    const turfBy = (s: gc.YearSeason) => card.filter(({ slot }) => slot.conditions.surface === "turf" && gc.yearSeasonOf(slot.seasonNumber!) === s).map(({ slot }) => slot.conditions.going);
    const share = (xs: unknown[], g: string) => xs.filter((x) => x === g).length / xs.length;
    expect(share(turfBy("summer"), "firm")).toBeGreaterThan(share(turfBy("winter"), "firm") + 0.2);
    expect(share(turfBy("winter"), "heavy")).toBeGreaterThan(share(turfBy("summer"), "heavy") + 0.2);
    const rain = (s: gc.YearSeason) => share(card.filter(({ slot }) => gc.yearSeasonOf(slot.seasonNumber!) === s).map(({ slot }) => slot.conditions.weather), "rain");
    expect(rain("autumn")).toBeGreaterThan(rain("summer"));
  });

  it("the card spreads races over every course", () => {
    const tracks = new Set(card.map(({ slot }) => slot.conditions.track));
    expect(tracks).toEqual(new Set(gc.COURSES.map((c) => c.name)));
  });

  it("frost moves a turf race to a course still racing, or to the all-weather when every turf is stopped", () => {
    // find a frost day at some course in the winter season (season 12)
    const winterDay = Math.floor(Date.UTC(2026, 10, 9) / gc.MS_PER_DAY);
    let found: { day: number; course: gc.Course } | null = null;
    for (let d = winterDay; d < winterDay + 28 && !found; d++) {
      for (const course of gc.COURSES) if (gc.courseDay(clock, course.id, d).frost) found = { day: d, course };
    }
    expect(found).not.toBeNull();
    const at = found!.day * gc.MS_PER_DAY + 13 * gc.MS_PER_HOUR;
    const racing = coursesRacing("turf", at);
    expect(racing.map((c) => c.id)).not.toContain(found!.course.id);
    for (let roll = 0; roll < 12; roll++) expect(placeRace("turf", at, roll).track).not.toBe(found!.course.name);
    // the preferred course is skipped when its turf is frozen
    expect(placeRace("turf", at, 0, found!.course.name).track).not.toBe(found!.course.name);
    // dirt and synthetic at that course still race
    expect(coursesRacing("dirt", at).length + coursesRacing("synthetic", at).length).toBeGreaterThan(0);
  });
});

describe("sister courses on the climate", () => {
  const post = slotPostTime(FROM + 7 * 4 + 60); // a race time in autumn
  const race = (surface: string, track: string, going?: string) => ({ postTime: post, conditions: { surface, track, ...(going ? { going } : {}) } });

  it("only courses that race the surface; a further division once they are all used", () => {
    // synthetic races at Kestrel Downs and Bellmont only
    const orig = race("synthetic", "Bellmont", "good");
    expect(sisterCourse(orig, ["Bellmont"])).toEqual({ track: "Kestrel Downs", division: 1 });
    // both used: second divisions, in the same rotation
    expect(sisterCourse(orig, ["Bellmont", "Kestrel Downs"])).toEqual({ track: "Kestrel Downs", division: 2 });
    expect(sisterCourse(orig, ["Bellmont", "Kestrel Downs", "Kestrel Downs"])).toEqual({ track: "Bellmont", division: 2 });
    // dirt: four courses, never Saltmarsh or Kestrel Downs
    const dirt = race("dirt", "Ashcombe");
    const tracks = ["Ashcombe"];
    for (let k = 0; k < 5; k++) tracks.push(sisterCourse(dirt, tracks)!.track);
    expect(tracks.slice(0, 4).sort()).toEqual(["Ashcombe", "Bellmont", "Harrowgate", "Larkspur"]);
    expect(tracks).not.toContain("Saltmarsh");
    expect(tracks).not.toContain("Kestrel Downs");
  });

  it("prefers a course whose own going that day is the race's", () => {
    const at = post.getTime();
    const goingAt = (name: string) => gc.raceGround(clock, gc.courseByName(name)!.id, "turf", at).going;
    const orig = race("turf", "Ashcombe", goingAt("Ashcombe"));
    const pick = sisterCourse(orig, ["Ashcombe"])!;
    const anySame = coursesRacing("turf", at).some((c) => c.name !== "Ashcombe" && goingAt(c.name) === goingAt("Ashcombe"));
    if (anySame) expect(goingAt(pick.track)).toBe(goingAt("Ashcombe"));
    expect(pick.division).toBe(1);
  });

  it("a race without a surface (old rows) keeps the old rotation", () => {
    expect(sisterCourse({ postTime: post, conditions: { track: "Ashcombe" } }, ["Ashcombe"])).toEqual({ track: "Kestrel Downs", division: 1 });
  });
});

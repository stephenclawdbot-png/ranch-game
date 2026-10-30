import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RaceReplaySchema, type RaceCourse, type RaceInput, type RaceReplay } from "@thoroughbred/shared";
import { ENGINE_VERSION, KIT_ENGINE_VERSION, LEGACY_ENGINE_VERSION, bendGeometry, courseLayout, engineVersionFor, simulateRace, verifyReplay } from "./index";
import { hillDrainFor } from "./course";
import { checkFrames, makeInput, seedFor, typicalField, type EntryOpts } from "./test-fixtures";

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** A neutral course: sweeping bends, the reference straight, flat. Each test changes one thing. */
const NEUTRAL: RaceCourse = { id: "probe", direction: "left", circumferenceM: 2400, homeStraightM: 500, bendsPerLap: 2, bendTightness: 0, finishGradientPermille: 0 };
const KESTREL: RaceCourse = { id: "kestrel_downs", direction: "left", circumferenceM: 1800, homeStraightM: 280, bendsPerLap: 3, bendTightness: 900, finishGradientPermille: 0 };

function withCourse(input: RaceInput, course: RaceCourse | undefined): RaceInput {
  const out = clone(input);
  if (course) out.course = course;
  else delete out.course;
  return out;
}

/** Mean finishing position (1 = won) of each entry index over many seeds, on a course. */
function meanPlaces(entries: EntryOpts[], course: RaceCourse, seeds: number, distanceM = 1600): number[] {
  const sum = entries.map(() => 0);
  for (let s = 0; s < seeds; s++) {
    const input = makeInput(entries, { distanceM, seed: seedFor(5000 + s) });
    const r = simulateRace({ ...input, course });
    const pos = new Map(r.result.finishOrder.map((f) => [f.horseId, f.position]));
    entries.forEach((_, i) => (sum[i]! += pos.get(`h${i + 1}`)!));
  }
  return sum.map((x) => x / seeds);
}

describe("course layout", () => {
  it("lays bends out back from the post: home straight, bend, straight, bend ... per lap", () => {
    // Kestrel: a 1800 m triangle, 280 m straights, three 320 m bends.
    expect(bendGeometry(KESTREL)).toEqual({ homeM: 280, bendM: 320, straightM: 280 });
    const l = courseLayout(KESTREL, 1600);
    expect(l.straightFromMm).toBe(1_320_000);
    expect(l.bends.map((b) => [b.fromMm / 1000, b.toMm / 1000])).toEqual([
      [0, 120],
      [400, 720],
      [1000, 1320],
    ]);
    // A race no longer than the home straight runs no bend.
    expect(courseLayout({ ...NEUTRAL, homeStraightM: 1000 }, 800).bends).toEqual([]);
  });

  it("ground lost per lane per bend depends on tightness and the bend's share of the lap, not its length", () => {
    const oval = courseLayout({ ...NEUTRAL, bendTightness: 500 }, 2400).bends[0]!;
    const bigOval = courseLayout({ ...NEUTRAL, circumferenceM: 3200, bendTightness: 500 }, 2400).bends[0]!;
    expect(bigOval.lengthMm).toBeGreaterThan(oval.lengthMm);
    expect(bigOval.lossPerLaneMm).toBe(oval.lossPerLaneMm);
    // Tightness counts squared: twice as tight loses four times the ground.
    expect(courseLayout({ ...NEUTRAL, bendTightness: 1000 }, 2400).bends[0]!.lossPerLaneMm).toBe(4 * oval.lossPerLaneMm);
    expect(courseLayout(NEUTRAL, 2400).bends[0]!.lossPerLaneMm).toBe(0);
    // A triangle's bends each turn 120 degrees, an oval's 180.
    const tri = courseLayout({ ...NEUTRAL, bendsPerLap: 3, bendTightness: 600 }, 2400).bends[0]!;
    const oval600 = courseLayout({ ...NEUTRAL, bendTightness: 600 }, 2400).bends[0]!;
    expect(tri.lossPerLaneMm * 3).toBe(oval600.lossPerLaneMm * 2);
  });

  it("an uphill finish costs a short-of-stamina horse more than a stayer; downhill saves", () => {
    const up = courseLayout({ ...NEUTRAL, finishGradientPermille: 30 }, 1600);
    expect(hillDrainFor(up, 650)).toBe(up.gradientDrain);
    expect(hillDrainFor(up, 500)).toBeGreaterThan(hillDrainFor(up, 650));
    expect(hillDrainFor(up, 800)).toBeLessThan(hillDrainFor(up, 650));
    expect(hillDrainFor(up, 800)).toBeGreaterThan(0);
    const down = courseLayout({ ...NEUTRAL, finishGradientPermille: -6 }, 1600);
    expect(hillDrainFor(down, 650)).toBeLessThan(0);
    expect(hillDrainFor(courseLayout(NEUTRAL, 1600), 500)).toBe(0);
  });
});

describe("course profile (engine 1.3.0)", () => {
  const base = makeInput(
    [{ stats: 700, style: "front" }, { stats: 660 }, { stats: 640, style: "closer" }, { stats: { speed: 720, stamina: 560 } }, { stats: { stamina: 780 }, style: "closer" }, { stats: 650, style: "front" }, { stats: 670 }, { stats: 630 }],
    { distanceM: 1600, seed: seedFor(3131) },
  );

  it("labels the race 1.3.0 (kit or not) and leaves course-less races on their old versions", () => {
    expect(ENGINE_VERSION).toBe("1.3.0");
    expect(engineVersionFor(base.entries)).toBe(LEGACY_ENGINE_VERSION);
    expect(engineVersionFor(base.entries, KESTREL)).toBe(ENGINE_VERSION);
    const kitted = clone(base);
    kitted.entries[0]!.kit = { formAmpPermille: 800 };
    expect(engineVersionFor(kitted.entries)).toBe(KIT_ENGINE_VERSION);
    expect(engineVersionFor(kitted.entries, KESTREL)).toBe(ENGINE_VERSION);
    expect(simulateRace(withCourse(kitted, KESTREL)).engineVersion).toBe(ENGINE_VERSION);
  });

  it("is deterministic, entry-order independent and verifiable", () => {
    const input = withCourse(base, KESTREL);
    const a = simulateRace(input);
    expect(simulateRace(clone(input))).toEqual(a);
    const shuffled = clone(input);
    shuffled.entries.reverse();
    expect(simulateRace(shuffled)).toEqual(a);
    expect(verifyReplay(input, a)).toBe(true);
  });

  it("seals the course in the result: another course, or none, fails verification", () => {
    const input = withCourse(base, KESTREL);
    const r = simulateRace(input);
    expect(verifyReplay(withCourse(base, undefined), r)).toBe(false);
    expect(verifyReplay(withCourse(base, { ...KESTREL, bendTightness: 899 }), r)).toBe(false);
    // Same shape, different name: the race runs identically, but the proof names its course.
    const renamed = withCourse(base, { ...KESTREL, id: "harrowgate" });
    const r2 = simulateRace(renamed);
    expect(r2.frames).toEqual(r.frames);
    expect(r2.result.resultHash).not.toBe(r.result.resultHash);
    expect(verifyReplay(renamed, r)).toBe(false);
    // A course-less replay doesn't verify against a course input either.
    expect(verifyReplay(input, simulateRace(base))).toBe(false);
  });

  it("direction is cosmetic: the race runs the same either way round (only the sealed proof differs)", () => {
    const left = simulateRace(withCourse(base, KESTREL));
    const right = simulateRace(withCourse(base, { ...KESTREL, direction: "right" }));
    expect(right.frames).toEqual(left.frames);
    expect(right.events).toEqual(left.events);
    expect(right.result.finishOrder).toEqual(left.result.finishOrder);
    expect(right.result.resultHash).not.toBe(left.result.resultHash);
  });

  it("a neutral course changes the race only through the sealed version", () => {
    const plain = simulateRace(base);
    const neutral = simulateRace(withCourse(base, NEUTRAL));
    expect(neutral.frames).toEqual(plain.frames);
    expect(neutral.result.finishOrder).toEqual(plain.result.finishOrder);
    expect(neutral.engineVersion).toBe(ENGINE_VERSION);
  });

  it("extreme courses within the schema still run valid, verifiable races", () => {
    const extremes: RaceCourse[] = [
      { id: "steep-down", direction: "right", circumferenceM: 5000, homeStraightM: 1500, bendsPerLap: 1, bendTightness: 1000, finishGradientPermille: -50 },
      { id: "steep-up", direction: "left", circumferenceM: 1000, homeStraightM: 150, bendsPerLap: 4, bendTightness: 1000, finishGradientPermille: 50 },
    ];
    for (const course of extremes) {
      for (const d of [800, 2400, 4000]) {
        const input = withCourse(makeInput(typicalField(12, d), { distanceM: d, seed: seedFor(d) }), course);
        const r = simulateRace(input);
        RaceReplaySchema.parse(r);
        checkFrames(input, r);
        expect(verifyReplay(input, r)).toBe(true);
      }
    }
  });

  it("the schema refuses an out-of-range course", () => {
    expect(() => simulateRace(withCourse(base, { ...KESTREL, bendTightness: 1200 }))).toThrow();
    expect(() => simulateRace(withCourse(base, { ...KESTREL, bendsPerLap: 0 }))).toThrow();
    expect(() => simulateRace(withCourse(base, { ...KESTREL, finishGradientPermille: 80 }))).toThrow();
  });
});

describe("course effects in isolation (same fields, one thing changed)", () => {
  const SEEDS = 120;
  // Equal horses, natural styles front / stalker / closer round the gates.
  const even: EntryOpts[] = Array.from({ length: 9 }, (_, i) => ({ stats: 650, style: (["front", "stalker", "closer"] as const)[i % 3] }));
  const styleMean = (places: number[], style: string) => {
    const idx = even.map((e, i) => (e.style === style ? i : -1)).filter((i) => i >= 0);
    return idx.reduce((s, i) => s + places[i]!, 0) / idx.length;
  };

  it("tight bends favour front-runners and low draws over closers and high draws", () => {
    const sweeping = meanPlaces(even, NEUTRAL, 240, 2000);
    const tight = meanPlaces(even, { ...NEUTRAL, bendTightness: 1000 }, 240, 2000);
    // Front-runners finish nearer the front, closers further back.
    expect(styleMean(tight, "front")).toBeLessThan(styleMean(sweeping, "front"));
    expect(styleMean(tight, "closer")).toBeGreaterThan(styleMean(sweeping, "closer"));
    // Low draws (gates 1-3) gain on high draws (7-9).
    const drawGap = (p: number[]) => (p[6]! + p[7]! + p[8]!) / 3 - (p[0]! + p[1]! + p[2]!) / 3;
    expect(drawGap(tight)).toBeGreaterThan(drawGap(sweeping));
  });

  it("a long home straight suits closers, a short one the handy horses", () => {
    const short = meanPlaces(even, { ...NEUTRAL, homeStraightM: 300 }, SEEDS);
    const long = meanPlaces(even, { ...NEUTRAL, homeStraightM: 800 }, SEEDS);
    expect(styleMean(long, "closer")).toBeLessThan(styleMean(short, "closer"));
    expect(styleMean(long, "front")).toBeGreaterThan(styleMean(short, "front"));
  });

  it("an uphill finish favours stayers; a downhill one the speedy horses", () => {
    const mixed: EntryOpts[] = Array.from({ length: 8 }, (_, i) => ({
      stats: i % 2 ? { speed: 700, stamina: 560 } : { speed: 620, stamina: 760 },
      style: (["front", "stalker", "closer", "stalker"] as const)[(i >> 1) % 4],
    }));
    const stayerMinusSpeedy = (p: number[]) => p.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / 4 - p.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / 4;
    const flat = stayerMinusSpeedy(meanPlaces(mixed, NEUTRAL, SEEDS));
    const up = stayerMinusSpeedy(meanPlaces(mixed, { ...NEUTRAL, finishGradientPermille: 30 }, SEEDS));
    const down = stayerMinusSpeedy(meanPlaces(mixed, { ...NEUTRAL, finishGradientPermille: -10 }, SEEDS));
    // Lower is better: stayers place better uphill, worse downhill.
    expect(up).toBeLessThan(flat);
    expect(down).toBeGreaterThan(flat);
  });

  it("an uphill finish is slower, a downhill one quicker", () => {
    let flat = 0;
    let up = 0;
    let down = 0;
    for (let s = 0; s < 30; s++) {
      const input = makeInput(even, { distanceM: 1600, seed: seedFor(7000 + s) });
      flat += simulateRace({ ...input, course: NEUTRAL }).result.winningTimeUs;
      up += simulateRace({ ...input, course: { ...NEUTRAL, finishGradientPermille: 30 } }).result.winningTimeUs;
      down += simulateRace({ ...input, course: { ...NEUTRAL, finishGradientPermille: -10 } }).result.winningTimeUs;
    }
    expect(up).toBeGreaterThan(flat);
    expect(down).toBeLessThan(flat);
  });

  it("a course tilts a race, it never decides it: the best horse still usually wins on every shape", () => {
    const courses: RaceCourse[] = [KESTREL, { ...NEUTRAL, homeStraightM: 800 }, { ...NEUTRAL, finishGradientPermille: 30, bendTightness: 400 }];
    const winsOf = (style: "front" | "closer", course?: RaceCourse) => {
      let wins = 0;
      for (let s = 0; s < 60; s++) {
        const field: EntryOpts[] = [{ stats: 760, style }, ...Array.from({ length: 7 }, (_, i) => ({ stats: 650, style: (["front", "stalker", "closer"] as const)[i % 3] }))];
        const r = simulateRace(withCourse(makeInput(field, { distanceM: 1600, seed: seedFor(8000 + s) }), course));
        if (r.result.finishOrder[0]!.horseId === "h1") wins++;
      }
      return wins;
    };
    for (const style of ["front", "closer"] as const) {
      const none = winsOf(style);
      for (const course of courses) {
        const wins = winsOf(style, course);
        // A horse 110 points better wins far more than its 1-in-8 share on any course, even the one
        // least suited to its style, and at least 60% as often as with no course at all.
        expect(wins, `${course.id} ${style}`).toBeGreaterThanOrEqual(20);
        expect(wins, `${course.id} ${style} vs ${none} with no course`).toBeGreaterThanOrEqual(Math.ceil(none * 0.6));
      }
    }
  });
});

describe("back-compat: races stored before course profiles existed", () => {
  const stored = JSON.parse(readFileSync(new URL("./fixtures/pre-1.3.0-races.json", import.meta.url), "utf8")) as {
    races: { input: RaceInput; replay: RaceReplay }[];
  };

  it("still verify, and re-simulate byte for byte under their own versions", () => {
    expect(stored.races.map((r) => r.replay.engineVersion)).toEqual([LEGACY_ENGINE_VERSION, KIT_ENGINE_VERSION]);
    for (const { input, replay } of stored.races) {
      expect(verifyReplay(input, replay)).toBe(true);
      expect(JSON.stringify(simulateRace(input))).toBe(JSON.stringify(replay));
    }
  });

  it("their proofs don't carry over to a course: adding one is a different race", () => {
    for (const { input, replay } of stored.races) expect(verifyReplay({ ...input, course: KESTREL }, replay)).toBe(false);
  });
});

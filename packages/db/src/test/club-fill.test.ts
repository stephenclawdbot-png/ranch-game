import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { sha256Hex } from "../crypto";
import { CLUB_MARK_KEY, clubRunnerSpec, gameCoreHooks, gc } from "../gameCore";
import { RULES } from "../rules";
import { economyConfig, horses, type HorseRow } from "../schema";
import { insertHorse } from "../services/accounts";
import { CLUB_CALIBRATION_MARKER, recalibrateClubRatings, sweepClubRatings, trueMarkOf } from "../services/clubFill";
import { clubWindowForRace, createRace, enterRace, getRaceForSimulation, type CreateRaceInput } from "../services/races";
import { at, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let n = 0;
function race(conditions: CreateRaceInput["conditions"], extra: Partial<CreateRaceInput> = {}) {
  n++;
  return createRace(h.db, {
    kind: "scheduled",
    name: `Club fill ${n}`,
    raceClass: "handicap",
    conditions,
    postTime: at(n * 60 * MIN + 10 * MIN),
    entriesCloseAt: at(n * 60 * MIN + 9 * MIN),
    purse: 1_000,
    maxRunners: 12,
    targetRunners: 8,
    seed: sha256Hex(`club-fill-seed-${n}`),
    ...extra,
  });
}

async function mintRow(spec: ReturnType<typeof clubRunnerSpec>): Promise<HorseRow> {
  const id = await insertHorse(h.db, { stableId: null, spec, origin: "house", now: T0 });
  return getHorseRow(h.db, id);
}

/** An old-style Club horse: an untrained racing-age mint stamped with a band rating. */
async function stampedClubHorse(i: number, rating: number): Promise<HorseRow> {
  const spec = gameCoreHooks.houseHorse!({ seed: "stamped", index: i, raceClass: "handicap", rating, season: 1 });
  return mintRow(spec);
}

describe("minted Club runners are honest", () => {
  it("the stored row's real ability mark is the target (several targets), and the rating is that mark", async () => {
    for (const target of [32, 45, 58, 68, 79, 90]) {
      const row = await mintRow(clubRunnerSpec({ seed: `mint-${target}`, index: 0, target, season: 12, distanceM: 1600, surface: "turf" }));
      const mark = trueMarkOf(row);
      expect(Math.abs(mark - target), `target ${target}`).toBeLessThanOrEqual(gc.CLUB_MARK_TOLERANCE);
      expect(row.rating).toBe(mark);
      expect((row.dynamics as Record<string, number>)[CLUB_MARK_KEY]).toBe(mark);
      // seasoned and fully trained, as the mark assumes
      expect(row.starts).toBe(gc.CLUB_SEASONED_STARTS[row.maturityType]);
      expect(row.wins).toBe(0);
      expect(row.fitness).toBe(gc.CLUB_FITNESS);
      expect(gc.preferredSurface(gc.upgradeGenome(row.genome)!)).toBe("turf");
    }
  });

  it("is deterministic from the seed", () => {
    const a = clubRunnerSpec({ seed: "det", index: 2, target: 70, season: 12, distanceM: 2000, surface: "dirt" });
    const b = clubRunnerSpec({ seed: "det", index: 2, target: 70, season: 12, distanceM: 2000, surface: "dirt" });
    expect(a).toEqual(b);
  });
});

describe("the Club's window per race", () => {
  it("banded races: the band's middle to its top; Listed and Group: floor to floor + span", async () => {
    expect(await clubWindowForRace(h.db, await race({ maxWins: 0, maxRating: 60 }), [])).toEqual({ lo: 30, hi: 60 });
    expect(await clubWindowForRace(h.db, await race({ minRating: 50, maxRating: 75 }), [])).toEqual({ lo: 63, hi: 75 });
    expect(await clubWindowForRace(h.db, await race({ minRating: 70, maxRating: 95 }), [])).toEqual({ lo: 83, hi: 95 });
    expect(await clubWindowForRace(h.db, await race({ minRating: 85 }, { raceClass: "listed" }), [])).toEqual({ lo: 85, hi: gc.CLUB_MARK_MAX });
  });

  it("open (calendar) races: the entered players' median band rating and above", async () => {
    const p = await newPlayer(h.db);
    const hs = [await makeHorse(h.db, p.stableId, { rating: 40 }), await makeHorse(h.db, p.stableId, { rating: 50 }), await makeHorse(h.db, p.stableId, { rating: 70 })];
    const bands = hs.map((x) => gc.bandCheck({ or: x.rating, peakOr: x.rating }, trueMarkOf(x)).rating).sort((a, b) => a - b);
    const r = await race({ calendar: { id: "fq-1", kind: "feature_qualifier" } }, { raceClass: "listed" });
    expect(await clubWindowForRace(h.db, r, hs.map((x) => x.id))).toEqual({ lo: bands[1]!, hi: bands[1]! + gc.CLUB_ABOVE_MEDIAN_SPAN });
    // nobody entered: the race's nominal level
    expect(await clubWindowForRace(h.db, r, [])).toEqual({ lo: 85, hi: gc.CLUB_MARK_MAX });
  });

  it("Story races: the whole band", async () => {
    const r = await race({ minRating: 34, maxRating: 58 }, { kind: "quick", purse: 0 });
    expect(await clubWindowForRace(h.db, r, [])).toEqual({ lo: 34, hi: 58 });
  });
});

describe("filling a field", () => {
  it("every Club runner's real ability is inside the window, spread across it, and suits the trip and surface", async () => {
    // a pool of free Club horses at assorted marks, some fitting the race, some not
    for (let i = 0; i < 12; i++) await mintRow(clubRunnerSpec({ seed: "pool", index: i, target: 55 + i * 2, season: 12, distanceM: i % 2 ? 1400 : 2800, surface: i % 3 ? "turf" : "dirt" }));
    const r = await race({ minRating: 50, maxRating: 75, distanceM: 1400, surface: "turf" });
    const p = await newPlayer(h.db);
    const mine = await makeHorse(h.db, p.stableId, { rating: 60 });
    await enterRace(h.db, { accountId: p.accountId, raceId: r.id, horseId: mine.id, tactic: "front", now: at(n * 60 * MIN) });
    const { field } = await getRaceForSimulation(h.db, r.id, r.postTime);
    const club = field.runners.filter((x) => x.isHouse);
    expect(club).toHaveLength(7);
    const w = { lo: 63, hi: 75 };
    const marks: number[] = [];
    for (const x of club) {
      const row = await getHorseRow(h.db, x.horseId);
      const mark = trueMarkOf(row);
      marks.push(mark);
      expect(mark).toBeGreaterThanOrEqual(w.lo);
      expect(mark).toBeLessThanOrEqual(w.hi);
      const g = gc.upgradeGenome(row.genome)!;
      expect(gc.clubFitsRace(g, { distanceM: 1400, surface: "turf" })).toBe(true);
      // ridden to its natural style
      expect(x.tactic).toBe(gc.runningStyle(g));
    }
    // spread: the pack covers the window, not one end of it
    expect(Math.max(...marks) - Math.min(...marks)).toBeGreaterThanOrEqual(6);
  });

  it("is deterministic from the race seed", async () => {
    const fill = async () => {
      const db = await memoryDb();
      try {
        const r = await createRace(db.db, {
          kind: "scheduled",
          name: "Twin",
          raceClass: "handicap",
          conditions: { minRating: 70, maxRating: 95, distanceM: 2000, surface: "dirt" },
          postTime: at(10 * MIN),
          entriesCloseAt: at(9 * MIN),
          targetRunners: RULES.minField,
          seed: sha256Hex("twin-seed"),
        });
        const { field } = await getRaceForSimulation(db.db, r.id, r.postTime);
        const rows = await Promise.all(field.runners.map((x) => getHorseRow(db.db, x.horseId)));
        return rows.map((x) => [x.name, x.rating, JSON.stringify(x.genome)]).sort();
      } finally {
        await db.close();
      }
    };
    expect(await fill()).toEqual(await fill());
  });
});

describe("recalibrating the existing pool", () => {
  it("sets each stamped Club horse's rating to its real mark once; idempotent; results move it after", async () => {
    const db = await memoryDb();
    try {
      const stamped: HorseRow[] = [];
      for (let i = 0; i < 4; i++) {
        const spec = gameCoreHooks.houseHorse!({ seed: "old", index: i, raceClass: "handicap", rating: 62 + i * 10, season: 1 });
        const id = await insertHorse(db.db, { stableId: null, spec, origin: "house", now: T0 });
        stamped.push(await getHorseRow(db.db, id));
      }
      expect(stamped.map((x) => x.rating)).toEqual([62, 72, 82, 92]);
      const truth = stamped.map(trueMarkOf);
      expect(Math.max(...truth)).toBeLessThan(60); // untrained novices: the bug

      expect(await sweepClubRatings(db.db, T0)).toBe(4);
      const after = await Promise.all(stamped.map((x) => getHorseRow(db.db, x.id)));
      expect(after.map((x) => x.rating)).toEqual(truth);
      expect(after.map((x) => (x.dynamics as Record<string, number>).peakOr)).toEqual(truth);
      const [marker] = await db.db.select().from(economyConfig).where(eq(economyConfig.key, CLUB_CALIBRATION_MARKER));
      expect(marker).toBeDefined();

      // idempotent, and a later result is never undone
      await db.db.update(horses).set({ rating: truth[0]! + 5 }).where(eq(horses.id, stamped[0]!.id));
      expect(await sweepClubRatings(db.db, at(MIN))).toBe(0);
      expect((await recalibrateClubRatings(db.db, at(MIN))).recalibrated).toBe(0);
      expect((await getHorseRow(db.db, stamped[0]!.id)).rating).toBe(truth[0]! + 5);
    } finally {
      await db.close();
    }
  });

  it("runs at the first field lock after deploy, before the pool is read", async () => {
    const db = await memoryDb();
    try {
      const spec = gameCoreHooks.houseHorse!({ seed: "first-lock", index: 0, raceClass: "handicap", rating: 85, season: 1 });
      const id = await insertHorse(db.db, { stableId: null, spec, origin: "house", now: T0 });
      const truth = trueMarkOf(await getHorseRow(db.db, id));
      const r = await createRace(db.db, {
        kind: "scheduled",
        name: "First",
        raceClass: "handicap",
        conditions: { minRating: 70, maxRating: 95 },
        postTime: at(10 * MIN),
        entriesCloseAt: at(9 * MIN),
        targetRunners: RULES.minField,
      });
      const { field } = await getRaceForSimulation(db.db, r.id, r.postTime);
      // the stamped "85" is really a novice: it no longer passes for a 70-95 handicapper
      expect(field.runners.map((x) => x.horseId)).not.toContain(id);
      expect((await getHorseRow(db.db, id)).rating).toBe(truth);
    } finally {
      await db.close();
    }
  });
});

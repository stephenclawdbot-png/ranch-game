import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { courseForRace, createRace, enterRace, fieldHashOf, getRaceForSimulation, lockField, type CreateRaceInput } from "../services/races";
import { at, MIN, makeHorse, memoryDb, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let n = 0;
async function lockedRace(extra: Partial<CreateRaceInput> = {}, track?: string) {
  const p = await newPlayer(h.db, { credits: 5_000 });
  const horse = await makeHorse(h.db, p.stableId);
  const race = await createRace(h.db, {
    kind: "scheduled",
    name: `Course race ${++n}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 140, distanceM: 1600, surface: "turf", going: "good", ...(track !== undefined ? { track } : {}) },
    postTime: at(10 * MIN),
    entriesCloseAt: at(9 * MIN),
    purse: 16_000,
    maxRunners: 12,
    targetRunners: 6,
    ...extra,
  });
  await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0 });
  const field = (await lockField(h.db, race.id, at(9 * MIN)))!;
  return { race, field };
}

describe("course character at the field lock", () => {
  it("freezes the course profile of a Live race on a known course into the field, and hashes it", async () => {
    const { race, field } = await lockedRace({}, "Kestrel Downs");
    const expected = gc.courseProfile(gc.courseByName("Kestrel Downs")!);
    expect(field.course).toEqual(expected);
    expect(courseForRace(race)).toEqual(expected);
    // Live races lock with the race model too (engine 1.4.0): both are sealed in the field hash.
    expect(field.model).toBe("1.4.0");
    expect(field.fieldHash).toBe(fieldHashOf(field.runners, expected, field.model));
    // The course is sealed in the field hash: same runners, no course, different hash.
    expect(field.fieldHash).not.toBe(fieldHashOf(field.runners, null, field.model));
    // ...and survives the stored round trip (the simulation reads it back).
    const sim = await getRaceForSimulation(h.db, race.id, at(10 * MIN));
    expect(sim.field.course).toEqual(expected);
    expect(sim.field.fieldHash).toBe(field.fieldHash);
  });

  it("a race without a known course locks with no course (no course key, hash without one)", async () => {
    for (const track of [undefined, "Old Vicarage", ""]) {
      const { field } = await lockedRace({}, track);
      expect("course" in field).toBe(false);
      expect(field.fieldHash).toBe(fieldHashOf(field.runners, null, field.model));
    }
  });

  it("only Live card races (scheduled, feature, final) race with course character", () => {
    const conditions = { track: "Harrowgate" };
    expect(courseForRace({ kind: "scheduled", conditions })?.id).toBe("harrowgate");
    expect(courseForRace({ kind: "feature", conditions })?.id).toBe("harrowgate");
    expect(courseForRace({ kind: "final", conditions })?.id).toBe("harrowgate");
    expect(courseForRace({ kind: "quick", conditions })).toBeUndefined();
    expect(courseForRace({ kind: "daily_cup", conditions })).toBeUndefined();
    expect(courseForRace({ kind: "trial", conditions })).toBeUndefined();
  });
});

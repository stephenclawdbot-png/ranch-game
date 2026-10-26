/**
 * Story races (§4e, kind "quick") and the career clock: a Story race never uses a career
 * start — no starts, no record, no max-starts retirement — while prizes, fatigue, injury
 * (career-ending included) and the per-day limit behave like any other race.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { getBalance, ledgerHealth } from "../services/ledger";
import { createRace, enterRace, getRaceForSimulation, settleRace, type CreateRaceInput, type RunnerOutcome } from "../services/races";
import { at, count, DAY, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let n = 0;
function storyRace(offsetMs = 0, extra: Partial<Pick<CreateRaceInput, "kind" | "purse" | "targetRunners">> = {}) {
  return createRace(h.db, {
    kind: "quick",
    name: `Story ${++n}`,
    raceClass: "maiden",
    conditions: { distanceM: 1200, surface: "turf" },
    postTime: at(offsetMs + 10 * MIN),
    entriesCloseAt: at(offsetMs + 9 * MIN),
    targetRunners: 2,
    ...extra,
  });
}

/** Locks + settles with `first` horses in the given order, the rest of the field after. */
async function runRace(raceId: string, now: Date, first: string[], extra: Record<string, Partial<RunnerOutcome>> = {}) {
  const { field } = await getRaceForSimulation(h.db, raceId, now);
  const order = [...first, ...field.runners.map((r) => r.horseId).filter((id) => !first.includes(id))];
  return settleRace(h.db, {
    raceId,
    now,
    resultHash: "0".repeat(64),
    result: { order },
    runners: order.map((horseId, i) => ({ horseId, position: i + 1, ...(extra[horseId] ?? {}) })),
  });
}

describe("Story races and the career clock", () => {
  it("pays its purse through the ledger but leaves starts and the record untouched", async () => {
    const p = await newPlayer(h.db, { credits: 1_000 });
    const a = await makeHorse(h.db, p.stableId, { starts: 7, wins: 2, places: 1, shows: 3, earnings: 900 });
    const race = await storyRace(0, { purse: 10_000 });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: a.id, tactic: "front", now: T0 });
    const r = await runRace(race.id, at(11 * MIN), [a.id], { [a.id]: { ratingAfter: 20, condition: { fatigue: 500 } } });
    expect(r.retired).toEqual([]);
    // Credits, result and condition are exactly as for any race.
    expect(await getBalance(h.db, p.accountId)).toBe(1_000 + 5_500);
    expect(await count(h.db, "race_results", `race_id = '${race.id}'`)).toBe(1);
    expect(await getHorseRow(h.db, a.id)).toMatchObject({ fatigue: 500, rating: 20, lockKind: null, careerStatus: "racing" });
    // The career clock and the record did not move.
    expect(await getHorseRow(h.db, a.id)).toMatchObject({ starts: 7, wins: 2, places: 1, shows: 3, earnings: 900 });
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
  });

  it("never retires a horse at the career cap, and a career-ending injury still does", async () => {
    const p = await newPlayer(h.db);
    const veteran = await makeHorse(h.db, p.stableId, { starts: 39 });
    const unlucky = await makeHorse(h.db, p.stableId, { starts: 5, insured: true });
    const safe = await storyRace(0, { targetRunners: 4 });
    await enterRace(h.db, { accountId: p.accountId, raceId: safe.id, horseId: veteran.id, tactic: "front", now: T0 });
    await runRace(safe.id, at(11 * MIN), [veteran.id]);
    expect(await getHorseRow(h.db, veteran.id)).toMatchObject({ starts: 39, careerStatus: "racing" });
    // The horse can keep racing Story races at the cap (the per-day limit still applies).
    const again = await storyRace(20 * MIN);
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: again.id, horseId: veteran.id, tactic: "front", now: at(15 * MIN) })).resolves.toBeDefined();

    const rough = await storyRace(DAY, { targetRunners: 4 });
    await enterRace(h.db, { accountId: p.accountId, raceId: rough.id, horseId: unlucky.id, tactic: "front", now: at(DAY) });
    const r = await runRace(rough.id, at(DAY + 11 * MIN), [unlucky.id], {
      [unlucky.id]: { injury: { severity: "career_ending", recoveryMs: 30 * DAY } },
    });
    expect(r.retired).toEqual([unlucky.id]);
    expect(await getHorseRow(h.db, unlucky.id)).toMatchObject({ starts: 5, careerStatus: "retired", retirementReason: "injury" });
  });

  it("a Live race still increments starts, the record and the career clock", async () => {
    const p = await newPlayer(h.db, { credits: 1_000 });
    const a = await makeHorse(h.db, p.stableId, { starts: 7, wins: 2, places: 1, shows: 3, earnings: 900 });
    const race = await storyRace(0, { kind: "scheduled", purse: 10_000, targetRunners: 4 });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: a.id, tactic: "front", now: T0 });
    await runRace(race.id, at(11 * MIN), [a.id]);
    expect(await getHorseRow(h.db, a.id)).toMatchObject({ starts: 8, wins: 3, places: 1, shows: 3, earnings: 900 + 5_500 });
    expect(await getBalance(h.db, p.accountId)).toBe(1_000 + 5_500);
  });
});
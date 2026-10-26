import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { isDomainError } from "../errors";
import { RULES } from "../rules";
import { horses } from "../schema";
import { breed } from "../services/breeding";
import { enterDailyCup } from "../services/competition";
import { moveToLegacyFarm, recordCare, retireHorse } from "../services/horses";
import { getBalance, ledgerHealth } from "../services/ledger";
import { runMaintenance } from "../services/maintenance";
import { createRace, enterRace, getRaceForSimulation, settleRace, type CreateRaceInput, type RunnerOutcome } from "../services/races";
import { commitSeed } from "../crypto";
import { gc, toHorseState } from "../gameCore";
import { at, count, DAY, expectDbError, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, settledAll, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let raceN = 0;
function quickRace(offsetMs = 0, extra: Partial<Pick<CreateRaceInput, "kind" | "purse" | "entryFee" | "maxRunners" | "targetRunners">> = {}) {
  return createRace(h.db, {
    kind: "quick",
    name: `Race ${++raceN}`,
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

describe("racing", () => {
  it("entering locks the horse; settlement is idempotent (purse paid once) and unlocks", async () => {
    const p = await newPlayer(h.db, { credits: 1_000 });
    const a = await makeHorse(h.db, p.stableId);
    const race = await quickRace(0, { kind: "scheduled", purse: 10_000, entryFee: 100 });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: a.id, tactic: "front", now: T0 });
    expect(await getHorseRow(h.db, a.id)).toMatchObject({ lockKind: "race", lockRef: race.id });
    expect(await getBalance(h.db, p.accountId)).toBe(900);

    await expect(getRaceForSimulation(h.db, race.id, at(5 * MIN))).rejects.toMatchObject({ code: "TOO_EARLY" });
    const sim = await getRaceForSimulation(h.db, race.id, at(10 * MIN));
    expect(sim.field.runners).toHaveLength(2); // filled with one house horse
    expect(commitSeed(sim.race.seed)).toBe(race.seedCommitment);
    const rival = sim.field.runners.find((r) => r.isHouse)!.horseId;
    const outcome = {
      raceId: race.id,
      now: at(11 * MIN),
      resultHash: "f".repeat(64),
      result: { order: [a.id, rival] },
      runners: [
        { horseId: a.id, position: 1, finishTimeUs: 70_000_000, ratingAfter: 12 },
        { horseId: rival, position: 2, finishTimeUs: 70_500_000 },
      ],
    };
    const results = await Promise.all([settleRace(h.db, outcome), settleRace(h.db, outcome), settleRace(h.db, outcome)]);
    expect(results.filter((r) => !r.alreadySettled)).toHaveLength(1);
    expect(await getBalance(h.db, p.accountId)).toBe(900 + 5_500);
    expect(await getHorseRow(h.db, a.id)).toMatchObject({ starts: 1, wins: 1, earnings: 5_500, rating: 12, lockKind: null });
    expect((await getHorseRow(h.db, rival)).lockKind).toBeNull();
    expect(await count(h.db, "race_results", `race_id = '${race.id}'`)).toBe(1);
    expect(await count(h.db, "inbox_items", `account_id = '${p.accountId}' and race_id = '${race.id}'`)).toBe(1);
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
  });

  it("hard cap: 3 starts per horse per day, enforced under concurrency", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    for (let i = 0; i < 2; i++) {
      const r = await quickRace(i * 20 * MIN);
      await enterRace(h.db, { accountId: p.accountId, raceId: r.id, horseId: horse.id, tactic: "front", now: at(i * 20 * MIN) });
      await runRace(r.id, at(i * 20 * MIN + 11 * MIN), [horse.id]);
    }
    const r3 = await quickRace(60 * MIN);
    const r4 = await quickRace(60 * MIN);
    const res = await settledAll([r3, r4].map((r) => enterRace(h.db, { accountId: p.accountId, raceId: r.id, horseId: horse.id, tactic: "front", now: at(50 * MIN) })));
    expect(res.ok).toHaveLength(1);
    expect(res.errors.every((e) => isDomainError(e, "HORSE_LOCKED") || isDomainError(e, "RACE_LIMIT"))).toBe(true);
    await runRace(res.ok[0]!.raceId, at(71 * MIN), [horse.id]);
    const r5 = await quickRace(90 * MIN);
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: r5.id, horseId: horse.id, tactic: "front", now: at(80 * MIN) })).rejects.toMatchObject({
      code: "RACE_LIMIT",
    });
    const r6 = await quickRace(DAY);
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: r6.id, horseId: horse.id, tactic: "front", now: at(DAY) })).resolves.toBeDefined();
  });

  it("retirement blocks racing but allows eligible breeding", async () => {
    const p = await newPlayer(h.db);
    const stallion = await makeHorse(h.db, p.stableId, { sex: "male", starts: 3 });
    const mare = await makeHorse(h.db, p.stableId, { sex: "female", starts: 10 });
    await retireHorse(h.db, { accountId: p.accountId, horseId: stallion.id, now: T0 });
    await retireHorse(h.db, { accountId: p.accountId, horseId: mare.id, now: T0 });
    const race = await quickRace();
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: stallion.id, tactic: "front", now: T0 })).rejects.toMatchObject({
      code: "HORSE_RETIRED",
    });
    await expect(breed(h.db, { accountId: p.accountId, sireId: stallion.id, damId: mare.id, now: T0, idempotencyKey: `ret:${mare.id}` })).resolves.toMatchObject({
      duplicate: false,
    });
    // Retirement is final, even bypassing the service.
    await expectDbError(h.db.update(horses).set({ careerStatus: "racing", retirementReason: null, retiredAt: null }).where(eq(horses.id, stallion.id)), /final/);
  });

  it("mandatory racing retirement at 40 starts; career-ending injury retires but never kills", async () => {
    const p = await newPlayer(h.db);
    const veteran = await makeHorse(h.db, p.stableId, { starts: 39 });
    const unlucky = await makeHorse(h.db, p.stableId, { starts: 5, insured: true });
    const race = await quickRace(0, { kind: "scheduled", targetRunners: 4 });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: veteran.id, tactic: "front", now: T0 });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: unlucky.id, tactic: "front", now: T0 });
    const before = await getBalance(h.db, p.accountId);
    const unluckyBefore = await getHorseRow(h.db, unlucky.id);
    const r = await runRace(race.id, at(11 * MIN), [veteran.id, unlucky.id], {
      [unlucky.id]: { injury: { severity: "career_ending", recoveryMs: 30 * DAY } },
    });
    expect(r.retired.sort()).toEqual([veteran.id, unlucky.id].sort());
    expect(await getHorseRow(h.db, veteran.id)).toMatchObject({ starts: 40, careerStatus: "retired", retirementReason: "max_starts" });
    expect(await getHorseRow(h.db, unlucky.id)).toMatchObject({ careerStatus: "retired", retirementReason: "injury" });
    expect(await getBalance(h.db, p.accountId)).toBe(before + gc.insurancePayout(toHorseState(unluckyBefore)));
    // The CHECK refuses a racing horse at 40 starts.
    const other = await makeHorse(h.db, p.stableId, { starts: 39 });
    await expectDbError(h.db.update(horses).set({ starts: 40 }).where(eq(horses.id, other.id)), /horses_mandatory_retirement/);
  });

  it("Legacy Farm is permanent and horses can never be deleted", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    await moveToLegacyFarm(h.db, { accountId: p.accountId, horseId: horse.id, now: T0 });
    expect(await getHorseRow(h.db, horse.id)).toMatchObject({ careerStatus: "pasture" });
    await expectDbError(h.db.update(horses).set({ careerStatus: "retired", pasturedAt: null }).where(eq(horses.id, horse.id)), /permanent/);
    await expectDbError(h.db.delete(horses).where(eq(horses.id, horse.id)), /cannot be deleted/);
  });
});

describe("care", () => {
  it("one counted session per horse per UTC day, even concurrently; foals grow only with care", async () => {
    const p = await newPlayer(h.db);
    const foalRow = await makeHorse(h.db, p.stableId, { careSessions: 0, stage: "foal" });
    const res = await settledAll(
      Array.from({ length: 4 }, () => recordCare(h.db, { accountId: p.accountId, horseId: foalRow.id, now: T0, actions: { feed: "oats" } })),
    );
    expect(res.ok).toHaveLength(1);
    expect(res.errors.every((e) => isDomainError(e, "ALREADY_CARED_TODAY"))).toBe(true);
    await expect(recordCare(h.db, { accountId: p.accountId, horseId: foalRow.id, now: at(11 * 60 * MIN), actions: {} })).rejects.toMatchObject({
      code: "ALREADY_CARED_TODAY",
    });
    for (let d = 1; d < 5; d++) await recordCare(h.db, { accountId: p.accountId, horseId: foalRow.id, now: at(d * DAY), actions: {} });
    expect(await getHorseRow(h.db, foalRow.id)).toMatchObject({ careSessions: 5, stage: "weanling" });
    expect(await count(h.db, "care_log", `horse_id = '${foalRow.id}'`)).toBe(5);
  });

  it("only the owner can care for a horse", async () => {
    const p = await newPlayer(h.db);
    const q = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    await expect(recordCare(h.db, { accountId: q.accountId, horseId: horse.id, now: T0, actions: {} })).rejects.toMatchObject({ code: "NOT_OWNER" });
  });
});

describe("daily cup", () => {
  it("one Cup Run per player per day", async () => {
    const p = await newPlayer(h.db);
    const a = await makeHorse(h.db, p.stableId);
    const b = await makeHorse(h.db, p.stableId);
    const run = () => ({ finishPosition: 3, finishTimeUs: 71_000_000, points: 8 });
    const res = await settledAll([a, b, a].map((x) => enterDailyCup(h.db, { accountId: p.accountId, horseId: x.id, now: T0, run })));
    expect(res.ok).toHaveLength(1);
    expect(res.errors.every((e) => isDomainError(e, "DAILY_CUP_ALREADY_ENTERED"))).toBe(true);
    await expect(enterDailyCup(h.db, { accountId: p.accountId, horseId: b.id, now: at(DAY), run })).resolves.toBeDefined();
  });
});

describe("inactivity", () => {
  it("time away never mutates a horse except healing and pregnancy completion", async () => {
    const p = await newPlayer(h.db);
    const racer = await makeHorse(h.db, p.stableId, { starts: 12, fitness: 800, freshness: 300, form: 700, morale: 650, bond: 400, rating: 55 });
    const foalRow = await makeHorse(h.db, p.stableId, { careSessions: 2, stage: "foal" });
    const injured = await makeHorse(h.db, p.stableId, { injury: { severity: "minor" }, injuredUntil: at(3 * DAY) });
    const sire = await makeHorse(h.db, p.stableId, { sex: "male", careerStatus: "retired", retirementReason: "choice", retiredAt: T0 });
    const dam = await makeHorse(h.db, p.stableId, { sex: "female", careerStatus: "retired", retirementReason: "choice", retiredAt: T0 });
    await breed(h.db, { accountId: p.accountId, sireId: sire.id, damId: dam.id, now: T0, idempotencyKey: `away:${dam.id}` });
    const credits = await getBalance(h.db, p.accountId);
    const snapshot = await h.db.select().from(horses).where(eq(horses.ownerStableId, p.stableId));

    // A year away, with the maintenance sweep running every day.
    for (let d = 1; d <= 365; d += 30) await runMaintenance(h.db, at(d * DAY));
    await runMaintenance(h.db, at(365 * DAY));

    const after = await h.db.select().from(horses).where(eq(horses.ownerStableId, p.stableId));
    const strip = (x: (typeof after)[number]) => {
      const { updatedAt: _u, injury: _i, injuredUntil: _iu, ...rest } = x;
      return rest;
    };
    for (const before of snapshot) {
      const now = after.find((x) => x.id === before.id)!;
      expect(strip(now)).toEqual(strip(before));
    }
    // Healing happened; the foal arrived; nothing else.
    expect(await getHorseRow(h.db, injured.id)).toMatchObject({ injury: null, injuredUntil: null });
    const newcomers = after.filter((x) => !snapshot.some((s) => s.id === x.id));
    expect(newcomers).toHaveLength(1);
    expect(newcomers[0]).toMatchObject({ damId: dam.id, stage: "foal", careSessions: 0 });
    expect(await getHorseRow(h.db, racer.id)).toMatchObject({ starts: 12, fitness: 800, bond: 400, stage: racer.stage });
    expect(await getHorseRow(h.db, foalRow.id)).toMatchObject({ careSessions: 2, stage: "foal" });
    expect(await getBalance(h.db, p.accountId)).toBe(credits); // no time-based fees
  });
});

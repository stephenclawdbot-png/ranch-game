import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { isDomainError } from "../errors";
import { RULES } from "../rules";
import { accounts, horses, stables } from "../schema";
import { getBalance, ledgerHealth } from "../services/ledger";
import {
  awaitingGraduation,
  buyFacility,
  careForAll,
  careForHorse,
  currentTrainingPlan,
  facilityLevels,
  facilityOffers,
  graduateFoal,
  runTrainingSession,
  saveTrainingPlan,
  scanPedigree,
  STABLE_HAND_COST,
  treatHorseInjury,
} from "../services/horseLife";
import { gc, toHorseState } from "../gameCore";
import { at, count, DAY, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

async function rejects(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(isDomainError(e) ? e.code : String(e)).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("care (local day)", () => {
  it("counts one session per local day; a repeat is a no-op; missing days never harm", async () => {
    const p = await newPlayer(h.db);
    await h.db.update(accounts).set({ timezone: "Pacific/Auckland" }).where(eq(accounts.id, p.accountId));
    const foal = await makeHorse(h.db, p.stableId, { careSessions: 0, stage: "foal" });
    const r1 = await careForHorse(h.db, { accountId: p.accountId, horseId: foal.id, now: T0, feed: "growth_mix" });
    expect(r1).toMatchObject({ counted: true, quality: 1000, feed: "growth_mix" });
    expect(r1.horse.careSessions).toBe(1);
    // T0 = 12:00 UTC = 01:00 next day in Auckland; +10 h is still the same local date.
    const r2 = await careForHorse(h.db, { accountId: p.accountId, horseId: foal.id, now: at(10 * 60 * MIN) });
    expect(r2.counted).toBe(false);
    expect((await getHorseRow(h.db, foal.id)).careSessions).toBe(1);
    expect(r1.day).toBe("2026-11-03");
    // A week away: nothing decays; the next visit just counts the next session.
    const before = await getHorseRow(h.db, foal.id);
    const r3 = await careForHorse(h.db, { accountId: p.accountId, horseId: foal.id, now: at(7 * DAY), feed: "performance" });
    expect(r3.counted).toBe(true);
    expect(r3.quality).toBeLessThan(1000);
    expect(r3.horse.careSessions).toBe(2);
    expect(r3.horse.bond).toBeGreaterThan(before.bond);
  });

  it("grows a foal through 5 / 7 / 7 sessions to racing age and graduates once", async () => {
    const p = await newPlayer(h.db);
    const foal = await makeHorse(h.db, p.stableId, { careSessions: 0, stage: "foal", origin: "pack" });
    const stages: string[] = [];
    let graduatedOn = -1;
    for (let d = 0; d < RULES.careToRacing; d++) {
      const r = await careForHorse(h.db, { accountId: p.accountId, horseId: foal.id, now: at(d * DAY) });
      expect(r.counted).toBe(true);
      stages.push(r.stageAfter);
      if (r.graduated) graduatedOn = d;
    }
    expect(stages[RULES.careToWean - 2]).toBe("foal");
    expect(stages[RULES.careToWean - 1]).toBe("weanling");
    expect(stages[RULES.careToYearling - 1]).toBe("yearling");
    expect(stages[RULES.careToRacing - 1]).toBe("juvenile");
    expect(graduatedOn).toBe(RULES.careToRacing - 1);
    const grown = await getHorseRow(h.db, foal.id);
    expect(awaitingGraduation(grown)).toBe(true);
    await graduateFoal(h.db, { accountId: p.accountId, horseId: foal.id, now: at(20 * DAY) });
    const again = await graduateFoal(h.db, { accountId: p.accountId, horseId: foal.id, now: at(21 * DAY) });
    expect(awaitingGraduation(again)).toBe(false);
    expect((again.dynamics as { graduatedAtMs: number }).graduatedAtMs).toBe(at(20 * DAY).getTime());
  });

  it("a foal can't graduate early", async () => {
    const p = await newPlayer(h.db);
    const foal = await makeHorse(h.db, p.stableId, { careSessions: 3, stage: "foal" });
    await rejects(graduateFoal(h.db, { accountId: p.accountId, horseId: foal.id, now: T0 }), "HORSE_NOT_OF_AGE");
  });

  it("care for all needs a stable hand and counts each horse once", async () => {
    const p = await newPlayer(h.db, { credits: 10_000 });
    const a = await makeHorse(h.db, p.stableId);
    const b = await makeHorse(h.db, p.stableId, { careSessions: 2, stage: "foal" });
    await rejects(careForAll(h.db, { accountId: p.accountId, now: T0 }), "NOT_ELIGIBLE");
    await careForHorse(h.db, { accountId: p.accountId, horseId: a.id, now: T0 });
    await buyFacility(h.db, { accountId: p.accountId, facility: "stableHand", toLevel: 1, now: T0 });
    const res = await careForAll(h.db, { accountId: p.accountId, now: T0 });
    expect(res.map((r) => [r.horse.id, r.counted])).toEqual(expect.arrayContaining([[a.id, false], [b.id, true]]));
    expect(await count(h.db, "care_log", `horse_id = '${b.id}'`)).toBe(1);
  });

  it("refuses horses the player doesn't own", async () => {
    const p = await newPlayer(h.db);
    const q = await newPlayer(h.db);
    const x = await makeHorse(h.db, q.stableId);
    await rejects(careForHorse(h.db, { accountId: p.accountId, horseId: x.id, now: T0 }), "NOT_OWNER");
  });
});

describe("training", () => {
  it("saves a plan, runs sessions in order, charges per session once and fills the week", async () => {
    const p = await newPlayer(h.db, { credits: 1_000 });
    const horse = await makeHorse(h.db, p.stableId);
    await rejects(saveTrainingPlan(h.db, { accountId: p.accountId, horseId: horse.id, slots: ["speed_work", "rest"], now: T0 }), "INVALID_INPUT");
    await saveTrainingPlan(h.db, { accountId: p.accountId, horseId: horse.id, slots: ["stamina_gallops", "gate_practice", "rest"], now: T0 });
    expect(await currentTrainingPlan(h.db, horse.id)).toEqual({ slots: ["stamina_gallops", "gate_practice", "rest"] });

    const s1 = await runTrainingSession(h.db, { accountId: p.accountId, horseId: horse.id, now: T0, expectedSession: 0 });
    expect(s1).toMatchObject({ ran: true, workout: "stamina_gallops", cost: 60, sessionsUsed: 1 });
    expect(s1.arrows!.stamina).toBe(1);
    expect(await getBalance(h.db, p.accountId)).toBe(940);
    // A double tap (same expected session) is a no-op.
    const dup = await runTrainingSession(h.db, { accountId: p.accountId, horseId: horse.id, now: T0, expectedSession: 0 });
    expect(dup.ran).toBe(false);
    expect(await getBalance(h.db, p.accountId)).toBe(940);

    const s2 = await runTrainingSession(h.db, { accountId: p.accountId, horseId: horse.id, now: at(MIN), expectedSession: 1 });
    expect(s2.workout).toBe("gate_practice");
    const s3 = await runTrainingSession(h.db, { accountId: p.accountId, horseId: horse.id, now: at(2 * MIN), expectedSession: 2 });
    expect(s3).toMatchObject({ workout: "rest", cost: 0 });
    await rejects(runTrainingSession(h.db, { accountId: p.accountId, horseId: horse.id, now: at(3 * MIN) }), "NOT_ELIGIBLE");
    expect(await getBalance(h.db, p.accountId)).toBe(900);

    const row = await getHorseRow(h.db, horse.id);
    const st = toHorseState(row);
    expect(st.training.realisation.stamina).toBeGreaterThan(600);
    expect(st.condition.lastHardWorkMs).toBe(T0.getTime());
    // Next week the slots are open again.
    const next = await runTrainingSession(h.db, { accountId: p.accountId, horseId: horse.id, now: at(7 * DAY), expectedSession: 0 });
    expect(next.ran).toBe(true);
    expect(await ledgerHealth(h.db)).toMatchObject({ totalPostings: 0, unbalancedTransactions: [], driftedAccounts: [], negativeAccounts: [] });
  });

  it("refuses foals, light-only yearlings, retired horses and sessions the player can't afford", async () => {
    const p = await newPlayer(h.db, { credits: 50 });
    const foal = await makeHorse(h.db, p.stableId, { careSessions: 2, stage: "foal" });
    await rejects(runTrainingSession(h.db, { accountId: p.accountId, horseId: foal.id, now: T0 }), "HORSE_NOT_OF_AGE");
    const yearling = await makeHorse(h.db, p.stableId, { careSessions: 14, stage: "yearling" });
    await rejects(saveTrainingPlan(h.db, { accountId: p.accountId, horseId: yearling.id, slots: ["speed_work", "rest", "rest"], now: T0 }), "NOT_ELIGIBLE");
    await saveTrainingPlan(h.db, { accountId: p.accountId, horseId: yearling.id, slots: ["gate_practice", "swimming", "rest"], now: T0 });
    const horse = await makeHorse(h.db, p.stableId);
    await rejects(runTrainingSession(h.db, { accountId: p.accountId, horseId: horse.id, now: T0, workout: "speed_work" }), "INSUFFICIENT_FUNDS");
    expect(await getBalance(h.db, p.accountId)).toBe(50);
    const retired = await makeHorse(h.db, p.stableId, { careerStatus: "retired", retirementReason: "choice", retiredAt: T0 });
    await rejects(runTrainingSession(h.db, { accountId: p.accountId, horseId: retired.id, now: T0 }), "HORSE_RETIRED");
  });

  it("a Trainer adds a fourth slot", async () => {
    const p = await newPlayer(h.db, { credits: 10_000 });
    const horse = await makeHorse(h.db, p.stableId);
    await buyFacility(h.db, { accountId: p.accountId, facility: "trainer", toLevel: 1, now: T0 });
    await rejects(saveTrainingPlan(h.db, { accountId: p.accountId, horseId: horse.id, slots: ["speed_work", "rest", "rest"], now: T0 }), "INVALID_INPUT");
    await saveTrainingPlan(h.db, { accountId: p.accountId, horseId: horse.id, slots: ["speed_work", "rest", "swimming", "rest"], now: T0 });
  });
});

describe("vet, scan", () => {
  it("vet treatment brings healing forward, once per injury per day; healed injuries clear", async () => {
    const p = await newPlayer(h.db, { credits: 1_000 });
    const injury: gc.Injury = { severity: "minor", atMs: T0.getTime(), unitsRequired: 48, bonusUnits: 0, vetLevel: 0, source: "test" };
    const horse = await makeHorse(h.db, p.stableId, { injury, injuredUntil: at(2 * DAY) });
    const t1 = await treatHorseInjury(h.db, { accountId: p.accountId, horseId: horse.id, now: at(MIN) });
    expect(t1).toMatchObject({ treated: true, cost: gc.VET_TREATMENT_COST });
    expect(t1.horse.injuredUntil!.getTime()).toBeLessThanOrEqual(at(DAY + MIN).getTime() + 3_600_000);
    const t2 = await treatHorseInjury(h.db, { accountId: p.accountId, horseId: horse.id, now: at(2 * MIN) });
    expect(t2.treated).toBe(false);
    expect(await getBalance(h.db, p.accountId)).toBe(1_000 - gc.VET_TREATMENT_COST);
    // Next day: 24 h elapsed + 24 h bonus >= 48 -> healed and cleared.
    const t3 = await treatHorseInjury(h.db, { accountId: p.accountId, horseId: horse.id, now: at(DAY + 2 * MIN) }).catch((e) => e);
    expect(isDomainError(t3) ? t3.code : (t3 as { treated: boolean }).treated).toBe("NOT_ELIGIBLE");
    const healthy = await makeHorse(h.db, p.stableId);
    await rejects(treatHorseInjury(h.db, { accountId: p.accountId, horseId: healthy.id, now: T0 }), "NOT_ELIGIBLE");
  });

  it("care during recovery also helps healing (and is counted)", async () => {
    const p = await newPlayer(h.db);
    const injury: gc.Injury = { severity: "minor", atMs: T0.getTime(), unitsRequired: 96, bonusUnits: 0, vetLevel: 0, source: "test" };
    const horse = await makeHorse(h.db, p.stableId, { injury, injuredUntil: at(4 * DAY) });
    const r = await careForHorse(h.db, { accountId: p.accountId, horseId: horse.id, now: T0 });
    expect((r.horse.injury as gc.Injury).bonusUnits).toBe(gc.CARE_HEAL_BONUS_H);
    expect(r.horse.injuredUntil!.getTime()).toBe(at(4 * DAY - 12 * 60 * MIN).getTime());
  });

  it("Pedigree Scan narrows the ranges once and charges once", async () => {
    const p = await newPlayer(h.db, { credits: 1_000 });
    const foal = await makeHorse(h.db, p.stableId, { careSessions: 0, stage: "foal" });
    const before = gc.revealWidth(toHorseState(foal));
    const s1 = await scanPedigree(h.db, { accountId: p.accountId, horseId: foal.id, now: T0 });
    const s2 = await scanPedigree(h.db, { accountId: p.accountId, horseId: foal.id, now: T0 });
    expect([s1.scanned, s2.scanned]).toEqual([true, false]);
    expect(gc.revealWidth(toHorseState(s1.horse))).toBeLessThan(before);
    expect(await getBalance(h.db, p.accountId)).toBe(1_000 - gc.PEDIGREE_SCAN_COST);
  });
});

describe("facilities", () => {
  it("prices come from game-core; upgrades are one level at a time and idempotent by level", async () => {
    const p = await newPlayer(h.db, { credits: 40_000 });
    const [s0] = await h.db.select().from(stables).where(eq(stables.id, p.stableId));
    const offers = facilityOffers(s0!);
    expect(offers.find((o) => o.key === "stalls")).toMatchObject({ level: 6, nextCost: gc.stallCost(7) });
    expect(offers.find((o) => o.key === "entries")).toMatchObject({ level: 0, nextCost: gc.ENTRY_TIER_COST[0] });
    expect(offers.find((o) => o.key === "vet")).toMatchObject({ level: 0, nextCost: gc.FACILITY_COSTS.vet[0] });
    expect(offers.find((o) => o.key === "stableHand")).toMatchObject({ level: 0, nextCost: STABLE_HAND_COST });

    const a = await buyFacility(h.db, { accountId: p.accountId, facility: "stalls", toLevel: 7, now: T0 });
    const b = await buyFacility(h.db, { accountId: p.accountId, facility: "stalls", toLevel: 7, now: T0 });
    expect([a.bought, b.bought, b.stable.stallSlots]).toEqual([true, false, 7]);
    await rejects(buyFacility(h.db, { accountId: p.accountId, facility: "stalls", toLevel: 9, now: T0 }), "INVALID_INPUT");
    const e = await buyFacility(h.db, { accountId: p.accountId, facility: "entries", toLevel: 1, now: T0 });
    expect([e.stable.entryAllowance, e.stable.entryCap]).toEqual([gc.dailyAllowance(1), gc.bankCap(1)]);
    const v = await buyFacility(h.db, { accountId: p.accountId, facility: "vet", toLevel: 1, now: T0 });
    expect(facilityLevels(v.stable).vet).toBe(1);
    const spent = gc.stallCost(7) + gc.ENTRY_TIER_COST[0] + gc.FACILITY_COSTS.vet[0];
    expect(await getBalance(h.db, p.accountId)).toBe(40_000 - spent);
    expect(await ledgerHealth(h.db)).toMatchObject({ totalPostings: 0, unbalancedTransactions: [], driftedAccounts: [], negativeAccounts: [] });
  });

  it("never lets credits go negative and caps stalls at 24", async () => {
    const p = await newPlayer(h.db, { credits: 100 });
    await rejects(buyFacility(h.db, { accountId: p.accountId, facility: "stalls", toLevel: 7, now: T0 }), "INSUFFICIENT_FUNDS");
    await h.db.update(stables).set({ stallSlots: 24 }).where(eq(stables.id, p.stableId));
    await rejects(buyFacility(h.db, { accountId: p.accountId, facility: "stalls", toLevel: 25, now: T0 }), "INVALID_INPUT");
    expect(await getBalance(h.db, p.accountId)).toBe(100);
    const [row] = await h.db.select().from(horses).where(eq(horses.ownerStableId, p.stableId));
    expect(row).toBeUndefined();
  });
});

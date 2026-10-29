/**
 * Rules the wiki review found inconsistent (2026-10-29): calendar races pay more than the hourly
 * card, top classes charge their entry fee, the Weekend Feature needs qualifying, a breeder that
 * used its last breeding retires for good, and only real Group 1s count (and score) as G1.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { RULES } from "../rules";
import { horses, inboxItems } from "../schema";
import { breed, foal } from "../services/breeding";
import { CALENDAR_PURSE, defaultCardSlot, specialSlotAt } from "../services/card";
import { runPoints } from "../services/leagues";
import { createRace, enterRace, featureQualificationReason } from "../services/races";
import { gc, toHorseState } from "../gameCore";
import { recordAccountSignal } from "../services/accounts";
import { setStudFee } from "../services/horses";
import { at, DAY, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const DAY_SLOTS = gc.SLOTS_PER_DAY;

describe("race card prices", () => {
  it("calendar races pay more than anything on the hourly card; top classes charge an entry fee", () => {
    const base = Math.floor((T0.getTime() - RULES.seasonEpochMs) / RULES.slotMs);
    const hourly = Array.from({ length: DAY_SLOTS * 7 }, (_, i) => base + i).filter((i) => !specialSlotAt(i)).map(defaultCardSlot);
    const richest = Math.max(...hourly.map((s) => s.purse ?? 0));
    const listedFeature = Math.max(...hourly.filter((s) => s.kind === "feature" && s.raceClass === "listed").map((s) => s.purse ?? 0));
    expect(CALENDAR_PURSE.feature_qualifier).toBeGreaterThanOrEqual(listedFeature);
    expect(CALENDAR_PURSE.weekend_feature).toBeGreaterThan(richest);
    expect(CALENDAR_PURSE.season_final).toBeGreaterThan(CALENDAR_PURSE.weekend_feature);
    for (const s of hourly) {
      if (s.raceClass === "listed") expect(s.entryFee).toBe(gc.ENTRY_FEE_BY_TIER.listed);
      else if (s.raceClass === "graded") expect(s.entryFee).toBe(gc.ENTRY_FEE_BY_TIER.g3);
      else expect(s.entryFee).toBe(0);
    }
    // the card's calendar slots use the calendar purses
    const special = Array.from({ length: DAY_SLOTS * 28 }, (_, i) => base + i).map((i) => [i, specialSlotAt(i)] as const).filter(([, sp]) => sp);
    expect(special.length).toBeGreaterThan(0);
    for (const [i, sp] of special) {
      const slot = defaultCardSlot(i);
      expect(slot.purse).toBe(CALENDAR_PURSE[sp!.kind as keyof typeof CALENDAR_PURSE]);
      expect(slot.entryFee).toBeGreaterThan(0);
    }
  });
});

describe("Weekend Feature qualifying", () => {
  it("needs a top-3 in a qualifier that week, or a rating of 100+", async () => {
    const p = await newPlayer(h.db, { credits: 10_000 });
    const q = await newPlayer(h.db, { credits: 10_000 });
    const qualifier = await createRace(h.db, {
      kind: "scheduled",
      name: "Qualifier",
      raceClass: "listed",
      conditions: { calendar: { kind: "feature_qualifier" } },
      postTime: at(10 * MIN),
      entriesCloseAt: at(9 * MIN),
    });
    const feature = await createRace(h.db, {
      kind: "feature",
      name: "Weekend Feature",
      raceClass: "graded",
      conditions: { calendar: { kind: "weekend_feature" } },
      postTime: at(2 * DAY),
      entriesCloseAt: at(2 * DAY - MIN),
    });
    const placed = await makeHorse(h.db, p.stableId, { rating: 90 });
    const unplaced = await makeHorse(h.db, q.stableId, { rating: 90 });
    const star = await makeHorse(h.db, q.stableId, { rating: 104 });
    await enterRace(h.db, { accountId: p.accountId, raceId: qualifier.id, horseId: placed.id, tactic: "front", now: T0 });
    // record the qualifier result directly (settlement is covered elsewhere)
    await h.db.execute(`update race_entries set finish_position = 2 where race_id = '${qualifier.id}' and horse_id = '${placed.id}'`);
    await h.db.execute(`update horses set lock_kind = null, lock_ref = null where id = '${placed.id}'`);

    expect(await featureQualificationReason(h.db, await getHorseRow(h.db, placed.id), feature)).toBeNull();
    expect(await featureQualificationReason(h.db, await getHorseRow(h.db, star.id), feature)).toBeNull();
    expect(await featureQualificationReason(h.db, await getHorseRow(h.db, unplaced.id), feature)).toMatch(/top-3/);
    await expect(enterRace(h.db, { accountId: q.accountId, raceId: feature.id, horseId: unplaced.id, tactic: "front", now: at(DAY) })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: feature.id, horseId: placed.id, tactic: "front", now: at(DAY) })).resolves.toBeTruthy();
  });
});

describe("spent breeders", () => {
  it("a stallion's last covering and a mare's last foal retire them for good, with a note", async () => {
    const p = await newPlayer(h.db, { credits: 20_000 });
    const last = RULES.breedingLifetimeLimit - 1;
    const sire = await makeHorse(h.db, p.stableId, { sex: "male", careerStatus: "retired", retirementReason: "choice", retiredAt: T0, breedingCount: last });
    const dam = await makeHorse(h.db, p.stableId, { sex: "female", careerStatus: "retired", retirementReason: "choice", retiredAt: T0, breedingCount: last });
    const cover = await breed(h.db, { accountId: p.accountId, sireId: sire.id, damId: dam.id, now: T0, idempotencyKey: `spent:${dam.id}` });
    expect(await getHorseRow(h.db, sire.id)).toMatchObject({ careerStatus: "pasture", studFee: null });
    expect(await getHorseRow(h.db, dam.id)).toMatchObject({ careerStatus: "retired" }); // in foal: goes after foaling
    await foal(h.db, { pregnancyId: cover.pregnancyId, now: new Date(T0.getTime() + RULES.pregnancyMs) });
    expect(await getHorseRow(h.db, dam.id)).toMatchObject({ careerStatus: "pasture" });
    const notes = await h.db.select().from(inboxItems).where(eq(inboxItems.kind, "retired"));
    expect(notes.map((n) => n.horseId).sort()).toEqual([sire.id, dam.id].sort());
    // a horse with breedings left stays at stud
    const young = await makeHorse(h.db, p.stableId, { sex: "male", careerStatus: "retired", retirementReason: "choice", retiredAt: T0, breedingCount: 0 });
    const [row] = await h.db.select().from(horses).where(eq(horses.id, young.id));
    expect(row!.careerStatus).toBe("retired");
  });
});

describe("Group 1 points", () => {
  it("League bonus: Group 1 (Weekend Feature, Season Final) beats an hourly Group 3", () => {
    const g3 = runPoints({ position: 1, fieldSize: 10, raceClass: "graded" });
    const g1 = runPoints({ position: 1, fieldSize: 10, raceClass: "graded", group1: true });
    expect(g1 - g3).toBe(gc.tierBonus("g1", 1) - gc.tierBonus("g3", 1));
  });
});

describe("harness findings (2026-10-29)", () => {
  it("one Live race per horse per day; Story races don't count towards it", async () => {
    const p = await newPlayer(h.db, { credits: 20_000 });
    const horse = await makeHorse(h.db, p.stableId);
    const live = (min: number) =>
      createRace(h.db, { kind: "scheduled", name: `Live ${min}`, raceClass: "maiden", conditions: {}, postTime: at(min * MIN), entriesCloseAt: at(min * MIN - MIN) });
    const r1 = await live(30);
    const r2 = await live(90);
    await enterRace(h.db, { accountId: p.accountId, raceId: r1.id, horseId: horse.id, tactic: "front", now: T0 });
    await h.db.execute(`update horses set lock_kind = null, lock_ref = null where id = '${horse.id}'`);
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: r2.id, horseId: horse.id, tactic: "front", now: T0 })).rejects.toMatchObject({ code: "RACE_LIMIT" });
    const story = await createRace(h.db, { kind: "quick", name: "Story", raceClass: "maiden", conditions: {}, postTime: at(60 * MIN), entriesCloseAt: at(59 * MIN) });
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: story.id, horseId: horse.id, tactic: "front", now: T0 })).resolves.toBeTruthy();
  });

  it("stud fees are capped at the stallion's appraisal, and linked accounts can't pay each other stud fees", async () => {
    const owner = await newPlayer(h.db, { credits: 20_000 });
    const alt = await newPlayer(h.db, { credits: 20_000 });
    const sire = await makeHorse(h.db, owner.stableId, { sex: "male", careerStatus: "retired", retirementReason: "choice", retiredAt: T0 });
    const ceiling = gc.studFeeCeiling(toHorseState(await getHorseRow(h.db, sire.id)));
    await expect(setStudFee(h.db, { accountId: owner.accountId, horseId: sire.id, fee: ceiling + 1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await setStudFee(h.db, { accountId: owner.accountId, horseId: sire.id, fee: ceiling });
    await recordAccountSignal(h.db, { accountId: owner.accountId, kind: "device", value: "same-phone" });
    await recordAccountSignal(h.db, { accountId: alt.accountId, kind: "device", value: "same-phone" });
    const mare = await makeHorse(h.db, alt.stableId, { sex: "female", careerStatus: "retired", retirementReason: "choice", retiredAt: T0 });
    await expect(breed(h.db, { accountId: alt.accountId, sireId: sire.id, damId: mare.id, now: T0, idempotencyKey: `linked:${mare.id}` })).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
  });
});

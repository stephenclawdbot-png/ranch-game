import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { horses, raceEntries, stables } from "../schema";
import { breed } from "../services/breeding";
import { createRace, enterRace, getRaceForSimulation, lockField, scratchEntry, settleRace } from "../services/races";
import { at, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const retired = { careerStatus: "retired" as const, retirementReason: "choice" as const, retiredAt: T0 };

async function setup() {
  const p = await newPlayer(h.db, { credits: 100_000 });
  await h.db.update(stables).set({ stallSlots: 24 }).where(eq(stables.id, p.stableId));
  // a racing mare with enough starts to breed while still racing
  const mare = await makeHorse(h.db, p.stableId, { sex: "female", starts: 26 });
  const stallion = await makeHorse(h.db, p.stableId, { sex: "male", ...retired });
  const race = await createRace(h.db, {
    kind: "scheduled",
    name: "Foaling Stakes",
    raceClass: "maiden",
    conditions: { distanceM: 1600, surface: "turf" },
    postTime: at(30 * MIN),
    entriesCloseAt: at(20 * MIN),
    targetRunners: 4,
  });
  return { p, mare, stallion, race };
}

describe("mares in foal don't race (both directions)", () => {
  it("a mare entered in a race that hasn't run is not covered: a clear refusal; after the race she can be", async () => {
    const { p, mare, stallion, race } = await setup();
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: mare.id, tactic: "front", now: T0 });
    const cover = (now: Date, key: string) => breed(h.db, { accountId: p.accountId, sireId: stallion.id, damId: mare.id, now, idempotencyKey: key });
    // entries open: scratching is offered
    await expect(cover(at(MIN), "c1")).rejects.toMatchObject({ code: "HORSE_LOCKED", message: expect.stringMatching(/entered in the Foaling Stakes.*cover her after that race, or scratch her entry first/) });
    // field locked: only "after the race"
    await lockField(h.db, race.id, at(21 * MIN));
    const locked = cover(at(22 * MIN), "c2");
    await expect(locked).rejects.toMatchObject({ code: "HORSE_LOCKED", details: { block: "entered_in_race", raceId: race.id } });
    await expect(locked).rejects.not.toMatchObject({ message: expect.stringMatching(/scratch/) });
    // the race runs: she is free to be covered
    const { field } = await getRaceForSimulation(h.db, race.id, at(31 * MIN));
    await settleRace(h.db, { raceId: race.id, now: at(31 * MIN), resultHash: "0".repeat(64), result: {}, runners: field.runners.map((r, i) => ({ horseId: r.horseId, position: i + 1 })) });
    const ok = await cover(at(32 * MIN), "c3");
    expect(ok.pregnancyId).toBeTruthy();
  });

  it("a scratched mare can be covered", async () => {
    const { p, mare, stallion, race } = await setup();
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: mare.id, tactic: "front", now: T0 });
    await scratchEntry(h.db, { accountId: p.accountId, raceId: race.id, horseId: mare.id, now: at(MIN) });
    await expect(breed(h.db, { accountId: p.accountId, sireId: stallion.id, damId: mare.id, now: at(2 * MIN), idempotencyKey: "s1" })).resolves.toMatchObject({ duplicate: false });
  });

  it("a mare in foal can't be entered", async () => {
    const { p, mare, stallion, race } = await setup();
    await breed(h.db, { accountId: p.accountId, sireId: stallion.id, damId: mare.id, now: T0, idempotencyKey: "f1" });
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: mare.id, tactic: "front", now: at(MIN) })).rejects.toMatchObject({ code: "HORSE_IN_FOAL" });
  });

  it("the lock drops a carrying mare defensively, paying the entry back and unlocking her", async () => {
    const { p, mare, stallion, race } = await setup();
    const other = await makeHorse(h.db, p.stableId, { sex: "male", starts: 3 });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: other.id, tactic: "front", now: T0 });
    await breed(h.db, { accountId: p.accountId, sireId: stallion.id, damId: mare.id, now: T0, idempotencyKey: "d1" });
    // an odd path: an entry for her that skipped enterRace's checks
    await h.db.update(stables).set({ entryBalance: 5 }).where(eq(stables.id, p.stableId));
    await h.db.insert(raceEntries).values({ raceId: race.id, horseId: mare.id, stableId: p.stableId, isHouse: false, tactic: "front", snapshot: {}, ratingBefore: 0, enteredAt: at(MIN), entryCost: 1 });
    await h.db.update(horses).set({ lockKind: "race", lockRef: race.id }).where(eq(horses.id, mare.id));
    const field = await lockField(h.db, race.id, at(21 * MIN));
    expect(field!.runners.map((r) => r.horseId)).toContain(other.id);
    expect(field!.runners.map((r) => r.horseId)).not.toContain(mare.id);
    const [entry] = await h.db.select().from(raceEntries).where(and(eq(raceEntries.raceId, race.id), eq(raceEntries.horseId, mare.id)));
    expect(entry!.status).toBe("scratched");
    expect(await getHorseRow(h.db, mare.id)).toMatchObject({ lockKind: null, lockRef: null });
    const [after] = await h.db.select().from(stables).where(eq(stables.id, p.stableId));
    expect(after!.entryBalance).toBe(6);
  });
});

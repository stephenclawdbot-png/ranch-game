import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { isDomainError } from "../errors";
import { bps, defaultAppraise, RULES } from "../rules";
import { fraudEvents, horses } from "../schema";
import { recordAccountSignal } from "../services/accounts";
import { breed } from "../services/breeding";
import { getBalance, ledgerHealth } from "../services/ledger";
import { buyListing, cancelListing, expireListings, listHorse } from "../services/market";
import { createRace, enterRace } from "../services/races";
import { at, count, DAY, expectDbError, getHorseRow, makeHorse, makeSeller, memoryDb, MIN, newPlayer, settledAll, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

async function seller() {
  const p = await newPlayer(h.db);
  await makeSeller(h.db, p.accountId, p.stableId);
  return p;
}

describe("market", () => {
  it("one horse is never owned by two users: concurrent buyers, exactly one wins", async () => {
    const s = await seller();
    const horse = await makeHorse(h.db, s.stableId, { rating: 10 });
    const listing = await listHorse(h.db, { accountId: s.accountId, horseId: horse.id, price: 2_000, now: T0 });
    const buyers = await Promise.all(Array.from({ length: 4 }, () => newPlayer(h.db, { credits: 5_000 })));
    const res = await settledAll(buyers.map((b) => buyListing(h.db, { accountId: b.accountId, listingId: listing.id, now: at(MIN) })));
    expect(res.ok).toHaveLength(1);
    expect(res.errors.every((e) => isDomainError(e, "LISTING_NOT_ACTIVE"))).toBe(true);

    const after = await getHorseRow(h.db, horse.id);
    const winner = buyers.find((b) => b.stableId === after.ownerStableId)!;
    expect(winner).toBeDefined();
    expect(after.lockKind).toBeNull();
    // Only the winner paid; the seller got 95%; 5% burned.
    for (const b of buyers) expect(await getBalance(h.db, b.accountId)).toBe(b === winner ? 3_000 : 5_000);
    expect(await getBalance(h.db, s.accountId)).toBe(5_000 + 1_900);
    expect(await count(h.db, "trades", `horse_id = '${horse.id}'`)).toBe(1);
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
  });

  it("can't sell a horse locked in a race, or a mare in foal (service and DB trigger)", async () => {
    const s = await seller();
    const runner = await makeHorse(h.db, s.stableId);
    const race = await createRace(h.db, { kind: "quick", name: "R", raceClass: "maiden", conditions: {}, postTime: at(10 * MIN), entriesCloseAt: at(9 * MIN) });
    await enterRace(h.db, { accountId: s.accountId, raceId: race.id, horseId: runner.id, tactic: "front", now: T0 });
    await expect(listHorse(h.db, { accountId: s.accountId, horseId: runner.id, price: 5_000, now: T0 })).rejects.toMatchObject({ code: "HORSE_LOCKED" });

    const mare = await makeHorse(h.db, s.stableId, { sex: "female", careerStatus: "retired", retirementReason: "choice", retiredAt: T0 });
    const stallion = await makeHorse(h.db, s.stableId, { sex: "male", careerStatus: "retired", retirementReason: "choice", retiredAt: T0 });
    await breed(h.db, { accountId: s.accountId, sireId: stallion.id, damId: mare.id, now: T0, idempotencyKey: `b:${mare.id}` });
    await expect(listHorse(h.db, { accountId: s.accountId, horseId: mare.id, price: 5_000, now: T0 })).rejects.toMatchObject({ code: "HORSE_IN_FOAL" });

    // Bypassing the services, the database still refuses both transfers.
    const other = await newPlayer(h.db);
    await expectDbError(h.db.update(horses).set({ ownerStableId: other.stableId }).where(eq(horses.id, runner.id)), /entered in a race/);
    await expectDbError(h.db.update(horses).set({ ownerStableId: other.stableId }).where(eq(horses.id, mare.id)), /in foal/);
  });

  it("listed horses are escrowed: no double listing, no racing; cancel and expiry return them", async () => {
    const s = await seller();
    const horse = await makeHorse(h.db, s.stableId);
    const l1 = await listHorse(h.db, { accountId: s.accountId, horseId: horse.id, price: 5_000, now: T0, durationMs: DAY });
    await expect(listHorse(h.db, { accountId: s.accountId, horseId: horse.id, price: 5_000, now: T0 })).rejects.toMatchObject({ code: "HORSE_LOCKED" });
    const race = await createRace(h.db, { kind: "quick", name: "R", raceClass: "maiden", conditions: {}, postTime: at(10 * MIN), entriesCloseAt: at(9 * MIN) });
    await expect(enterRace(h.db, { accountId: s.accountId, raceId: race.id, horseId: horse.id, tactic: "front", now: T0 })).rejects.toMatchObject({ code: "HORSE_LOCKED" });
    await cancelListing(h.db, { accountId: s.accountId, listingId: l1.id, now: T0 });
    expect((await getHorseRow(h.db, horse.id)).lockKind).toBeNull();

    const l2 = await listHorse(h.db, { accountId: s.accountId, horseId: horse.id, price: 5_000, now: T0, durationMs: DAY });
    const buyer = await newPlayer(h.db, { credits: 10_000 });
    await expect(buyListing(h.db, { accountId: buyer.accountId, listingId: l2.id, now: at(2 * DAY) })).rejects.toMatchObject({ code: "LISTING_EXPIRED" });
    expect(await expireListings(h.db, at(2 * DAY))).toBeGreaterThanOrEqual(1);
    const back = await getHorseRow(h.db, horse.id);
    expect(back.ownerStableId).toBe(s.stableId);
    expect(back.lockKind).toBeNull();
  });

  it("bound (Club-bred) horses can't be sold or transferred; foals of bound parents need 5 starts", async () => {
    const s = await seller();
    const bound = await makeHorse(h.db, s.stableId, { bound: true });
    await expect(listHorse(h.db, { accountId: s.accountId, horseId: bound.id, price: 5_000, now: T0 })).rejects.toMatchObject({ code: "HORSE_BOUND" });
    const other = await newPlayer(h.db);
    await expectDbError(h.db.update(horses).set({ ownerStableId: other.stableId }).where(eq(horses.id, bound.id)), /bound/);

    const youngster = await makeHorse(h.db, s.stableId, { tradeMinStarts: 5, starts: 4 });
    await expect(listHorse(h.db, { accountId: s.accountId, horseId: youngster.id, price: 5_000, now: T0 })).rejects.toMatchObject({ code: "HORSE_BOUND" });
    await h.db.update(horses).set({ starts: 5 }).where(eq(horses.id, youngster.id));
    await expect(listHorse(h.db, { accountId: s.accountId, horseId: youngster.id, price: 5_000, now: T0 })).resolves.toBeDefined();
  });

  it("enforces seller requirements and the 70% appraisal floor", async () => {
    const fresh = await newPlayer(h.db);
    const horse = await makeHorse(h.db, fresh.stableId, { rating: 50 });
    await expect(listHorse(h.db, { accountId: fresh.accountId, horseId: horse.id, price: 5_000, now: T0 })).rejects.toMatchObject({
      code: "SELLER_REQUIREMENTS",
    });
    await makeSeller(h.db, fresh.accountId, fresh.stableId);
    const floor = bps(defaultAppraise(await getHorseRow(h.db, horse.id)), RULES.listingFloorBps);
    await expect(listHorse(h.db, { accountId: fresh.accountId, horseId: horse.id, price: floor - 1, now: T0 })).rejects.toMatchObject({
      code: "PRICE_BELOW_FLOOR",
    });
    await expect(listHorse(h.db, { accountId: fresh.accountId, horseId: horse.id, price: floor, now: T0 })).resolves.toMatchObject({ price: floor });
  });

  it("blocks trades between linked accounts and records a fraud event", async () => {
    const s = await seller();
    const horse = await makeHorse(h.db, s.stableId);
    const listing = await listHorse(h.db, { accountId: s.accountId, horseId: horse.id, price: 5_000, now: T0 });
    const alt = await newPlayer(h.db, { credits: 10_000 });
    await recordAccountSignal(h.db, { accountId: s.accountId, kind: "device", value: "device-abc" });
    const linked = await recordAccountSignal(h.db, { accountId: alt.accountId, kind: "device", value: "device-abc" });
    expect(linked).toEqual([s.accountId]);
    await expect(buyListing(h.db, { accountId: alt.accountId, listingId: listing.id, now: T0 })).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    const events = await h.db.select().from(fraudEvents).where(eq(fraudEvents.accountId, alt.accountId));
    expect(events.map((e) => e.kind)).toContain("linked_trade_blocked");
    expect((await getHorseRow(h.db, horse.id)).ownerStableId).toBe(s.stableId);
    expect(await getBalance(h.db, alt.accountId)).toBe(10_000);
  });

  it("can't buy your own listing", async () => {
    const s = await seller();
    const horse = await makeHorse(h.db, s.stableId);
    const listing = await listHorse(h.db, { accountId: s.accountId, horseId: horse.id, price: 5_000, now: T0 });
    await expect(buyListing(h.db, { accountId: s.accountId, listingId: listing.id, now: T0 })).rejects.toMatchObject({ code: "CANNOT_BUY_OWN" });
  });
});

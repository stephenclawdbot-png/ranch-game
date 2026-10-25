import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { commitSeed } from "../crypto";
import { isDomainError } from "../errors";
import { RULES, seasonNumberAt, type GameHooks } from "../rules";
import { stables } from "../schema";
import { occupancy, recordPlayDay, stableOf, upgradeStalls } from "../services/accounts";
import { breed, foal } from "../services/breeding";
import { moveToLegacyFarm, releaseToClub } from "../services/horses";
import { getBalance, ledgerHealth } from "../services/ledger";
import { buyListing, listHorse } from "../services/market";
import { foalCropStatus, getPackState, pullPack, setFoalCropCap } from "../services/packs";
import { defaultHooks } from "../rules";
import { at, count, DAY, getHorseRow, makeHorse, makeSeller, memoryDb, newPlayer, settledAll, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const retired = { careerStatus: "retired" as const, retirementReason: "choice" as const, retiredAt: T0 };
let key = 0;
const k = () => `pull-${++key}`;

describe("stall capacity", () => {
  it("new stables get 6 stalls and 3 bound starter horses; upgrades stop at 24", async () => {
    const p = await newPlayer(h.db, { starters: 3, credits: 100_000 });
    const s = await stableOf(h.db, p.accountId);
    expect(s.stallSlots).toBe(6);
    expect(await occupancy(h.db, s)).toMatchObject({ horses: 3, free: 3 });
    expect((await getHorseRow(h.db, p.horseIds[0]!)).bound).toBe(true);
    await upgradeStalls(h.db, { accountId: p.accountId, addSlots: 18, cost: 1_000, idempotencyKey: `up:${p.accountId}` });
    await expect(upgradeStalls(h.db, { accountId: p.accountId, addSlots: 1, cost: 1_000, idempotencyKey: `up2:${p.accountId}` })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect((await stableOf(h.db, p.accountId)).stallSlots).toBe(24);
  });

  it("is enforced under concurrency: one free stall, five simultaneous pack pulls → one horse", async () => {
    const p = await newPlayer(h.db, { credits: 100_000 });
    for (let i = 0; i < 5; i++) await makeHorse(h.db, p.stableId);
    const res = await settledAll(Array.from({ length: 5 }, () => pullPack(h.db, { accountId: p.accountId, packType: "premium", idempotencyKey: k(), now: T0 })));
    expect(res.ok).toHaveLength(1);
    expect(res.errors.every((e) => isDomainError(e, "STABLE_FULL"))).toBe(true);
    expect(await count(h.db, "horses", `owner_stable_id = '${p.stableId}'`)).toBe(6);
    expect(await getBalance(h.db, p.accountId)).toBe(100_000 - 2_500); // losers were not charged
  });

  it("is enforced on market buys, concurrently across listings", async () => {
    const seller = await newPlayer(h.db);
    await makeSeller(h.db, seller.accountId, seller.stableId);
    const listings = [];
    for (let i = 0; i < 3; i++) {
      const horse = await makeHorse(h.db, seller.stableId);
      listings.push(await listHorse(h.db, { accountId: seller.accountId, horseId: horse.id, price: 1_000, now: T0 }));
    }
    const buyer = await newPlayer(h.db, { credits: 10_000 });
    for (let i = 0; i < 5; i++) await makeHorse(h.db, buyer.stableId);
    const res = await settledAll(listings.map((l) => buyListing(h.db, { accountId: buyer.accountId, listingId: l.id, now: T0 })));
    expect(res.ok).toHaveLength(1);
    expect(res.errors.every((e) => isDomainError(e, "STABLE_FULL"))).toBe(true);
    expect(await count(h.db, "horses", `owner_stable_id = '${buyer.stableId}'`)).toBe(6);
  });

  it("foaling uses the nursery overflow slot and never loses the foal; Legacy Farm and release free stalls", async () => {
    const p = await newPlayer(h.db, { credits: 100_000 });
    const sire = await makeHorse(h.db, p.stableId, { sex: "male", ...retired });
    const dam = await makeHorse(h.db, p.stableId, { sex: "female", ...retired });
    const filler = [];
    for (let i = 0; i < 4; i++) filler.push(await makeHorse(h.db, p.stableId));
    // 6/6 stalls: covering may still use the single overflow slot.
    const b = await breed(h.db, { accountId: p.accountId, sireId: sire.id, damId: dam.id, now: T0, idempotencyKey: `ovf:${dam.id}` });
    const s = await stableOf(h.db, p.accountId);
    expect(await occupancy(h.db, s)).toMatchObject({ used: 7, overflow: true });
    // ... but nothing else can be acquired, and no second foal can be on the way.
    await expect(pullPack(h.db, { accountId: p.accountId, packType: "premium", idempotencyKey: k(), now: T0 })).rejects.toMatchObject({ code: "STABLE_FULL" });
    const dam2 = await makeHorse(h.db, null, { sex: "female", ...retired });
    await h.db.execute(`update horses set owner_stable_id = '${p.stableId}' where id = '${dam2.id}'`);
    await expect(breed(h.db, { accountId: p.accountId, sireId: sire.id, damId: dam2.id, now: T0, idempotencyKey: `ovf2:${dam2.id}` })).rejects.toMatchObject({
      code: "STABLE_FULL",
    });
    await releaseToClub(h.db, { accountId: p.accountId, horseId: dam2.id, now: T0 });

    const f = await foal(h.db, { pregnancyId: b.pregnancyId, now: at(DAY) });
    expect(f.inOverflow).toBe(true);
    expect((await getHorseRow(h.db, f.foalId)).ownerStableId).toBe(p.stableId);

    await moveToLegacyFarm(h.db, { accountId: p.accountId, horseId: filler[0]!.id, now: at(DAY) });
    expect(await occupancy(h.db, s)).toMatchObject({ used: 6, overflow: false });
    await releaseToClub(h.db, { accountId: p.accountId, horseId: filler[1]!.id, now: at(DAY) });
    expect((await getHorseRow(h.db, filler[1]!.id)).ownerStableId).toBeNull();
    await expect(pullPack(h.db, { accountId: p.accountId, packType: "premium", idempotencyKey: k(), now: at(DAY) })).resolves.toBeDefined();
  });
});

describe("packs", () => {
  it("commits the next seed before the pull and reveals it after", async () => {
    const p = await newPlayer(h.db, { credits: 100_000 });
    const state = await getPackState(h.db, { accountId: p.accountId, packType: "premium", now: T0 });
    const r = await pullPack(h.db, { accountId: p.accountId, packType: "premium", idempotencyKey: k(), now: T0 });
    expect(r.seedCommitment).toBe(state.nextSeedCommitment);
    expect(commitSeed(r.seedReveal)).toBe(r.seedCommitment);
    expect(r.nextSeedCommitment).not.toBe(r.seedCommitment);
    const horse = await getHorseRow(h.db, r.horseId);
    expect(horse).toMatchObject({ origin: "pack", stage: "foal", careSessions: 0, bound: false });
  });

  it("pity: Rare within 10, Epic within 50 (even if the roll is always Common)", async () => {
    const p = await newPlayer(h.db, { credits: 1_000_000 });
    await h.db.update(stables).set({ stallSlots: 24 }).where(eq(stables.id, p.stableId));
    const unlucky: GameHooks = { ...defaultHooks, rollRarity: () => "common" };
    const rarities: string[] = [];
    for (let i = 0; i < 50; i++) {
      const week = Math.floor(i / RULES.premiumPerWeek);
      const r = await pullPack(h.db, { accountId: p.accountId, packType: "premium", idempotencyKey: k(), now: at(week * 7 * DAY) }, unlucky);
      rarities.push(r.rarity);
      // Keep stalls free: release each pack foal to the Club.
      await releaseToClub(h.db, { accountId: p.accountId, horseId: r.horseId, now: at(week * 7 * DAY) });
    }
    expect(rarities[9]).toBe("rare");
    expect(rarities[19]).toBe("rare");
    expect(rarities[49]).toBe("epic");
    expect(rarities.filter((r) => r === "common")).toHaveLength(50 - 5);
  });

  it("is idempotent per key (no double charge, no second horse)", async () => {
    const p = await newPlayer(h.db, { credits: 10_000 });
    const key1 = k();
    const [a, b] = await Promise.all([
      pullPack(h.db, { accountId: p.accountId, packType: "paddock", idempotencyKey: key1, now: T0 }),
      pullPack(h.db, { accountId: p.accountId, packType: "paddock", idempotencyKey: key1, now: T0 }),
    ]);
    expect(a.horseId).toBe(b.horseId);
    expect(await getBalance(h.db, p.accountId)).toBe(10_000 - 500);
    expect(await count(h.db, "horses", `owner_stable_id = '${p.stableId}'`)).toBe(1);
  });

  it("weekly limits: 3 bought Paddock Packs, 10 Premium Packs", async () => {
    const p = await newPlayer(h.db, { credits: 1_000_000 });
    await h.db.update(stables).set({ stallSlots: 24 }).where(eq(stables.id, p.stableId));
    const paddock = await settledAll(Array.from({ length: 5 }, () => pullPack(h.db, { accountId: p.accountId, packType: "paddock", idempotencyKey: k(), now: T0 })));
    expect(paddock.ok).toHaveLength(3);
    expect(paddock.errors.every((e) => isDomainError(e, "PACK_LIMIT"))).toBe(true);
    const premium = await settledAll(Array.from({ length: 12 }, () => pullPack(h.db, { accountId: p.accountId, packType: "premium", idempotencyKey: k(), now: T0 })));
    expect(premium.ok).toHaveLength(10);
    // Next week the limits reset.
    await expect(pullPack(h.db, { accountId: p.accountId, packType: "paddock", idempotencyKey: k(), now: at(7 * DAY) })).resolves.toBeDefined();
  });

  it("free Paddock Pack every 3rd play day; its horse is bound", async () => {
    const p = await newPlayer(h.db);
    await expect(pullPack(h.db, { accountId: p.accountId, packType: "paddock", idempotencyKey: k(), now: T0, free: true })).rejects.toMatchObject({
      code: "PACK_LIMIT",
    });
    // (A refused pull rolls back, so record the play days explicitly.)
    await recordPlayDay(h.db, p.accountId, T0);
    await recordPlayDay(h.db, p.accountId, at(DAY));
    await recordPlayDay(h.db, p.accountId, at(5 * DAY)); // not consecutive: still counts
    const r = await pullPack(h.db, { accountId: p.accountId, packType: "paddock", idempotencyKey: k(), now: at(5 * DAY), free: true });
    expect((await getHorseRow(h.db, r.horseId)).bound).toBe(true);
    expect(await getBalance(h.db, p.accountId)).toBe(5_000);
    await expect(pullPack(h.db, { accountId: p.accountId, packType: "paddock", idempotencyKey: k(), now: at(5 * DAY), free: true })).rejects.toMatchObject({
      code: "PACK_LIMIT",
    });
  });

  it("the seasonal global foal crop can't be oversold under concurrency", async () => {
    const later = at(400 * DAY); // a fresh season for this test
    const season = seasonNumberAt(later);
    await setFoalCropCap(h.db, season, 3);
    const players = await Promise.all(Array.from({ length: 6 }, () => newPlayer(h.db, { credits: 10_000 })));
    const res = await settledAll(players.map((p) => pullPack(h.db, { accountId: p.accountId, packType: "premium", idempotencyKey: k(), now: later })));
    expect(res.ok).toHaveLength(3);
    expect(res.errors.every((e) => isDomainError(e, "CROP_SOLD_OUT"))).toBe(true);
    expect(await foalCropStatus(h.db, season)).toMatchObject({ produced: 3, remaining: 0 });
    // Losers were not charged.
    const balances = await Promise.all(players.map((p) => getBalance(h.db, p.accountId)));
    expect(balances.filter((b) => b === 10_000)).toHaveLength(3);
    await expect(h.db.execute(`update foal_crop set produced = cap + 1 where season_number = ${season}`)).rejects.toThrow();
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
  });
});

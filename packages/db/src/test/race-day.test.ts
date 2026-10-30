import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { ledgerTransactions } from "../schema";
import { getBalance, ledgerHealth } from "../services/ledger";
import { cancelRace, createRace, enterRace, fieldHashOf, lockField, scratchEntry, storedRaceDay, type CreateRaceInput } from "../services/races";
import { at, MIN, makeHorse, memoryDb, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let n = 0;
function liveRace(extra: Partial<CreateRaceInput> = {}) {
  return createRace(h.db, {
    kind: "scheduled",
    name: `Race day ${++n}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 140, distanceM: 1400, surface: "turf", going: "soft" },
    postTime: at(10 * MIN),
    entriesCloseAt: at(9 * MIN),
    purse: 16_000,
    maxRunners: 12,
    targetRunners: 8,
    ...extra,
  });
}

/** Ledger transaction kinds posted for a race (by idempotency key). */
async function kinds(raceId: string): Promise<string[]> {
  const rows = await h.db.select({ kind: ledgerTransactions.kind, key: ledgerTransactions.idempotencyKey }).from(ledgerTransactions);
  return rows.filter((r) => r.key.includes(raceId)).map((r) => r.kind);
}

const FULL: gc.RaceDayChoice = { extras: ["soft_shoes", "physio", "vet_check"], jockey: "top" };

describe("race-day extras and jockeys", () => {
  it("are charged with the entry (race_extras, jockey_fee) and stored in the entry snapshot", async () => {
    const p = await newPlayer(h.db, { credits: 5_000 });
    const horse = await makeHorse(h.db, p.stableId);
    const race = await liveRace();
    const quote = gc.raceDayQuote(FULL, race.purse);
    expect(quote.extrasTotal).toBe(3 * 320);
    expect(quote.jockeyFee).toBe(800);
    const entry = await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0, raceDay: FULL });
    expect(await getBalance(h.db, p.accountId)).toBe(5_000 + gc.DAILY_GOAL_CREDITS - quote.total);
    expect(storedRaceDay(entry.snapshot)).toEqual({ ...FULL, paid: { extras: 960, jockey: 800 } });
    const k = await kinds(race.id);
    expect(k).toContain("race_extras");
    expect(k).toContain("jockey_fee");
    // Entering again is idempotent: nothing is charged twice.
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0, raceDay: FULL });
    expect(await getBalance(h.db, p.accountId)).toBe(5_000 + gc.DAILY_GOAL_CREDITS - quote.total);
  });

  it("an entry without extras stores and charges nothing extra", async () => {
    const p = await newPlayer(h.db, { credits: 5_000 });
    const horse = await makeHorse(h.db, p.stableId);
    const race = await liveRace();
    const entry = await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0 });
    expect((entry.snapshot as Record<string, unknown>).raceDay).toBeUndefined();
    expect(storedRaceDay(entry.snapshot)).toBeNull();
    expect(await getBalance(h.db, p.accountId)).toBe(5_000 + gc.DAILY_GOAL_CREDITS);
  });

  it("refuses shoes the going doesn't call for, extras in Story races, and what the stable can't pay", async () => {
    const p = await newPlayer(h.db, { credits: 5_000 });
    const horse = await makeHorse(h.db, p.stableId);
    const good = await liveRace({ conditions: { minRating: 0, maxRating: 140, distanceM: 1400, surface: "turf", going: "good" } });
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: good.id, horseId: horse.id, tactic: "front", now: T0, raceDay: { extras: ["soft_shoes"], jockey: "apprentice" } })).rejects.toMatchObject({
      code: "NOT_ELIGIBLE",
    });
    const story = await liveRace({ kind: "quick", targetRunners: 2 });
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: story.id, horseId: horse.id, tactic: "front", now: T0, raceDay: { extras: [], jockey: "top" } })).rejects.toMatchObject({
      code: "NOT_ELIGIBLE",
    });
    const poor = await newPlayer(h.db, { credits: 100 });
    const pony = await makeHorse(h.db, poor.stableId);
    const rich = await liveRace({ purse: 72_000 });
    await expect(enterRace(h.db, { accountId: poor.accountId, raceId: rich.id, horseId: pony.id, tactic: "front", now: T0, raceDay: { extras: [], jockey: "top" } })).rejects.toBeDefined();
    // Nothing half-done: the horse is free and nothing was charged.
    expect(await getBalance(h.db, poor.accountId)).toBe(100);
    // Firm shoes on good going are refused too.
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: good.id, horseId: horse.id, tactic: "front", now: T0, raceDay: { extras: ["firm_shoes"], jockey: "apprentice" } })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("scratching before the close refunds the extras and the jockey (the entry fee rules are unchanged)", async () => {
    const p = await newPlayer(h.db, { credits: 5_000 });
    const horse = await makeHorse(h.db, p.stableId);
    const race = await liveRace();
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0, raceDay: FULL });
    const before = await getBalance(h.db, p.accountId);
    await scratchEntry(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, now: T0 });
    await scratchEntry(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, now: T0 }); // idempotent
    expect(await getBalance(h.db, p.accountId)).toBe(before + gc.raceDayQuote(FULL, race.purse).total);
    const k = await kinds(race.id);
    expect(k).toContain("race_extras_refund");
    expect(k).toContain("jockey_fee_refund");
    expect((await ledgerHealth(h.db)).unbalancedTransactions).toEqual([]);
  });

  it("an abandoned race refunds them too, once", async () => {
    const p = await newPlayer(h.db, { credits: 5_000 });
    const horse = await makeHorse(h.db, p.stableId);
    const race = await liveRace();
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0, raceDay: { extras: ["vet_check"], jockey: "journeyman" } });
    const before = await getBalance(h.db, p.accountId);
    await Promise.all([cancelRace(h.db, { raceId: race.id, now: T0, reason: "test" }), cancelRace(h.db, { raceId: race.id, now: T0, reason: "test" })]);
    expect(await getBalance(h.db, p.accountId)).toBe(before + 320 + 400);
  });

  it("the locked field carries the engine kit for runners that bought one, and hashes old fields as before", async () => {
    const p = await newPlayer(h.db, { credits: 5_000 });
    const q = await newPlayer(h.db, { credits: 5_000 });
    const race = await liveRace();
    const a = await makeHorse(h.db, p.stableId);
    const b = await makeHorse(h.db, q.stableId);
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: a.id, tactic: "stalker", now: T0, raceDay: FULL });
    await enterRace(h.db, { accountId: q.accountId, raceId: race.id, horseId: b.id, tactic: "stalker", now: T0, raceDay: { extras: ["vet_check"], jockey: "apprentice" } });
    const field = (await lockField(h.db, race.id, at(9 * MIN)))!;
    const ra = field.runners.find((r) => r.horseId === a.id)!;
    const rb = field.runners.find((r) => r.horseId === b.id)!;
    expect(ra.kit).toEqual({ goingPenaltyPermille: 500, formAmpPermille: 800, keenPermille: 500 });
    expect(rb.kit).toBeUndefined(); // a vet check acts on the injury roll, not on the track
    expect("kit" in rb).toBe(false);
    for (const r of field.runners.filter((x) => x.isHouse)) expect(r.kit).toBeUndefined();
    expect(field.fieldHash).toBe(fieldHashOf(field.runners));
    // A runner list without kit hashes exactly as the old formula did.
    const old = field.runners.map(({ kit: _k, ...r }) => r);
    const { sha256Hex } = await import("../crypto");
    expect(fieldHashOf(old)).toBe(sha256Hex(JSON.stringify(old.map((r) => [r.gate, r.horseId, r.tactic, r.horse]))));
  });

  it("a locked field can't be scratched from, so nothing is refunded once the field is set", async () => {
    const p = await newPlayer(h.db, { credits: 5_000 });
    const horse = await makeHorse(h.db, p.stableId);
    const race = await liveRace();
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0, raceDay: FULL });
    await lockField(h.db, race.id, at(9 * MIN));
    const before = await getBalance(h.db, p.accountId);
    await expect(scratchEntry(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, now: at(9 * MIN) })).rejects.toMatchObject({ code: "RACE_CLOSED" });
    expect(await getBalance(h.db, p.accountId)).toBe(before);
    const rows = await h.db.select().from(ledgerTransactions).where(eq(ledgerTransactions.idempotencyKey, `race-day-refund:extras:${race.id}:${horse.id}`));
    expect(rows).toHaveLength(0);
  });
});

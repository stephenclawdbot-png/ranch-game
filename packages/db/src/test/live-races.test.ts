import { asc, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { commitSeed } from "../crypto";
import { isDomainError } from "../errors";
import { RULES } from "../rules";
import { gc } from "../gameCore";
import { entryMovements, raceEntries, races, stables } from "../schema";
import { createAccount } from "../services/accounts";
import { ensureRaceCard, slotIndexAt, tickRaceCard } from "../services/card";
import { listCardRaces } from "../services/player";
import { getEntryBank, localDate, refillEntries, setTimezone, upgradeEntryTier } from "../services/entries";
import { getBalance } from "../services/ledger";
import { cancelRace, createRace, enterRace, getRaceForSimulation, lockField, scratchEntry, settleRace, type CreateRaceInput } from "../services/races";
import { at, count, DAY, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, settledAll, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let n = 0;
function liveRace(extra: Partial<CreateRaceInput> = {}, offsetMs = 0) {
  return createRace(h.db, {
    kind: "scheduled",
    name: `Live ${++n}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 140, distanceM: 1400, surface: "turf" },
    postTime: at(offsetMs + 10 * MIN),
    entriesCloseAt: at(offsetMs + 9 * MIN),
    purse: 3_000,
    maxRunners: 12,
    targetRunners: 10,
    ...extra,
  });
}

async function bank(accountId: string, now = T0) {
  return getEntryBank(h.db, { accountId, now });
}

describe("race card", () => {
  it("publishes one race per slot, idempotently across concurrent instances", async () => {
    const now = at(30 * DAY);
    const cards = await Promise.all([ensureRaceCard(h.db, now), ensureRaceCard(h.db, now), ensureRaceCard(h.db, now)]);
    const expected = RULES.cardHorizonMs / RULES.slotMs;
    expect(cards[0]).toHaveLength(expected);
    expect(cards[1]!.map((r) => r.seedCommitment)).toEqual(cards[0]!.map((r) => r.seedCommitment));
    const first = slotIndexAt(now) + 1;
    expect(await count(h.db, "races", `slot_key in (${Array.from({ length: expected }, (_, i) => `'live:${first + i}'`).join(",")})`)).toBe(expected);
    expect(RULES.entriesCloseBeforePostMs).toBe(30_000); // one going-to-post constant, from game-core
    for (const r of cards[0]!) {
      expect(r.entriesCloseAt.getTime()).toBe(r.postTime.getTime() - 30_000);
      expect(r.postTime.getTime() % RULES.slotMs).toBe(RULES.seasonEpochMs % RULES.slotMs);
      expect(r.targetRunners).toBeGreaterThanOrEqual(8);
      expect(r.targetRunners).toBeLessThanOrEqual(12);
      expect(r.entryCost).toBe(r.kind === "feature" ? 2 : 1);
    }
    // Deterministic conditions per slot.
    const again = await ensureRaceCard(h.db, now);
    expect(again.map((r) => [r.name, r.conditions])).toEqual(cards[0]!.map((r) => [r.name, r.conditions]));
  });
});

describe("entering live races", () => {
  it("enforces class / rating bands and maiden conditions", async () => {
    const p = await newPlayer(h.db);
    const low = await makeHorse(h.db, p.stableId, { rating: 40 });
    const winner = await makeHorse(h.db, p.stableId, { rating: 60, wins: 1, starts: 3 });
    const band = await liveRace({ conditions: { minRating: 50, maxRating: 75 } });
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: band.id, horseId: low.id, tactic: "front", now: T0 })).rejects.toMatchObject({
      code: "NOT_ELIGIBLE",
    });
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: band.id, horseId: winner.id, tactic: "front", now: T0 })).resolves.toBeDefined();
    const maiden = await liveRace({ raceClass: "maiden", conditions: { maxWins: 0, maxRating: 60 } });
    const w2 = await makeHorse(h.db, p.stableId, { rating: 30, wins: 1, starts: 2 });
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: maiden.id, horseId: w2.id, tactic: "front", now: T0 })).rejects.toMatchObject({
      code: "NOT_ELIGIBLE",
    });
  });

  it("closes entries 30 s before the off; a horse runs in one race at a time; entering is idempotent", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    const a = await liveRace();
    const b = await liveRace();
    const e1 = await enterRace(h.db, { accountId: p.accountId, raceId: a.id, horseId: horse.id, tactic: "front", now: T0 });
    const e2 = await enterRace(h.db, { accountId: p.accountId, raceId: a.id, horseId: horse.id, tactic: "front", now: T0 });
    expect(e2.id).toBe(e1.id);
    expect((await bank(p.accountId)).balance).toBe(9); // charged once
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: b.id, horseId: horse.id, tactic: "front", now: T0 })).rejects.toMatchObject({
      code: "HORSE_LOCKED",
    });
    const other = await makeHorse(h.db, p.stableId);
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: b.id, horseId: other.id, tactic: "front", now: at(9 * MIN) })).rejects.toMatchObject({
      code: "RACE_CLOSED",
    });
  });

  it("one horse per stable per Live race, even with concurrent entries; other stables unaffected", async () => {
    const p = await newPlayer(h.db);
    const q = await newPlayer(h.db);
    const race = await liveRace({ targetRunners: 8 });
    const mine = await Promise.all(Array.from({ length: 6 }, () => makeHorse(h.db, p.stableId)));
    const theirs = await Promise.all(Array.from({ length: 2 }, () => makeHorse(h.db, q.stableId)));
    const res = await settledAll([
      ...mine.map((x) => enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: x.id, tactic: "front", now: T0 })),
      ...theirs.map((x) => enterRace(h.db, { accountId: q.accountId, raceId: race.id, horseId: x.id, tactic: "front", now: T0 })),
    ]);
    expect(res.ok).toHaveLength(2); // one horse from each stable
    expect(res.errors.every((e) => isDomainError(e, "STABLE_ALREADY_ENTERED"))).toBe(true);
    expect(res.errors.every((e) => /you already have Horse \d+ in this race/.test((e as Error).message))).toBe(true);
    // A story race (quick) still takes several horses from one stable.
    const story = await liveRace({ kind: "quick", targetRunners: 2 });
    const three = await Promise.all([makeHorse(h.db, p.stableId), makeHorse(h.db, p.stableId), makeHorse(h.db, p.stableId)]);
    for (const x of three) await enterRace(h.db, { accountId: p.accountId, raceId: story.id, horseId: x.id, tactic: "front", now: T0 });
    expect(await count(h.db, "race_entries", `race_id = '${story.id}'`)).toBe(3);
  });

  it("consumes stable entries (Live 1, Feature 2, Story 0) and never goes negative", async () => {
    const p = await newPlayer(h.db);
    expect((await bank(p.accountId)).balance).toBe(10);
    const feature = await liveRace({ kind: "feature" });
    const story = await liveRace({ kind: "quick", targetRunners: 2 });
    const horses = await Promise.all(Array.from({ length: 3 }, () => makeHorse(h.db, p.stableId)));
    await enterRace(h.db, { accountId: p.accountId, raceId: feature.id, horseId: horses[0]!.id, tactic: "front", now: T0 });
    await enterRace(h.db, { accountId: p.accountId, raceId: story.id, horseId: horses[1]!.id, tactic: "front", now: T0 });
    expect((await bank(p.accountId)).balance).toBe(8);
    // Drain the bank to 1, then a Feature (2) is refused without side effects.
    await h.db.update(stables).set({ entryBalance: 1 }).where(eq(stables.id, p.stableId));
    const f2 = await liveRace({ kind: "feature" });
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: f2.id, horseId: horses[2]!.id, tactic: "front", now: T0 })).rejects.toMatchObject({
      code: "INSUFFICIENT_ENTRIES",
    });
    expect((await getHorseRow(h.db, horses[2]!.id)).lockKind).toBeNull();
    await expect(h.db.update(stables).set({ entryBalance: -1 }).where(eq(stables.id, p.stableId))).rejects.toThrow();
  });

  it("scratching forfeits the entry; an abandoned race refunds it (once)", async () => {
    const p = await newPlayer(h.db);
    const x = await makeHorse(h.db, p.stableId);
    const y = await makeHorse(h.db, p.stableId);
    const r1 = await liveRace();
    await enterRace(h.db, { accountId: p.accountId, raceId: r1.id, horseId: x.id, tactic: "front", now: T0 });
    await scratchEntry(h.db, { accountId: p.accountId, raceId: r1.id, horseId: x.id, now: T0 });
    expect((await getHorseRow(h.db, x.id)).lockKind).toBeNull();
    expect((await bank(p.accountId)).balance).toBe(9);
    await expect(enterRace(h.db, { accountId: p.accountId, raceId: r1.id, horseId: x.id, tactic: "front", now: T0 })).rejects.toMatchObject({
      code: "RACE_CLOSED",
    });
    const r2 = await liveRace();
    await enterRace(h.db, { accountId: p.accountId, raceId: r2.id, horseId: y.id, tactic: "front", now: T0 });
    expect((await bank(p.accountId)).balance).toBe(8);
    await Promise.all([cancelRace(h.db, { raceId: r2.id, now: T0, reason: "test" }), cancelRace(h.db, { raceId: r2.id, now: T0, reason: "test" })]);
    expect((await bank(p.accountId)).balance).toBe(9);
    expect((await getHorseRow(h.db, y.id)).lockKind).toBeNull();
  });
});

describe("field lock and settlement", () => {
  it("locks once even when several instances race to do it; fills with house horses; gates drawn from the seed", async () => {
    const p = await newPlayer(h.db);
    const q = await newPlayer(h.db);
    const r = await newPlayer(h.db);
    const race = await liveRace({ targetRunners: 9 });
    for (const pl of [p, q, r]) {
      const horse = await makeHorse(h.db, pl.stableId);
      await enterRace(h.db, { accountId: pl.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0 });
    }
    await expect(lockField(h.db, race.id, at(8 * MIN))).rejects.toMatchObject({ code: "TOO_EARLY" });
    const closeAt = at(9 * MIN);
    const fields = await Promise.all([lockField(h.db, race.id, closeAt), lockField(h.db, race.id, closeAt), tickRaceCard(h.db, closeAt).then(() => lockField(h.db, race.id, closeAt))]);
    expect(new Set(fields.map((f) => f.fieldHash)).size).toBe(1);
    const field = fields[0]!;
    expect(field.runners).toHaveLength(9);
    expect(field.runners.filter((r) => r.isHouse)).toHaveLength(6);
    expect(field.runners.map((r) => r.gate).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(await count(h.db, "race_entries", `race_id = '${race.id}'`)).toBe(9);
    for (const r of field.runners) expect(await getHorseRow(h.db, r.horseId)).toMatchObject({ lockKind: "race", lockRef: race.id });
    const [row] = await h.db.select().from(races).where(eq(races.id, race.id));
    expect(row!.status).toBe("locked");
    // Entries are closed for good.
    const late = await makeHorse(h.db, q.stableId);
    await expect(enterRace(h.db, { accountId: q.accountId, raceId: race.id, horseId: late.id, tactic: "front", now: closeAt })).rejects.toMatchObject({
      code: "RACE_CLOSED",
    });

    // Settlement after the broadcast, from two instances at once: exactly once.
    const sim = await getRaceForSimulation(h.db, race.id, at(10 * MIN));
    const order = sim.field.runners.map((r) => r.horseId);
    const outcome = { raceId: race.id, now: at(13 * MIN), resultHash: "a".repeat(64), result: {}, runners: order.map((horseId, i) => ({ horseId, position: i + 1 })) };
    const tick = await tickRaceCard(h.db, at(13 * MIN));
    expect(tick.dueForSettlement.map((r) => r.id)).toContain(race.id);
    const settled = await Promise.all([settleRace(h.db, outcome), settleRace(h.db, outcome)]);
    expect(settled.filter((s) => !s.alreadySettled)).toHaveLength(1);
    for (const r of field.runners) expect((await getHorseRow(h.db, r.horseId)).lockKind).toBeNull();
    const paid = (await getBalance(h.db, p.accountId)) + (await getBalance(h.db, q.accountId)) + (await getBalance(h.db, r.accountId));
    const playerPrizes = Object.entries(settled.find((s) => !s.alreadySettled)!.prizes)
      .filter(([id]) => field.runners.some((fr) => fr.horseId === id && !fr.isHouse))
      .reduce((s, [, v]) => s + v, 0);
    // Each stable's first entry of the day also paid its race goal.
    expect(paid).toBe(15_000 + playerPrizes + 3 * gc.DAILY_GOAL_CREDITS); // three stables of 5,000
  });

  it("house horses are reused across races and never double-booked by concurrent locks", async () => {
    const r1 = await liveRace({ targetRunners: 8 }, 60 * MIN);
    const r2 = await liveRace({ targetRunners: 8 }, 60 * MIN);
    const close = at(69 * MIN);
    const [f1, f2] = await Promise.all([lockField(h.db, r1.id, close), lockField(h.db, r2.id, close)]);
    const ids1 = new Set(f1.runners.map((r) => r.horseId));
    expect(f2.runners.some((r) => ids1.has(r.horseId))).toBe(false);
    const houseEntries = await h.db.select().from(raceEntries).where(eq(raceEntries.isHouse, true));
    expect(houseEntries.length).toBeGreaterThanOrEqual(16);
  });
});

describe("stable entry bank", () => {
  it("grants +10 once per local date even under concurrent first activity; rollover caps at 20", async () => {
    const p = await newPlayer(h.db); // signup grants day one
    await h.db.update(stables).set({ entryBalance: 4 }).where(eq(stables.id, p.stableId));
    const next = at(DAY);
    const views = await Promise.all(Array.from({ length: 5 }, () => bank(p.accountId, next)));
    expect(views.filter((v) => v.grantedNow > 0)).toHaveLength(1);
    expect((await bank(p.accountId, next)).balance).toBe(14);
    expect((await bank(p.accountId, at(2 * DAY))).balance).toBe(20); // capped, not 24
    expect((await bank(p.accountId, at(3 * DAY))).balance).toBe(20);
    // Days away are not lost (allowance x days), but never beyond the cap.
    await h.db.update(stables).set({ entryBalance: 0 }).where(eq(stables.id, p.stableId));
    expect((await bank(p.accountId, at(4 * DAY))).balance).toBe(10);
    await h.db.update(stables).set({ entryBalance: 3 }).where(eq(stables.id, p.stableId));
    expect((await bank(p.accountId, at(30 * DAY))).balance).toBe(20);
    expect(await count(h.db, "entry_movements", `stable_id = '${p.stableId}' and kind = 'daily' and local_date = '${localDate("UTC", next)}'`)).toBe(1);
  });

  it("uses the player's local midnight (timezones and DST)", async () => {
    // America/New_York leaves DST on 2026-11-01 at 06:00Z.
    expect(localDate("America/New_York", new Date("2026-11-01T03:59:00Z"))).toBe("2026-10-31");
    expect(localDate("America/New_York", new Date("2026-11-01T04:01:00Z"))).toBe("2026-11-01");
    expect(localDate("America/New_York", new Date("2026-11-02T04:30:00Z"))).toBe("2026-11-01"); // EST now
    expect(localDate("America/New_York", new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-02");
    expect(localDate("Pacific/Auckland", new Date("2026-11-02T10:59:00Z"))).toBe("2026-11-02");
    expect(localDate("Pacific/Auckland", new Date("2026-11-02T11:00:00Z"))).toBe("2026-11-03");

    const ny = await createAccount(h.db, { stableName: "NY", silks: {}, timezone: "America/New_York", starterHorses: 0, now: new Date("2026-11-01T04:01:00Z") });
    await h.db.update(stables).set({ entryBalance: 0 }).where(eq(stables.id, ny.stableId));
    // 24.5 h later but the same New York date (the clocks went back): no new grant.
    expect((await bank(ny.accountId, new Date("2026-11-02T04:30:00Z"))).balance).toBe(0);
    // New York midnight (05:00Z in EST): granted.
    expect((await bank(ny.accountId, new Date("2026-11-02T05:00:00Z"))).balance).toBe(10);

    const nz = await createAccount(h.db, { stableName: "NZ", silks: {}, timezone: "Pacific/Auckland", starterHorses: 0, now: new Date("2026-11-02T10:00:00Z") });
    await h.db.update(stables).set({ entryBalance: 0 }).where(eq(stables.id, nz.stableId));
    expect((await bank(nz.accountId, new Date("2026-11-02T10:59:00Z"))).balance).toBe(0);
    expect((await bank(nz.accountId, new Date("2026-11-02T11:00:00Z"))).balance).toBe(10);
    // Unknown timezones fall back to UTC.
    const bad = await createAccount(h.db, { stableName: "Bad", silks: {}, timezone: "Mars/Olympus", starterHorses: 0, now: T0 });
    expect((await bank(bad.accountId)).timezone).toBe("UTC");
  });

  it("timezone changes at most once per 30 days, and a change never double-grants a date", async () => {
    const p = await newPlayer(h.db);
    await expect(setTimezone(h.db, { accountId: p.accountId, timezone: "Asia/Tokyo", now: at(DAY) })).rejects.toMatchObject({ code: "TIMEZONE_LOCKED" });
    await setTimezone(h.db, { accountId: p.accountId, timezone: "Asia/Tokyo", now: at(31 * DAY) });
    await expect(setTimezone(h.db, { accountId: p.accountId, timezone: "Europe/London", now: at(40 * DAY) })).rejects.toMatchObject({ code: "TIMEZONE_LOCKED" });
    await expect(setTimezone(h.db, { accountId: p.accountId, timezone: "Not/AZone", now: at(90 * DAY) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const dailies = await h.db.select().from(entryMovements).where(eq(entryMovements.stableId, p.stableId));
    const dates = dailies.filter((m) => m.kind === "daily").map((m) => m.localDate);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("refill: +5 for credits, once per local date, only below 5", async () => {
    const p = await newPlayer(h.db, { credits: 10_000 });
    await expect(refillEntries(h.db, { accountId: p.accountId, now: T0 })).rejects.toMatchObject({ code: "ENTRY_REFILL_UNAVAILABLE" });
    await h.db.update(stables).set({ entryBalance: 4 }).where(eq(stables.id, p.stableId));
    const res = await settledAll(Array.from({ length: 3 }, () => refillEntries(h.db, { accountId: p.accountId, now: T0 })));
    expect(res.ok).toHaveLength(1);
    expect(res.ok[0]!.balance).toBe(9);
    expect(await getBalance(h.db, p.accountId)).toBe(10_000 - RULES.entryRefillPrice);
    await h.db.update(stables).set({ entryBalance: 0 }).where(eq(stables.id, p.stableId));
    await expect(refillEntries(h.db, { accountId: p.accountId, now: at(MIN) })).rejects.toMatchObject({ code: "ENTRY_REFILL_UNAVAILABLE" });
    // Next local day: the daily grant lands first (0 → 10), so no refill is needed.
    await expect(refillEntries(h.db, { accountId: p.accountId, now: at(DAY) })).rejects.toMatchObject({ code: "ENTRY_REFILL_UNAVAILABLE" });
  });

  it("facility tiers raise the allowance (max 15) and the cap (max 30)", async () => {
    const p = await newPlayer(h.db, { credits: 10_000 });
    const s = await upgradeEntryTier(h.db, { accountId: p.accountId, tier: 5, cost: 1_000, idempotencyKey: `tier:${p.accountId}` });
    expect(s).toMatchObject({ entryAllowance: 15, entryCap: 30 });
    expect((await bank(p.accountId, at(DAY))).balance).toBe(25);
    expect((await bank(p.accountId, at(2 * DAY))).balance).toBe(30);
  });
});

describe("sister courses", () => {
  let slotN = 0;
  /** A Live card race in a far-future slot (never collides with a published card slot). */
  function slotRace(extra: Partial<CreateRaceInput> = {}) {
    return createRace(h.db, {
      kind: "scheduled",
      name: "Ashcombe Sprint Stakes",
      raceClass: "maiden",
      conditions: { maxWins: 0, maxRating: 60, distanceM: 1400, surface: "turf", track: "Ashcombe" },
      postTime: at(10 * MIN),
      entriesCloseAt: at(10 * MIN - 30_000),
      purse: 2_000,
      maxRunners: 4,
      targetRunners: 4,
      slotKey: `live:9000${String(++slotN).padStart(3, "0")}`,
      ...extra,
    });
  }

  async function enter(accountId: string, stableId: string, raceId: string, rating = 40) {
    const horse = await makeHorse(h.db, stableId, { rating, wins: 0, starts: 0 });
    await enterRace(h.db, { accountId, raceId, horseId: horse.id, tactic: "front", now: T0 });
    return horse;
  }

  it("the last-but-one gate opens one sister; concurrent entries create exactly one", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const c = await newPlayer(h.db);
    const d = await newPlayer(h.db);
    const race = await slotRace();
    await enter(a.accountId, a.stableId, race.id);
    await enter(b.accountId, b.stableId, race.id);
    // The third and fourth gates arrive together: the slot lock admits exactly one sister.
    const both = await settledAll([enter(c.accountId, c.stableId, race.id), enter(d.accountId, d.stableId, race.id)]);
    expect(both.ok).toHaveLength(2);
    const sisters = await h.db.select().from(races).where(like(races.slotKey, `${race.slotKey}:%`));
    expect(sisters).toHaveLength(1);
    const [orig] = await h.db.select().from(races).where(eq(races.id, race.id));
    const s = sisters[0]!;
    expect(s).toMatchObject({
      kind: "scheduled",
      name: "Kestrel Downs Sprint Stakes", // next course in TRACKS, same race name
      slotKey: `${race.slotKey}:2`,
      conditions: { ...(orig!.conditions as Record<string, unknown>), track: "Kestrel Downs" },
      purse: orig!.purse,
      maxRunners: 4,
      targetRunners: 4,
      postTime: orig!.postTime,
      entriesCloseAt: orig!.entriesCloseAt,
      status: "open",
    });
    expect(s.seedCommitment).not.toBe(orig!.seedCommitment); // its own fresh seed commitment
    expect(commitSeed(s.seed!)).toBe(s.seedCommitment);
    // The card lists the sister right after its original.
    const list = await listCardRaces(h.db, { from: at(5 * MIN), to: at(15 * MIN) });
    expect(list[list.findIndex((r) => r.id === race.id) + 1]!.id).toBe(s.id);
    // A full race still refuses the fifth entry (the web layer retries on the sister).
    await expect(enter(b.accountId, b.stableId, race.id)).rejects.toMatchObject({ code: "RACE_FULL" });
  });

  it("caps at five sisters (six courses); filling the sixth creates no seventh", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const c = await newPlayer(h.db);
    const d = await newPlayer(h.db);
    const race = await slotRace();
    // Each round fills the slot's newest race; each full race opens the next course.
    for (let k = 0; k < 6; k++) {
      const slot = await h.db.select().from(races).where(like(races.slotKey, `${race.slotKey}%`)).orderBy(asc(races.slotKey));
      const current = slot.at(-1)!;
      const four = [a, b, c, d]; // one horse per stable per Live race
      for (const p of four) await enter(p.accountId, p.stableId, current.id);
    }
    const slot = await h.db.select().from(races).where(like(races.slotKey, `${race.slotKey}%`)).orderBy(asc(races.slotKey));
    expect(slot.map((r) => r.slotKey)).toEqual([race.slotKey, `${race.slotKey}:2`, `${race.slotKey}:3`, `${race.slotKey}:4`, `${race.slotKey}:5`, `${race.slotKey}:6`]);
    expect(slot.map((r) => (r.conditions as { track?: string }).track)).toEqual(["Ashcombe", "Kestrel Downs", "Saltmarsh", "Bellmont", "Larkspur", "Harrowgate"]);
  });

  it("a sister locks, fills with Club horses and settles like any Live race", async () => {
    const p = await newPlayer(h.db);
    const race = await slotRace();
    for (const f of [await newPlayer(h.db), await newPlayer(h.db), await newPlayer(h.db)]) {
      await enter(f.accountId, f.stableId, race.id); // one gate left: opens the sister
    }
    const [sister] = await h.db.select().from(races).where(like(races.slotKey, `${race.slotKey}:%`));
    expect(sister).toBeDefined();
    const mine = await enter(p.accountId, p.stableId, sister!.id);
    const close = at(10 * MIN - 30_000);
    const field = await lockField(h.db, sister!.id, close);
    expect(field.runners).toHaveLength(4); // 1 player + 3 Club horses
    expect(field.runners.filter((r) => r.isHouse)).toHaveLength(3);
    const sim = await getRaceForSimulation(h.db, sister!.id, at(10 * MIN));
    const before = await getBalance(h.db, p.accountId);
    const settled = await settleRace(h.db, {
      raceId: sister!.id,
      now: at(13 * MIN),
      resultHash: "c".repeat(64),
      result: {},
      runners: sim.field.runners.map((r, i) => ({ horseId: r.horseId, position: i + 1 })),
    });
    expect(settled.alreadySettled).toBe(false);
    expect(settled.prizes[mine.id]).toBeGreaterThan(0);
    expect(await getBalance(h.db, p.accountId)).toBe(before + settled.prizes[mine.id]!);
    expect((await getHorseRow(h.db, mine.id)).lockKind).toBeNull();
    expect((await h.db.select().from(races).where(eq(races.id, sister!.id)))[0]!.status).toBe("settled");
  });
});

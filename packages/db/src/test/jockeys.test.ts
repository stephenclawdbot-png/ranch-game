import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { accounts, jockeyEvents, jockeyRides, jockeys, raceEntries } from "../schema";
import { recordAccountSignal } from "../services/accounts";
import { getBalance } from "../services/ledger";
import {
  activeStableIds,
  createJockeyTx,
  ensureJockeyBackfill,
  getJockey,
  heldCount,
  jockeyCareer,
  jockeyLeaderboard,
  listJockeys,
  poolSize,
  releaseJockey,
  runJockeyMaintenance,
  signJockey,
  stableJockeys,
} from "../services/jockeys";
import { cancelRace, createRace, enterRace, fieldHashOf, lockField, scratchEntry, settleRace, type CreateRaceInput } from "../services/races";
import { DAY, MIN, T0, at, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let n = 0;
function race(extra: Partial<CreateRaceInput> = {}, offsetMs = 0) {
  return createRace(h.db, {
    kind: "scheduled",
    name: `Jockey race ${++n}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 140, distanceM: 1600, surface: "turf", going: "good" },
    postTime: at(offsetMs + 10 * MIN),
    entriesCloseAt: at(offsetMs + 9 * MIN),
    purse: 2_000,
    maxRunners: 12,
    targetRunners: 6,
    ...extra,
  });
}

async function freelancer(grade: gc.JockeyGrade = "C") {
  const v = { A: 850, B: 650, C: 500, D: 350, E: 150 }[grade];
  const j = await createJockeyTx(h.db, { seed: gc.seedFrom("test-freelancer", ++n), stableId: null, now: T0 });
  const skills = { gate: v, pace: v, finish: v, handling: v };
  await h.db.update(jockeys).set({ skills, potential: skills, wins: 60, rides: 300 }).where(eq(jockeys.id, j.id));
  return j.id;
}

describe("stable creation and backfill", () => {
  it("a new stable starts with one apprentice", async () => {
    const p = await newPlayer(h.db);
    const mine = await stableJockeys(h.db, p.stableId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.stage).toBe("apprentice");
    expect(mine[0]!.claimLb).toBe(7);
    const career = await jockeyCareer(h.db, mine[0]!.id);
    expect(career.map((e) => e.kind)).toEqual(["debut"]);
  });

  it("backfill gives older stables an apprentice once and seeds a Club pool once", async () => {
    const p = await newPlayer(h.db);
    // A stable made before jockeys: no debut event, no jockey.
    await h.db.delete(jockeyEvents).where(eq(jockeyEvents.stableId, p.stableId));
    await h.db.update(jockeys).set({ retiredAt: T0, stableId: null }).where(eq(jockeys.stableId, p.stableId));
    expect(await heldCount(h.db, p.stableId)).toBe(0);
    const first = await ensureJockeyBackfill(h.db, T0);
    expect(first.apprentices).toBeGreaterThanOrEqual(1);
    expect(first.freelancers).toBeGreaterThanOrEqual(12);
    expect(await heldCount(h.db, p.stableId)).toBe(1);
    const again = await ensureJockeyBackfill(h.db, T0);
    expect(again).toEqual({ apprentices: 0, freelancers: 0 });
    const free = await listJockeys(h.db, { filter: "freelancers" });
    expect(free.length).toBeGreaterThanOrEqual(12);
    // Seasoned riders over the career, none already due to retire.
    expect(new Set(free.map((f) => f.stage)).size).toBeGreaterThan(1);
    for (const f of free) expect(new Date(f.retireAt).getTime()).toBeGreaterThan(T0.getTime() + 2 * 7 * DAY);
  });
});

describe("signing and releasing", () => {
  it("signs a freelancer for a fee by grade, up to 3, and releases back to the pool", async () => {
    const p = await newPlayer(h.db, { credits: 20_000 });
    const a = await freelancer("C");
    const b = await freelancer("E");
    const c = await freelancer("D");
    const before = await getBalance(h.db, p.accountId);
    const r = await signJockey(h.db, { accountId: p.accountId, jockeyId: a, now: T0 });
    expect(r.fee).toBe(gc.signingFee("C"));
    expect(await getBalance(h.db, p.accountId)).toBe(before - gc.signingFee("C"));
    await signJockey(h.db, { accountId: p.accountId, jockeyId: b, now: T0 });
    expect(await heldCount(h.db, p.stableId)).toBe(3);
    await expect(signJockey(h.db, { accountId: p.accountId, jockeyId: c, now: T0 })).rejects.toMatchObject({ code: "JOCKEY_LIMIT" });
    // Another stable can't sign a held jockey.
    const q = await newPlayer(h.db, { credits: 20_000 });
    await expect(signJockey(h.db, { accountId: q.accountId, jockeyId: a, now: T0 })).rejects.toMatchObject({ code: "JOCKEY_UNAVAILABLE" });
    await releaseJockey(h.db, { accountId: p.accountId, jockeyId: a, now: T0 });
    expect((await getJockey(h.db, a))!.stableId).toBeNull();
    expect((await jockeyCareer(h.db, a)).map((e) => e.kind)).toEqual(["debut", "signed", "released"]);
    await signJockey(h.db, { accountId: p.accountId, jockeyId: c, now: T0 });
    expect(await heldCount(h.db, p.stableId)).toBe(3);
  });

  it("a linked account can't sign a jockey its alt just released", async () => {
    const a = await newPlayer(h.db, { credits: 20_000 });
    const b = await newPlayer(h.db, { credits: 20_000 });
    await recordAccountSignal(h.db, { accountId: a.accountId, kind: "wallet", value: "0xjockeylink" });
    await recordAccountSignal(h.db, { accountId: b.accountId, kind: "wallet", value: "0xjockeylink" });
    const [mine] = await stableJockeys(h.db, a.stableId);
    await releaseJockey(h.db, { accountId: a.accountId, jockeyId: mine!.id, now: T0 });
    await expect(signJockey(h.db, { accountId: b.accountId, jockeyId: mine!.id, now: at(MIN) })).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    // An unrelated stable can.
    const c = await newPlayer(h.db, { credits: 20_000 });
    await signJockey(h.db, { accountId: c.accountId, jockeyId: mine!.id, now: at(MIN) });
  });
});

describe("booking", () => {
  it("defaults to the stable's best own jockey (free); a freelancer costs a fee by grade and purse, refunded on scratch", async () => {
    const p = await newPlayer(h.db, { credits: 10_000 });
    const [own] = await stableJockeys(h.db, p.stableId);
    const r1 = await race();
    const h1 = await makeHorse(h.db, p.stableId, { rating: 60 });
    const e1 = await enterRace(h.db, { accountId: p.accountId, raceId: r1.id, horseId: h1.id, tactic: "stalker", now: at(0) });
    expect(e1.jockeyId).toBe(own!.id);

    const fl = await freelancer("A");
    const r2 = await race({}, 60 * MIN);
    const h2 = await makeHorse(h.db, p.stableId, { rating: 60 });
    const before = await getBalance(h.db, p.accountId);
    const e2 = await enterRace(h.db, { accountId: p.accountId, raceId: r2.id, horseId: h2.id, tactic: "stalker", raceDay: { extras: [], jockey: "apprentice", jockeyId: fl }, now: at(0) });
    expect(e2.jockeyId).toBe(fl);
    const fee = gc.freelanceFee("A", 2_000);
    expect(fee).toBe(100);
    expect(await getBalance(h.db, p.accountId)).toBe(before - fee);
    await scratchEntry(h.db, { accountId: p.accountId, raceId: r2.id, horseId: h2.id, now: at(MIN) });
    expect(await getBalance(h.db, p.accountId)).toBe(before);
  });

  it("an old paid tier books a freelancer of matching grade", async () => {
    const p = await newPlayer(h.db, { credits: 10_000 });
    await freelancer("A");
    const r = await race({}, 120 * MIN);
    const horse = await makeHorse(h.db, p.stableId, { rating: 60 });
    const e = await enterRace(h.db, { accountId: p.accountId, raceId: r.id, horseId: horse.id, tactic: "stalker", raceDay: { extras: [], jockey: "top" }, now: at(0) });
    const j = await getJockey(h.db, e.jockeyId!);
    expect(j!.grade).toBe("A");
    expect(j!.stableId).toBeNull();
  });

  it("refuses another stable's jockey, a second ride in the same race and rides within 10 minutes", async () => {
    const p = await newPlayer(h.db, { credits: 10_000 });
    const q = await newPlayer(h.db, { credits: 10_000 });
    const [theirs] = await stableJockeys(h.db, q.stableId);
    const r = await race({}, 200 * MIN);
    const hp = await makeHorse(h.db, p.stableId, { rating: 60 });
    await expect(
      enterRace(h.db, { accountId: p.accountId, raceId: r.id, horseId: hp.id, tactic: "stalker", raceDay: { extras: [], jockey: "apprentice", jockeyId: theirs!.id }, now: at(0) }),
    ).rejects.toMatchObject({ code: "JOCKEY_UNAVAILABLE" });

    const fl = await freelancer("C");
    await enterRace(h.db, { accountId: p.accountId, raceId: r.id, horseId: hp.id, tactic: "stalker", raceDay: { extras: [], jockey: "apprentice", jockeyId: fl }, now: at(0) });
    const hq = await makeHorse(h.db, q.stableId, { rating: 60 });
    await expect(
      enterRace(h.db, { accountId: q.accountId, raceId: r.id, horseId: hq.id, tactic: "stalker", raceDay: { extras: [], jockey: "apprentice", jockeyId: fl }, now: at(0) }),
    ).rejects.toMatchObject({ code: "JOCKEY_UNAVAILABLE" });
    // A sister race 5 minutes later: clash. 15 minutes later: fine.
    const near = await race({}, 205 * MIN);
    await expect(
      enterRace(h.db, { accountId: q.accountId, raceId: near.id, horseId: hq.id, tactic: "stalker", raceDay: { extras: [], jockey: "apprentice", jockeyId: fl }, now: at(0) }),
    ).rejects.toMatchObject({ code: "JOCKEY_UNAVAILABLE" });
    const later = await race({}, 215 * MIN);
    await enterRace(h.db, { accountId: q.accountId, raceId: later.id, horseId: hq.id, tactic: "stalker", raceDay: { extras: [], jockey: "apprentice", jockeyId: fl }, now: at(0) });
  });
});

describe("the lock, weights and settlement", () => {
  it("freezes each runner's jockey and kit into the hashed field; the apprentice claim comes off the weight", async () => {
    await ensureJockeyBackfill(h.db, T0);
    const p = await newPlayer(h.db, { credits: 10_000 });
    const q = await newPlayer(h.db, { credits: 10_000 });
    const [app] = await stableJockeys(h.db, p.stableId);
    const fl = await freelancer("B");
    const r = await race({}, 400 * MIN);
    const hp = await makeHorse(h.db, p.stableId, { rating: 62 });
    const hq = await makeHorse(h.db, q.stableId, { rating: 62 });
    await enterRace(h.db, { accountId: p.accountId, raceId: r.id, horseId: hp.id, tactic: "stalker", now: at(0) });
    await enterRace(h.db, { accountId: q.accountId, raceId: r.id, horseId: hq.id, tactic: "stalker", raceDay: { extras: [], jockey: "apprentice", jockeyId: fl }, now: at(0) });
    const seen = new Map<string, number | undefined>();
    const field = (await lockField(h.db, r.id, at(409 * MIN), {
      engineHorse: ({ snapshot, extraWeightLb }) => {
        seen.set(String(snapshot.id), extraWeightLb);
        return snapshot;
      },
    }))!;
    const a = field.runners.find((x) => x.horseId === hp.id)!;
    const b = field.runners.find((x) => x.horseId === hq.id)!;
    expect(a.jockey).toEqual({ id: app!.id, name: app!.name, claimLb: 7 });
    expect(b.jockey).toMatchObject({ id: fl, claimLb: 0 });
    // Same rating: the apprentice's horse carries 7 lb less, net.
    expect(b.weightLb! - a.weightLb!).toBe(7);
    const min = Math.min(...field.runners.map((x) => x.weightLb!));
    for (const x of field.runners) {
      expect(x.jockey).toBeDefined();
      expect(x.kit?.battlePermille).toBeDefined();
      expect(x.extraWeightLb).toBe(x.weightLb! - min);
      expect(seen.get(x.horseId) ?? 0).toBe(x.extraWeightLb);
    }
    expect(a.kit).toMatchObject(gc.jockeyKit((await getJockey(h.db, app!.id))!.skills));
    // Distinct jockeys; Club runners got Club freelancers.
    const ids = field.runners.map((x) => x.jockey!.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of field.runners.filter((y) => y.isHouse)) expect(x.jockey!.id).not.toBeNull();
    // Sealed: changing a jockey changes the hash.
    expect(field.fieldHash).toBe(fieldHashOf(field.runners, null, field.model));
    const swapped = field.runners.map((x) => (x.horseId === hp.id ? { ...x, jockey: { ...x.jockey!, name: "Someone Else" } } : x));
    expect(fieldHashOf(swapped, null, field.model)).not.toBe(field.fieldHash);
    // Idempotent lock.
    expect((await lockField(h.db, r.id, at(410 * MIN)))!.fieldHash).toBe(field.fieldHash);
    const rides = await h.db.select().from(jockeyRides).where(eq(jockeyRides.raceId, r.id));
    expect(rides).toHaveLength(field.runners.length);

    // Settlement: rides, wins, experience and growth, once.
    const before = (await getJockey(h.db, app!.id))!;
    const order = [hp.id, ...field.runners.map((x) => x.horseId).filter((id) => id !== hp.id)];
    const input = { raceId: r.id, now: at(412 * MIN), runners: order.map((horseId, i) => ({ horseId, position: i + 1 })), resultHash: "x", result: {} };
    await settleRace(h.db, input);
    const after = (await getJockey(h.db, app!.id))!;
    expect(after.rides).toBe(before.rides + 1);
    expect(after.wins).toBe(before.wins + 1);
    expect(gc.jockeyOverall(after.skills)).toBeGreaterThan(gc.jockeyOverall(before.skills));
    await settleRace(h.db, input);
    const again = (await getJockey(h.db, app!.id))!;
    expect(again.rides).toBe(after.rides);
    expect(again.skills).toEqual(after.skills);
    const lb = await jockeyLeaderboard(h.db, { from: T0, to: at(DAY) });
    expect(lb.find((x) => x.jockey.id === app!.id)?.wins).toBe(1);
  });

  it("a cancelled race drops its rides", async () => {
    const p = await newPlayer(h.db, { credits: 10_000 });
    const r = await race({}, 600 * MIN);
    const hp = await makeHorse(h.db, p.stableId, { rating: 60 });
    await enterRace(h.db, { accountId: p.accountId, raceId: r.id, horseId: hp.id, tactic: "stalker", now: at(0) });
    await lockField(h.db, r.id, at(609 * MIN));
    expect((await h.db.select().from(jockeyRides).where(eq(jockeyRides.raceId, r.id))).length).toBeGreaterThan(0);
    await cancelRace(h.db, { raceId: r.id, now: at(609 * MIN), reason: "test" });
    expect(await h.db.select().from(jockeyRides).where(eq(jockeyRides.raceId, r.id))).toHaveLength(0);
  });
});

describe("weekly maintenance", () => {
  it("ages, announces and retires jockeys, holds the pool near 1.5 per active stable, and releases idle stables' jockeys", async () => {
    // A fresh database, to count the pool exactly.
    const own = await memoryDb();
    try {
      const db = own.db;
      const { createAccount } = await import("../services/accounts");
      const make = async (k: number) =>
        createAccount(db, { stableName: `W ${k}`, silks: { primary: "#111111", secondary: "#222222", pattern: "solid", cap: "#333333" }, startingCredits: 1_000, starterHorses: 0, now: T0 });
      const stablesMade = [];
      for (let k = 0; k < 10; k++) stablesMade.push(await make(k));
      const m0 = await runJockeyMaintenance(db, T0);
      expect(m0.week).not.toBeNull();
      expect(m0.week!.active).toBe(10);
      expect(await poolSize(db)).toBeGreaterThanOrEqual(gc.jockeyPoolTarget(10));
      // The same week again: no second intake.
      expect((await runJockeyMaintenance(db, at(MIN))).week).toBeNull();

      // Simulate 30 weeks with 10 active stables: retirements happen, intake refills, the pool stays near target.
      const sizes: number[] = [];
      let retired = 0;
      let intake = 0;
      const stagesSeen = new Set<string>();
      for (let w = 1; w <= 30; w++) {
        const now = at(w * 7 * DAY);
        await db.update(accounts).set({ lastSeenAt: now });
        const m = await runJockeyMaintenance(db, now);
        retired += m.retired;
        intake += m.week?.intake ?? 0;
        sizes.push(await poolSize(db));
        for (const r of await db.select({ stage: jockeys.stage }).from(jockeys).where(isNull(jockeys.retiredAt))) stagesSeen.add(r.stage);
      }
      expect(retired).toBeGreaterThan(0);
      expect(intake).toBeGreaterThan(0);
      const target = gc.jockeyPoolTarget(10);
      // Never short of target after a week's intake; the starting pool's surplus (at least 12
      // freelancers) drains by retirement, then the pool holds near target.
      for (const s of sizes) expect(s).toBeGreaterThanOrEqual(target - 4);
      for (const s of sizes.slice(20)) expect(s).toBeLessThanOrEqual(target + 4);
      const announced = await db.select().from(jockeyEvents).where(eq(jockeyEvents.kind, "retirement_announced"));
      const gone = await db.select().from(jockeyEvents).where(eq(jockeyEvents.kind, "retired"));
      expect(announced.length).toBeGreaterThanOrEqual(gone.length);
      // Careers moved through every stage.
      expect([...stagesSeen].sort()).toEqual(["apprentice", "prime", "veteran"]);

      // Idle stable: not seen and no entries for 21 days → its jockeys go back to the pool.
      const idle = stablesMade[0]!;
      const fresh = await createJockeyTx(db, { seed: gc.seedFrom("idle-test"), stableId: idle.stableId, now: at(30 * 7 * DAY) });
      const late = at(30 * 7 * DAY + 22 * DAY);
      await db.update(accounts).set({ lastSeenAt: late });
      await db.update(accounts).set({ lastSeenAt: at(30 * 7 * DAY) }).where(eq(accounts.id, idle.accountId));
      const m = await runJockeyMaintenance(db, late);
      expect(m.released).toBeGreaterThanOrEqual(1);
      const [row] = await db.select().from(jockeys).where(eq(jockeys.id, fresh.id));
      expect(row!.stableId).toBeNull();
      expect((await activeStableIds(db, late)).includes(idle.stableId)).toBe(false);
      // Nobody ever holds more than the cap.
      const held = await db.execute(sql`select max(c)::int as m from (select count(*) as c from jockeys where stable_id is not null and retired_at is null group by stable_id) x`);
      const max = ((Array.isArray(held) ? held : (held as { rows: { m: number }[] }).rows)[0] as { m: number | null }).m ?? 0;
      expect(max).toBeLessThanOrEqual(gc.JOCKEYS_PER_STABLE_MAX);
    } finally {
      await own.close();
    }
  });
});

describe("entries store the booking", () => {
  it("race_entries.jockey_id is set for Live entries", async () => {
    const rows = await h.db.select().from(raceEntries).where(and(eq(raceEntries.isHouse, false)));
    expect(rows.some((r) => r.jockeyId !== null)).toBe(true);
  });
});

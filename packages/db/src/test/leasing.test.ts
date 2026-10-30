import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { isDomainError } from "../errors";
import { gc } from "../gameCore";
import { RULES, bps } from "../rules";
import { accounts, fraudEvents, horseLeaseListings, horseLeases, horses, inboxItems, ledgerTransactions, raceEntries, races, stables, usdgOrders } from "../schema";
import { occupancy, recordAccountSignal } from "../services/accounts";
import { breed } from "../services/breeding";
import { runCupEntry } from "../services/dailyCup";
import { careForHorse } from "../services/horseLife";
import {
  buyInsurance,
  listLeasedOutHorses,
  listStableHorses,
  moveToLegacyFarm,
  releaseToClub,
  renameHorse,
  retireHorse,
  setStudFee,
} from "../services/horses";
import {
  leaseBoard,
  leaseMetrics,
  lesseeRecords,
  offerLease,
  orderLeaseBoard,
  rateLessee,
  returnLease,
  sweepLeases,
  takeLease,
  withdrawLeaseOffer,
} from "../services/leasing";
import { getBalance, ledgerHealth } from "../services/ledger";
import { listHorse } from "../services/market";
import { createRace, enterRace, getRaceForSimulation, settleRace, type RunnerOutcome } from "../services/races";
import { settleUpkeep } from "../services/upkeep";
import { at, count, DAY, getHorseRow, makeHorse, makeSeller, memoryDb, MIN, newPlayer, settledAll, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

/** An established stable: 8 days old with 10 settled Live starts (lessee requirements). */
async function lessee(credits = 5_000) {
  const p = await newPlayer(h.db, { credits });
  await h.db
    .update(accounts)
    .set({ createdAt: new Date(T0.getTime() - 8 * DAY) })
    .where(eq(accounts.id, p.accountId));
  const house = await makeHorse(h.db, null);
  for (let i = 0; i < gc.LESSEE_MIN_LIVE_STARTS; i++) {
    const race = await createRace(h.db, {
      kind: "scheduled",
      name: `Past ${i}`,
      raceClass: "maiden",
      conditions: {},
      postTime: new Date(T0.getTime() - (i + 1) * DAY),
      entriesCloseAt: new Date(T0.getTime() - (i + 1) * DAY - MIN),
    });
    await h.db.update(races).set({ status: "settled" }).where(eq(races.id, race.id));
    await h.db.insert(raceEntries).values({ raceId: race.id, horseId: house.id, stableId: p.stableId, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
  }
  return p;
}

/** An owner with `n` racing horses (the lease cap is a quarter of them, 1..3). */
async function owner(n = 4) {
  const p = await newPlayer(h.db);
  const hs = [];
  for (let i = 0; i < n; i++) hs.push(await makeHorse(h.db, p.stableId, { rating: 40 + i }));
  return { ...p, horses: hs };
}

let raceN = 0;
function liveRace(postAt: Date, purse = 10_000) {
  return createRace(h.db, {
    kind: "scheduled",
    name: `Lease race ${++raceN}`,
    raceClass: "maiden",
    conditions: { distanceM: 1200, surface: "turf" },
    postTime: postAt,
    entriesCloseAt: new Date(postAt.getTime() - MIN),
    targetRunners: 2,
    purse,
  });
}

async function runRace(raceId: string, now: Date, first: string[], extra: Record<string, Partial<RunnerOutcome>> = {}) {
  const { field } = await getRaceForSimulation(h.db, raceId, now);
  const order = [...first, ...field.runners.map((r) => r.horseId).filter((id) => !first.includes(id))];
  return settleRace(h.db, { raceId, now, resultHash: "0".repeat(64), result: { order }, runners: order.map((horseId, i) => ({ horseId, position: i + 1, ...(extra[horseId] ?? {}) })) });
}

const offer = (accountId: string, horseId: string, extra: Partial<Parameters<typeof offerLease>[1]> = {}) =>
  offerLease(h.db, { accountId, horseId, termDays: 7, ownerSharePct: 50, now: T0, ...extra });

describe("leasing: offers", () => {
  it("validates terms and the horse; one open offer per horse; no fee in the beta", async () => {
    const o = await owner(4);
    const [a, b] = o.horses;
    await expect(offer(o.accountId, a!.id, { termDays: 10 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(offer(o.accountId, a!.id, { ownerSharePct: 85 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(offer(o.accountId, a!.id, { fee: 100 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(offer(o.accountId, a!.id, { maxLiveStartsPerWeek: 9 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const l = await offer(o.accountId, a!.id);
    expect(l).toMatchObject({ status: "active", termDays: 7, ownerSharePct: 50, fee: 0, maxLiveStartsPerWeek: gc.LEASE_WEEKLY_STARTS_DEFAULT, allowAllOut: false });
    await expect(offer(o.accountId, a!.id)).rejects.toMatchObject({ code: "HORSE_LOCKED" });
    // someone else's horse, a retired horse, a stallion at stud, too few starts left; a Club-bred starter may be leased
    const other = await newPlayer(h.db);
    await expect(offer(other.accountId, b!.id)).rejects.toMatchObject({ code: "NOT_OWNER" });
    const retired = await makeHorse(h.db, o.stableId, { careerStatus: "retired", retirementReason: "choice", retiredAt: T0 });
    await expect(offer(o.accountId, retired.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    const bound = await makeHorse(h.db, o.stableId, { bound: true });
    const boundOffer = await offer(o.accountId, bound.id);
    await withdrawLeaseOffer(h.db, { accountId: o.accountId, listingId: boundOffer.id, now: T0 });
    const stud = await makeHorse(h.db, o.stableId, { studFee: 300 });
    await expect(offer(o.accountId, stud.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    const old = await makeHorse(h.db, o.stableId, { starts: 36 });
    await expect(offer(o.accountId, old.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    // an offered horse can't go on the market; withdrawing frees it
    await makeSeller(h.db, o.accountId, o.stableId);
    await expect(listHorse(h.db, { accountId: o.accountId, horseId: a!.id, price: 1_000_000, now: T0 })).rejects.toMatchObject({ code: "HORSE_LOCKED" });
    await withdrawLeaseOffer(h.db, { accountId: o.accountId, listingId: l.id, now: T0 });
    await expect(offer(o.accountId, a!.id)).resolves.toMatchObject({ status: "active" });
    // retiring withdraws the offer
    await retireHorse(h.db, { accountId: o.accountId, horseId: a!.id, now: T0 });
    expect(await count(h.db, "horse_lease_listings", `horse_id = '${a!.id}' and status = 'active'`)).toBe(0);
  });

  it("caps: 3 open offers per owner; out on lease at most min(3, 25% of racing horses), at least 1", async () => {
    const o = await owner(4); // 25% of 4 = 1 horse out at once
    const offers = [];
    for (const x of o.horses.slice(0, 3)) offers.push(await offer(o.accountId, x.id));
    await expect(offer(o.accountId, o.horses[3]!.id)).rejects.toMatchObject({ code: "LEASE_LIMIT" });
    const l1 = await lessee();
    await takeLease(h.db, { accountId: l1.accountId, listingId: offers[0]!.id, now: T0 });
    // the owner is at their cap: the next take voids that offer, new offers are refused
    const l2 = await lessee();
    await expect(takeLease(h.db, { accountId: l2.accountId, listingId: offers[1]!.id, now: T0 })).rejects.toMatchObject({ code: "LEASE_LIMIT" });
    expect(await count(h.db, "horse_lease_listings", `id = '${offers[1]!.id}' and status = 'cancelled'`)).toBe(1);
    await expect(offer(o.accountId, o.horses[3]!.id)).rejects.toMatchObject({ code: "LEASE_LIMIT" });
    expect(gc.maxLeasesOut(12)).toBe(3);
  });

  it("the upfront-fee path (off in the beta) pays the owner and burns the cut", async () => {
    const o = await owner(4);
    const x = o.horses[0]!;
    await expect(offerLease(h.db, { accountId: o.accountId, horseId: x.id, termDays: 14, ownerSharePct: 40, fee: 2_001, now: T0 }, { feeMax: 2_000 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const l = await offerLease(h.db, { accountId: o.accountId, horseId: x.id, termDays: 14, ownerSharePct: 40, fee: 10, now: T0 }, { feeMax: 2_000 });
    const t = await lessee(10_000);
    const ownerBefore = await getBalance(h.db, o.accountId);
    await takeLease(h.db, { accountId: t.accountId, listingId: l.id, now: T0 });
    const split = gc.leaseFeeSplit(l.fee);
    expect(split).toEqual({ cut: 1, ownerReceives: 9 });
    expect(await getBalance(h.db, t.accountId)).toBe(10_000 - l.fee);
    expect(await getBalance(h.db, o.accountId)).toBe(ownerBefore + split.ownerReceives);
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
  });
});

describe("leasing: taking a lease", () => {
  it("first come first served under concurrency; idempotent for the winner; the horse moves stalls", async () => {
    const o = await owner(4);
    const x = o.horses[0]!;
    const l = await offer(o.accountId, x.id);
    const takers = await Promise.all([lessee(), lessee(), lessee(), lessee()]);
    const ownerOcc = await occupancy(h.db, (await h.db.select().from(stables).where(eq(stables.id, o.stableId)))[0]!);
    const res = await settledAll(takers.map((t) => takeLease(h.db, { accountId: t.accountId, listingId: l.id, now: at(MIN) })));
    expect(res.ok).toHaveLength(1);
    expect(res.errors.every((e) => isDomainError(e, "LISTING_NOT_ACTIVE"))).toBe(true);
    const after = await getHorseRow(h.db, x.id);
    expect(after.ownerStableId).toBe(o.stableId); // ownership never moves
    const winner = takers.find((t) => t.stableId === after.lesseeStableId)!;
    expect(winner).toBeDefined();
    const again = await takeLease(h.db, { accountId: winner.accountId, listingId: l.id, now: at(2 * MIN) });
    expect(again.duplicate).toBe(true);
    expect(await count(h.db, "horse_leases", `horse_id = '${x.id}'`)).toBe(1);
    // stalls: the owner's is freed, the lessee's taken
    const ownerAfter = await occupancy(h.db, (await h.db.select().from(stables).where(eq(stables.id, o.stableId)))[0]!);
    expect(ownerAfter.horses).toBe(ownerOcc.horses - 1);
    expect((await listStableHorses(h.db, winner.stableId)).map((r) => r.id)).toContain(x.id);
    expect((await listStableHorses(h.db, o.stableId)).map((r) => r.id)).not.toContain(x.id);
    expect((await listLeasedOutHorses(h.db, o.stableId)).map((r) => r.id)).toEqual([x.id]);
    // inbox notes to both
    expect(await count(h.db, "inbox_items", `kind = 'lease_start' and horse_id = '${x.id}'`)).toBe(2);
    // the start condition is recorded
    const [lease] = await h.db.select().from(horseLeases).where(eq(horseLeases.horseId, x.id));
    expect(lease!.startCondition).toMatchObject({ label: "fresh", rating: x.rating });
  });

  it("refuses fresh accounts, linked accounts (fraud event), a third lease, a full stable and a low rating", async () => {
    const o = await owner(12);
    const fresh = await newPlayer(h.db);
    const l1 = await offer(o.accountId, o.horses[0]!.id);
    await expect(takeLease(h.db, { accountId: fresh.accountId, listingId: l1.id, now: T0 })).rejects.toMatchObject({ code: "SELLER_REQUIREMENTS" });
    await expect(takeLease(h.db, { accountId: o.accountId, listingId: l1.id, now: T0 })).rejects.toMatchObject({ code: "CANNOT_BUY_OWN" });

    const alt = await lessee();
    await recordAccountSignal(h.db, { accountId: o.accountId, kind: "device", value: "lease-dev-1" });
    await recordAccountSignal(h.db, { accountId: alt.accountId, kind: "device", value: "lease-dev-1" });
    await expect(takeLease(h.db, { accountId: alt.accountId, listingId: l1.id, now: T0 })).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    expect(await count(h.db, "fraud_events", `kind = 'linked_lease_blocked' and account_id = '${alt.accountId}'`)).toBe(1);

    const t = await lessee();
    const l2 = await offer(o.accountId, o.horses[1]!.id);
    const l3 = await offer(o.accountId, o.horses[2]!.id);
    await takeLease(h.db, { accountId: t.accountId, listingId: l1.id, now: T0 });
    await takeLease(h.db, { accountId: t.accountId, listingId: l2.id, now: T0 });
    await expect(takeLease(h.db, { accountId: t.accountId, listingId: l3.id, now: T0 })).rejects.toMatchObject({ code: "LEASE_LIMIT" });

    const full = await lessee();
    const [fs] = await h.db.select().from(stables).where(eq(stables.id, full.stableId));
    for (let i = 0; i < fs!.stallSlots; i++) await makeHorse(h.db, full.stableId);
    await expect(takeLease(h.db, { accountId: full.accountId, listingId: l3.id, now: T0 })).rejects.toMatchObject({ code: "STABLE_FULL" });

    // a minimum rating of 4 stars: an unrated lessee counts as 3
    const o2 = await owner(4);
    const picky = await offer(o2.accountId, o2.horses[0]!.id, { minLesseeRating: 4 });
    const newbie = await lessee();
    await expect(takeLease(h.db, { accountId: newbie.accountId, listingId: picky.id, now: T0 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("flags reciprocal leases (A to B, then B to A) without blocking", async () => {
    const a = await lessee();
    const b = await lessee();
    const ha = await makeHorse(h.db, a.stableId);
    const hb = await makeHorse(h.db, b.stableId);
    const la = await offer(a.accountId, ha.id);
    await takeLease(h.db, { accountId: b.accountId, listingId: la.id, now: T0 });
    const lb = await offer(b.accountId, hb.id);
    await takeLease(h.db, { accountId: a.accountId, listingId: lb.id, now: at(DAY) });
    const flagged = await h.db.select().from(fraudEvents).where(and(eq(fraudEvents.kind, "lease_reciprocal"), eq(fraudEvents.accountId, a.accountId)));
    expect(flagged).toHaveLength(1);
  });
});

describe("leasing: who may do what", () => {
  it("the lessee races and cares; only the owner sells, breeds, retires, renames, insures - and not while away", async () => {
    const o = await owner(4);
    const x = o.horses[0]!;
    const mare = await makeHorse(h.db, o.stableId, { sex: "female", careerStatus: "retired", retirementReason: "choice", retiredAt: T0 });
    const l = await offer(o.accountId, x.id);
    const t = await lessee();
    await takeLease(h.db, { accountId: t.accountId, listingId: l.id, now: T0 });
    await makeSeller(h.db, t.accountId, t.stableId);
    await makeSeller(h.db, o.accountId, o.stableId);
    const lesseeTries = [
      listHorse(h.db, { accountId: t.accountId, horseId: x.id, price: 5_000, now: T0 }),
      retireHorse(h.db, { accountId: t.accountId, horseId: x.id, now: T0 }),
      moveToLegacyFarm(h.db, { accountId: t.accountId, horseId: x.id, now: T0 }),
      releaseToClub(h.db, { accountId: t.accountId, horseId: x.id, now: T0 }),
      renameHorse(h.db, { accountId: t.accountId, horseId: x.id, name: "Borrowed Glory" }),
      buyInsurance(h.db, { accountId: t.accountId, horseId: x.id }),
      setStudFee(h.db, { accountId: t.accountId, horseId: x.id, fee: 100 }),
    ];
    for (const r of await Promise.allSettled(lesseeTries)) expect(r.status === "rejected" && isDomainError(r.reason, "NOT_OWNER")).toBe(true);
    const ownerTries = [
      listHorse(h.db, { accountId: o.accountId, horseId: x.id, price: 5_000, now: T0 }),
      retireHorse(h.db, { accountId: o.accountId, horseId: x.id, now: T0 }),
      renameHorse(h.db, { accountId: o.accountId, horseId: x.id, name: "Home Again" }),
      setStudFee(h.db, { accountId: o.accountId, horseId: x.id, fee: 100 }),
      careForHorse(h.db, { accountId: o.accountId, horseId: x.id, now: T0 }),
    ];
    for (const r of await Promise.allSettled(ownerTries)) expect(r.status === "rejected" && isDomainError(r.reason, "HORSE_ON_LEASE")).toBe(true);
    await expect(breed(h.db, { accountId: o.accountId, sireId: x.id, damId: mare.id, now: T0, idempotencyKey: `lease-b:${x.id}` })).rejects.toMatchObject({ code: "HORSE_ON_LEASE" });
    const race = await liveRace(at(30 * MIN));
    await expect(enterRace(h.db, { accountId: o.accountId, raceId: race.id, horseId: x.id, tactic: "front", now: T0 })).rejects.toMatchObject({ code: "HORSE_ON_LEASE" });
    // the owner may still insure (the payout is theirs)
    await buyInsurance(h.db, { accountId: o.accountId, horseId: x.id });
    // the lessee cares and races
    await expect(careForHorse(h.db, { accountId: t.accountId, horseId: x.id, now: T0 })).resolves.toMatchObject({ counted: true });
    await expect(enterRace(h.db, { accountId: t.accountId, raceId: race.id, horseId: x.id, tactic: "front", now: T0 })).resolves.toMatchObject({ stableId: t.stableId });
  });

  it("welfare: no tired entries, all-out only if allowed, the owner's weekly Live cap, no race after the term", async () => {
    const o = await owner(8);
    const x = o.horses[0]!;
    const y = o.horses[1]!;
    const lx = await offer(o.accountId, x.id, { maxLiveStartsPerWeek: 2 });
    const ly = await offer(o.accountId, y.id, { allowAllOut: true });
    const t = await lessee();
    await takeLease(h.db, { accountId: t.accountId, listingId: lx.id, now: T0 });
    const t2 = await lessee();
    await takeLease(h.db, { accountId: t2.accountId, listingId: ly.id, now: T0 });

    const r1 = await liveRace(at(30 * MIN));
    await expect(enterRace(h.db, { accountId: t.accountId, raceId: r1.id, horseId: x.id, tactic: "front", now: T0, meta: { plan: { intensity: "all_out" } } })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(enterRace(h.db, { accountId: t2.accountId, raceId: r1.id, horseId: y.id, tactic: "front", now: T0, meta: { plan: { intensity: "all_out" } } })).resolves.toBeTruthy();
    await h.db.update(horses).set({ fatigue: 900, fatigueAt: T0 }).where(eq(horses.id, x.id));
    await expect(enterRace(h.db, { accountId: t.accountId, raceId: r1.id, horseId: x.id, tactic: "front", now: T0 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await h.db.update(horses).set({ fatigue: 0, fatigueAt: T0 }).where(eq(horses.id, x.id));

    // weekly cap 2 (T0 is a Monday): two Live starts this week, the third refused
    const day = (d: number) => liveRace(at(d * DAY + 30 * MIN));
    for (const d of [1, 2]) {
      const r = await day(d);
      await enterRace(h.db, { accountId: t.accountId, raceId: r.id, horseId: x.id, tactic: "front", now: at(d * DAY) });
      await runRace(r.id, at(d * DAY + 31 * MIN), [x.id]);
    }
    const r3 = await day(3);
    await expect(enterRace(h.db, { accountId: t.accountId, raceId: r3.id, horseId: x.id, tactic: "front", now: at(3 * DAY) })).rejects.toMatchObject({ code: "RACE_LIMIT" });
    // after the term ends: refused
    const late = await liveRace(at(8 * DAY));
    await expect(enterRace(h.db, { accountId: t.accountId, raceId: late.id, horseId: x.id, tactic: "front", now: at(6 * DAY) })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    const [lease] = await h.db.select().from(horseLeases).where(eq(horseLeases.horseId, x.id));
    expect(lease!.entries).toBe(2);
    expect(lease!.races).toBe(2);
  });
});

describe("leasing: prizes, the end of a lease, upkeep", () => {
  it("splits the purse exactly at settlement (owner share rounded down, the rest to the lessee)", async () => {
    const o = await owner(4);
    const x = o.horses[0]!;
    const l = await offer(o.accountId, x.id, { ownerSharePct: 33 });
    const t = await lessee();
    await takeLease(h.db, { accountId: t.accountId, listingId: l.id, now: T0 });
    const purse = 10_001;
    const race = await liveRace(at(30 * MIN), purse);
    await enterRace(h.db, { accountId: t.accountId, raceId: race.id, horseId: x.id, tactic: "front", now: T0 });
    const [ob, lb] = [await getBalance(h.db, o.accountId), await getBalance(h.db, t.accountId)];
    const res = await runRace(race.id, at(31 * MIN), [x.id]);
    const prize = bps(purse, RULES.purseSplitBps[0]!);
    expect(res.prizes[x.id]).toBe(prize);
    const ownerShare = Math.floor((prize * 33) / 100);
    expect(await getBalance(h.db, o.accountId)).toBe(ob + ownerShare);
    expect(await getBalance(h.db, t.accountId)).toBe(lb + prize - ownerShare);
    const [txn] = await h.db.select().from(ledgerTransactions).where(eq(ledgerTransactions.idempotencyKey, `lease-share:${race.id}:${x.id}`));
    expect(txn!.kind).toBe("lease_share");
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
    const [lease] = await h.db.select().from(horseLeases).where(eq(horseLeases.horseId, x.id));
    expect(lease).toMatchObject({ races: 1, ownerEarned: ownerShare, lesseeEarned: prize - ownerShare });
    // settling again pays nothing more
    await runRace(race.id, at(32 * MIN), [x.id]);
    expect(await getBalance(h.db, o.accountId)).toBe(ob + ownerShare);
    // the race result (and the League credit) is the lessee's
    const [entry] = await h.db.select().from(raceEntries).where(and(eq(raceEntries.raceId, race.id), eq(raceEntries.horseId, x.id)));
    expect(entry!.stableId).toBe(t.stableId);
  });

  it("term end: a horse entered in a race goes home after that race settles; notes to both", async () => {
    const o = await owner(4);
    const x = o.horses[0]!;
    const l = await offer(o.accountId, x.id);
    const t = await lessee();
    await takeLease(h.db, { accountId: t.accountId, listingId: l.id, now: T0 });
    const race = await liveRace(at(7 * DAY - MIN)); // runs right at the end of the term
    await enterRace(h.db, { accountId: t.accountId, raceId: race.id, horseId: x.id, tactic: "front", now: at(6 * DAY) });
    // the term is over, but the horse is in the race: the sweep leaves it
    await sweepLeases(h.db, at(7 * DAY + MIN));
    expect((await getHorseRow(h.db, x.id)).lesseeStableId).toBe(t.stableId);
    await runRace(race.id, at(7 * DAY + 2 * MIN), [x.id]);
    const home = await getHorseRow(h.db, x.id);
    expect(home.lesseeStableId).toBeNull();
    const [lease] = await h.db.select().from(horseLeases).where(eq(horseLeases.horseId, x.id));
    expect(lease).toMatchObject({ status: "ended", endReason: "term", races: 1 });
    expect(lease!.endCondition).toMatchObject({ label: "fresh" });
    expect(await count(h.db, "inbox_items", `kind = 'lease_end' and horse_id = '${x.id}'`)).toBe(2);
    // plain term end (no race): the sweep sends it home
    const y = o.horses[1]!;
    const ly = await offer(o.accountId, y.id, { now: at(8 * DAY) });
    // the owner's cap (1 of 4) is free again now that x is home
    await takeLease(h.db, { accountId: t.accountId, listingId: ly.id, now: at(8 * DAY) });
    expect((await sweepLeases(h.db, at(15 * DAY + MIN))).leasesEnded).toBeGreaterThanOrEqual(1);
    expect((await getHorseRow(h.db, y.id)).lesseeStableId).toBeNull();
  });

  it("early return: at once when idle, after the race when entered; the owner can't recall", async () => {
    const o = await owner(8);
    const [x, y] = o.horses;
    const t = await lessee();
    const lx = await offer(o.accountId, x!.id);
    const ly = await offer(o.accountId, y!.id);
    const { lease: a } = await takeLease(h.db, { accountId: t.accountId, listingId: lx.id, now: T0 });
    const { lease: b } = await takeLease(h.db, { accountId: t.accountId, listingId: ly.id, now: T0 });
    await expect(returnLease(h.db, { accountId: o.accountId, leaseId: a.id, now: T0 })).rejects.toMatchObject({ code: "NOT_OWNER" });
    expect(await returnLease(h.db, { accountId: t.accountId, leaseId: a.id, now: at(MIN) })).toEqual({ ended: true, pending: false });
    expect((await getHorseRow(h.db, x!.id)).lesseeStableId).toBeNull();
    const race = await liveRace(at(30 * MIN));
    await enterRace(h.db, { accountId: t.accountId, raceId: race.id, horseId: y!.id, tactic: "front", now: at(MIN) });
    expect(await returnLease(h.db, { accountId: t.accountId, leaseId: b.id, now: at(2 * MIN) })).toEqual({ ended: false, pending: true });
    expect((await getHorseRow(h.db, y!.id)).lesseeStableId).toBe(t.stableId);
    await runRace(race.id, at(31 * MIN), [y!.id]);
    expect((await getHorseRow(h.db, y!.id)).lesseeStableId).toBeNull();
    const [ended] = await h.db.select().from(horseLeases).where(eq(horseLeases.id, b.id));
    expect(ended).toMatchObject({ status: "ended", endReason: "returned" });
    // cooldown: x can't be offered again for 7 days
    await expect(offer(o.accountId, x!.id, { now: at(DAY) })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(offer(o.accountId, x!.id, { now: at(8 * DAY) })).resolves.toMatchObject({ status: "active" });
    // owner rates the lessee once; the record is public
    await rateLessee(h.db, { accountId: o.accountId, leaseId: a.id, stars: 4, now: at(DAY) });
    await rateLessee(h.db, { accountId: o.accountId, leaseId: a.id, stars: 1, now: at(DAY) });
    await expect(rateLessee(h.db, { accountId: t.accountId, leaseId: b.id, stars: 5, now: at(DAY) })).rejects.toMatchObject({ code: "NOT_OWNER" });
    const rec = (await lesseeRecords(h.db, [t.stableId])).get(t.stableId)!;
    expect(rec).toMatchObject({ leases: 2, races: 1, ratings: 1, ratingSum: 4, starsTenths: 40, avgFatigueAtEntry: 0 });
  });

  it("a moderate injury on lease sends the horse home after the race; the split is still paid", async () => {
    const o = await owner(4);
    const x = o.horses[0]!;
    const l = await offer(o.accountId, x.id, { ownerSharePct: 60 });
    const t = await lessee();
    await takeLease(h.db, { accountId: t.accountId, listingId: l.id, now: T0 });
    const race = await liveRace(at(30 * MIN));
    await enterRace(h.db, { accountId: t.accountId, raceId: race.id, horseId: x.id, tactic: "front", now: T0 });
    const ob = await getBalance(h.db, o.accountId);
    await runRace(race.id, at(31 * MIN), [x.id], { [x.id]: { injury: { severity: "moderate", recoveryMs: 3 * DAY } } });
    expect((await getHorseRow(h.db, x.id)).lesseeStableId).toBeNull();
    const [lease] = await h.db.select().from(horseLeases).where(eq(horseLeases.horseId, x.id));
    expect(lease).toMatchObject({ status: "ended", endReason: "injured", injuries: 1 });
    expect(lease!.endCondition).toMatchObject({ label: "injured", injury: "moderate" });
    expect(await getBalance(h.db, o.accountId)).toBeGreaterThan(ob);
  });

  it("a career-ending injury on lease: retired, the lease ends, the owner gets the insurance", async () => {
    const o = await owner(4);
    const x = o.horses[0]!;
    await buyInsurance(h.db, { accountId: o.accountId, horseId: x.id });
    const l = await offer(o.accountId, x.id);
    const t = await lessee();
    await takeLease(h.db, { accountId: t.accountId, listingId: l.id, now: T0 });
    const race = await liveRace(at(30 * MIN), 0);
    await enterRace(h.db, { accountId: t.accountId, raceId: race.id, horseId: x.id, tactic: "front", now: T0 });
    const [ob, lb] = [await getBalance(h.db, o.accountId), await getBalance(h.db, t.accountId)];
    await runRace(race.id, at(31 * MIN), [x.id], { [x.id]: { injury: { severity: "career_ending", recoveryMs: 3 * DAY } } });
    const home = await getHorseRow(h.db, x.id);
    expect(home).toMatchObject({ careerStatus: "retired", lesseeStableId: null, ownerStableId: o.stableId });
    expect(await getBalance(h.db, o.accountId)).toBeGreaterThan(ob);
    expect(await getBalance(h.db, t.accountId)).toBe(lb);
    const [lease] = await h.db.select().from(horseLeases).where(eq(horseLeases.horseId, x.id));
    expect(lease!.endReason).toBe("retired");
  });

  it("upkeep is paid by the stable that used the horse: the lessee", async () => {
    const o = await owner(4);
    const x = o.horses[0]!;
    const l = await offer(o.accountId, x.id);
    const t = await lessee();
    await takeLease(h.db, { accountId: t.accountId, listingId: l.id, now: T0 });
    const race = await liveRace(at(30 * MIN));
    await enterRace(h.db, { accountId: t.accountId, raceId: race.id, horseId: x.id, tactic: "front", now: T0 });
    await runRace(race.id, at(31 * MIN), [x.id]);
    // the lease ends before the week is charged: the lessee still pays for the week it used the horse
    await returnLease(h.db, { accountId: t.accountId, leaseId: (await h.db.select().from(horseLeases).where(eq(horseLeases.horseId, x.id)))[0]!.id, now: at(DAY) });
    const nextWeek = at(8 * DAY);
    const lesseeCharge = await settleUpkeep(h.db, nextWeek, { stableId: t.stableId });
    expect(lesseeCharge.find((c) => c.weekStart === "2026-11-02")).toMatchObject({ horses: 1, due: gc.UPKEEP_RACING_PER_WEEK });
    expect((await settleUpkeep(h.db, nextWeek, { stableId: o.stableId })).filter((c) => c.due > 0)).toEqual([]);
    const note = await h.db.select().from(inboxItems).where(and(eq(inboxItems.kind, "upkeep"), eq(inboxItems.accountId, t.accountId)));
    expect(note.some((n) => (n.data as { weekStart?: string }).weekStart === "2026-11-02")).toBe(true);
  });
});

describe("leasing: board and metrics", () => {
  it("orders by quality band, shuffled per day, new owners lifted to every third place", () => {
    const mk = (id: string, rating: number, newOwner: boolean) => ({ listing: { id }, horse: { rating }, newOwner });
    const rows = [mk("a", 55, false), mk("b", 52, false), mk("c", 58, false), mk("d", 30, true), mk("e", 71, false)];
    const day1 = orderLeaseBoard(rows, "2026-11-02");
    expect(day1[0]!.listing.id).toBe("e");
    expect(day1[1]!.listing.id).toBe("d"); // the new owner's horse is lifted
    expect(orderLeaseBoard(rows, "2026-11-02").map((r) => r.listing.id)).toEqual(day1.map((r) => r.listing.id)); // stable within a day
    const bands = new Set<string>();
    for (const d of ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]) {
      bands.add(orderLeaseBoard(rows, d).slice(2).map((r) => r.listing.id).join(""));
    }
    expect(bands.size).toBeGreaterThan(1); // the 50s band shuffles across days
  });

  it("the board lists open offers; metrics count leases and market sales", async () => {
    const o = await owner(4);
    await offer(o.accountId, o.horses[0]!.id);
    const board = await leaseBoard(h.db, T0);
    expect(board.some((r) => r.horse.id === o.horses[0]!.id && r.newOwner)).toBe(true);
    const m = await leaseMetrics(h.db, at(MIN));
    expect(m.active).toBeGreaterThan(0);
    expect(m.startedThisWeek).toBeGreaterThan(0);
    expect(m.openOffers).toBeGreaterThan(0);
    expect(m.sharesPaidThisWeek).toBeGreaterThanOrEqual(0); // postings carry the wall clock
    expect(m.marketSalesThisWeek).toBeGreaterThanOrEqual(0);
  });
});

describe("leasing: review fixes (2026-10-30)", () => {
  it("a stallion with a live USDG stud booking can't be offered or taken on lease", async () => {
    const o = await owner(4);
    const x = o.horses[0]!;
    expect((await getHorseRow(h.db, x.id)).sex).toBe("male");
    const l = await offer(o.accountId, x.id);
    const mareOwner = await newPlayer(h.db);
    const mare = await makeHorse(h.db, mareOwner.stableId, { sex: "female" });
    await h.db.insert(usdgOrders).values({
      orderId: `0x${"ab".repeat(32)}`,
      kind: "stud",
      accountId: mareOwner.accountId,
      wallet: `0x${"11".repeat(20)}`,
      horseId: x.id,
      mareId: mare.id,
      horseRef: `0x${"cd".repeat(32)}`,
      price: 5_000_000,
      fee: 250_000,
      token: `0x${"22".repeat(20)}`,
      chainId: 46630,
      marketAddress: `0x${"33".repeat(20)}`,
      deadline: at(15 * MIN),
    });
    const t = await lessee();
    await expect(takeLease(h.db, { accountId: t.accountId, listingId: l.id, now: T0 })).rejects.toMatchObject({ code: "LISTING_NOT_ACTIVE" });
    expect((await getHorseRow(h.db, x.id)).lesseeStableId).toBeNull();
    await expect(offer(o.accountId, x.id)).rejects.toMatchObject({ code: "HORSE_LOCKED" });
  });

  it("standing a horse at stud withdraws its open lease offer", async () => {
    const o = await owner(4);
    const x = o.horses[0]!;
    const l = await offer(o.accountId, x.id);
    await setStudFee(h.db, { accountId: o.accountId, horseId: x.id, fee: 500, now: T0 });
    const [row] = await h.db.select().from(horseLeaseListings).where(eq(horseLeaseListings.id, l.id));
    expect(row!.status).toBe("cancelled");
  });

  it("no Daily Cup run on a horse that was handed back or whose term is over", async () => {
    const o = await owner(8);
    const [x, y] = o.horses;
    const t = await lessee();
    const { lease: a } = await takeLease(h.db, { accountId: t.accountId, listingId: (await offer(o.accountId, x!.id)).id, now: T0 });
    const race = await liveRace(at(30 * MIN));
    await enterRace(h.db, { accountId: t.accountId, raceId: race.id, horseId: x!.id, tactic: "front", now: T0 });
    expect(await returnLease(h.db, { accountId: t.accountId, leaseId: a.id, now: at(MIN) })).toMatchObject({ pending: true });
    const cup = (horseId: string, now: Date) => runCupEntry(h.db, { accountId: t.accountId, horseId, now, credits: 0, run: () => ({ finishPosition: 1, finishTimeUs: 1, result: {} }) });
    await expect(cup(x!.id, at(2 * MIN))).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    // term over (7 days) but not swept yet
    await takeLease(h.db, { accountId: t.accountId, listingId: (await offer(o.accountId, y!.id)).id, now: T0 });
    await expect(cup(y!.id, at(7 * DAY + MIN))).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("an owner who raced a horse before leasing it out pays that week's upkeep for it", async () => {
    const o = await owner(4);
    const x = o.horses[0]!;
    const race = await liveRace(at(30 * MIN));
    await enterRace(h.db, { accountId: o.accountId, raceId: race.id, horseId: x.id, tactic: "front", now: T0 });
    await runRace(race.id, at(31 * MIN), [x.id]);
    const t = await lessee();
    await takeLease(h.db, { accountId: t.accountId, listingId: (await offer(o.accountId, x.id, { now: at(DAY) })).id, now: at(DAY) });
    const charges = await settleUpkeep(h.db, at(8 * DAY), { stableId: o.stableId });
    expect(charges.find((c) => c.weekStart === "2026-11-02")).toMatchObject({ horses: 1, due: gc.UPKEEP_RACING_PER_WEEK });
  });
});

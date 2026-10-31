import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { RULES } from "../rules";
import { fraudEvents, horseLeaseListings, horses, inboxItems, raceClaims, stables } from "../schema";
import { recordAccountSignal } from "../services/accounts";
import { cardSlotAt, claimingSlotOfMeeting, ensureRaceCard, isCalendarSlot, isClaimingSlot, meetingRaceOf, slotIndexAt, slotIndexOf, slotKeyOf, slotPostTime } from "../services/card";
import { claimingCard, claimingEligibleCount, claimPriceBand, isClaimingRace, lodgeClaim } from "../services/claiming";
import { getBalance, ledgerHealth } from "../services/ledger";
import { listHorse } from "../services/market";
import { cancelRace, createRace, enterRace, lockField, scratchEntry, settleRace, type RunnerOutcome } from "../services/races";
import { at, count, DAY, getHorseRow, makeHorse, makeSeller, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

async function seller(credits = 5_000) {
  const p = await newPlayer(h.db, { credits });
  await makeSeller(h.db, p.accountId, p.stableId);
  return p;
}

let raceN = 0;
/** A claiming race opening at `open`, closing 9 minutes later (players only: no house runners). */
async function claimingRace(open = T0, runners = 2) {
  return createRace(h.db, {
    kind: "scheduled",
    name: `Bellmont Claiming Stakes (0-55) ${++raceN}`,
    raceClass: "handicap",
    conditions: { claiming: true, minRating: 0, maxRating: 55, distanceM: 1400 },
    postTime: new Date(open.getTime() + 10 * MIN),
    entriesCloseAt: new Date(open.getTime() + 9 * MIN),
    purse: 1_500,
    maxRunners: 12,
    targetRunners: runners,
  });
}

async function priceOf(horseId: string) {
  return claimPriceBand(await getHorseRow(h.db, horseId));
}

async function enterAtAppraisal(p: { accountId: string }, raceId: string, horseId: string, now = T0) {
  const { appraisal } = await priceOf(horseId);
  await enterRace(h.db, { accountId: p.accountId, raceId, horseId, tactic: "stalker", now, claimPrice: appraisal });
  return appraisal;
}

function settle(raceId: string, order: string[], now: Date, extra: Record<string, Partial<RunnerOutcome>> = {}) {
  return settleRace(h.db, { raceId, now, resultHash: "0".repeat(64), result: { order }, runners: order.map((horseId, i) => ({ horseId, position: i + 1, ...(extra[horseId] ?? {}) })) });
}

const claimRows = (raceId: string) => h.db.select().from(raceClaims).where(eq(raceClaims.raceId, raceId));

describe("claiming races: the card", () => {
  const from = slotIndexAt(new Date(Date.UTC(2026, 10, 2)));
  const days = 60;
  const claimingByDay = new Map<number, number[]>();
  for (let i = from; i < from + days * 96; i++) {
    if (!isClaimingSlot(i)) continue;
    const day = Math.floor(slotPostTime(i).getTime() / DAY);
    claimingByDay.set(day, [...(claimingByDay.get(day) ?? []), i]);
  }

  it("one claiming race a day, in the 19:00 UTC meeting, on a handicap, never over a calendar race", () => {
    // every day of two months except the Season Finals' day(s) has exactly one
    const finals = [...Array(days).keys()].map((d) => Math.floor(slotPostTime(from).getTime() / DAY) + d).filter((d) => !claimingByDay.has(d));
    expect(finals.length).toBeLessThanOrEqual(2);
    for (const [, slots] of claimingByDay) {
      expect(slots).toHaveLength(1);
      const i = slots[0]!;
      const m = meetingRaceOf(i)!;
      expect(m.ofDay).toBe(2);
      expect(slotPostTime(i).getUTCHours()).toBeGreaterThanOrEqual(19);
      expect([2, 4, 6]).toContain(m.race);
      expect(isCalendarSlot(i)).toBe(false);
      const race = cardSlotAt(i)!;
      expect(race.name).toMatch(/^.+ Claiming Stakes \((0-55|50-75|70-95)\)$/);
      expect(race.raceClass).toBe("handicap");
      expect(isClaimingRace(race)).toBe(true);
      expect(race.conditions.maxRating).toBe({ 2: 55, 4: 75, 6: 95 }[m.race]);
      expect(race.purse).toBe({ 2: 1_500, 4: 2_000, 6: 2_500 }[m.race]);
    }
  });

  it("rotates through the three bands day by day", () => {
    const bands = [...claimingByDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, [i]]) => ({ day, race: meetingRaceOf(i!)!.race }));
    const plain = bands.filter(({ day }) => {
      const m = meetingRaceOf(claimingByDay.get(day)![0]!)!;
      return [2, 4, 6].every((pos) => !isCalendarSlot(slotIndexAt(new Date(m.startMs + pos * 15 * MIN))));
    });
    expect(plain.length).toBeGreaterThan(30);
    for (const { day, race } of plain) expect(race).toBe([2, 4, 6][gc.claimingBandOrder(day)[0]!]);
    expect(new Set(bands.map((b) => b.race)).size).toBe(3);
  });

  it("other meetings and ordinary handicaps are unchanged", () => {
    for (let i = from; i < from + 96; i++) {
      const m = meetingRaceOf(i);
      if (!m || isClaimingSlot(i)) continue;
      const race = cardSlotAt(i)!;
      expect(race.name).not.toMatch(/Claiming/);
      expect(isClaimingRace(race)).toBe(false);
      if (m.ofDay !== 2) expect(claimingSlotOfMeeting(m)).toBeNull();
    }
  });
});

describe("the claiming gate (CLAIMING_MIN_ELIGIBLE)", () => {
  // Runs before the entering/claims describes below, on the still-empty world: this one owns the
  // horses it counts. The 0-55 band is the one fresh test horses fit (rating 0).
  function hcp55Candidate(from: number): number {
    for (let i = from; ; i++) if (isClaimingSlot(i) && meetingRaceOf(i)!.race === 2) return i;
  }
  const c1 = hcp55Candidate(slotIndexAt(T0) + 1);
  const c2 = hcp55Candidate(c1 + 1);
  /** Publishes the card for the 24 h around a candidate slot and returns it. */
  const publish = (i: number, horizonMs = RULES.cardHorizonMs) => ensureRaceCard(h.db, new Date(slotPostTime(i).getTime() - 60 * MIN), {}, horizonMs);
  const raceAt = (card: Awaited<ReturnType<typeof publish>>, i: number) => card.find((r) => r.slotKey === slotKeyOf(i))!;

  it("no eligible horses: the candidate slot is published as the ordinary handicap", async () => {
    expect(await claimingEligibleCount(h.db, { minRating: 0, maxRating: 55, now: T0 })).toBe(0);
    const card = await publish(c1);
    const race = raceAt(card, c1);
    expect(race.name).toMatch(/Handicap \(0-55\)$/);
    expect(isClaimingRace(race)).toBe(false);
    // the evening meeting keeps its full card: the slot was never lost
    expect(card.filter((r) => r.postTime.getUTCHours() >= 19)).toHaveLength(8);
  });

  it("at the threshold it is published as the claiming race; below it is not, and it never flips after publishing", async () => {
    // one short of the knob: still the handicap
    const a = await seller();
    const short: string[] = [];
    for (let k = 0; k < gc.CLAIMING_MIN_ELIGIBLE - 1; k++) short.push((await makeHorse(h.db, a.stableId)).id);
    expect(await claimingEligibleCount(h.db, { minRating: 0, maxRating: 55, now: T0 })).toBe(gc.CLAIMING_MIN_ELIGIBLE - 1);
    const below = await publish(c2);
    expect(raceAt(below, c2).name).toMatch(/Handicap \(0-55\)$/);
    // already published: a sixth eligible horse appearing later changes nothing
    const b = await seller();
    short.push((await makeHorse(h.db, b.stableId)).id);
    expect(await claimingEligibleCount(h.db, { minRating: 0, maxRating: 55, now: T0 })).toBe(gc.CLAIMING_MIN_ELIGIBLE);
    expect(raceAt(await publish(c2), c2).name).toMatch(/Handicap \(0-55\)$/);

    // the next 0-55 candidate, with enough eligible horses from the start: published as claiming
    const c3 = hcp55Candidate(c2 + 1);
    const at = await publish(c3);
    const race = raceAt(at, c3);
    expect(race.name).toMatch(/Claiming Stakes \(0-55\)$/);
    expect(isClaimingRace(race)).toBe(true);
    expect(race.conditions).toMatchObject({ claiming: true, minRating: 0, maxRating: 55 });
    // eligibility disappears later (the horses become Club-bred and untradeable): the published
    // claiming race keeps its kind for good
    await h.db.update(horses).set({ bound: true }).where(inArray(horses.id, short));
    expect(await claimingEligibleCount(h.db, { minRating: 0, maxRating: 55, now: T0 })).toBe(0);
    expect(isClaimingRace(raceAt(await publish(c3), c3))).toBe(true);
  });

  it("calendar races are untouched by the gate", async () => {
    const card = await publish(c2 + 1, 8 * DAY);
    const cal = card.filter((r) => {
      const i = slotIndexOf(r.slotKey);
      return i !== null && isCalendarSlot(i);
    });
    expect(cal.length).toBeGreaterThanOrEqual(3);
    for (const r of cal) {
      const def = cardSlotAt(slotIndexOf(r.slotKey)!)!;
      expect(r.name).toBe(def.name);
      expect(r.conditions).toEqual(def.conditions);
      expect(r.raceClass).toBe(def.raceClass);
      expect(r.kind).toBe(def.kind);
      expect(isClaimingRace(r)).toBe(false);
    }
  });
});

describe("claiming races: entering", () => {
  it("needs a claim price inside the market's band; refused in ordinary races", async () => {
    const s = await seller();
    const horse = await makeHorse(h.db, s.stableId);
    const race = await claimingRace();
    const band = await priceOf(horse.id);
    expect(band.min).toBe(Math.ceil((band.appraisal * 700) / 1000));
    await expect(enterRace(h.db, { accountId: s.accountId, raceId: race.id, horseId: horse.id, tactic: "front", now: T0 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(enterRace(h.db, { accountId: s.accountId, raceId: race.id, horseId: horse.id, tactic: "front", now: T0, claimPrice: band.min - 1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(enterRace(h.db, { accountId: s.accountId, raceId: race.id, horseId: horse.id, tactic: "front", now: T0, claimPrice: band.max + 1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const entry = await enterRace(h.db, { accountId: s.accountId, raceId: race.id, horseId: horse.id, tactic: "front", now: T0, claimPrice: band.max });
    expect(entry.claimPrice).toBe(band.max);
    const plain = await createRace(h.db, { kind: "quick", name: "R", raceClass: "maiden", conditions: {}, postTime: at(10 * MIN), entriesCloseAt: at(9 * MIN) });
    const other = await makeHorse(h.db, s.stableId);
    await expect(enterRace(h.db, { accountId: s.accountId, raceId: plain.id, horseId: other.id, tactic: "front", now: T0, claimPrice: 1000 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("only horses that could be sold for credits today", async () => {
    const s = await seller();
    const race = await claimingRace();
    const tryEnter = async (horseId: string) => {
      const { appraisal } = await priceOf(horseId);
      return enterRace(h.db, { accountId: s.accountId, raceId: race.id, horseId, tactic: "front", now: T0, claimPrice: appraisal });
    };
    const bound = await makeHorse(h.db, s.stableId, { bound: true });
    await expect(tryEnter(bound.id)).rejects.toMatchObject({ code: "HORSE_BOUND" });
    const young = await makeHorse(h.db, s.stableId, { tradeMinStarts: 5, starts: 2 });
    await expect(tryEnter(young.id)).rejects.toMatchObject({ code: "HORSE_BOUND" });
    const offered = await makeHorse(h.db, s.stableId);
    await h.db.insert(horseLeaseListings).values({ horseId: offered.id, ownerStableId: s.stableId, termDays: 7, ownerSharePct: 50, expiresAt: at(DAY) });
    await expect(tryEnter(offered.id)).rejects.toMatchObject({ code: "HORSE_LOCKED" });
    const leasedOut = await makeHorse(h.db, s.stableId);
    const lessee = await newPlayer(h.db);
    await h.db.update(horses).set({ lesseeStableId: lessee.stableId }).where(eq(horses.id, leasedOut.id));
    await expect(tryEnter(leasedOut.id)).rejects.toMatchObject({ code: "HORSE_ON_LEASE" });
    // a new seller (account too young / too few races) can't sell, so can't enter
    const fresh = await newPlayer(h.db);
    const freshHorse = await makeHorse(h.db, fresh.stableId);
    const { appraisal } = await priceOf(freshHorse.id);
    await expect(enterRace(h.db, { accountId: fresh.accountId, raceId: race.id, horseId: freshHorse.id, tactic: "front", now: T0, claimPrice: appraisal })).rejects.toMatchObject({ code: "SELLER_REQUIREMENTS" });
    // a listed horse is locked (the race lock check)
    const listed = await makeHorse(h.db, s.stableId);
    await listHorse(h.db, { accountId: s.accountId, horseId: listed.id, price: (await priceOf(listed.id)).appraisal, now: T0 });
    await expect(tryEnter(listed.id)).rejects.toMatchObject({ code: "HORSE_LOCKED" });
  });
});

describe("claiming races: claims", () => {
  it("escrows the price; refuses own horse, linked accounts, a full stable, too few credits; one claim per stable", async () => {
    const s = await seller();
    const horse = await makeHorse(h.db, s.stableId);
    const second = await seller();
    const horse2 = await makeHorse(h.db, second.stableId);
    const race = await claimingRace();
    const price = await enterAtAppraisal(s, race.id, horse.id);
    await enterAtAppraisal(second, race.id, horse2.id);

    await expect(lodgeClaim(h.db, { accountId: s.accountId, raceId: race.id, horseId: horse.id, now: T0 })).rejects.toMatchObject({ code: "CANNOT_BUY_OWN" });

    const alt = await newPlayer(h.db, { credits: 100_000 });
    await recordAccountSignal(h.db, { accountId: s.accountId, kind: "device", value: `dev-${race.id}` });
    await recordAccountSignal(h.db, { accountId: alt.accountId, kind: "device", value: `dev-${race.id}` });
    await expect(lodgeClaim(h.db, { accountId: alt.accountId, raceId: race.id, horseId: horse.id, now: T0 })).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    expect((await h.db.select().from(fraudEvents).where(eq(fraudEvents.accountId, alt.accountId))).map((f) => f.kind)).toContain("linked_trade_blocked");

    const full = await newPlayer(h.db, { credits: 100_000 });
    await h.db.update(stables).set({ stallSlots: 1 }).where(eq(stables.id, full.stableId));
    await makeHorse(h.db, full.stableId);
    await expect(lodgeClaim(h.db, { accountId: full.accountId, raceId: race.id, horseId: horse.id, now: T0 })).rejects.toMatchObject({ code: "STABLE_FULL" });

    const poor = await newPlayer(h.db, { credits: price - 1 });
    await expect(lodgeClaim(h.db, { accountId: poor.accountId, raceId: race.id, horseId: horse.id, now: T0 })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });

    const buyer = await newPlayer(h.db, { credits: 100_000 });
    const claim = await lodgeClaim(h.db, { accountId: buyer.accountId, raceId: race.id, horseId: horse.id, now: T0 });
    expect(claim.status).toBe("lodged");
    expect(await getBalance(h.db, buyer.accountId)).toBe(100_000 - price);
    // idempotent for the same horse; a second horse in the same race is refused
    expect((await lodgeClaim(h.db, { accountId: buyer.accountId, raceId: race.id, horseId: horse.id, now: T0 })).id).toBe(claim.id);
    expect(await getBalance(h.db, buyer.accountId)).toBe(100_000 - price);
    await expect(lodgeClaim(h.db, { accountId: buyer.accountId, raceId: race.id, horseId: horse2.id, now: T0 })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    // the card shows prices and counts
    const card = await claimingCard(h.db, race.id);
    expect(card.get(horse.id)).toEqual({ price, claims: 1 });
    expect(card.get(horse2.id)?.claims).toBe(0);
    // claims close with the entries
    const late = await newPlayer(h.db, { credits: 100_000 });
    await expect(lodgeClaim(h.db, { accountId: late.accountId, raceId: race.id, horseId: horse2.id, now: at(9 * MIN) })).rejects.toMatchObject({ code: "RACE_CLOSED" });
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
  });

  it("a lodged claim holds a stall", async () => {
    const s = await seller();
    const a = await makeHorse(h.db, s.stableId);
    const b = await makeHorse(h.db, s.stableId);
    const r1 = await claimingRace();
    const r2 = await claimingRace();
    await enterAtAppraisal(s, r1.id, a.id);
    await enterAtAppraisal(s, r2.id, b.id);
    const buyer = await newPlayer(h.db, { credits: 100_000 });
    await h.db.update(stables).set({ stallSlots: 1 }).where(eq(stables.id, buyer.stableId));
    await lodgeClaim(h.db, { accountId: buyer.accountId, raceId: r1.id, horseId: a.id, now: T0 });
    await expect(lodgeClaim(h.db, { accountId: buyer.accountId, raceId: r2.id, horseId: b.id, now: T0 })).rejects.toMatchObject({ code: "STABLE_FULL" });
  });

  it("several claims: one seeded draw at the lock, the losers refunded", async () => {
    const s = await seller();
    const horse = await makeHorse(h.db, s.stableId);
    const race = await claimingRace(T0, 2);
    const price = await enterAtAppraisal(s, race.id, horse.id);
    const buyers = await Promise.all([1, 2, 3].map(() => newPlayer(h.db, { credits: 50_000 })));
    for (const b of buyers) await lodgeClaim(h.db, { accountId: b.accountId, raceId: race.id, horseId: horse.id, now: T0 });
    expect((await claimingCard(h.db, race.id)).get(horse.id)?.claims).toBe(3);
    const field = (await lockField(h.db, race.id, at(9 * MIN)))!;
    await lockField(h.db, race.id, at(9 * MIN)); // idempotent
    const rows = await claimRows(race.id);
    expect(rows.filter((c) => c.status === "drawn")).toHaveLength(1);
    expect(rows.filter((c) => c.status === "lost")).toHaveLength(2);
    for (const c of rows) {
      const b = buyers.find((x) => x.stableId === c.claimantStableId)!;
      expect(await getBalance(h.db, b.accountId)).toBe(c.status === "drawn" ? 50_000 - price : 50_000);
    }
    // the draw is the race seed's: the same race and claims always draw the same claimant
    const winner = rows.find((c) => c.status === "drawn")!;
    await settle(race.id, [horse.id, ...field.runners.map((r) => r.horseId).filter((x) => x !== horse.id)], at(11 * MIN));
    expect((await getHorseRow(h.db, horse.id)).ownerStableId).toBe(winner.claimantStableId);
    const lostNotes = await h.db.select().from(inboxItems).where(eq(inboxItems.kind, "claim_lost"));
    expect(lostNotes.length).toBeGreaterThanOrEqual(2);
  });

  it("refunds on a scratch and an abandoned race", async () => {
    const s = await seller();
    const a = await makeHorse(h.db, s.stableId);
    const race = await claimingRace();
    await enterAtAppraisal(s, race.id, a.id);
    const buyer = await newPlayer(h.db, { credits: 50_000 });
    await lodgeClaim(h.db, { accountId: buyer.accountId, raceId: race.id, horseId: a.id, now: T0 });
    await scratchEntry(h.db, { accountId: s.accountId, raceId: race.id, horseId: a.id, now: at(MIN) });
    expect((await claimRows(race.id))[0]!.status).toBe("refunded");
    expect(await getBalance(h.db, buyer.accountId)).toBe(50_000);

    const race2 = await claimingRace();
    const b = await makeHorse(h.db, s.stableId);
    await enterAtAppraisal(s, race2.id, b.id);
    await lodgeClaim(h.db, { accountId: buyer.accountId, raceId: race2.id, horseId: b.id, now: T0 });
    await lockField(h.db, race2.id, at(9 * MIN));
    await cancelRace(h.db, { raceId: race2.id, now: at(9 * MIN), reason: "test" });
    expect((await claimRows(race2.id))[0]!.status).toBe("refunded");
    expect(await getBalance(h.db, buyer.accountId)).toBe(50_000);
    expect((await getHorseRow(h.db, b.id)).ownerStableId).toBe(s.stableId);
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
  });
});

describe("claiming races: after the race", () => {
  it("the horse moves whatever the result: purse to the old owner, price minus 5% burned; resale and re-entry locks; idempotent", async () => {
    const s = await seller();
    const horse = await makeHorse(h.db, s.stableId);
    const rival = await seller();
    const rivalHorse = await makeHorse(h.db, rival.stableId);
    const race = await claimingRace();
    const price = await enterAtAppraisal(s, race.id, horse.id);
    await enterAtAppraisal(rival, race.id, rivalHorse.id);
    const buyer = await seller(100_000);
    await lodgeClaim(h.db, { accountId: buyer.accountId, raceId: race.id, horseId: horse.id, now: T0 });
    const before = await getBalance(h.db, s.accountId);
    await lockField(h.db, race.id, at(9 * MIN));
    const res = await settle(race.id, [horse.id, rivalHorse.id], at(11 * MIN));
    const purse = res.prizes[horse.id]!;
    expect(purse).toBeGreaterThan(0);
    const { toOwner, fee } = gc.claimSettlement(price);
    expect(fee).toBe(Math.floor(price / 20));
    expect(await getBalance(h.db, s.accountId)).toBe(before + purse + toOwner);
    expect(await getBalance(h.db, buyer.accountId)).toBe(100_000 - price);
    const after = await getHorseRow(h.db, horse.id);
    expect(after.ownerStableId).toBe(buyer.stableId);
    expect(after.lockKind).toBeNull();
    expect(after.wins).toBe(1);
    const [claim] = await claimRows(race.id);
    expect(claim).toMatchObject({ status: "claimed", fee });
    // inbox notes to both owners
    expect(await count(h.db, "inbox_items", `kind = 'claim_won' and horse_id = '${horse.id}'`)).toBe(1);
    expect(await count(h.db, "inbox_items", `kind = 'horse_claimed' and horse_id = '${horse.id}'`)).toBe(1);

    // idempotent settlement: nothing moves twice
    const again = await settle(race.id, [horse.id, rivalHorse.id], at(12 * MIN));
    expect(again.alreadySettled).toBe(true);
    expect(await getBalance(h.db, s.accountId)).toBe(before + purse + toOwner);
    expect(await getBalance(h.db, buyer.accountId)).toBe(100_000 - price);

    // resale lock: the claimant can't list it for 72 h
    const { appraisal } = await priceOf(horse.id);
    await expect(listHorse(h.db, { accountId: buyer.accountId, horseId: horse.id, price: appraisal, now: at(DAY) })).rejects.toMatchObject({ code: "RESALE_LOCKED" });
    // re-entry lock: no claiming race for 3 days
    const next = await claimingRace(at(DAY));
    await expect(enterRace(h.db, { accountId: buyer.accountId, raceId: next.id, horseId: horse.id, tactic: "front", now: at(DAY), claimPrice: appraisal })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    const later = await claimingRace(at(3 * DAY + 20 * MIN));
    await enterRace(h.db, { accountId: buyer.accountId, raceId: later.id, horseId: horse.id, tactic: "front", now: at(3 * DAY + 20 * MIN), claimPrice: (await priceOf(horse.id)).appraisal });
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
  });

  it("an injured horse still transfers; a fatal injury voids the claim and refunds", async () => {
    const s = await seller();
    const hurt = await makeHorse(h.db, s.stableId);
    const other = await seller();
    const race = await claimingRace();
    await enterAtAppraisal(s, race.id, hurt.id);
    const otherHorse = await makeHorse(h.db, other.stableId);
    await enterAtAppraisal(other, race.id, otherHorse.id);
    const b1 = await newPlayer(h.db, { credits: 100_000 });
    const b2 = await newPlayer(h.db, { credits: 100_000 });
    await lodgeClaim(h.db, { accountId: b1.accountId, raceId: race.id, horseId: hurt.id, now: T0 });
    await lodgeClaim(h.db, { accountId: b2.accountId, raceId: race.id, horseId: otherHorse.id, now: T0 });
    await lockField(h.db, race.id, at(9 * MIN));
    await settle(race.id, [otherHorse.id, hurt.id], at(11 * MIN), {
      [hurt.id]: { injury: { severity: "moderate", recoveryMs: 7 * DAY } },
      [otherHorse.id]: { injury: { severity: "fatal", recoveryMs: 0 } },
    });
    expect((await getHorseRow(h.db, hurt.id)).ownerStableId).toBe(b1.stableId);
    const deadRow = await getHorseRow(h.db, otherHorse.id);
    expect(deadRow.ownerStableId).toBe(other.stableId);
    expect(await getBalance(h.db, b2.accountId)).toBe(100_000);
    const rows = await claimRows(race.id);
    expect(rows.find((c) => c.horseId === otherHorse.id)!.status).toBe("void");
    expect(rows.find((c) => c.horseId === hurt.id)!.status).toBe("claimed");
  });
});

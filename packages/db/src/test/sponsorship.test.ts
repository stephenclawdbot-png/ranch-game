/**
 * Sponsor a race (services/sponsorship.ts): pricing and names, the sponsor list, one sponsor
 * per slot under concurrency, idempotent purchase, refusals, naming on publication and in
 * place, sister courses, the result note, the refund on abandonment and the ledger.
 */
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { RULES } from "../rules";
import { inboxItems, ledgerTransactions, raceSponsorships, races } from "../schema";
import { CALENDAR_HORIZON_MS, defaultCardSlot, ensureRaceCard, isCalendarSlot, slotIndexAt, slotPostTime } from "../services/card";
import { getBalance, ledgerHealth, systemAccountId } from "../services/ledger";
import { cancelRace, createRace, enterRace, getRaceForSimulation, lockField, settleRace } from "../services/races";
import {
  SPONSORSHIP,
  listSponsorSlots,
  listStableSponsorships,
  raceSponsor,
  sanitiseSponsorName,
  sponsorOf,
  sponsorRace,
  sponsoredRaceName,
  sponsorshipPrice,
  sponsorWindow,
} from "../services/sponsorship";
import { at, DAY, makeHorse, memoryDb, MIN, newPlayer, settledAll, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let keyN = 0;
const key = () => `sponsor-test-${++keyN}`;

async function burnBalance(): Promise<number> {
  const id = await systemAccountId(h.db, "burn");
  const rows = await h.db.execute(`select balance from ledger_accounts where id = '${id}'`);
  const list = (Array.isArray(rows) ? rows : (rows as { rows: { balance: string }[] }).rows) as { balance: string }[];
  return Number(list[0]!.balance);
}

/** The first ordinary (non-calendar) slot at or after `from`. */
function ordinarySlot(from: number): number {
  let i = from;
  while (isCalendarSlot(i)) i++;
  return i;
}

describe("pricing and names", () => {
  it("prices at three times the purse with a floor", () => {
    expect(SPONSORSHIP.purseMultiple).toBe(3);
    expect(sponsorshipPrice(1_000)).toBe(3_000);
    expect(sponsorshipPrice(500)).toBe(SPONSORSHIP.minPrice);
    expect(sponsorshipPrice(2_500)).toBe(7_500);
    expect(sponsorshipPrice(12_000)).toBe(36_000);
  });

  it("names the race after the stable and the class, sanitised and length-limited", () => {
    expect(sponsoredRaceName("Glenmorrow House", "Ashcombe Handicap (0-55)", "Ashcombe")).toBe("The Glenmorrow House Handicap (0-55)");
    expect(sponsoredRaceName("Glenmorrow House", "Saltmarsh Maiden Stakes", "Saltmarsh")).toBe("The Glenmorrow House Maiden Stakes");
    expect(sponsoredRaceName("Glenmorrow House", "Bellmont Feature Group 3", "Bellmont")).toBe("The Glenmorrow House Group 3 Stakes");
    expect(sponsoredRaceName("Glenmorrow House", "Bellmont Feature Listed Stakes", "Bellmont")).toBe("The Glenmorrow House Listed Stakes");
    expect(sponsoredRaceName("The Old Barn", "Larkspur Novice Stakes", "Larkspur")).toBe("The Old Barn Novice Stakes");
    expect(sanitiseSponsorName("  Copper\u0000 <b>Gate</b>\n  & Co.  ")).toBe("Copper bGateb & Co.");
    expect(sanitiseSponsorName("x".repeat(60))).toHaveLength(SPONSORSHIP.maxNameChars);
    expect(sanitiseSponsorName("!!!")).toBe("Anonymous");
  });
});

describe("the sponsor list", () => {
  it("lists every ordinary slot for the next week at its price; calendar races are not for sale", async () => {
    const now = at(2 * DAY);
    const slots = await listSponsorSlots(h.db, now);
    const w = sponsorWindow(now);
    expect(slots[0]!.index).toBeGreaterThanOrEqual(w.first);
    expect(slots.at(-1)!.index).toBeLessThanOrEqual(w.last);
    expect(slots.at(-1)!.postTime.getTime()).toBeLessThanOrEqual(now.getTime() + SPONSORSHIP.windowMs);
    const calendar = Array.from({ length: w.last - w.first + 1 }, (_, i) => w.first + i).filter(isCalendarSlot);
    expect(calendar.length).toBeGreaterThan(0); // a week always has Qualifiers
    expect(slots).toHaveLength(w.last - w.first + 1 - calendar.length);
    for (const s of slots) {
      expect(isCalendarSlot(s.index)).toBe(false);
      expect(s.price).toBe(sponsorshipPrice(defaultCardSlot(s.index).purse!));
      expect(s.name).toBe(defaultCardSlot(s.index).name);
      expect(s.block).toBeNull();
    }
    // the Feature at the top of each class cycle costs the most
    expect(Math.max(...slots.map((s) => s.price))).toBe(sponsorshipPrice(Math.max(...slots.map((s) => s.purse))));
  });
});

describe("buying a sponsorship", () => {
  it("charges the price once (burned), is idempotent per key, and names the race when it is published", async () => {
    const now = at(3 * DAY);
    const p = await newPlayer(h.db, { credits: 50_000 });
    // a slot a day ahead: beyond the published card (6 h)
    const index = ordinarySlot(slotIndexAt(new Date(now.getTime() + DAY)));
    const slot = defaultCardSlot(index);
    expect(slot.kind === "scheduled" || slot.kind === "feature").toBe(true);
    const price = sponsorshipPrice(slot.purse!);
    const burn0 = await burnBalance();
    const k = key();
    const first = await sponsorRace(h.db, { accountId: p.accountId, slotIndex: index, idempotencyKey: k, now });
    expect(first.duplicate).toBe(false);
    expect(first.raceId).toBeNull();
    expect(first.raceName).toBe(sponsoredRaceName(await stableName(p.accountId), slot.name, String(slot.conditions.track)));
    const again = await sponsorRace(h.db, { accountId: p.accountId, slotIndex: index, idempotencyKey: k, now });
    expect(again).toMatchObject({ duplicate: true, sponsorship: { id: first.sponsorship.id } });
    expect(await getBalance(h.db, p.accountId)).toBe(50_000 - price);
    expect((await burnBalance()) - burn0).toBe(price);
    const tx = await h.db.select().from(ledgerTransactions).where(eq(ledgerTransactions.kind, "race_sponsorship"));
    expect(tx.filter((t) => t.idempotencyKey === `race-sponsorship:${first.sponsorship.id}`)).toHaveLength(1);
    // the same key for another slot is a conflict, not a second purchase
    await expect(sponsorRace(h.db, { accountId: p.accountId, slotIndex: index + 1, idempotencyKey: k, now })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    // later the card publishes the slot: the race carries the sponsor's name
    const publishAt = new Date(slotPostTime(index).getTime() - RULES.cardHorizonMs + MIN);
    await ensureRaceCard(h.db, publishAt);
    const [race] = await h.db.select().from(races).where(eq(races.slotKey, `live:${index}`));
    expect(race!.name).toBe(first.raceName);
    expect(sponsorOf(race!)).toMatchObject({ sponsorshipId: first.sponsorship.id, stableId: p.stableId, baseName: slot.name });
    expect(sponsorOf(race!)!.silks).toMatchObject({ pattern: "solid" });
    const [row] = await h.db.select().from(raceSponsorships).where(eq(raceSponsorships.id, first.sponsorship.id));
    expect(row!.raceId).toBe(race!.id);
    // publishing again changes nothing
    await ensureRaceCard(h.db, new Date(publishAt.getTime() + MIN));
    const [same] = await h.db.select().from(races).where(eq(races.slotKey, `live:${index}`));
    expect(same!.name).toBe(first.raceName);
    // the slot shows as sponsored on the list
    const listed = (await listSponsorSlots(h.db, now)).find((s) => s.index === index);
    expect(listed).toMatchObject({ block: "sponsored", sponsor: { stableId: p.stableId } });
    const mine = await listStableSponsorships(h.db, p.stableId);
    expect(mine[0]).toMatchObject({ slotIndex: index, raceId: race!.id, price, refunded: false });
  });

  it("one sponsor per slot: concurrent buyers, exactly one wins and pays", async () => {
    const now = at(4 * DAY);
    const index = ordinarySlot(slotIndexAt(new Date(now.getTime() + 2 * DAY)));
    const players = await Promise.all(Array.from({ length: 5 }, () => newPlayer(h.db, { credits: 100_000 })));
    const res = await settledAll(players.map((p) => sponsorRace(h.db, { accountId: p.accountId, slotIndex: index, idempotencyKey: key(), now })));
    expect(res.ok).toHaveLength(1);
    expect(res.errors).toHaveLength(4);
    for (const e of res.errors) expect(e).toMatchObject({ code: "ALREADY_SPONSORED" });
    const price = sponsorshipPrice(defaultCardSlot(index).purse!);
    const balances = await Promise.all(players.map((p) => getBalance(h.db, p.accountId)));
    expect(balances.filter((b) => b === 100_000 - price)).toHaveLength(1);
    expect(balances.filter((b) => b === 100_000)).toHaveLength(4);
    expect(await h.db.select().from(raceSponsorships).where(eq(raceSponsorships.slotIndex, index))).toHaveLength(1);
  });

  it("refuses calendar races, gone or too-distant slots, closed races, the per-stable cap and empty purses", async () => {
    const now = at(5 * DAY);
    const p = await newPlayer(h.db, { credits: 200_000 });
    const w = sponsorWindow(now);
    const buy = (slotIndex: number, when = now, accountId = p.accountId) => sponsorRace(h.db, { accountId, slotIndex, idempotencyKey: key(), now: when });
    let calendar = w.first;
    while (!isCalendarSlot(calendar)) calendar++;
    await expect(buy(calendar)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(buy(w.last + 1)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(buy(w.first - 1)).rejects.toMatchObject({ code: "RACE_CLOSED" });
    // published, entries closed (10 s before the off)
    const next = ordinarySlot(w.first);
    await ensureRaceCard(h.db, now);
    const closedAt = new Date(slotPostTime(next).getTime() - 10_000);
    await expect(buy(next, closedAt)).rejects.toMatchObject({ code: "RACE_CLOSED" });
    // a calendar race already on the card (published a day ahead) is still not for sale
    await ensureRaceCard(h.db, new Date(slotPostTime(calendar).getTime() - CALENDAR_HORIZON_MS + MIN));
    await expect(buy(calendar, new Date(slotPostTime(calendar).getTime() - CALENDAR_HORIZON_MS + MIN))).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    // not enough credits: nothing is sold
    const poor = await newPlayer(h.db, { credits: 100 });
    const cheap = ordinarySlot(w.first + 40);
    await expect(buy(cheap, now, poor.accountId)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(await h.db.select().from(raceSponsorships).where(eq(raceSponsorships.slotIndex, cheap))).toHaveLength(0);
    // at most three upcoming sponsorships per stable
    const picks = [ordinarySlot(w.first + 50), ordinarySlot(w.first + 60), ordinarySlot(w.first + 70), ordinarySlot(w.first + 80)];
    for (const i of picks.slice(0, SPONSORSHIP.maxUpcomingPerStable)) await buy(i);
    await expect(buy(picks[3]!)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });
});

describe("a published race", () => {
  it("is renamed in place; sisters keep their course name; the sponsor hears the result", async () => {
    const sponsor = await newPlayer(h.db, { credits: 20_000 });
    const index = ordinarySlot(slotIndexAt(T0) + 3);
    const postTime = slotPostTime(index);
    const close = new Date(postTime.getTime() - 30_000);
    const race = await createRace(h.db, {
      kind: "scheduled",
      name: "Ashcombe Maiden Stakes",
      raceClass: "maiden",
      conditions: { maxWins: 0, maxRating: 60, distanceM: 1400, surface: "turf", track: "Ashcombe" },
      postTime,
      entriesCloseAt: close,
      purse: 1_000,
      maxRunners: 4,
      targetRunners: 4,
      slotKey: `live:${index}`,
    });
    const res = await sponsorRace(h.db, { accountId: sponsor.accountId, slotIndex: index, idempotencyKey: key(), now: T0 });
    const name = `The ${await stableName(sponsor.accountId)} Maiden Stakes`;
    expect(res).toMatchObject({ raceId: race.id, raceName: name });
    expect(await getBalance(h.db, sponsor.accountId)).toBe(20_000 - 3_000);
    const [renamed] = await h.db.select().from(races).where(eq(races.id, race.id));
    expect(renamed!.name).toBe(name);
    expect(sponsorOf(renamed!)?.baseName).toBe("Ashcombe Maiden Stakes");

    // three entries: one gate left opens a sister course, under its own course name
    for (let i = 0; i < 3; i++) {
      const p = await newPlayer(h.db);
      const horse = await makeHorse(h.db, p.stableId, { rating: 40, wins: 0, starts: 0, name: `Sponsor Runner ${i}` });
      await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "front", meta: { stableName: `Owner ${i}` }, now: T0 });
    }
    const [sister] = await h.db.select().from(races).where(like(races.slotKey, `live:${index}:%`));
    expect(sister!.name).toBe("Kestrel Downs Maiden Stakes");
    expect(sponsorOf(sister!)).toBeNull();
    expect(await raceSponsor(h.db, sister!)).toMatchObject({ stableId: sponsor.stableId });
    expect(await raceSponsor(h.db, renamed!)).toMatchObject({ stableId: sponsor.stableId });

    // run it: the sponsor gets the result in the inbox (once)
    await lockField(h.db, race.id, close);
    const sim = await getRaceForSimulation(h.db, race.id, postTime);
    const outcome = { raceId: race.id, now: new Date(postTime.getTime() + 3 * MIN), resultHash: "d".repeat(64), result: {}, runners: sim.field.runners.map((r, i) => ({ horseId: r.horseId, position: i + 1 })) };
    await settleRace(h.db, outcome);
    await settleRace(h.db, outcome);
    const notes = await h.db.select().from(inboxItems).where(and(eq(inboxItems.accountId, sponsor.accountId), eq(inboxItems.kind, "race_sponsor")));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toMatch(new RegExp(`^Your race: .+ won ${name}$`));
    expect(notes[0]!.raceId).toBe(race.id);
    expect((await listStableSponsorships(h.db, sponsor.stableId))[0]).toMatchObject({ raceStatus: "settled", raceName: name });
  });

  it("an abandoned sponsored race refunds the sponsor once", async () => {
    const sponsor = await newPlayer(h.db, { credits: 10_000 });
    const index = ordinarySlot(slotIndexAt(T0) + 6);
    const race = await createRace(h.db, {
      kind: "scheduled",
      name: "Saltmarsh Handicap (0-55)",
      raceClass: "handicap",
      conditions: { minRating: 0, maxRating: 55, distanceM: 1600, surface: "dirt", track: "Saltmarsh" },
      postTime: slotPostTime(index),
      entriesCloseAt: new Date(slotPostTime(index).getTime() - 30_000),
      purse: 1_500,
      slotKey: `live:${index}`,
    });
    await sponsorRace(h.db, { accountId: sponsor.accountId, slotIndex: index, idempotencyKey: key(), now: T0 });
    expect(await getBalance(h.db, sponsor.accountId)).toBe(10_000 - 4_500);
    await Promise.all([cancelRace(h.db, { raceId: race.id, now: T0, reason: "test" }), cancelRace(h.db, { raceId: race.id, now: T0, reason: "test" })]);
    expect(await getBalance(h.db, sponsor.accountId)).toBe(10_000);
    expect((await listStableSponsorships(h.db, sponsor.stableId))[0]).toMatchObject({ refunded: true });
    const health = await ledgerHealth(h.db);
    expect(health).toMatchObject({ totalPostings: 0, unbalancedTransactions: [], driftedAccounts: [], negativeAccounts: [] });
  });
});

async function stableName(accountId: string): Promise<string> {
  const rows = await h.db.execute(`select name from stables where account_id = '${accountId}'`);
  const list = (Array.isArray(rows) ? rows : (rows as { rows: { name: string }[] }).rows) as { name: string }[];
  return list[0]!.name;
}


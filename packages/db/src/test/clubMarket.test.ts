import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { RULES, bps } from "../rules";
import { accounts, clubMarketDays, horseLeaseListings, horseLeases, horses, ledgerAccounts, marketListings, raceEntries, races, stables, trades } from "../schema";
import { recordAccountSignal } from "../services/accounts";
import { clubSupplyCounts, runClubMarket } from "../services/clubMarket";
import { leaseBoard, leaseMetrics, offerLease, sweepLeases, takeLease, withdrawLeaseOffer } from "../services/leasing";
import { getBalance, ledgerHealth } from "../services/ledger";
import { runMaintenance } from "../services/maintenance";
import { buyListing, cancelListing, expireListings, listHorse } from "../services/market";
import { createRace, enterRace, getRaceForSimulation, settleRace } from "../services/races";
import { usdgRegistrationStatus } from "../services/usdgMarket";
import { listMarket } from "../services/economyViews";
import { at, DAY, floorPrice, getHorseRow, makeHorse, makeSeller, memoryDb, MIN, newPlayer, T0 } from "./helpers";

// Each test gets its own database: the Club's caps count the whole market.
let h: DbHandle;
beforeEach(async () => {
  h = await memoryDb();
});
afterEach(async () => {
  await h.close();
});

const HOUR = 60 * MIN;

async function burnBalance(): Promise<number> {
  const [r] = await h.db.select({ b: ledgerAccounts.balance }).from(ledgerAccounts).where(and(eq(ledgerAccounts.kind, "burn"), sql`${ledgerAccounts.ownerAccountId} is null`, eq(ledgerAccounts.currency, "CR")));
  return Number(r!.b);
}

async function clubLots() {
  return h.db.select().from(marketListings).where(and(eq(marketListings.club, true), eq(marketListings.status, "active")));
}
async function clubOffers() {
  return h.db.select().from(horseLeaseListings).where(and(eq(horseLeaseListings.club, true), eq(horseLeaseListings.status, "active")));
}

/** A stable that may sell (8 days old, 20 races) with `n` tradeable racing horses. */
async function seller(n: number, credits = 5_000) {
  const p = await newPlayer(h.db, { credits });
  await makeSeller(h.db, p.accountId, p.stableId);
  const hs = [];
  for (let i = 0; i < n; i++) hs.push(await makeHorse(h.db, p.stableId, { rating: 40 + i }));
  return { ...p, horses: hs };
}

/** An established stable: 8 days old with 10 settled Live starts (lessee requirements). */
async function lessee(credits = 5_000) {
  const p = await newPlayer(h.db, { credits });
  await h.db
    .update(accounts)
    .set({ createdAt: new Date(T0.getTime() - 8 * DAY) })
    .where(eq(accounts.id, p.accountId));
  const past = await makeHorse(h.db, null, { careerStatus: "retired", retirementReason: "choice", retiredAt: T0 });
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
    await h.db.insert(raceEntries).values({ raceId: race.id, horseId: past.id, stableId: p.stableId, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
  }
  return p;
}

describe("the Club's daily market job", () => {
  it("lists 3 lots and opens 4 lease offers once per UTC day; reruns do nothing", async () => {
    const r1 = await runClubMarket(h.db, T0);
    expect(r1).toMatchObject({ ran: true, listed: gc.CLUB_SALE_LISTINGS_PER_DAY, offered: gc.CLUB_LEASE_OFFERS_MAX, withdrawn: 0 });
    const again = await runClubMarket(h.db, at(6 * HOUR));
    expect(again).toMatchObject({ ran: false, listed: 0, offered: 0 });
    const report = await runMaintenance(h.db, at(7 * HOUR));
    expect(report.club.ran).toBe(false);
    expect(await clubLots()).toHaveLength(3);
    expect(await clubOffers()).toHaveLength(4);
    expect(await h.db.select().from(clubMarketDays)).toHaveLength(1);

    for (const l of await clubLots()) {
      const horse = await getHorseRow(h.db, l.horseId);
      // a Club horse minted like a Live runner, locked as the lot's escrow, priced at 110% of appraisal
      expect(horse).toMatchObject({ ownerStableId: null, origin: "house", careerStatus: "racing", lockKind: "market", lockRef: l.id, bound: false });
      expect(horse.careSessions).toBeGreaterThanOrEqual(RULES.careToRacing);
      expect(horse.rating).toBeGreaterThanOrEqual(gc.CLUB_RATING_MIN);
      expect(l.sellerStableId).toBeNull();
      expect(l.price).toBe(gc.clubSalePrice(l.appraisal));
      expect(l.expiresAt.getTime() - l.createdAt.getTime()).toBe(72 * HOUR);
    }
    for (const o of await clubOffers()) {
      expect(o).toMatchObject({ ownerStableId: null, ownerSharePct: 50, fee: 0, allowAllOut: false, maxLiveStartsPerWeek: gc.LEASE_WEEKLY_STARTS_DEFAULT });
      expect([7, 14]).toContain(o.termDays);
    }

    // the next day tops the market up to the cap of 6 lots; lease offers are already at 4
    expect(await runClubMarket(h.db, at(DAY))).toMatchObject({ ran: true, listed: 3, offered: 0 });
    expect(await runClubMarket(h.db, at(2 * DAY))).toMatchObject({ ran: true, listed: 0, offered: 0 });
    expect(await clubLots()).toHaveLength(gc.CLUB_SALE_LISTINGS_MAX);
  });

  it("lease offers use free Club racers before minting new ones", async () => {
    const pool = [];
    for (let i = 0; i < 6; i++) pool.push(await makeHorse(h.db, null, { origin: "house", rating: 45, starts: 3 }));
    await runClubMarket(h.db, T0);
    const offered = (await clubOffers()).map((o) => o.horseId);
    expect(offered).toHaveLength(4);
    for (const id of offered) expect(pool.map((p) => p.id)).toContain(id);
  });

  it("backs off as players list and offer their own", async () => {
    await runClubMarket(h.db, T0);
    await runClubMarket(h.db, at(DAY));
    expect(await clubLots()).toHaveLength(6);
    const s = await seller(7);
    for (const x of s.horses.slice(0, 4)) await listHorse(h.db, { accountId: s.accountId, horseId: x.id, price: await floorPrice(h.db, x.id), now: at(DAY + HOUR), durationMs: 3 * DAY });
    // players' lease offers (an owner with 8 racers may have 2 out, 3 on offer)
    const o = await seller(8);
    for (const x of o.horses.slice(0, 2)) await offerLease(h.db, { accountId: o.accountId, horseId: x.id, termDays: 7, ownerSharePct: 50, now: at(DAY + HOUR) });

    const r = await runClubMarket(h.db, at(2 * DAY));
    // 4 player lots: at most 2 Club lots; 2 player offers: at most 2 Club offers
    expect(r).toMatchObject({ listed: 0, offered: 0, withdrawn: 4 + 2 });
    const lots = await clubLots();
    expect(lots).toHaveLength(2);
    expect(await clubOffers()).toHaveLength(2);
    // withdrawn lots hand their horses back to the Club's pool, unlocked
    const cancelled = await h.db.select().from(marketListings).where(and(eq(marketListings.club, true), eq(marketListings.status, "cancelled")));
    expect(cancelled).toHaveLength(4);
    for (const l of cancelled) expect(await getHorseRow(h.db, l.horseId)).toMatchObject({ ownerStableId: null, lockKind: null });

    // 7 player lots: the Club lists nothing
    for (const x of s.horses.slice(4)) await listHorse(h.db, { accountId: s.accountId, horseId: x.id, price: await floorPrice(h.db, x.id), now: at(2 * DAY + HOUR), durationMs: 3 * DAY });
    // (the next UTC day, before the first Club lots lapse at 72 h)
    expect(await runClubMarket(h.db, at(3 * DAY - HOUR))).toMatchObject({ ran: true, listed: 0, withdrawn: 2 });
    expect(await clubLots()).toHaveLength(0);
    expect((await clubSupplyCounts(h.db, at(3 * DAY - HOUR))).playerLots).toBe(7);
  });

  it("unsold lots expire after 72 h and the horses return to the Club's pool", async () => {
    await runClubMarket(h.db, T0);
    const lots = await clubLots();
    expect(await expireListings(h.db, at(72 * HOUR + MIN))).toBe(3);
    for (const l of lots) {
      expect(await getHorseRow(h.db, l.horseId)).toMatchObject({ ownerStableId: null, lockKind: null, careerStatus: "racing" });
    }
    // back in the pool: a Live race filled by the Club can pick them again
    const ratings = (await Promise.all(lots.map((l) => getHorseRow(h.db, l.horseId)))).map((x) => x.rating);
    const race = await createRace(h.db, {
      kind: "scheduled",
      name: "Fill",
      raceClass: "maiden",
      conditions: { distanceM: 1200, surface: "turf", minRating: Math.min(...ratings), maxRating: Math.max(...ratings) },
      postTime: at(80 * HOUR),
      entriesCloseAt: at(80 * HOUR - MIN),
      targetRunners: 3,
    });
    const p = await newPlayer(h.db);
    const mine = await makeHorse(h.db, p.stableId, { rating: Math.min(...ratings) });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: mine.id, tactic: "front", now: at(79 * HOUR) });
    const { field } = await getRaceForSimulation(h.db, race.id, at(80 * HOUR));
    const ids = field.runners.map((r) => r.horseId);
    expect(lots.some((l) => ids.includes(l.horseId))).toBe(true);
  });
});

describe("buying a Club lot", () => {
  it("burns the price, moves the horse, applies the resale lock; never USDG-registrable", async () => {
    await runClubMarket(h.db, T0);
    const [lot] = await clubLots();
    const buyer = await seller(0, 100_000);
    await h.db.update(accounts).set({ createdAt: new Date(T0.getTime() - 30 * DAY) }).where(eq(accounts.id, buyer.accountId));
    const [before, burnBefore] = [await getBalance(h.db, buyer.accountId), await burnBalance()];
    const res = await buyListing(h.db, { accountId: buyer.accountId, listingId: lot!.id, now: at(HOUR) });
    expect(res.price).toBe(lot!.price);
    expect(await getBalance(h.db, buyer.accountId)).toBe(before - lot!.price);
    expect(await burnBalance()).toBe(burnBefore + lot!.price);
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
    const horse = await getHorseRow(h.db, lot!.horseId);
    expect(horse).toMatchObject({ ownerStableId: buyer.stableId, lockKind: null, origin: "house" });
    const [trade] = await h.db.select().from(trades).where(eq(trades.listingId, lot!.id));
    expect(trade).toMatchObject({ club: true, sellerStableId: null, buyerStableId: buyer.stableId });
    // resale lock, then an ordinary sellable horse
    await expect(listHorse(h.db, { accountId: buyer.accountId, horseId: horse.id, price: lot!.price, now: at(2 * HOUR) })).rejects.toMatchObject({ code: "RESALE_LOCKED" });
    await expect(listHorse(h.db, { accountId: buyer.accountId, horseId: horse.id, price: lot!.price, now: at(74 * HOUR) })).resolves.toMatchObject({ club: false, sellerStableId: buyer.stableId });
    // Club-bred: the USDG market refuses it
    const usdg = await usdgRegistrationStatus(h.db, { accountId: buyer.accountId, horseId: horse.id, now: at(74 * HOUR) });
    expect(usdg.checks.find((c) => c.key === "not_starter_or_gift")!.ok).toBe(false);
    // the admin metrics count it as a Club sale, not a player one
    const m = await leaseMetrics(h.db, at(74 * HOUR));
    expect(m.club.salesThisWeek).toBe(1);
    expect(m.marketSalesThisWeek).toBe(0);
  });

  it("the buyer still needs a free stall and the credits; players can't cancel Club lots or offers", async () => {
    await runClubMarket(h.db, T0);
    const [lot] = await clubLots();
    const [offer] = await clubOffers();
    const full = await newPlayer(h.db, { credits: 50_000 });
    await h.db.update(stables).set({ stallSlots: 1 }).where(eq(stables.id, full.stableId));
    await makeHorse(h.db, full.stableId);
    await expect(buyListing(h.db, { accountId: full.accountId, listingId: lot!.id, now: at(HOUR) })).rejects.toMatchObject({ code: "STABLE_FULL" });
    const poor = await newPlayer(h.db, { credits: 1 });
    await expect(buyListing(h.db, { accountId: poor.accountId, listingId: lot!.id, now: at(HOUR) })).rejects.toBeTruthy();
    expect(await getHorseRow(h.db, lot!.horseId)).toMatchObject({ ownerStableId: null, lockKind: "market" });
    await expect(cancelListing(h.db, { accountId: full.accountId, listingId: lot!.id, now: at(HOUR) })).rejects.toMatchObject({ code: "NOT_OWNER" });
    await expect(withdrawLeaseOffer(h.db, { accountId: full.accountId, listingId: offer!.id, now: at(HOUR) })).rejects.toMatchObject({ code: "NOT_OWNER" });
    // the market view names the Club as the seller
    const view = await listMarket(h.db, { now: at(HOUR) });
    expect(view.filter((v) => v.listing.club).map((v) => v.sellerStableName)).toEqual(["The Club", "The Club", "The Club"]);
  });

  it("linked accounts still can't trade with each other", async () => {
    const s = await seller(1);
    const alt = await newPlayer(h.db);
    await recordAccountSignal(h.db, { accountId: s.accountId, kind: "device", value: "device-club" });
    await recordAccountSignal(h.db, { accountId: alt.accountId, kind: "device", value: "device-club" });
    const l = await listHorse(h.db, { accountId: s.accountId, horseId: s.horses[0]!.id, price: await floorPrice(h.db, s.horses[0]!.id), now: T0 });
    await expect(buyListing(h.db, { accountId: alt.accountId, listingId: l.id, now: T0 })).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
  });
});

describe("leasing a Club horse", () => {
  it("only an eligible lessee; purse split with the owner share burned; the horse goes back to the Club", async () => {
    await runClubMarket(h.db, T0);
    const offers = await clubOffers();
    const offer = offers.find((o) => o.termDays === 7) ?? offers[0]!;
    const fresh = await newPlayer(h.db);
    await expect(takeLease(h.db, { accountId: fresh.accountId, listingId: offer.id, now: T0 })).rejects.toMatchObject({ code: "SELLER_REQUIREMENTS" });

    const t = await lessee();
    const { lease } = await takeLease(h.db, { accountId: t.accountId, listingId: offer.id, now: T0 });
    expect(lease).toMatchObject({ club: true, ownerStableId: null, lesseeStableId: t.stableId, ownerSharePct: 50 });
    const x = offer.horseId;
    const leased = await getHorseRow(h.db, x);
    expect({ owner: leased.ownerStableId, lessee: leased.lesseeStableId }).toEqual({ owner: null, lessee: t.stableId });
    // taken: off the board
    expect((await leaseBoard(h.db, T0)).some((b) => b.listing.id === offer.id)).toBe(false);

    const purse = 10_001;
    const race = await createRace(h.db, {
      kind: "scheduled",
      name: "Club lease race",
      raceClass: "maiden",
      conditions: { distanceM: 1200, surface: "turf" },
      postTime: at(30 * MIN),
      entriesCloseAt: at(29 * MIN),
      targetRunners: 2,
      purse,
    });
    await enterRace(h.db, { accountId: t.accountId, raceId: race.id, horseId: x, tactic: "front", now: T0 });
    const [lb, burnBefore] = [await getBalance(h.db, t.accountId), await burnBalance()];
    const { field } = await getRaceForSimulation(h.db, race.id, at(31 * MIN));
    const order = [x, ...field.runners.map((r) => r.horseId).filter((id) => id !== x)];
    const res = await settleRace(h.db, { raceId: race.id, now: at(31 * MIN), resultHash: "0".repeat(64), result: { order }, runners: order.map((horseId, i) => ({ horseId, position: i + 1 })) });
    const prize = bps(purse, RULES.purseSplitBps[0]!);
    expect(res.prizes[x]).toBe(prize);
    const clubShare = Math.floor((prize * 50) / 100);
    expect(await getBalance(h.db, t.accountId)).toBe(lb + prize - clubShare);
    expect(await burnBalance()).toBe(burnBefore + clubShare);
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
    const m = await leaseMetrics(h.db, at(HOUR));
    expect(m.club.leasesStartedThisWeek).toBe(1);
    expect(m.startedThisWeek).toBe(0);

    // the term ends: home to the Club
    await sweepLeases(h.db, new Date(lease.endsAt.getTime() + MIN));
    expect(await getHorseRow(h.db, x)).toMatchObject({ ownerStableId: null, lesseeStableId: null });
    const [ended] = await h.db.select().from(horseLeases).where(eq(horseLeases.id, lease.id));
    expect(ended).toMatchObject({ status: "ended", endReason: "term", ownerEarned: clubShare });
    // nobody is billed or notified as its owner; the horse isn't a player's
    expect((await h.db.select().from(horses).where(eq(horses.id, x)))[0]!.ownerStableId).toBeNull();
  });

  it("Club offers sit on the board under the Club's name, and leased Club horses never fill Live fields", async () => {
    await runClubMarket(h.db, T0);
    const board = await leaseBoard(h.db, T0);
    const club = board.filter((b) => b.listing.club);
    expect(club).toHaveLength(4);
    expect(club.every((b) => b.ownerStableName === "The Club" && !b.newOwner)).toBe(true);
    // horses on a Club lease offer are kept out of the Club's Live fillers
    const ids = club.map((b) => b.horse.id);
    const ratings = club.map((b) => b.horse.rating);
    const race = await createRace(h.db, {
      kind: "scheduled",
      name: "Fill 2",
      raceClass: "maiden",
      conditions: { distanceM: 1200, surface: "turf", minRating: Math.min(...ratings), maxRating: Math.max(...ratings) },
      postTime: at(HOUR),
      entriesCloseAt: at(HOUR - MIN),
      targetRunners: 6,
    });
    const p = await newPlayer(h.db);
    const mine = await makeHorse(h.db, p.stableId, { rating: Math.min(...ratings) });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: mine.id, tactic: "front", now: T0 });
    const { field } = await getRaceForSimulation(h.db, race.id, at(HOUR));
    expect(field.runners.some((r) => ids.includes(r.horseId))).toBe(false);
  });
});

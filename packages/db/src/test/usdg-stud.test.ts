/**
 * USDG stud fees for registered stallions (docs/usdg-market.md, "USDG stud fees"), DB side:
 * setting the fee (registered only, bounds, credits OR USDG), the quote (order row first, slot
 * held, mare locked, base fee held in escrow, linked accounts refused), fulfilment running the
 * covering idempotently, season/lifetime limits honoured at the quote and at fulfilment (refund
 * due when the covering can't happen), expiry releasing the booking, and the backstop list.
 */
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { RULES, seasonNumberAt } from "../rules";
import { breedingEvents, fraudEvents, horses, inboxItems, pregnancies, raceEntries, races, usdgOrders, type HorseRow } from "../schema";
import { recordAccountSignal } from "../services/accounts";
import { linkVerifiedWallet } from "../services/betaMoney";
import { breed, foal } from "../services/breeding";
import { breedingStatus, listStuds, previewPairing, standsAtStud } from "../services/economyViews";
import { setStudFee } from "../services/horses";
import { getBalance, ledgerHealth } from "../services/ledger";
import { createRace } from "../services/races";
import {
  expireUsdgOrder,
  fulfilUsdgOrder,
  getUsdgOrder,
  listUsdg,
  quoteUsdgRegistration,
  studHoldsOf,
  usdgOrdersNeedingAttention,
  usdgOrdersForReview,
  USDG_ORDER_GRACE_MS,
  type UsdgChainRef,
} from "../services/usdgMarket";
import { fulfilUsdgPayment, fulfilUsdgStudOrder, quoteUsdgStud, setUsdgStudFee } from "../services/usdgStud";
import { at, DAY, expectDbError, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

function expectHealthy(x: Awaited<ReturnType<typeof ledgerHealth>>) {
  expect(x).toMatchObject({ totalPostings: 0, unbalancedTransactions: [], driftedAccounts: [], negativeAccounts: [] });
}

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const USD = gc.USDG_UNIT;
const POLICY = gc.DEFAULT_USDG_POLICY;
const CHAIN: UsdgChainRef = { chainId: 31337, market: "0x00000000000000000000000000000000004d4b54", token: "0x0000000000000000000000000000000000005d6e" };
const HOUR = 60 * MIN;
const BASE = RULES.breedingBaseFee;
const retired = { careerStatus: "retired" as const, retirementReason: "choice" as const, retiredAt: T0 };
const txHash = () => `0x${randomBytes(32).toString("hex")}`;

type Player = Awaited<ReturnType<typeof newPlayer>> & { wallet: string };

async function player(): Promise<Player> {
  const p = await newPlayer(h.db, { credits: 50_000 });
  await h.db.execute(`update stables set stall_slots = 24 where id = '${p.stableId}'`);
  const wallet = `0x${randomBytes(20).toString("hex")}`;
  await linkVerifiedWallet(h.db, { accountId: p.accountId, address: wallet, now: T0 });
  return { ...p, wallet };
}

let raceNo = 0;
/** A retired (breeding-eligible) stallion with 5 settled Live starts, registered for the USDG market. */
async function registeredStallion(p: Player, overrides: Partial<HorseRow> = {}): Promise<HorseRow> {
  const horse = await makeHorse(h.db, p.stableId, { sex: "male", origin: "bred", ...retired, ...overrides });
  for (let i = 0; i < POLICY.minLiveStarts; i++) {
    const postTime = new Date(T0.getTime() - (++raceNo + 1) * HOUR);
    const race = await createRace(h.db, { kind: "scheduled", name: `Stud history ${raceNo}`, raceClass: "maiden", conditions: {}, postTime, entriesCloseAt: new Date(postTime.getTime() - MIN) });
    await h.db.update(races).set({ status: "settled" }).where(eq(races.id, race.id));
    await h.db.insert(raceEntries).values({ raceId: race.id, horseId: horse.id, stableId: p.stableId, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
  }
  await h.db.update(horses).set({ starts: sql`greatest(${horses.starts}, ${POLICY.minLiveStarts})` }).where(eq(horses.id, horse.id));
  const reg = await quoteUsdgRegistration(h.db, { accountId: p.accountId, horseId: horse.id, termsAccepted: true, chain: CHAIN, now: T0 }, POLICY);
  await fulfilUsdgOrder(h.db, { orderId: reg.orderId, txHash: txHash(), now: T0 }, POLICY);
  return getHorseRow(h.db, horse.id);
}

const mareOf = (p: Player, overrides: Partial<HorseRow> = {}) => makeHorse(h.db, p.stableId, { sex: "female", ...retired, ...overrides });

/** An owner with a registered stallion standing for `fee` USDG, and a mare owner. */
async function setup(fee = 40 * USD, overrides: Partial<HorseRow> = {}) {
  const owner = await player();
  const stallion = await registeredStallion(owner, overrides);
  await setUsdgStudFee(h.db, { accountId: owner.accountId, horseId: stallion.id, fee, now: T0 }, POLICY);
  const buyer = await player();
  const mare = await mareOf(buyer);
  return { owner, stallion: await getHorseRow(h.db, stallion.id), buyer, mare };
}

const quote = (p: Player, sireId: string, damId: string, now = T0) => quoteUsdgStud(h.db, { accountId: p.accountId, sireId, damId, chain: CHAIN, now }, POLICY);

describe("USDG stud fee: setting it", () => {
  it("only a registered entire stallion with a linked wallet, within the bounds; credits OR USDG, never both", async () => {
    const owner = await player();
    const plain = await makeHorse(h.db, owner.stableId, { sex: "male", origin: "bred", ...retired });
    await expect(setUsdgStudFee(h.db, { accountId: owner.accountId, horseId: plain.id, fee: 10 * USD, now: T0 }, POLICY)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });

    const stallion = await registeredStallion(owner);
    const set = (fee: number | null) => setUsdgStudFee(h.db, { accountId: owner.accountId, horseId: stallion.id, fee, now: T0 }, POLICY);
    await expect(set(POLICY.studFeeMin - 1)).rejects.toMatchObject({ code: "PRICE_BELOW_FLOOR" });
    await expect(set(POLICY.studFeeMax + 1)).rejects.toMatchObject({ code: "PRICE_ABOVE_CEILING" });
    const other = await player();
    await expect(setUsdgStudFee(h.db, { accountId: other.accountId, horseId: stallion.id, fee: 10 * USD, now: T0 }, POLICY)).rejects.toMatchObject({ code: "NOT_OWNER" });

    await setStudFee(h.db, { accountId: owner.accountId, horseId: stallion.id, fee: 800 });
    await set(25 * USD);
    expect(await getHorseRow(h.db, stallion.id)).toMatchObject({ studFeeUsdg: 25 * USD, studFee: null });
    const studs = await listStuds(h.db);
    expect(studs.find((s) => s.horse.id === stallion.id)?.horse.studFeeUsdg).toBe(25 * USD);
    expect(standsAtStud(await getHorseRow(h.db, stallion.id))).toBe(true);
    // Back to credits: the USDG fee goes.
    await setStudFee(h.db, { accountId: owner.accountId, horseId: stallion.id, fee: 900 });
    expect(await getHorseRow(h.db, stallion.id)).toMatchObject({ studFeeUsdg: null, studFee: 900 });
    await set(25 * USD);
    // The database refuses both at once.
    await expectDbError(h.db.update(horses).set({ studFee: 100 }).where(eq(horses.id, stallion.id)), /horses_stud_fee_usdg/);
    // Withdrawing from stud clears both.
    await setStudFee(h.db, { accountId: owner.accountId, horseId: stallion.id, fee: null });
    expect(await getHorseRow(h.db, stallion.id)).toMatchObject({ studFeeUsdg: null, studFee: null });
  });

  it("the credits path refuses a USDG stallion; his owner still covers his own mares for free; the preview shows the USDG fee", async () => {
    const { owner, stallion, buyer, mare } = await setup();
    await expect(breed(h.db, { accountId: buyer.accountId, sireId: stallion.id, damId: mare.id, now: T0, idempotencyKey: `credits:${mare.id}` })).rejects.toMatchObject({ code: "USDG_ONLY" });
    const pv = await previewPairing(h.db, { accountId: buyer.accountId, sireId: stallion.id, damId: mare.id, now: T0 });
    expect(pv).toMatchObject({ block: null, usdgStudFee: 40 * USD, ownSire: false });
    expect(pv.fees).toMatchObject({ studFee: 0, totalPaidByMareOwner: BASE });
    const own = await mareOf(owner);
    await expect(breed(h.db, { accountId: owner.accountId, sireId: stallion.id, damId: own.id, now: T0, idempotencyKey: `own:${own.id}` })).resolves.toMatchObject({ duplicate: false });
    expect((await previewPairing(h.db, { accountId: owner.accountId, sireId: stallion.id, damId: (await mareOf(owner)).id, now: T0 })).usdgStudFee).toBeNull();
  });
});

describe("USDG stud fee: quote", () => {
  it("writes the order first, holds the slot, locks the mare, holds the base fee; a repeat returns the same order", async () => {
    const { owner, stallion, buyer, mare } = await setup();
    const before = await getBalance(h.db, buyer.accountId);
    const o = await quote(buyer, stallion.id, mare.id);
    expect(o).toMatchObject({
      kind: "stud",
      status: "pending",
      accountId: buyer.accountId,
      wallet: buyer.wallet,
      horseId: stallion.id,
      horseRef: gc.usdgHorseRef(stallion.id),
      mareId: mare.id,
      mareRef: gc.usdgHorseRef(mare.id),
      sellerAccountId: owner.accountId,
      sellerWallet: owner.wallet,
      price: 40 * USD,
      fee: 2 * USD,
      creditsHeld: BASE,
    });
    expect(o.deadline.getTime() - T0.getTime()).toBe(POLICY.quoteTtlMs);
    expect(before - (await getBalance(h.db, buyer.accountId))).toBe(BASE);
    expect(await getHorseRow(h.db, mare.id)).toMatchObject({ lockKind: "stud", lockRef: o.id });
    expect(await studHoldsOf(h.db, stallion.id, T0)).toBe(1);
    expect((await breedingStatus(h.db, await getHorseRow(h.db, stallion.id), T0)).usedThisSeason).toBe(1);
    expect((await breedingStatus(h.db, await getHorseRow(h.db, mare.id), T0)).block).toBe("booked");
    expect((await quote(buyer, stallion.id, mare.id, at(MIN))).orderId).toBe(o.orderId);
    // The booked mare can't be covered by anything else, nor booked to another stallion.
    const second = await setup();
    await expect(quote(buyer, second.stallion.id, mare.id)).rejects.toMatchObject({ code: "HORSE_LOCKED" });
    const ownStallion = await makeHorse(h.db, buyer.stableId, { sex: "male", ...retired });
    await expect(breed(h.db, { accountId: buyer.accountId, sireId: ownStallion.id, damId: mare.id, now: T0, idempotencyKey: `x:${mare.id}` })).rejects.toMatchObject({ code: "HORSE_LOCKED" });
    // A stallion with a live booking can't be put up for sale.
    await expect(listUsdg(h.db, { accountId: owner.accountId, horseId: stallion.id, kind: "fixed", price: 50 * USD, duration: 3, now: T0 }, POLICY)).rejects.toMatchObject({ code: "HORSE_LOCKED" });
    expectHealthy(await ledgerHealth(h.db));
  });

  it("refuses linked accounts (fraud event), own stallions, unregistered or credits-only stallions, and the breeding rules", async () => {
    const { owner, stallion, mare, buyer } = await setup();
    const alt = await player();
    await recordAccountSignal(h.db, { accountId: owner.accountId, kind: "device", value: `stud-laptop-${owner.accountId}` });
    await recordAccountSignal(h.db, { accountId: alt.accountId, kind: "device", value: `stud-laptop-${owner.accountId}` });
    const altMare = await mareOf(alt);
    await expect(quote(alt, stallion.id, altMare.id)).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    const [ev] = await h.db.select().from(fraudEvents).where(and(eq(fraudEvents.accountId, alt.accountId), eq(fraudEvents.kind, "linked_trade_blocked")));
    expect(ev?.data).toMatchObject({ market: "usdg", what: "stud" });
    expect(await getHorseRow(h.db, altMare.id)).toMatchObject({ lockKind: null });

    const ownMare = await mareOf(owner);
    await expect(quote(owner, stallion.id, ownMare.id)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    const creditsStud = await makeHorse(h.db, owner.stableId, { sex: "male", ...retired, studFee: 500 });
    await expect(quote(buyer, creditsStud.id, mare.id)).rejects.toMatchObject({ code: "NOT_OWNER" });
    // Kinship: his own daughter.
    const daughter = await mareOf(buyer, { sireId: stallion.id });
    await expect(quote(buyer, stallion.id, daughter.id)).rejects.toMatchObject({ code: "KIN_BREEDING" });
    // A mare in foal.
    const carrying = await mareOf(buyer);
    const buyerStallion = await makeHorse(h.db, buyer.stableId, { sex: "male", ...retired });
    await breed(h.db, { accountId: buyer.accountId, sireId: buyerStallion.id, damId: carrying.id, now: T0, idempotencyKey: `foal:${carrying.id}` });
    await expect(quote(buyer, stallion.id, carrying.id)).rejects.toMatchObject({ code: expect.stringMatching(/HORSE_IN_FOAL|BREEDING_SEASON_LIMIT/) });
    // No stall for the foal.
    const full = await player();
    const fullMare = await mareOf(full);
    await h.db.execute(`update stables set stall_slots = 1 where id = '${full.stableId}'`);
    await makeHorse(h.db, full.stableId, { sex: "male" });
    await expect(quote(full, stallion.id, fullMare.id)).rejects.toMatchObject({ code: "STABLE_FULL" });
  });

  it("season and lifetime limits count live bookings: no over-booking, and the owner's own covers respect held slots", async () => {
    const owner = await player();
    const stallion = await registeredStallion(owner, { breedingCount: RULES.breedingLifetimeLimit - 2 });
    await setUsdgStudFee(h.db, { accountId: owner.accountId, horseId: stallion.id, fee: 5 * USD, now: T0 }, POLICY);
    const [a, b, c] = [await player(), await player(), await player()];
    await quote(a, stallion.id, (await mareOf(a)).id);
    await quote(b, stallion.id, (await mareOf(b)).id);
    await expect(quote(c, stallion.id, (await mareOf(c)).id)).rejects.toMatchObject({ code: "BREEDING_LIMIT" });
    const own = await mareOf(owner);
    await expect(breed(h.db, { accountId: owner.accountId, sireId: stallion.id, damId: own.id, now: T0, idempotencyKey: `held:${own.id}` })).rejects.toMatchObject({ code: "BREEDING_LIMIT" });
    // Once a booking lapses unpaid, its slot is free again.
    const lapse = at(POLICY.quoteTtlMs + USDG_ORDER_GRACE_MS + MIN);
    for (const o of await usdgOrdersNeedingAttention(h.db, { now: lapse })) if (o.horseId === stallion.id) await expireUsdgOrder(h.db, { orderId: o.orderId, now: lapse }, POLICY);
    expect(await studHoldsOf(h.db, stallion.id, lapse)).toBe(0);
    await expect(quote(c, stallion.id, (await h.db.select().from(horses).where(and(eq(horses.ownerStableId, c.stableId), eq(horses.sex, "female"))))[0]!.id, lapse)).resolves.toMatchObject({ kind: "stud" });

    // Per season: a stallion with lifetime left but this season's slots taken by bookings.
    const owner2 = await player();
    const s2 = await registeredStallion(owner2);
    await setUsdgStudFee(h.db, { accountId: owner2.accountId, horseId: s2.id, fee: 5 * USD, now: T0 }, POLICY);
    for (let i = 0; i < RULES.stallionPerSeason; i++) {
      const p = await player();
      await quote(p, s2.id, (await mareOf(p)).id);
    }
    const late = await player();
    const lateMare = await mareOf(late);
    await expect(quote(late, s2.id, lateMare.id)).rejects.toMatchObject({ code: expect.stringMatching(/BREEDING_(SEASON_)?LIMIT/) });
  });
});

describe("USDG stud fee: fulfilment", () => {
  it("runs the covering once the payment is verified: pregnancy, base fee burned, mare unlocked, owner told; idempotent", async () => {
    const { owner, stallion, buyer, mare } = await setup();
    const o = await quote(buyer, stallion.id, mare.id);
    const balance = await getBalance(h.db, buyer.accountId);
    const ownerBalance = await getBalance(h.db, owner.accountId);
    const tx = txHash();
    const r = await fulfilUsdgPayment(h.db, { orderId: o.orderId, txHash: tx, now: at(2 * MIN) }, POLICY);
    expect(r).toMatchObject({ status: "fulfilled", duplicate: false });
    const done = (await getUsdgOrder(h.db, o.orderId))!;
    expect(done).toMatchObject({ status: "fulfilled", txHash: tx, flagged: false });
    expect(done.breedingEventId).not.toBeNull();
    const [ev] = await h.db.select().from(breedingEvents).where(eq(breedingEvents.id, done.breedingEventId!));
    expect(ev).toMatchObject({ sireId: stallion.id, damId: mare.id, studFee: 0, baseFee: BASE, seasonNumber: seasonNumberAt(at(2 * MIN)), idempotencyKey: `usdg-stud:${o.orderId}` });
    const [preg] = await h.db.select().from(pregnancies).where(eq(pregnancies.breedingEventId, ev!.id));
    expect(preg).toMatchObject({ status: "carrying", damId: mare.id });
    expect(await getHorseRow(h.db, mare.id)).toMatchObject({ lockKind: null, lockRef: null, breedingCount: 1 });
    expect((await getHorseRow(h.db, stallion.id)).breedingCount).toBe(1);
    // No credits move at fulfilment (the base fee was held at the quote and is now burned); the stud fee was USDG.
    expect(await getBalance(h.db, buyer.accountId)).toBe(balance);
    expect(await getBalance(h.db, owner.accountId)).toBe(ownerBalance);
    expect(await studHoldsOf(h.db, stallion.id, at(2 * MIN))).toBe(0);
    const [note] = await h.db.select().from(inboxItems).where(and(eq(inboxItems.accountId, owner.accountId), eq(inboxItems.kind, "usdg_stud")));
    expect(note?.title).toMatch(/38 USDG stud fee paid to your wallet/);

    // Idempotent: a retry (or the backstop) does nothing twice.
    const again = await fulfilUsdgStudOrder(h.db, { orderId: o.orderId, txHash: tx, now: at(3 * MIN) });
    expect(again).toMatchObject({ status: "fulfilled", duplicate: true, pregnancyId: preg!.id });
    expect((await h.db.select().from(breedingEvents).where(eq(breedingEvents.damId, mare.id))).length).toBe(1);
    await expect(fulfilUsdgStudOrder(h.db, { orderId: o.orderId, txHash: txHash(), now: at(3 * MIN) })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(fulfilUsdgOrder(h.db, { orderId: o.orderId, txHash: tx, now: at(3 * MIN) }, POLICY)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(fulfilUsdgStudOrder(h.db, { orderId: `0x${"ab".repeat(32)}`, txHash: tx, now: T0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The foal is an ordinary foal of the mare's owner.
    const born = await foal(h.db, { pregnancyId: preg!.id, now: at(DAY + 3 * MIN) });
    expect(await getHorseRow(h.db, born.foalId)).toMatchObject({ ownerStableId: buyer.stableId, origin: "bred", sireId: stallion.id, damId: mare.id, bound: false });
    expectHealthy(await ledgerHealth(h.db));
  });

  it("concurrent confirmations cover once", async () => {
    const { stallion, buyer, mare } = await setup();
    const o = await quote(buyer, stallion.id, mare.id);
    const tx = txHash();
    const rs = await Promise.allSettled([0, 1, 2].map(() => fulfilUsdgStudOrder(h.db, { orderId: o.orderId, txHash: tx, now: at(MIN) })));
    expect(rs.filter((r) => r.status === "fulfilled" && r.value.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect((await h.db.select().from(breedingEvents).where(eq(breedingEvents.damId, mare.id))).length).toBe(1);
  });

  it("season limits are honoured at fulfilment: a covering that can't happen any more is recorded for an admin refund and released", async () => {
    const { owner, stallion, buyer, mare } = await setup();
    const o = await quote(buyer, stallion.id, mare.id);
    const before = await getBalance(h.db, buyer.accountId);
    // A race nobody should win: the mare got a covering this season by some other route (simulated).
    const other = await makeHorse(h.db, null, { sex: "male", ...retired });
    await h.db.insert(breedingEvents).values({ sireId: other.id, damId: mare.id, requestedBy: buyer.accountId, seasonNumber: seasonNumberAt(T0), idempotencyKey: `race:${mare.id}` });
    const r = await fulfilUsdgStudOrder(h.db, { orderId: o.orderId, txHash: txHash(), now: at(MIN) });
    expect(r).toMatchObject({ status: "paid", pregnancyId: null });
    const row = (await getUsdgOrder(h.db, o.orderId))!;
    expect(row).toMatchObject({ status: "paid", flagged: true, breedingEventId: null });
    expect(row.flagReason).toMatch(/^refund due: /);
    // Booking released: the mare is free, the held base fee came back, the slot is free.
    expect(await getHorseRow(h.db, mare.id)).toMatchObject({ lockKind: null });
    expect((await getBalance(h.db, buyer.accountId)) - before).toBe(BASE);
    expect(await studHoldsOf(h.db, stallion.id, at(MIN))).toBe(0);
    expect((await h.db.select().from(pregnancies).where(eq(pregnancies.damId, mare.id))).length).toBe(0);
    // Alerted: a fraud-review event, the admin's attention list, an inbox note for the payer.
    const [alert] = await h.db.select().from(fraudEvents).where(and(eq(fraudEvents.kind, "usdg_stud_refund_due"), eq(fraudEvents.accountId, buyer.accountId)));
    expect(alert).toMatchObject({ relatedAccountId: owner.accountId, severity: 3 });
    expect((await usdgOrdersForReview(h.db)).some((x) => x.orderId === o.orderId)).toBe(true);
    const [note] = await h.db.select().from(inboxItems).where(and(eq(inboxItems.accountId, buyer.accountId), eq(inboxItems.kind, "usdg_stud")));
    expect(note?.title).toMatch(/will refund 40 USDG/);
    // Settled for good: the backstop stops looking at it, a retry changes nothing.
    expect((await usdgOrdersNeedingAttention(h.db, { now: at(HOUR) })).some((x) => x.orderId === o.orderId)).toBe(false);
    expect(await fulfilUsdgStudOrder(h.db, { orderId: o.orderId, txHash: row.txHash!, now: at(HOUR) })).toMatchObject({ status: "paid", duplicate: true });
    expect((await getBalance(h.db, buyer.accountId)) - before).toBe(BASE);
    expectHealthy(await ledgerHealth(h.db));
  });

  it("lifetime limit at fulfilment and a stallion gone to the Legacy Farm: refund due, never a covering", async () => {
    const { stallion, buyer, mare } = await setup();
    const o = await quote(buyer, stallion.id, mare.id);
    await h.db.update(horses).set({ careerStatus: "pasture", pasturedAt: T0 }).where(eq(horses.id, stallion.id));
    expect(await fulfilUsdgStudOrder(h.db, { orderId: o.orderId, txHash: txHash(), now: at(MIN) })).toMatchObject({ status: "paid" });
    expect((await getUsdgOrder(h.db, o.orderId))!.flagged).toBe(true);

    const s2 = await setup();
    const o2 = await quote(s2.buyer, s2.stallion.id, s2.mare.id);
    await h.db.update(horses).set({ breedingCount: RULES.breedingLifetimeLimit }).where(eq(horses.id, s2.stallion.id));
    expect(await fulfilUsdgStudOrder(h.db, { orderId: o2.orderId, txHash: txHash(), now: at(MIN) })).toMatchObject({ status: "paid" });
    expect((await getUsdgOrder(h.db, o2.orderId))!.flagReason).toMatch(/refund due/);
  });

  it("the stallion's owner changing his fee after the booking doesn't change the paid order", async () => {
    const { owner, stallion, buyer, mare } = await setup(40 * USD);
    const o = await quote(buyer, stallion.id, mare.id);
    await setUsdgStudFee(h.db, { accountId: owner.accountId, horseId: stallion.id, fee: 90 * USD, now: T0 }, POLICY);
    await setStudFee(h.db, { accountId: owner.accountId, horseId: stallion.id, fee: null });
    expect(await fulfilUsdgStudOrder(h.db, { orderId: o.orderId, txHash: txHash(), now: at(MIN) })).toMatchObject({ status: "fulfilled" });
    expect((await getUsdgOrder(h.db, o.orderId))!.price).toBe(40 * USD);
  });
});

describe("USDG stud fee: expiry and backstop", () => {
  it("an unpaid booking expires after its deadline (+ grace): mare unlocked, base fee returned, slot freed", async () => {
    const { stallion, buyer, mare } = await setup();
    const before = await getBalance(h.db, buyer.accountId);
    const o = await quote(buyer, stallion.id, mare.id);
    expect(await expireUsdgOrder(h.db, { orderId: o.orderId, now: at(POLICY.quoteTtlMs) }, POLICY)).toMatchObject({ expired: false }); // still in grace
    const lapse = at(POLICY.quoteTtlMs + USDG_ORDER_GRACE_MS + MIN);
    expect((await usdgOrdersNeedingAttention(h.db, { now: lapse })).some((x) => x.orderId === o.orderId)).toBe(true);
    expect(await expireUsdgOrder(h.db, { orderId: o.orderId, now: lapse }, POLICY)).toMatchObject({ expired: true });
    expect((await getUsdgOrder(h.db, o.orderId))!.status).toBe("expired");
    expect(await getHorseRow(h.db, mare.id)).toMatchObject({ lockKind: null });
    expect(await getBalance(h.db, buyer.accountId)).toBe(before);
    expect(await studHoldsOf(h.db, stallion.id, lapse)).toBe(0);
    // A fresh booking works; a payment for the expired one (seen late) is a refund, not a covering.
    const fresh = await quote(buyer, stallion.id, mare.id, lapse);
    expect(fresh.orderId).not.toBe(o.orderId);
    expect(await fulfilUsdgStudOrder(h.db, { orderId: o.orderId, txHash: txHash(), now: lapse })).toMatchObject({ status: "paid" });
    expect((await getUsdgOrder(h.db, o.orderId))!.flagReason).toMatch(/lapsed/);
    expect(await getHorseRow(h.db, mare.id)).toMatchObject({ lockKind: "stud", lockRef: fresh.id }); // the fresh booking keeps its lock
    expectHealthy(await ledgerHealth(h.db));
  });

  it("a submitted payment keeps the booking alive past the deadline (the backstop settles it)", async () => {
    const { stallion, buyer, mare } = await setup();
    const o = await quote(buyer, stallion.id, mare.id);
    await h.db.update(usdgOrders).set({ txHash: txHash() }).where(eq(usdgOrders.id, o.id));
    const late = at(POLICY.quoteTtlMs + USDG_ORDER_GRACE_MS + HOUR);
    expect(await studHoldsOf(h.db, stallion.id, late)).toBe(1);
    expect((await usdgOrdersNeedingAttention(h.db, { now: late })).some((x) => x.orderId === o.orderId)).toBe(true);
  });
});

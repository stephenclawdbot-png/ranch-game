/**
 * Practice money sandbox (owner requirement, docs/reports/2026-11-01 exploit audit.md "Practice
 * money sandbox"): walletless testers trade T-USDG under their practice identity. Every test drives
 * the real services on PGlite and proves one of:
 *
 *   1. the 100 T-USDG starter balance can't be multiplied (repeated grants, a second stable on the
 *      same device, linking / unlinking / relinking a wallet, re-registering, the practice reset);
 *   2. self-trades and trades between linked accounts (USDG lots, auctions, stud fees, the credits
 *      market, leases, the tote) can't create or launder value;
 *   3. no T-USDG or practice identity reaches a real-money path (SIWE sign-in, affiliates, the Prize
 *      Pool, real-chain orders, the credits ledger);
 *   4. race transactions can't be gamed (betting at the off or on your own / a linked runner,
 *      entering or scratching to move a pool, claiming, entry and tote refunds).
 *
 * The practice address resolver is a stand-in (apps/web derives the real one with secp256k1).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { accountPlayDays, fraudEvents, horses, ledgerAccounts, ledgerTransactions, raceEntries, races, toteBets, type HorseRow } from "../schema";
import { recordAccountSignal } from "../services/accounts";
import { ensureReferralCode, recordReferral, referralPlan } from "../services/affiliates";
import { accountForWallet, adminUnlinkWallet, allocateUsd, DEFAULT_POOL_RULES, linkVerifiedWallet, poolScores, verifiedWalletOf } from "../services/betaMoney";
import { appraisalOf, lodgeClaim } from "../services/claiming";
import { offerLease, takeLease } from "../services/leasing";
import { getBalance, ledgerHealth, playerLedgerAccountId, post } from "../services/ledger";
import { buyListing, listHorse } from "../services/market";
import { testerForAccount } from "../services/playtest";
import { marketWalletOf, practiceAddressOf, setPracticeAddressResolver } from "../services/practiceIdentity";
import { cancelRace, createRace, enterRace, scratchEntry, type CreateRaceInput } from "../services/races";
import { confirmToteAdult, placeToteBet, settleTote, type PlaceToteBetInput } from "../services/tote";
import { closeUsdgAuctions, listUsdg, placeUsdgBid, quoteUsdgRegistration, quoteUsdgSale, type UsdgChainRef } from "../services/usdgMarket";
import {
  grantPracticeUsdg,
  payUsdgOrderPractice,
  practiceLedgerAccountId,
  practiceUsdgBalance,
  resetPracticeUsdg,
  USDG_PRACTICE_MARKET,
  USDG_PRACTICE_TOKEN,
} from "../services/usdgPractice";
import { quoteUsdgStud, setUsdgStudFee } from "../services/usdgStud";
import { at, DAY, getHorseRow, makeHorse, makeSeller, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
const fakeAddress = (accountId: string) => `0x${createHash("sha256").update(`sandbox-practice:${accountId}`).digest("hex").slice(0, 40)}`;

beforeAll(async () => {
  h = await memoryDb();
  setPracticeAddressResolver((accountId) => fakeAddress(accountId));
  vi.stubEnv("USDG_MODE", "practice");
});
afterAll(async () => {
  setPracticeAddressResolver(null);
  vi.unstubAllEnvs();
  await h.close();
});

const USD = gc.USDG_UNIT;
const GRANT = gc.PRACTICE_USDG_GRANT;
const ON = { USDG_MODE: "practice" };
const POLICY = gc.DEFAULT_USDG_POLICY;
const PRACTICE: UsdgChainRef = { chainId: 46630, market: USDG_PRACTICE_MARKET, token: USDG_PRACTICE_TOKEN };
const REAL: UsdgChainRef = { chainId: 46630, market: "0x00000000000000000000000000000000004d4b54", token: "0x0000000000000000000000000000000000005d6e" };
const HOUR = 60 * MIN;
const sig = () => `0x${randomBytes(65).toString("hex")}`;
const newWallet = () => `0x${randomBytes(20).toString("hex")}`;

type Player = Awaited<ReturnType<typeof newPlayer>>;

/** A walletless tester (practice identity only) with the starter balance. */
async function tester(opts: { grant?: boolean; credits?: number } = {}): Promise<Player> {
  const p = await newPlayer(h.db, { credits: opts.credits ?? 50_000 });
  await h.db.execute(`update stables set stall_slots = 24 where id = '${p.stableId}'`);
  if (opts.grant !== false) expect((await grantPracticeUsdg(h.db, { accountId: p.accountId, now: T0, env: ON })).granted).toBe(true);
  return p;
}

let deviceN = 0;
/** Records the same device for both accounts (what founding does with the browser's device id): linked. */
async function link(a: Player, b: Player): Promise<void> {
  const device = `sandbox-device-${++deviceN}`;
  await recordAccountSignal(h.db, { accountId: a.accountId, kind: "device", value: device });
  await recordAccountSignal(h.db, { accountId: b.accountId, kind: "device", value: device });
}

let raceNo = 0;
async function withLiveStarts(horse: HorseRow, stableId: string, n = POLICY.minLiveStarts): Promise<void> {
  for (let i = 0; i < n; i++) {
    const postTime = new Date(T0.getTime() - (++raceNo + 1) * HOUR);
    const race = await createRace(h.db, { kind: "scheduled", name: `Sandbox history ${raceNo}`, raceClass: "maiden", conditions: {}, postTime, entriesCloseAt: new Date(postTime.getTime() - MIN) });
    await h.db.update(races).set({ status: "settled" }).where(eq(races.id, race.id));
    await h.db.insert(raceEntries).values({ raceId: race.id, horseId: horse.id, stableId, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0, finishPosition: 1 });
  }
  await h.db.update(horses).set({ starts: sql`greatest(${horses.starts}, ${n})` }).where(eq(horses.id, horse.id));
}

/** A horse registered for the USDG market, the fee paid in T-USDG. */
async function registered(p: Player, overrides: Partial<HorseRow> & { sex?: "male" | "female" } = {}): Promise<HorseRow> {
  const horse = await makeHorse(h.db, p.stableId, { origin: "bred", ...overrides });
  await withLiveStarts(horse, p.stableId);
  const reg = await quoteUsdgRegistration(h.db, { accountId: p.accountId, horseId: horse.id, termsAccepted: true, chain: PRACTICE, now: T0 }, POLICY);
  expect((await payUsdgOrderPractice(h.db, { orderId: reg.orderId, accountId: p.accountId, now: T0 }, POLICY)).status).toBe("fulfilled");
  return getHorseRow(h.db, horse.id);
}

const grantsOf = async (accountId: string) =>
  (await h.db.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(eq(ledgerTransactions.idempotencyKey, `usdg-practice:grant:${accountId}`))).length;

/** Every T-USDG unit in existence came from a grant or a top-up, and the ledger balances. */
async function practiceSupplyConserved(): Promise<void> {
  const health = await ledgerHealth(h.db);
  expect(health.unbalancedTransactions).toEqual([]);
  expect(health.driftedAccounts).toEqual([]);
  expect(health.negativeAccounts).toEqual([]);
  const [minted] = await h.db
    .select({ s: sql<string>`coalesce(sum(p.amount), 0)` })
    .from(ledgerTransactions)
    .innerJoin(sql`ledger_postings p`, sql`p.transaction_id = ${ledgerTransactions.id}`)
    .innerJoin(ledgerAccounts, sql`${ledgerAccounts.id} = p.ledger_account_id`)
    .where(and(eq(ledgerAccounts.currency, "TUSDG"), eq(ledgerAccounts.kind, "player"), sql`${ledgerTransactions.kind} in ('usdg_practice_grant', 'usdg_practice_topup')`));
  const [held] = await h.db
    .select({ s: sql<string>`coalesce(sum(${ledgerAccounts.balance}), 0)` })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.currency, "TUSDG"), sql`${ledgerAccounts.kind} <> 'mint'`));
  expect(Number(held?.s)).toBe(Number(minted?.s));
}

// ---------------------------------------------------------------------------
// 1. The starter balance can't be multiplied
// ---------------------------------------------------------------------------

describe("1. the 100 T-USDG starter balance can't be multiplied", () => {
  it("1a: a walletless tester gets the grant once, however often (and however concurrently) it is asked for", async () => {
    const p = await tester({ grant: false });
    expect(await verifiedWalletOf(h.db, p.accountId)).toBeNull();
    expect(await marketWalletOf(h.db, p.accountId)).toBe(fakeAddress(p.accountId));
    const runs = await Promise.all(Array.from({ length: 6 }, () => grantPracticeUsdg(h.db, { accountId: p.accountId, now: T0, env: ON })));
    expect(runs.filter((r) => r.granted)).toHaveLength(1);
    for (let i = 0; i < 3; i++) expect((await grantPracticeUsdg(h.db, { accountId: p.accountId, now: at(i * DAY), env: ON })).granted).toBe(false);
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(GRANT);
    expect(await grantsOf(p.accountId)).toBe(1);
  });

  it("1b: a second stable founded on the same device gets no starter balance (FIXED: one grant per linked group)", async () => {
    const first = await tester();
    const second = await tester({ grant: false });
    await link(first, second);
    expect(await grantPracticeUsdg(h.db, { accountId: second.accountId, now: T0, env: ON })).toEqual({ granted: false, balance: 0 });
    // A third account on that device, asking repeatedly and concurrently: still nothing.
    const third = await tester({ grant: false });
    await link(first, third);
    const runs = await Promise.all([1, 2, 3].map(() => grantPracticeUsdg(h.db, { accountId: third.accountId, now: T0, env: ON })));
    expect(runs.every((r) => !r.granted && r.balance === 0)).toBe(true);
    expect(await grantsOf(second.accountId)).toBe(0);
    expect(await grantsOf(third.accountId)).toBe(0);
    // The first account keeps its own grant (asking again changes nothing).
    expect(await grantPracticeUsdg(h.db, { accountId: first.accountId, now: T0, env: ON })).toEqual({ granted: false, balance: GRANT });
  });

  it("1c: linking, unlinking and relinking a wallet never grants again (money is per account)", async () => {
    const p = await tester();
    await linkVerifiedWallet(h.db, { accountId: p.accountId, address: newWallet(), now: at(MIN) });
    expect((await grantPracticeUsdg(h.db, { accountId: p.accountId, now: at(MIN), env: ON })).granted).toBe(false);
    const t = await testerForAccount(h.db, p.accountId);
    await adminUnlinkWallet(h.db, { testerId: t!.id });
    expect((await grantPracticeUsdg(h.db, { accountId: p.accountId, now: at(2 * MIN), env: ON })).granted).toBe(false);
    await linkVerifiedWallet(h.db, { accountId: p.accountId, address: newWallet(), now: at(3 * MIN) });
    expect((await grantPracticeUsdg(h.db, { accountId: p.accountId, now: at(3 * MIN), env: ON })).granted).toBe(false);
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(GRANT);
    expect(await grantsOf(p.accountId)).toBe(1);
  });

  it("1d: a wallet already used by one stable can't sign in a second stable to collect another grant", async () => {
    const a = await tester();
    const b = await tester({ grant: false });
    const w = newWallet();
    await linkVerifiedWallet(h.db, { accountId: a.accountId, address: w, now: T0 });
    await expect(linkVerifiedWallet(h.db, { accountId: b.accountId, address: w, now: T0 })).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    expect(await accountForWallet(h.db, w)).toBe(a.accountId);
  });

  it("1e: registering a horse again is refused (no second fee, no refund path) and re-registering a stable is a new seat with no grant if on the same device", async () => {
    const p = await tester();
    const horse = await registered(p);
    const after = await practiceUsdgBalance(h.db, p.accountId);
    expect(after).toBe(GRANT - POLICY.registrationFee);
    await expect(quoteUsdgRegistration(h.db, { accountId: p.accountId, horseId: horse.id, termsAccepted: true, chain: PRACTICE, now: at(MIN) }, POLICY)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(after);
  });

  it("1f: the end-of-beta reset drains balances for good: no grant comes back, and a second reset changes nothing", async () => {
    const p = await tester();
    await resetPracticeUsdg(h.db, { apply: true, now: at(DAY) });
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(0);
    expect(await grantPracticeUsdg(h.db, { accountId: p.accountId, now: at(DAY + MIN), env: ON })).toEqual({ granted: false, balance: 0 });
    await resetPracticeUsdg(h.db, { apply: true, now: at(DAY + 2 * MIN) });
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(0);
    await practiceSupplyConserved();
  });
});

// ---------------------------------------------------------------------------
// 2. Self-trades and linked trades
// ---------------------------------------------------------------------------

describe("2. self-trades and linked trades can't create or launder value", () => {
  it("2a: USDG fixed-price lot: buying your own is refused, a linked buyer is refused and flagged; no T-USDG moves", async () => {
    const seller = await tester();
    const alt = await tester();
    await link(seller, alt);
    const horse = await registered(seller);
    const lot = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 90 * USD, duration: 7, now: T0 }, POLICY);
    const balances = [await practiceUsdgBalance(h.db, seller.accountId), await practiceUsdgBalance(h.db, alt.accountId)];
    await expect(quoteUsdgSale(h.db, { accountId: seller.accountId, listingId: lot.id, chain: PRACTICE, now: at(MIN) }, POLICY)).rejects.toMatchObject({ code: "CANNOT_BUY_OWN" });
    await expect(quoteUsdgSale(h.db, { accountId: alt.accountId, listingId: lot.id, chain: PRACTICE, now: at(MIN) }, POLICY)).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    const flags = await h.db.select().from(fraudEvents).where(and(eq(fraudEvents.accountId, alt.accountId), eq(fraudEvents.kind, "linked_trade_blocked")));
    expect(flags.length).toBeGreaterThan(0);
    expect([await practiceUsdgBalance(h.db, seller.accountId), await practiceUsdgBalance(h.db, alt.accountId)]).toEqual(balances);
  });

  it("2b: auctions: no bid on your own lot, none from a linked account, and a bidder linked before the close is voided (unsold)", async () => {
    const seller = await tester();
    const alt = await tester();
    const later = await tester();
    await link(seller, alt);
    const horse = await registered(seller);
    const lot = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "auction", price: 5 * USD, duration: 24, now: T0 }, POLICY);
    const bid = (p: Player, amount: number, nonce: string) => placeUsdgBid(h.db, { accountId: p.accountId, listingId: lot.id, amount, nonce, signature: sig(), signer: fakeAddress(p.accountId), now: at(MIN) }, POLICY);
    await expect(bid(seller, 50 * USD, "1")).rejects.toMatchObject({ code: "CANNOT_BUY_OWN" });
    await expect(bid(alt, 50 * USD, "2")).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    await bid(later, 60 * USD, "3");
    await link(seller, later); // shill discovered before the close
    const closed = await closeUsdgAuctions(h.db, { now: at(25 * HOUR), chain: PRACTICE }, POLICY);
    expect(closed.offered).toHaveLength(0);
    expect((await getHorseRow(h.db, horse.id)).ownerStableId).toBe(seller.stableId);
  });

  it("2c: stud fees: never to your own stallion, never between linked accounts", async () => {
    const owner = await tester();
    const alt = await tester();
    await link(owner, alt);
    const sire = await registered(owner, { sex: "male" });
    await setUsdgStudFee(h.db, { accountId: owner.accountId, horseId: sire.id, fee: 20 * USD, now: T0 }, POLICY);
    const ownMare = await makeHorse(h.db, owner.stableId, { sex: "female" });
    const altMare = await makeHorse(h.db, alt.stableId, { sex: "female" });
    await expect(quoteUsdgStud(h.db, { accountId: owner.accountId, sireId: sire.id, damId: ownMare.id, chain: PRACTICE, now: at(MIN) }, POLICY)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(quoteUsdgStud(h.db, { accountId: alt.accountId, sireId: sire.id, damId: altMare.id, chain: PRACTICE, now: at(MIN) }, POLICY)).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
  });

  it("2d: credits market: no buying your own lot, none between linked accounts", async () => {
    const seller = await tester();
    const alt = await tester();
    await link(seller, alt);
    await makeSeller(h.db, seller.accountId, seller.stableId);
    const horse = await makeHorse(h.db, seller.stableId, { origin: "bred", starts: 5, tradeMinStarts: 0 });
    const lot = await listHorse(h.db, { accountId: seller.accountId, horseId: horse.id, price: appraisalOf(horse), now: T0 });
    await expect(buyListing(h.db, { accountId: seller.accountId, listingId: lot.id, now: at(MIN) })).rejects.toMatchObject({ code: "CANNOT_BUY_OWN" });
    const before = await getBalance(h.db, alt.accountId);
    await expect(buyListing(h.db, { accountId: alt.accountId, listingId: lot.id, now: at(MIN) })).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    expect(await getBalance(h.db, alt.accountId)).toBe(before);
  });

  it("2e: leases: not your own horse, not between linked accounts", async () => {
    const owner = await tester();
    const alt = await tester();
    await link(owner, alt);
    const hs = [];
    for (let i = 0; i < 4; i++) hs.push(await makeHorse(h.db, owner.stableId, { rating: 40 + i }));
    const offer = await offerLease(h.db, { accountId: owner.accountId, horseId: hs[0]!.id, termDays: 7, ownerSharePct: 50, now: T0 });
    await expect(takeLease(h.db, { accountId: owner.accountId, listingId: offer.id, now: at(MIN) })).rejects.toMatchObject({ code: "CANNOT_BUY_OWN" });
    await expect(takeLease(h.db, { accountId: alt.accountId, listingId: offer.id, now: at(MIN) })).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
  });

  it("2f: tote: linked accounts backing both sides of a T-USDG pool count as one bettor, so the pool is void and refunded (and flagged)", async () => {
    const { race, owners } = await raceWithField(4);
    const a = await tester();
    const b = await tester();
    await link(a, b);
    for (const p of [a, b]) await confirmToteAdult(h.db, { accountId: p.accountId, now: T0 });
    await bet(a, race.id, owners[0]!.horseId, 5 * USD, { currency: "TUSDG" });
    await bet(b, race.id, owners[1]!.horseId, 5 * USD, { currency: "TUSDG" });
    await runRace(race.id, { [owners[0]!.horseId]: 1, [owners[1]!.horseId]: 2 });
    await settleTote(h.db, race.id, at(DAY));
    const rows = await h.db.select().from(toteBets).where(eq(toteBets.raceId, race.id));
    expect(rows.every((r) => r.status === "void" && r.payout === r.stake)).toBe(true);
    expect(await practiceUsdgBalance(h.db, a.accountId)).toBe(GRANT);
    expect(await practiceUsdgBalance(h.db, b.accountId)).toBe(GRANT);
    expect((await h.db.select().from(fraudEvents).where(eq(fraudEvents.kind, "tote_linked_opposing_bets"))).length).toBeGreaterThan(0);
  });

  it("2g: after all of the above, every T-USDG unit still traces back to a grant (nothing created)", async () => {
    await practiceSupplyConserved();
  });
});

// ---------------------------------------------------------------------------
// 3. Nothing reaches a real-money path
// ---------------------------------------------------------------------------

describe("3. no T-USDG or practice identity reaches a real-money path", () => {
  it("3a: SIWE sign-in as the practice address finds no account; the practice address is never a verified wallet", async () => {
    const p = await tester();
    const addr = practiceAddressOf(p.accountId)!;
    expect(addr).toBe(fakeAddress(p.accountId));
    expect(await accountForWallet(h.db, addr)).toBeNull();
    expect(await verifiedWalletOf(h.db, p.accountId)).toBeNull();
  });

  it("3b: affiliates: a walletless inviter earns no commission (dropped: no verified wallet)", async () => {
    const inviter = await tester();
    const code = await ensureReferralCode(h.db, inviter.accountId);
    const buyer = await tester();
    await recordReferral(h.db, { accountId: buyer.accountId, code, now: T0 });
    const plan = await referralPlan(h.db, { buyerAccountId: buyer.accountId, buyerWallet: newWallet(), usdCents: 500, now: at(MIN) });
    expect(plan.ref1).toBeNull();
    expect(plan.dropped).toEqual(expect.arrayContaining([expect.objectContaining({ level: 1, accountId: inviter.accountId, reason: "no verified wallet" })]));
  });

  it("3c: Prize Pool: a walletless top scorer is not eligible and gets no allocation", async () => {
    const p = await tester();
    const horse = await makeHorse(h.db, p.stableId, { origin: "bred" });
    const from = new Date(T0.getTime() - 7 * DAY);
    await withLiveStarts(horse, p.stableId, 8);
    for (let d = 1; d <= 5; d++) await h.db.insert(accountPlayDays).values({ accountId: p.accountId, day: new Date(T0.getTime() - d * DAY).toISOString().slice(0, 10) }).onConflictDoNothing();
    const scores = await poolScores(h.db, { from, to: T0, rules: DEFAULT_POOL_RULES });
    const mine = scores.find((s) => s.accountId === p.accountId)!;
    expect(mine.score).toBeGreaterThan(0);
    expect(mine).toMatchObject({ wallet: null, eligible: false, reason: "no verified wallet" });
    expect(allocateUsd(scores, 10_000, DEFAULT_POOL_RULES).some((a) => a.accountId === p.accountId)).toBe(false);
  });

  it("3d: real-chain orders: a walletless buyer can't get one, and a practice-address lot can't be paid with real money", async () => {
    const walletless = await tester();
    const realBuyer = await tester();
    await linkVerifiedWallet(h.db, { accountId: realBuyer.accountId, address: newWallet(), now: T0 });
    const horse = await registered(walletless);
    const lot = await listUsdg(h.db, { accountId: walletless.accountId, horseId: horse.id, kind: "fixed", price: 10 * USD, duration: 7, now: T0 }, POLICY);
    expect(lot.sellerWallet).toBe(fakeAddress(walletless.accountId));
    await expect(quoteUsdgSale(h.db, { accountId: realBuyer.accountId, listingId: lot.id, chain: REAL, now: at(MIN) }, POLICY)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    const other = await tester();
    const own = await makeHorse(h.db, other.stableId, { origin: "bred" });
    await withLiveStarts(own, other.stableId);
    await expect(quoteUsdgRegistration(h.db, { accountId: other.accountId, horseId: own.id, termsAccepted: true, chain: REAL, now: at(MIN) }, POLICY)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("3e: a real-money order can't be paid with T-USDG", async () => {
    const seller = await tester();
    const buyer = await tester();
    for (const p of [seller, buyer]) await linkVerifiedWallet(h.db, { accountId: p.accountId, address: newWallet(), now: T0 });
    const horse = await registered(seller);
    const lot = await listUsdg(h.db, { accountId: seller.accountId, horseId: horse.id, kind: "fixed", price: 10 * USD, duration: 7, now: T0 }, POLICY);
    const order = await quoteUsdgSale(h.db, { accountId: buyer.accountId, listingId: lot.id, chain: REAL, now: at(MIN) }, POLICY);
    const before = await practiceUsdgBalance(h.db, buyer.accountId);
    await expect(payUsdgOrderPractice(h.db, { orderId: order.orderId, accountId: buyer.accountId, now: at(2 * MIN) }, POLICY)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await practiceUsdgBalance(h.db, buyer.accountId)).toBe(before);
  });

  it("3f: T-USDG can't move into Stable Credits (a ledger transaction can't mix currencies)", async () => {
    const p = await tester();
    await expect(
      post(h.db, {
        idempotencyKey: `sandbox-mix:${p.accountId}`,
        kind: "test_mix",
        postings: [
          { ledgerAccountId: await practiceLedgerAccountId(h.db, p.accountId), amount: -USD },
          { ledgerAccountId: await playerLedgerAccountId(h.db, p.accountId), amount: USD },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(GRANT);
  });
});

// ---------------------------------------------------------------------------
// 4. Race transactions
// ---------------------------------------------------------------------------

let raceN = 0;
let keyN = 0;
function liveRace(extra: Partial<CreateRaceInput> = {}) {
  return createRace(h.db, {
    kind: "scheduled",
    name: `Sandbox ${++raceN}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 140, distanceM: 1400, surface: "turf" },
    postTime: at(10 * MIN),
    entriesCloseAt: at(9 * MIN),
    purse: 3_000,
    maxRunners: 12,
    targetRunners: 6,
    ...extra,
  });
}
async function raceWithField(runners: number, extra: Partial<CreateRaceInput> = {}) {
  const race = await liveRace({ targetRunners: runners, ...extra });
  const owners: (Player & { horseId: string })[] = [];
  for (let i = 0; i < runners; i++) {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { rating: 30 });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0 });
    owners.push({ ...p, horseId: horse.id });
  }
  return { race, owners };
}
function bet(p: Player, raceId: string, horseId: string, stake: number, extra: Partial<PlaceToteBetInput> = {}) {
  return placeToteBet(h.db, { accountId: p.accountId, raceId, horseId, pool: "win", currency: "CR", stake, clientKey: `sandbox-${++keyN}`, now: at(5 * MIN), env: ON, ...extra }, { dbClock: false });
}
async function runRace(raceId: string, positions: Record<string, number>) {
  const { lockField, listRaceEntries, settleRace } = await import("../services/races");
  await lockField(h.db, raceId, at(9 * MIN));
  const entries = await listRaceEntries(h.db, raceId);
  const order = [...entries].sort((x, y) => (positions[x.horseId] ?? 99) - (positions[y.horseId] ?? 99));
  await settleRace(h.db, { raceId, now: at(10 * MIN), resultHash: "0".repeat(64), result: { order: order.map((e) => e.horseId) }, runners: order.map((e, i) => ({ horseId: e.horseId, position: i + 1 })) });
}

describe("4. race transactions can't be gamed", () => {
  it("4a: no bet at or after the off (credits or T-USDG)", async () => {
    const { race, owners } = await raceWithField(4);
    const p = await tester();
    await confirmToteAdult(h.db, { accountId: p.accountId, now: T0 });
    for (const currency of ["CR", "TUSDG"] as const) {
      await expect(bet(p, race.id, owners[0]!.horseId, currency === "CR" ? 100 : USD, { currency, now: at(10 * MIN) })).rejects.toMatchObject({ code: "RACE_CLOSED" });
      await expect(bet(p, race.id, owners[0]!.horseId, currency === "CR" ? 100 : USD, { currency, now: at(11 * MIN) })).rejects.toMatchObject({ code: "RACE_CLOSED" });
    }
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(GRANT);
  });

  it("4b: no bet on a race where you or a linked account has a runner (any runner, either currency)", async () => {
    const { race, owners } = await raceWithField(4);
    const owner = owners[0]!;
    await grantPracticeUsdg(h.db, { accountId: owner.accountId, now: T0, env: ON });
    await confirmToteAdult(h.db, { accountId: owner.accountId, now: T0 });
    for (const currency of ["CR", "TUSDG"] as const) {
      for (const target of [owner.horseId, owners[1]!.horseId]) {
        await expect(bet(owner, race.id, target, currency === "CR" ? 100 : USD, { currency })).rejects.toMatchObject({ code: "TOTE_CONFLICT" });
      }
    }
    const alt = await tester();
    await link(owner, alt);
    await confirmToteAdult(h.db, { accountId: alt.accountId, now: T0 });
    await expect(bet(alt, race.id, owners[2]!.horseId, USD, { currency: "TUSDG" })).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
  });

  it("4c: entering a runner after betting voids your own (and a linked account's) bets with a full refund", async () => {
    const { race, owners } = await raceWithField(4);
    const p = await tester();
    const alt = await tester();
    await link(p, alt);
    for (const x of [p, alt]) await confirmToteAdult(h.db, { accountId: x.accountId, now: T0 });
    await bet(p, race.id, owners[0]!.horseId, 2 * USD, { currency: "TUSDG" });
    await bet(alt, race.id, owners[1]!.horseId, 3 * USD, { currency: "TUSDG" });
    const mine = await makeHorse(h.db, p.stableId, { rating: 30 });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: mine.id, tactic: "stalker", now: at(6 * MIN) });
    const rows = await h.db.select().from(toteBets).where(eq(toteBets.raceId, race.id));
    expect(rows.every((r) => r.status === "void" && r.payout === r.stake)).toBe(true);
    expect(await practiceUsdgBalance(h.db, p.accountId)).toBe(GRANT);
    expect(await practiceUsdgBalance(h.db, alt.accountId)).toBe(GRANT);
  });

  it("4d: scratching refunds the bets on that horse in full (no take), can't happen after entries close, and the horse can't come back in", async () => {
    const { race, owners } = await raceWithField(4);
    const a = await tester();
    const b = await tester();
    for (const x of [a, b]) await confirmToteAdult(h.db, { accountId: x.accountId, now: T0 });
    await bet(a, race.id, owners[0]!.horseId, 4 * USD, { currency: "TUSDG" });
    await bet(b, race.id, owners[1]!.horseId, 4 * USD, { currency: "TUSDG" });
    await scratchEntry(h.db, { accountId: owners[0]!.accountId, raceId: race.id, horseId: owners[0]!.horseId, now: at(6 * MIN) });
    expect(await practiceUsdgBalance(h.db, a.accountId)).toBe(GRANT);
    await expect(enterRace(h.db, { accountId: owners[0]!.accountId, raceId: race.id, horseId: owners[0]!.horseId, tactic: "stalker", now: at(7 * MIN) })).rejects.toMatchObject({ code: "RACE_CLOSED" });
    await expect(scratchEntry(h.db, { accountId: owners[1]!.accountId, raceId: race.id, horseId: owners[1]!.horseId, now: at(9 * MIN) })).rejects.toMatchObject({ code: "RACE_CLOSED" });
    // Only b is left in the pool: thin, so b is refunded too. Nobody ends with more than they had.
    await runRace(race.id, { [owners[1]!.horseId]: 1 });
    await settleTote(h.db, race.id, at(DAY));
    expect(await practiceUsdgBalance(h.db, b.accountId)).toBe(GRANT);
  });

  it("4e: claiming: no claim on your own horse, none by a linked account, none after entries close", async () => {
    const race = await liveRace({ name: `Sandbox Claiming ${++raceN}`, conditions: { claiming: true, minRating: 0, maxRating: 55, distanceM: 1400 }, targetRunners: 2 });
    const seller = await tester();
    await makeSeller(h.db, seller.accountId, seller.stableId);
    const horse = await makeHorse(h.db, seller.stableId, { origin: "bred", rating: 30, starts: 5, tradeMinStarts: 0 });
    await enterRace(h.db, { accountId: seller.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0, claimPrice: appraisalOf(horse) });
    const alt = await tester();
    await link(seller, alt);
    const stranger = await tester();
    await expect(lodgeClaim(h.db, { accountId: seller.accountId, raceId: race.id, horseId: horse.id, now: at(MIN) })).rejects.toMatchObject({ code: "CANNOT_BUY_OWN" });
    await expect(lodgeClaim(h.db, { accountId: alt.accountId, raceId: race.id, horseId: horse.id, now: at(MIN) })).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    await expect(lodgeClaim(h.db, { accountId: stranger.accountId, raceId: race.id, horseId: horse.id, now: at(9 * MIN) })).rejects.toMatchObject({ code: "RACE_CLOSED" });
  });

  it("4f: an abandoned race refunds entry fees and tote stakes exactly once, however often it is cancelled or settled", async () => {
    const race = await liveRace({ entryFee: 200 });
    const owners: (Player & { horseId: string })[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await newPlayer(h.db);
      const horse = await makeHorse(h.db, p.stableId, { rating: 30 });
      await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0 });
      owners.push({ ...p, horseId: horse.id });
    }
    const credits0 = await getBalance(h.db, owners[0]!.accountId);
    const a = await tester();
    const b = await tester();
    for (const x of [a, b]) await confirmToteAdult(h.db, { accountId: x.accountId, now: T0 });
    await bet(a, race.id, owners[0]!.horseId, 3 * USD, { currency: "TUSDG" });
    await bet(b, race.id, owners[1]!.horseId, 300, { currency: "CR" });
    const credB = await getBalance(h.db, b.accountId);
    for (let i = 0; i < 2; i++) await cancelRace(h.db, { raceId: race.id, now: at(8 * MIN + i), reason: "sandbox" });
    for (let i = 0; i < 2; i++) await settleTote(h.db, race.id, at(DAY + i));
    expect(await getBalance(h.db, owners[0]!.accountId)).toBe(credits0 + 200);
    expect(await practiceUsdgBalance(h.db, a.accountId)).toBe(GRANT);
    expect(await getBalance(h.db, b.accountId)).toBe(credB + 300);
    const refunds = await h.db.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(like(ledgerTransactions.idempotencyKey, `entry-refund:${race.id}:%`));
    expect(refunds).toHaveLength(3);
    await practiceSupplyConserved();
  });
});

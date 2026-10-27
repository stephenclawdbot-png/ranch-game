import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { achievements, accounts, chainOrders, dailyCupEntries, fraudEvents, packPulls, raceEntries, races, referrals, testers } from "../schema";
import { recordAccountSignal, recordPlayDay } from "../services/accounts";
import { getBalance } from "../services/ledger";
import { generateInviteCodes, resetPlaytest, RESET_CONFIRMATION, setTesterWallet } from "../services/playtest";
import { createRace } from "../services/races";
import {
  accountForWallet,
  allocateUsd,
  allocationsForWallet,
  consumeWalletChallenge,
  createChainOrder,
  createWalletChallenge,
  DEFAULT_POOL_RULES,
  ensureAccountWallet,
  fulfilChainOrder,
  linkVerifiedWallet,
  markEpochPosted,
  markOrderSubmitted,
  openChainOrders,
  poolScores,
  premiumPacksLifetime,
  reservedPremiumPacks,
  saveEpochDraft,
  usdCentsToWei,
  verifiedWalletOf,
  weekPeriod,
  weiToUsdCents,
  type PoolScoreRow,
} from "../services/betaMoney";
import {
  affiliateAdminView,
  claimOwner,
  ensureReferralCode,
  inviteesOf,
  recordReferral,
  recordReferralEarnings,
  referralPlan,
  revokeReferral,
  setAffiliateConfig,
  settleReferralActivations,
  DEFAULT_AFFILIATE_CONFIG,
} from "../services/affiliates";
import { at, count, DAY, expectDbError, makeHorse, makeSeller, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let w = 0;
const wallet = () => `0x${(++w).toString(16).padStart(40, "a")}`;
const orderHex = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const txHex = (n: number) => `0x${(n + 0xabc).toString(16).padStart(64, "0")}`;

async function playerWithWallet(now = T0) {
  const p = await newPlayer(h.db, { starters: 0 });
  const addr = wallet();
  await linkVerifiedWallet(h.db, { accountId: p.accountId, address: addr, now });
  return { ...p, wallet: addr };
}

describe("wallet links (SIWE-verified, one per account)", () => {
  it("challenges are single-use and expire", async () => {
    const p = await newPlayer(h.db);
    await createWalletChallenge(h.db, { accountId: p.accountId, nonce: "abcDEF123456", message: "msg-1", expiresAt: new Date(T0.getTime() + 600_000) });
    expect(await consumeWalletChallenge(h.db, { accountId: p.accountId, nonce: "abcDEF123456", now: T0 })).toBe("msg-1");
    await expect(consumeWalletChallenge(h.db, { accountId: p.accountId, nonce: "abcDEF123456", now: T0 })).rejects.toThrow(/expired or was already used/);
    await createWalletChallenge(h.db, { accountId: p.accountId, nonce: "zzzZZZ999999", message: "msg-2", expiresAt: new Date(T0.getTime() + 600_000) });
    await expect(consumeWalletChallenge(h.db, { accountId: p.accountId, nonce: "zzzZZZ999999", now: new Date(T0.getTime() + 601_000) })).rejects.toThrow();
    const other = await newPlayer(h.db);
    await createWalletChallenge(h.db, { accountId: p.accountId, nonce: "otherACC1234", message: "m", expiresAt: new Date(T0.getTime() + 600_000) });
    await expect(consumeWalletChallenge(h.db, { accountId: other.accountId, nonce: "otherACC1234", now: T0 })).rejects.toThrow();
  });

  it("links once, refuses a wallet already used by another stable, and locks the unsigned path", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const addr = wallet();
    const res = await linkVerifiedWallet(h.db, { accountId: a.accountId, address: addr, now: T0 });
    expect(res.tester.inviteCode).toBe("OPEN");
    expect(await verifiedWalletOf(h.db, a.accountId)).toBe(addr);
    await linkVerifiedWallet(h.db, { accountId: a.accountId, address: addr.toUpperCase().replace("0X", "0x"), now: T0 }); // same wallet: idempotent
    await expect(linkVerifiedWallet(h.db, { accountId: b.accountId, address: addr, now: T0 })).rejects.toThrow(/already linked to another stable/);
    await expect(linkVerifiedWallet(h.db, { accountId: a.accountId, address: wallet(), now: T0 })).rejects.toThrow(/already has a verified wallet/);
    await expect(setTesterWallet(h.db, { accountId: a.accountId, address: wallet() })).rejects.toThrow(/verified/);
    await expect(linkVerifiedWallet(h.db, { accountId: b.accountId, address: "0x123", now: T0 })).rejects.toThrow();
  });

  it("one wallet, one account: the lower(wallet_address) unique index, and a race that loses it gets LINKED_ACCOUNTS", async () => {
    const addr = wallet();
    // Direct rows differing only by case can't coexist (wallets are stored checksummed).
    await h.db.insert(accounts).values({ tokenHash: `t-${addr.slice(2, 12)}`, walletAddress: addr });
    await expectDbError(h.db.insert(accounts).values({ tokenHash: "t-other", walletAddress: addr.toUpperCase().replace(/^0X/, "0x") }), /duplicate key|unique/i);

    // Two accounts race to claim the same wallet: exactly one wins, the other is told the
    // wallet is taken (LINKED_ACCOUNTS), never a 500 or two owners.
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const race = wallet();
    const rs = await Promise.allSettled([
      ensureAccountWallet(h.db, { accountId: a.accountId, address: race, now: T0 }),
      ensureAccountWallet(h.db, { accountId: b.accountId, address: race, now: T0 }),
    ]);
    const losers = rs.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(losers.length).toBe(1);
    expect((losers[0]!.reason as { code?: string }).code).toBe("LINKED_ACCOUNTS");
    const winner = await accountForWallet(h.db, race);
    expect(winner).toBeTypeOf("string");
    expect([a.accountId, b.accountId]).toContain(winner);
  });
});

describe("ETH checkout orders", () => {
  it("reserve the weekly cap, then fulfil exactly once with prepaid pulls (no credits spent)", async () => {
    const p = await playerWithWallet();
    const credits = await getBalance(h.db, p.accountId);
    const order = await createChainOrder(h.db, {
      orderId: orderHex(1),
      accountId: p.accountId,
      wallet: p.wallet,
      sku: "premium_pack",
      quantity: 2,
      usdCents: 998,
      priceWei: 3_000_000_000_000_000n,
      ethUsdMicros: 3_326_000_000,
      priceSources: [{ source: "coinbase", price: 3326 }],
      chainId: 46630,
      storeAddress: "0x00000000000000000000000000000000000000c1",
      deadline: new Date(T0.getTime() + 300_000),
      now: T0,
    });
    expect(order.status).toBe("quoted");
    expect(await reservedPremiumPacks(h.db, { accountId: p.accountId, now: T0 })).toBe(2);
    expect(await premiumPacksLifetime(h.db, { accountId: p.accountId, now: T0 })).toBe(2); // live quotes count
    expect(await reservedPremiumPacks(h.db, { accountId: p.accountId, now: new Date(T0.getTime() + 301_000) })).toBe(0); // expired quote
    expect(await premiumPacksLifetime(h.db, { accountId: p.accountId, now: new Date(T0.getTime() + 301_000) })).toBe(0);
    expect((await openChainOrders(h.db, { accountId: p.accountId, now: T0 })).length).toBe(1);
    await expect(markOrderSubmitted(h.db, { orderId: order.orderId, accountId: (await newPlayer(h.db)).accountId, txHash: txHex(1), now: T0 })).rejects.toThrow();
    const sub = await markOrderSubmitted(h.db, { orderId: order.orderId, accountId: p.accountId, txHash: txHex(1), now: T0 });
    expect(sub.status).toBe("submitted");
    await expect(markOrderSubmitted(h.db, { orderId: order.orderId, accountId: p.accountId, txHash: txHex(2), now: T0 })).rejects.toThrow(/different transaction/);

    const first = await fulfilChainOrder(h.db, { orderId: order.orderId, txHash: txHex(1), now: T0, split: { poolShareWei: 900n, treasuryWei: 2100n } });
    expect(first.duplicate).toBe(false);
    expect(first.pulls).toHaveLength(2);
    expect(first.order.status).toBe("fulfilled");
    expect(first.order.poolShareWei).toBe("900");
    const again = await fulfilChainOrder(h.db, { orderId: order.orderId, txHash: txHex(1), now: T0 });
    expect(again.duplicate).toBe(true);
    expect(again.pulls.map((x) => x.pullId)).toEqual(first.pulls.map((x) => x.pullId));
    expect(await premiumPacksLifetime(h.db, { accountId: p.accountId, now: new Date(T0.getTime() + 301_000) })).toBe(2); // confirmed orders keep counting for the whole beta
    const pulls = await h.db.select().from(packPulls).where(eq(packPulls.accountId, p.accountId));
    expect(pulls).toHaveLength(2);
    expect(pulls.every((x) => x.packType === "premium" && x.price === 0 && !x.free)).toBe(true);
    expect(await getBalance(h.db, p.accountId)).toBe(credits);
    await expect(fulfilChainOrder(h.db, { orderId: order.orderId, txHash: txHex(9), now: T0 })).rejects.toThrow(/different transaction/);
    await expect(fulfilChainOrder(h.db, { orderId: orderHex(999), txHash: txHex(3), now: T0 })).rejects.toThrow(/unknown order/);
    // Orders survive the playtest reset (real money).
    await resetPlaytest(h.db, { confirm: RESET_CONFIRMATION });
    const [kept] = await h.db.select().from(chainOrders).where(eq(chainOrders.orderId, order.orderId));
    expect(kept?.status).toBe("fulfilled");
    const [t] = await h.db.select().from(testers).where(sql`lower(${testers.walletAddress}) = ${p.wallet.toLowerCase()}`);
    expect(t?.walletVerifiedAt).not.toBeNull();
  });
});

describe("Prize Pool allocations", () => {
  const row = (i: number, over: Partial<PoolScoreRow> = {}): PoolScoreRow => ({
    accountId: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    testerId: null,
    stableName: `S${i}`,
    wallet: wallet(),
    racePoints: 100 - i,
    cupPoints: 0,
    score: 100 - i,
    wins: 0,
    runs: 1,
    activeDays: 5,
    flagged: false,
    eligible: true,
    reason: null,
    ...over,
  });

  it("splits a USD budget over the paid ranks with a per-player cap; leftovers stay in the pool", () => {
    const rules = { ...DEFAULT_POOL_RULES, paidRanks: 3, capUsdCents: 2_000, minPayoutUsdCents: 50 };
    const a = allocateUsd([row(1), row(2), row(3, { eligible: false, reason: "x" }), row(4), row(5)], 6_000, rules);
    expect(a.map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(a.map((x) => x.usdCents)).toEqual([2_000, 2_000, 1_000]); // 3000/2000/1000 shares, capped at $20
    expect(a.reduce((s, x) => s + x.usdCents, 0)).toBeLessThanOrEqual(6_000);
    expect(allocateUsd([row(1)], 30, rules)).toEqual([]); // dust
    expect(allocateUsd([], 5_000, rules)).toEqual([]);
  });

  it("converts USD <-> wei at the posting price (rounding down)", () => {
    const micros = 3_000_000_000; // $3,000/ETH
    expect(usdCentsToWei(2_000, micros)).toBe(6_666_666_666_666_666n); // $20 = 0.00666... ETH
    expect(weiToUsdCents(10n ** 18n, micros)).toBe(300_000);
    expect(() => usdCentsToWei(1, 0)).toThrow();
  });

  let raceNo = 0;
  /** A settled Live race: the stable's horse finishes `position` in a 4-runner field (house fillers). */
  async function liveRun(postTime: Date, stableId: string, horseId: string, position: number) {
    const race = await createRace(h.db, { kind: "scheduled", name: `Pool race ${++raceNo}`, raceClass: "maiden", conditions: {}, postTime, entriesCloseAt: new Date(postTime.getTime() - MIN) });
    await h.db.update(races).set({ status: "settled" }).where(eq(races.id, race.id));
    await h.db.insert(raceEntries).values({ raceId: race.id, horseId, stableId, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0, finishPosition: position, status: "entered" });
    const fillers = await Promise.all([makeHorse(h.db, null), makeHorse(h.db, null), makeHorse(h.db, null)]);
    await h.db.insert(raceEntries).values(fillers.map((f, i) => ({ raceId: race.id, horseId: f.id, gate: i + 2, tactic: "stalker", snapshot: {}, ratingBefore: 0, isHouse: true })));
  }

  it("scores Daily Cup points, requires 4 active days + a verified wallet, and excludes premium-pack horses", async () => {
    const weekStart = "2026-11-02";
    const { from } = weekPeriod(weekStart);
    const a = await playerWithWallet();
    const b = await newPlayer(h.db); // no wallet
    const c = await playerWithWallet(); // only 2 active days
    const d = await playerWithWallet(); // premium-pack horse
    for (const p of [a, b, c, d]) {
      const horse = await makeHorse(h.db, p.stableId);
      await h.db.insert(dailyCupEntries).values({ day: "2026-11-03", accountId: p.accountId, horseId: horse.id, snapshot: {}, points: 40 });
      if (p === d) await h.db.insert(packPulls).values({ accountId: d.accountId, packType: "premium", pullIndex: 1, seedCommitment: "x", seedReveal: "y", rarity: "rare", horseId: horse.id, price: 0, free: false, weekStart, seasonNumber: 1, idempotencyKey: `t:${horse.id}` });
      for (let day = 0; day < (p === c ? 2 : 4); day++) await recordPlayDay(h.db, p.accountId, new Date(from.getTime() + day * DAY + 3_600_000));
    }
    const scores = await poolScores(h.db, { ...weekPeriod(weekStart), rules: DEFAULT_POOL_RULES });
    const by = new Map(scores.map((s) => [s.accountId, s]));
    expect(by.get(a.accountId)).toMatchObject({ cupPoints: 40, score: 66, eligible: true, activeDays: 4 }); // 40 x 5 / 3
    expect(by.get(b.accountId)).toMatchObject({ eligible: false, reason: "no verified wallet" });
    expect(by.get(c.accountId)).toMatchObject({ eligible: false, reason: "active 2/4 days" });
    expect(by.get(d.accountId)).toMatchObject({ cupPoints: 0, eligible: false, reason: "no points" });
    const loose = await poolScores(h.db, { ...weekPeriod(weekStart), rules: { ...DEFAULT_POOL_RULES, excludePremiumHorses: false } });
    expect(loose.find((s) => s.accountId === d.accountId)?.eligible).toBe(true);
  });

  it("scores the placing rate, not volume: 3 great runs beat 20 average ones", async () => {
    const weekStart = "2026-11-09";
    const { from } = weekPeriod(weekStart);
    const great = await playerWithWallet();
    const grinder = await playerWithWallet();
    for (const p of [great, grinder]) for (let day = 0; day < 4; day++) await recordPlayDay(h.db, p.accountId, new Date(from.getTime() + day * DAY + 3_600_000));
    const greatHorse = await makeHorse(h.db, great.stableId);
    const grinderHorse = await makeHorse(h.db, grinder.stableId);
    for (let i = 0; i < 3; i++) await liveRun(new Date(from.getTime() + (i + 1) * DAY + 3_600_000), great.stableId, greatHorse.id, 1); // 3 wins: 3 x 13 = 39 -> 39 x 15 / 8
    for (let i = 0; i < 20; i++) await liveRun(new Date(from.getTime() + (i % 5) * DAY + 5 * 3_600_000), grinder.stableId, grinderHorse.id, 6); // 20 sixths: 20 x 3 = 60 -> 60 x 15 / 20
    const scores = await poolScores(h.db, { ...weekPeriod(weekStart), rules: DEFAULT_POOL_RULES });
    const by = new Map(scores.map((s) => [s.accountId, s]));
    expect(by.get(great.accountId)).toMatchObject({ score: 73, racePoints: 39, runs: 3, wins: 3, eligible: true });
    expect(by.get(grinder.accountId)).toMatchObject({ score: 45, racePoints: 60, runs: 20 });
    expect(by.get(grinder.accountId)!.score).toBeLessThan(by.get(great.accountId)!.score);
    expect(scores[0]!.accountId).toBe(great.accountId);
  });

  it("counts only the best 3 Daily Cup days (mean x 5), so volume alone doesn't score", async () => {
    const weekStart = "2026-11-16";
    const { from } = weekPeriod(weekStart);
    const many = await playerWithWallet();
    const once = await playerWithWallet();
    for (const p of [many, once]) for (let day = 0; day < 4; day++) await recordPlayDay(h.db, p.accountId, new Date(from.getTime() + day * DAY + 3_600_000));
    const manyHorse = await makeHorse(h.db, many.stableId);
    for (const [day, points] of [["2026-11-16", 40], ["2026-11-17", 30], ["2026-11-18", 20], ["2026-11-19", 10]] as const)
      await h.db.insert(dailyCupEntries).values({ day, accountId: many.accountId, horseId: manyHorse.id, snapshot: {}, points });
    const onceHorse = await makeHorse(h.db, once.stableId);
    await h.db.insert(dailyCupEntries).values({ day: "2026-11-16", accountId: once.accountId, horseId: onceHorse.id, snapshot: {}, points: 40 });
    const scores = await poolScores(h.db, { ...weekPeriod(weekStart), rules: DEFAULT_POOL_RULES });
    const by = new Map(scores.map((s) => [s.accountId, s]));
    expect(by.get(many.accountId)).toMatchObject({ cupPoints: 90, score: 150 }); // (40 + 30 + 20) x 5 / 3; the 10-point day is ignored
    expect(by.get(once.accountId)).toMatchObject({ cupPoints: 40, score: 66 }); // one 40 day, still the mean over 3
  });

  it("reaches full weight from 8 runs: the same placings score the same at 8 and 16 runs", async () => {
    const weekStart = "2026-11-23";
    const { from } = weekPeriod(weekStart);
    const r4 = await playerWithWallet();
    const r8 = await playerWithWallet();
    const r16 = await playerWithWallet();
    for (const p of [r4, r8, r16]) for (let day = 0; day < 4; day++) await recordPlayDay(h.db, p.accountId, new Date(from.getTime() + day * DAY + 3_600_000));
    const h4 = await makeHorse(h.db, r4.stableId);
    const h8 = await makeHorse(h.db, r8.stableId);
    const h16 = await makeHorse(h.db, r16.stableId);
    const at = (d: number, hour: number) => new Date(from.getTime() + (d % 6) * DAY + (hour + 1) * 3_600_000);
    for (let i = 0; i < 4; i++) await liveRun(at(i, 0), r4.stableId, h4.id, 2); // 9 points a run
    for (let i = 0; i < 8; i++) await liveRun(at(i, 1), r8.stableId, h8.id, 2);
    for (let i = 0; i < 16; i++) await liveRun(at(i, 2), r16.stableId, h16.id, 2);
    const scores = await poolScores(h.db, { ...weekPeriod(weekStart), rules: DEFAULT_POOL_RULES });
    const by = new Map(scores.map((s) => [s.accountId, s]));
    expect(by.get(r8.accountId)!.score).toBe(135); // 72 x 15 / 8
    expect(by.get(r16.accountId)!.score).toBe(135); // 144 x 15 / 16: playing more doesn't score more
    expect(by.get(r4.accountId)!.score).toBe(67); // half weight at 4 runs: 36 x 15 / 8
  });

  it("needs 4 active days (3 no longer qualifies) and caps a week at $10", async () => {
    const weekStart = "2026-11-30";
    const { from } = weekPeriod(weekStart);
    const three = await playerWithWallet();
    const four = await playerWithWallet();
    for (const [p, days] of [[three, 3], [four, 4]] as const) {
      const horse = await makeHorse(h.db, p.stableId);
      await h.db.insert(dailyCupEntries).values({ day: "2026-12-01", accountId: p.accountId, horseId: horse.id, snapshot: {}, points: 40 });
      for (let day = 0; day < days; day++) await recordPlayDay(h.db, p.accountId, new Date(from.getTime() + day * DAY + 3_600_000));
    }
    const scores = await poolScores(h.db, { ...weekPeriod(weekStart), rules: DEFAULT_POOL_RULES });
    const by = new Map(scores.map((s) => [s.accountId, s]));
    expect(by.get(three.accountId)).toMatchObject({ eligible: false, reason: "active 3/4 days" });
    expect(by.get(four.accountId)).toMatchObject({ eligible: true });
    expect(DEFAULT_POOL_RULES.minActiveDays).toBe(4);
    const paid = allocateUsd(Array.from({ length: 10 }, (_, i) => row(i + 10)), 100_000, DEFAULT_POOL_RULES);
    expect(paid[0]!.usdCents).toBe(1_000); // $10 cap, not $20
  });

  it("drafts can be replaced until posted; only posted allocations are served", async () => {
    const pool = "0x00000000000000000000000000000000000000d1";
    const addr = wallet();
    const p = await newPlayer(h.db);
    const draft = (root: string) =>
      saveEpochDraft(h.db, {
        chainId: 46630,
        poolAddress: pool,
        epochId: 1,
        kind: "weekly",
        weekStart: "2026-11-02",
        root,
        totalWei: 5n,
        availableWei: 100n,
        ethUsdMicros: 3_000_000_000,
        priceSources: null,
        config: { budgetBps: 2500 },
        vestStart: T0,
        vestEnd: new Date(T0.getTime() + 14 * DAY),
        allocations: [{ accountId: p.accountId, testerId: null, stableName: "S", wallet: addr, rank: 1, score: 10, activeDays: 3, usdCents: 100, amountWei: 5n, leaf: `0x${"1".repeat(64)}`, proof: [] }],
        now: T0,
      });
    await draft(`0x${"a".repeat(64)}`);
    const second = await draft(`0x${"b".repeat(64)}`);
    expect(await allocationsForWallet(h.db, { wallet: addr, chainId: 46630, poolAddress: pool })).toHaveLength(0);
    await markEpochPosted(h.db, { id: second.id, txHash: txHex(5), now: T0 });
    const mine = await allocationsForWallet(h.db, { wallet: addr.toUpperCase().replace("0X", "0x"), chainId: 46630, poolAddress: pool });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.epoch.root).toBe(`0x${"b".repeat(64)}`);
    await expect(draft(`0x${"c".repeat(64)}`)).rejects.toThrow(/already posted/);
  });
});

describe("affiliates (2 levels, owner at the root)", () => {
  async function tree() {
    const owner = await playerWithWallet();
    await claimOwner(h.db, { accountId: owner.accountId, now: T0 });
    const [root] = await generateInviteCodes(h.db, { count: 1, maxUses: 10 });
    const alice = await playerWithWallet();
    await recordReferral(h.db, { accountId: alice.accountId, code: root!, now: T0 });
    const aliceCode = await ensureReferralCode(h.db, alice.accountId);
    expect(await ensureReferralCode(h.db, alice.accountId)).toBe(aliceCode);
    const bob = await playerWithWallet();
    await recordReferral(h.db, { accountId: bob.accountId, code: aliceCode.toLowerCase(), now: T0 });
    return { owner, alice, bob, root: root!, aliceCode };
  }

  it("root codes make the owner level 1; personal codes give inviter + upstream; written once", async () => {
    const { owner, alice, bob, aliceCode } = await tree();
    const [ra] = await h.db.select().from(referrals).where(eq(referrals.accountId, alice.accountId));
    expect(ra).toMatchObject({ inviterAccountId: owner.accountId, upstreamAccountId: null });
    const [rb] = await h.db.select().from(referrals).where(eq(referrals.accountId, bob.accountId));
    expect(rb).toMatchObject({ inviterAccountId: alice.accountId, upstreamAccountId: owner.accountId, viaCode: aliceCode });
    await recordReferral(h.db, { accountId: bob.accountId, code: await ensureReferralCode(h.db, owner.accountId), now: T0 }); // no rewrite
    expect((await h.db.select().from(referrals).where(eq(referrals.accountId, bob.accountId)))[0]!.inviterAccountId).toBe(alice.accountId);
    expect(await recordReferral(h.db, { accountId: bob.accountId, code: "NOPE", now: T0 })).toBeNull();
    const view = await inviteesOf(h.db, owner.accountId, DEFAULT_AFFILIATE_CONFIG);
    expect(view.map((v) => v.level).sort()).toEqual([1, 2]);
    await expect(claimOwner(h.db, { accountId: (await newPlayer(h.db)).accountId, now: T0 })).rejects.toThrow(/verify a wallet/);
  });

  it("signs both levels within the window; drops levels for revoked, expired, walletless, linked or capped referrers", async () => {
    const { owner, alice, bob } = await tree();
    const plan = await referralPlan(h.db, { buyerAccountId: bob.accountId, buyerWallet: bob.wallet, usdCents: 499, now: T0 });
    expect(plan.ref1).toMatchObject({ accountId: alice.accountId, wallet: alice.wallet, bps: 1000, usdCents: 49, owner: false });
    expect(plan.ref2).toMatchObject({ accountId: owner.accountId, bps: 300, usdCents: 14, owner: true });

    const late = await referralPlan(h.db, { buyerAccountId: bob.accountId, buyerWallet: bob.wallet, usdCents: 499, now: new Date(T0.getTime() + 91 * DAY) });
    expect(late.ref1).toBeNull();
    expect(late.dropped[0]!.reason).toMatch(/window/);

    // Same wallet as the buyer (e.g. alice buying with... her own wallet is impossible; simulate via buyerWallet).
    const same = await referralPlan(h.db, { buyerAccountId: bob.accountId, buyerWallet: alice.wallet, usdCents: 499, now: T0 });
    expect(same.ref1).toBeNull();
    expect(same.ref2).toBeNull(); // level 2 needs level 1
    expect(same.dropped.map((d) => d.reason)).toContain("same wallet as the buyer or the other referrer");

    // Linked accounts (same device) -> dropped and flagged; the owner is exempt.
    await recordAccountSignal(h.db, { accountId: bob.accountId, kind: "device", value: "dev-shared" });
    await recordAccountSignal(h.db, { accountId: alice.accountId, kind: "device", value: "dev-shared" });
    const linked = await referralPlan(h.db, { buyerAccountId: bob.accountId, buyerWallet: bob.wallet, usdCents: 499, now: T0 });
    expect(linked.ref1).toBeNull();
    expect(linked.dropped[0]!.reason).toMatch(/linked/);
    const flags = await h.db.select().from(fraudEvents).where(eq(fraudEvents.kind, "referral_linked"));
    expect(flags.some((f) => f.accountId === bob.accountId && f.relatedAccountId === alice.accountId)).toBe(true);

    // Revoked referral -> nothing.
    const carol = await playerWithWallet();
    await recordReferral(h.db, { accountId: carol.accountId, code: await ensureReferralCode(h.db, alice.accountId), now: T0 });
    await revokeReferral(h.db, { accountId: carol.accountId, reason: "test", now: T0 });
    const rev = await referralPlan(h.db, { buyerAccountId: carol.accountId, buyerWallet: carol.wallet, usdCents: 499, now: T0 });
    expect(rev.ref1).toBeNull();
    expect(rev.dropped.every((d) => d.reason === "referral revoked")).toBe(true);
    await expect(revokeReferral(h.db, { accountId: carol.accountId, reason: "again", now: T0 })).rejects.toThrow();

    // Inviter without a wallet.
    const dave = await newPlayer(h.db);
    const erin = await playerWithWallet();
    await recordReferral(h.db, { accountId: erin.accountId, code: await ensureReferralCode(h.db, dave.accountId), now: T0 });
    const nw = await referralPlan(h.db, { buyerAccountId: erin.accountId, buyerWallet: erin.wallet, usdCents: 499, now: T0 });
    expect(nw.dropped[0]).toMatchObject({ level: 1, reason: "no verified wallet" });
  });

  it("weekly per-inviter cap counts open quotes and earnings; the owner has its own (optional) cap", async () => {
    const { owner, alice } = await tree();
    await setAffiliateConfig(h.db, { weeklyCapUsdCents: 100, ownerWeeklyCapUsdCents: null });
    const buyers = [await playerWithWallet(), await playerWithWallet(), await playerWithWallet()];
    const aliceCode = await ensureReferralCode(h.db, alice.accountId);
    let n = 100;
    const results = [];
    for (const b of buyers) {
      await recordReferral(h.db, { accountId: b.accountId, code: aliceCode, now: T0 });
      const plan = await referralPlan(h.db, { buyerAccountId: b.accountId, buyerWallet: b.wallet, usdCents: 499, now: T0 });
      results.push(plan);
      await createChainOrder(h.db, {
        orderId: orderHex(++n),
        accountId: b.accountId,
        wallet: b.wallet,
        sku: "premium_pack",
        quantity: 1,
        usdCents: 499,
        priceWei: 1n,
        ethUsdMicros: 1,
        priceSources: null,
        chainId: 1,
        storeAddress: "0x00000000000000000000000000000000000000c1",
        deadline: new Date(T0.getTime() + 300_000),
        now: T0,
        ref1: plan.ref1,
        ref2: plan.ref2,
      });
    }
    // $0.49 each: two fit under $1.00, the third would exceed it.
    expect(results.map((r) => !!r.ref1)).toEqual([true, true, false]);
    expect(results[2]!.dropped[0]!.reason).toMatch(/weekly commission cap/);
    // The owner (level 2) has no cap configured: paid every time.
    expect(results.every((r) => r.ref2?.accountId === owner.accountId || r.ref1 === null)).toBe(true);
    await setAffiliateConfig(h.db, { weeklyCapUsdCents: DEFAULT_AFFILIATE_CONFIG.weeklyCapUsdCents });
    await expect(setAffiliateConfig(h.db, { ref1Bps: 1501 })).rejects.toThrow();
    await expect(setAffiliateConfig(h.db, { ref2Bps: 501 })).rejects.toThrow();
  });

  /** Settled Live (scheduled) races the account's horse ran in; makeSeller's kind "quick" runs are Story. */
  async function liveRuns(runs: number, stableId: string) {
    const horse = await makeHorse(h.db, stableId);
    for (let i = 0; i < runs; i++) {
      const race = await createRace(h.db, { kind: "scheduled", name: `Affiliate live ${i}`, raceClass: "maiden", conditions: {}, postTime: new Date(T0.getTime() - (i + 1) * DAY), entriesCloseAt: new Date(T0.getTime() - (i + 1) * DAY - MIN) });
      await h.db.update(races).set({ status: "settled" }).where(eq(races.id, race.id));
      await h.db.insert(raceEntries).values({ raceId: race.id, horseId: horse.id, stableId, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0, finishPosition: i + 1, status: "entered" });
    }
  }

  it("records paid commissions once and grants the active-invitee reward once (credits + badge)", async () => {
    const { owner, alice, bob } = await tree();
    const plan = await referralPlan(h.db, { buyerAccountId: bob.accountId, buyerWallet: bob.wallet, usdCents: 499, now: T0 });
    const order = await createChainOrder(h.db, {
      orderId: orderHex(500),
      accountId: bob.accountId,
      wallet: bob.wallet,
      sku: "premium_pack",
      quantity: 1,
      usdCents: 499,
      priceWei: 1_000_000n,
      ethUsdMicros: 1,
      priceSources: null,
      chainId: 1,
      storeAddress: "0x00000000000000000000000000000000000000c1",
      deadline: new Date(T0.getTime() + 300_000),
      now: T0,
      ref1: plan.ref1,
      ref2: plan.ref2,
    });
    const commissions = [
      { level: 1 as const, wallet: alice.wallet, amountWei: 100_000n, deferred: false },
      { level: 2 as const, wallet: owner.wallet, amountWei: 30_000n, deferred: false },
    ];
    await recordReferralEarnings(h.db, { order, txHash: txHex(500), commissions, now: T0 });
    await recordReferralEarnings(h.db, { order, txHash: txHex(500), commissions, now: T0 });
    const admin = await affiliateAdminView(h.db);
    expect(admin.ownerAccountId).toBe(owner.accountId);
    expect(admin.owner.level2Wei).not.toBe("0");
    expect(admin.topInviters.find((t) => t.accountId === alice.accountId)?.earnedUsdCents).toBeGreaterThanOrEqual(49);

    const before = await getBalance(h.db, alice.accountId);
    expect(await settleReferralActivations(h.db, { now: T0, inviterAccountId: alice.accountId })).toBe(0); // bob not active yet
    for (let d = 0; d < 3; d++) await recordPlayDay(h.db, bob.accountId, new Date(T0.getTime() + d * DAY));
    await makeSeller(h.db, bob.accountId, bob.stableId); // 20 settled runs, all Story: no longer enough
    expect(await settleReferralActivations(h.db, { now: T0, inviterAccountId: alice.accountId })).toBe(0);
    await liveRuns(5, bob.stableId); // 5 Live races activate
    expect(await settleReferralActivations(h.db, { now: T0, inviterAccountId: alice.accountId })).toBe(1);
    expect(await settleReferralActivations(h.db, { now: T0, inviterAccountId: alice.accountId })).toBe(0);
    expect((await getBalance(h.db, alice.accountId)) - before).toBe(DEFAULT_AFFILIATE_CONFIG.activeReward.credits);
    const badges = await h.db.select().from(achievements).where(eq(achievements.accountId, alice.accountId));
    expect(badges.map((b) => b.code)).toContain("referrer");
  });

  it("a linked inviter/invitee pair gets no activation reward, and one fraud flag", async () => {
    const { alice, bob } = await tree();
    for (let d = 0; d < 3; d++) await recordPlayDay(h.db, bob.accountId, new Date(T0.getTime() + d * DAY));
    await liveRuns(5, bob.stableId);
    await recordAccountSignal(h.db, { accountId: bob.accountId, kind: "device", value: "dev-alt" });
    await recordAccountSignal(h.db, { accountId: alice.accountId, kind: "device", value: "dev-alt" });
    const before = await getBalance(h.db, alice.accountId);
    expect(await settleReferralActivations(h.db, { now: T0, inviterAccountId: alice.accountId })).toBe(0);
    expect(await settleReferralActivations(h.db, { now: T0, inviterAccountId: alice.accountId })).toBe(0); // idempotent: no second flag
    expect(await getBalance(h.db, alice.accountId)).toBe(before);
    const flags = await h.db
      .select()
      .from(fraudEvents)
      .where(and(eq(fraudEvents.accountId, bob.accountId), eq(fraudEvents.relatedAccountId, alice.accountId), eq(fraudEvents.kind, "referral_linked")));
    expect(flags).toHaveLength(1);
    const [r] = await h.db.select().from(referrals).where(eq(referrals.accountId, bob.accountId));
    expect(r!.activatedAt).toBeNull(); // stays pending: the flag is reviewed, the reward is simply not granted
  });

  it("the activation scan never starves: it pages past invitees who never became active", async () => {
    const { alice } = await tree();
    const aliceCode = (await ensureReferralCode(h.db, alice.accountId)).toLowerCase();
    // 250 invitees who never play (pending forever), then ONE eligible invitee behind them.
    for (let i = 0; i < 250; i++) {
      const b = await newPlayer(h.db);
      await recordReferral(h.db, { accountId: b.accountId, code: aliceCode, now: at(i) });
    }
    const eligible = await newPlayer(h.db);
    await recordReferral(h.db, { accountId: eligible.accountId, code: aliceCode, now: at(400) });
    for (let d = 0; d < 3; d++) await recordPlayDay(h.db, eligible.accountId, new Date(T0.getTime() + d * DAY));
    await liveRuns(5, eligible.stableId);
    const before = await getBalance(h.db, alice.accountId);
    // Pages of 100: the eligible invitee sits on the third page and is paid in one pass.
    expect(await settleReferralActivations(h.db, { now: T0, inviterAccountId: alice.accountId, limit: 100 })).toBe(1);
    expect(await getBalance(h.db, alice.accountId)).toBe(before + DEFAULT_AFFILIATE_CONFIG.activeReward.credits);
    const [re] = await h.db.select().from(referrals).where(eq(referrals.accountId, eligible.accountId));
    expect(re!.activatedAt).not.toBeNull();
    // Idempotent: a second pass pays nothing.
    expect(await settleReferralActivations(h.db, { now: T0, inviterAccountId: alice.accountId, limit: 100 })).toBe(0);
  });
});

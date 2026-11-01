import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { betaRewards, horses, inviteCodes, ledgerAccounts, races, testerRewards, testers } from "../schema";
import { SLOT_KEY_PREFIX } from "../services/card";
import { createRace } from "../services/races";
import { createAccount } from "../services/accounts";
import { getBalance, ledgerHealth } from "../services/ledger";
import {
  approvedUnpaidCsv,
  awardBetaReward,
  budgetSummary,
  checkInvite,
  generateInviteCodes,
  linkTester,
  listTesters,
  playtestConfig,
  playtestMetrics,
  redeemInvite,
  resetPlaytest,
  setBetaRewardStatus,
  setTesterWallet,
  submitFeedback,
  testerBetaProgress,
  testerForAccount,
  track,
  updateFeedback,
  type TelemetryEvent,
  FEEDBACK_PER_HOUR,
  MISS_IT_AFTER_DAYS,
  MISS_IT_RATINGS,
  missItDue,
  RESET_CONFIRMATION,
} from "../services/playtest";
import { at, DAY, memoryDb, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const silks = { primary: "#112233", secondary: "#445566", pattern: "solid", cap: "#778899" };

async function join(code: string, name: string, cap = 60, now = T0) {
  const r = await redeemInvite(h.db, { code, cap, now });
  const acc = await createAccount(h.db, { stableName: name, silks, starterHorses: 3, now });
  await linkTester(h.db, { testerId: r.testerId, accountId: acc.accountId, stableName: name, now });
  await track(h.db, { accountId: acc.accountId, name: "signup", now });
  return { ...acc, testerId: r.testerId, rejoin: r.rejoin };
}

const fb = (accountId: string | null, message = "The start gate looks odd") => ({
  accountId,
  stableId: null,
  anonKey: "1.2.3.4",
  category: "bug" as const,
  rating: 4,
  message,
  route: "/race/x",
  viewport: "390x844",
  userAgent: "test",
  clientErrors: ["TypeError: x"],
});

describe("playtest", () => {
  it("config reads env", () => {
    expect(playtestConfig({})).toEqual({ enabled: false, testerCap: 60 });
    expect(playtestConfig({ PLAYTEST_MODE: "1", PLAYTEST_TESTER_CAP: "2" })).toEqual({ enabled: true, testerCap: 2 });
  });

  it("invite codes: single use, tester cap, case-insensitive, exclusive-item record", async () => {
    const codes = await generateInviteCodes(h.db, { count: 3 });
    expect(new Set(codes).size).toBe(3);
    expect(codes[0]).toMatch(/^TB-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await checkInvite(h.db, "nope", 60)).toEqual({ ok: false, problem: "INVALID" });
    const a = await join(codes[0]!.toLowerCase(), "QA Tester A");
    expect(a.rejoin).toBe(false);
    expect(await checkInvite(h.db, codes[0]!, 60)).toEqual({ ok: false, problem: "USED" });
    await expect(redeemInvite(h.db, { code: codes[0]!, cap: 60 })).rejects.toMatchObject({ details: { invite: "USED" } });
    // Cap: one tester exists; a cap of 1 refuses the next code.
    await expect(redeemInvite(h.db, { code: codes[1]!, cap: 1 })).rejects.toMatchObject({ details: { invite: "FULL" } });
    const [perk] = await h.db.select().from(testerRewards).where(eq(testerRewards.testerId, a.testerId));
    expect(perk?.kind).toBe("playtest_founder");
    // Concurrent redemptions of one code: exactly one wins.
    const res = await Promise.allSettled([redeemInvite(h.db, { code: codes[2]!, cap: 60 }), redeemInvite(h.db, { code: codes[2]!, cap: 60 })]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [row] = await h.db.select().from(inviteCodes).where(eq(inviteCodes.code, codes[2]!));
    expect(row?.uses).toBe(1);
  });

  it("wallet address: EVM format only, testers only", async () => {
    const [code] = await generateInviteCodes(h.db, { count: 1 });
    const t = await join(code!, "QA Tester W");
    await expect(setTesterWallet(h.db, { accountId: t.accountId, address: "0x123" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const ok = await setTesterWallet(h.db, { accountId: t.accountId, address: "0x52908400098527886E0F7030069857D2E4169EE7" });
    expect(ok.walletAddress).toBe("0x52908400098527886E0F7030069857D2E4169EE7");
    const outsider = await createAccount(h.db, { stableName: "Not a tester", silks, starterHorses: 0, now: T0 });
    await expect(setTesterWallet(h.db, { accountId: outsider.accountId, address: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("feedback: validated, rate limited, accept-as-bug creates the bounty once", async () => {
    const [code] = await generateInviteCodes(h.db, { count: 1 });
    const t = await join(code!, "QA Tester F");
    await expect(submitFeedback(h.db, { ...fb(t.accountId), message: "  " })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const first = await submitFeedback(h.db, { ...fb(t.accountId), now: T0 });
    expect(first.testerId).toBe(t.testerId);
    for (let i = 1; i < FEEDBACK_PER_HOUR; i++) await submitFeedback(h.db, { ...fb(t.accountId), now: T0 });
    await expect(submitFeedback(h.db, { ...fb(t.accountId), now: T0 })).rejects.toMatchObject({ details: { rateLimited: true } });
    // An hour later it's fine again; anonymous senders are limited separately.
    await submitFeedback(h.db, { ...fb(t.accountId), now: at(61 * 60_000) });
    await submitFeedback(h.db, { ...fb(null), now: T0 });

    await updateFeedback(h.db, { id: first.id, acceptBug: true, status: "resolved" });
    await updateFeedback(h.db, { id: first.id, acceptBug: true });
    const bounties = await h.db.select().from(betaRewards).where(eq(betaRewards.testerId, t.testerId));
    expect(bounties).toHaveLength(1);
    expect(bounties[0]).toMatchObject({ ruleKey: "bug_bounty", status: "pending", amountUsdCents: 500 });
    expect(await testerBetaProgress(h.db, { testerId: t.testerId })).toMatchObject({ acceptedBugs: 1, feedbackSent: FEEDBACK_PER_HOUR + 1 });
  });

  it("fallback payout ledger: unique per period, approve -> paid with a tx hash, CSV, budget", async () => {
    const [tester] = await h.db.select().from(testers).where(eq(testers.stableName, "QA Tester W"));
    await awardBetaReward(h.db, { testerId: tester!.id, ruleKey: "best_feedback", period: "week-1" });
    await awardBetaReward(h.db, { testerId: tester!.id, ruleKey: "best_feedback", period: "week-1" });
    const rows = await h.db.select().from(betaRewards).where(eq(betaRewards.testerId, tester!.id));
    expect(rows).toHaveLength(1);
    const id = rows[0]!.id;
    await expect(setBetaRewardStatus(h.db, { id, action: "paid", txHash: `0x${"a".repeat(64)}` })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await setBetaRewardStatus(h.db, { id, action: "approve" });
    const csv = await approvedUnpaidCsv(h.db);
    expect(csv).toContain("0x52908400098527886E0F7030069857D2E4169EE7");
    expect(csv).toContain('"10.00"');
    await expect(setBetaRewardStatus(h.db, { id, action: "paid", txHash: "0xabc" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await setBetaRewardStatus(h.db, { id, action: "paid", txHash: `0x${"a".repeat(64)}` });
    await expect(setBetaRewardStatus(h.db, { id, action: "void" })).rejects.toMatchObject({ code: "PERMANENT_STATE" });
    const b = await budgetSummary(h.db, 1000);
    expect(b.paidCents).toBe(1000);
    expect(b.over).toBe(true); // 1000 paid + 500 pending bounty > $10
  });

  it("telemetry metrics: actives, funnel, retention", async () => {
    const [code] = await generateInviteCodes(h.db, { count: 1 });
    const t = await join(code!, "QA Tester M", 60, T0);
    await track(h.db, { accountId: t.accountId, name: "session_start", now: T0 });
    await track(h.db, { accountId: t.accountId, name: "race_entered", props: { kind: "story", junk: { x: 1 } }, now: T0 });
    await track(h.db, { accountId: t.accountId, name: "session_start", now: at(DAY) });
    const m = await playtestMetrics(h.db, { now: at(DAY), days: 3 });
    expect(m.funnel.signups).toBeGreaterThanOrEqual(1);
    expect(m.funnel.firstRace).toBeGreaterThanOrEqual(1);
    expect(m.funnel.secondSession).toBeGreaterThanOrEqual(1);
    expect(m.retention.day1).not.toBeNull();
    const today = m.days.find((d) => d.day === "2026-11-02");
    expect(today?.racesByKind.story).toBeGreaterThanOrEqual(1);
    const list = await listTesters(h.db);
    expect(list.find((x) => x.stableName === "QA Tester M")?.daysPlayed).toBe(2);
  });

  it("reset wipes game progress, keeps testers, wallets, codes and rewards, and is idempotent", async () => {
    const before = await h.db.select().from(testers);
    const rewardsBefore = await h.db.select().from(betaRewards);
    await expect(resetPlaytest(h.db, { confirm: "yes" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const r1 = await resetPlaytest(h.db, { confirm: RESET_CONFIRMATION });
    expect(r1.testersUnlinked).toBe(before.filter((t) => t.accountId).length);
    const r2 = await resetPlaytest(h.db, { confirm: RESET_CONFIRMATION });
    expect(r2.testersUnlinked).toBe(0);
    expect((await h.db.execute(sql`select count(*)::int as n from horses`)) as unknown).toBeDefined();
    expect(await h.db.select().from(horses)).toHaveLength(0);
    const after = await h.db.select().from(testers);
    expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
    expect(after.find((t) => t.stableName === "QA Tester W")?.walletAddress).toBe("0x52908400098527886E0F7030069857D2E4169EE7");
    expect(await h.db.select().from(betaRewards)).toHaveLength(rewardsBefore.length);
    expect((await h.db.select().from(ledgerAccounts)).map((a) => a.kind).sort()).toEqual(["burn", "escrow", "mint", "treasury"]);
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);

    // A tester re-joins with the same code and keeps their tester record and wallet.
    const w = after.find((t) => t.stableName === "QA Tester W")!;
    const again = await join(w.inviteCode, "QA Tester W2");
    expect(again.rejoin).toBe(true);
    expect(again.testerId).toBe(w.id);
    expect((await testerForAccount(h.db, again.accountId))?.walletAddress).toBe(w.walletAddress);
    expect(await getBalance(h.db, again.accountId)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Beta dashboard metrics on a clean database: time to first race, the 6-step funnel,
// live share, races per active day, and race_perf device/GPU reports.
// ---------------------------------------------------------------------------

describe("beta metrics", () => {
  let h2: DbHandle;
  beforeAll(async () => {
    h2 = await memoryDb();
  });
  afterAll(async () => {
    await h2.close();
  });

  it("empty telemetry: nulls, not zeroes or NaN", async () => {
    const m = await playtestMetrics(h2.db, { now: at(2 * DAY), days: 3 });
    expect(m.firstRace).toEqual({ medianSec: null, under60Pct: null, n: 0 });
    expect(m.racesPerActive).toBeNull();
    expect(m.liveShare).toBeNull();
  });

  it("median time to first race, under-60 share, the 6-step funnel, races per active and live share", async () => {
    const A = randomUUID();
    const B = randomUUID();
    const C = randomUUID();
    const t = (accountId: string, name: TelemetryEvent, props?: Record<string, unknown>, now = T0) => track(h2.db, { accountId, name, props, now });
    // A: fast first race (45 s), watched, went live, came back the next UTC day.
    await t(A, "signup");
    await t(A, "session_start");
    await t(A, "race_entered", { kind: "story" }, at(45_000));
    await t(A, "race_watched", undefined, at(50_000));
    await t(A, "race_entered", { kind: "live" }, at(90_000));
    await t(A, "session_start", undefined, at(DAY));
    // B: slow first race (120 s), live only, never came back.
    await t(B, "signup");
    await t(B, "race_entered", { kind: "live" }, at(120_000));
    // C: signed up on day 2 and never raced.
    await t(C, "signup", undefined, at(DAY));
    await t(C, "session_start", undefined, at(DAY));

    const m = await playtestMetrics(h2.db, { now: at(2 * DAY), days: 3 });
    // Median of [45, 120] s; A is 1 of 3 signups under 60 s.
    expect(m.firstRace).toEqual({ medianSec: 82.5, under60Pct: 33.3, n: 2 });
    expect(m.funnel).toEqual({ signups: 3, firstRace: 2, raceWatched: 1, liveRace: 2, secondSession: 1, nextDay: 1 });
    // 3 races over 4 active-days (A+B on day 1, A+C on day 2): 0.8; 2 of 3 races were Live.
    expect(m.racesPerActive).toBe(0.8);
    expect(m.liveShare).toBe(66.7);
    const day1 = m.days.find((d) => d.day === "2026-11-02")!;
    expect(day1).toMatchObject({ actives: 2, races: 3 });
    expect(day1.racesByKind).toEqual({ live: 2, story: 1 });
  });

  it("perf reports: per-device medians, on-target share and the slow-GPU threshold", async () => {
    const report = (gpu: string, device: "phone" | "desktop", fps: number, fpsLow: number, downgraded: boolean, now = T0) =>
      track(h2.db, { accountId: null, name: "race_perf", props: { fps, fpsLow, downgraded, device, gpu }, now });
    // Phone: Adreno (3 reports, two downgrades) + Mali (1 report).
    await report("Adreno 640", "phone", 20, 10, true);
    await report("Adreno 640", "phone", 30, 20, true);
    await report("Adreno 640", "phone", 40, 30, false);
    await report("Mali G78", "phone", 50, 40, false);
    // Desktop: 2 reports, one below the 60 fps target.
    await report("Apple M2", "desktop", 55, 40, false);
    await report("Apple M2", "desktop", 65, 50, false);

    const m = await playtestMetrics(h2.db, { now: at(2 * DAY), days: 3 });
    expect(m.perf.byDevice).toEqual([
      // Phone: fps [20,30,40,50] -> median 35, low [10,20,30,40] -> 25; 3 of 4 at/over 30; 2 of 4 downgraded.
      { device: "phone", reports: 4, medianFps: 35, lowFps: 25, onTargetPct: 75, downgradedPct: 50 },
      // Desktop: median (55+65)/2 = 60, low (40+50)/2 = 45; only the 65 fps report holds 60.
      { device: "desktop", reports: 2, medianFps: 60, lowFps: 45, onTargetPct: 50, downgradedPct: 0 },
    ]);
    // Only Adreno clears the >= 3 reports bar (Mali 1, Apple M2 2).
    expect(m.perf.slowGpus).toEqual([{ gpu: "Adreno 640", reports: 3, medianFps: 30 }]);
  });
});

describe("beta metrics: breeding participation and the exit question", () => {
  it("asks a tester from day 7, once; counts the answers and breeding by testers", async () => {
    const [code] = await generateInviteCodes(h.db, { count: 1, maxUses: 5, note: "miss-it" });
    const t = await join(code!, "Miss It Stable");
    expect(await missItDue(h.db, { accountId: t.accountId, now: at(6 * DAY) })).toBe(false);
    expect(await missItDue(h.db, { accountId: t.accountId, now: at(MISS_IT_AFTER_DAYS * DAY + 60_000) })).toBe(true);
    await submitFeedback(h.db, { ...fb(t.accountId, "My filly won the Cup"), category: "miss_it", rating: MISS_IT_RATINGS.very, now: at(8 * DAY) });
    expect(await missItDue(h.db, { accountId: t.accountId, now: at(9 * DAY) })).toBe(false);
    // Not a tester: never asked.
    const plain = await createAccount(h.db, { stableName: "Plain Stable", silks, now: T0 });
    expect(await missItDue(h.db, { accountId: plain.accountId, now: at(30 * DAY) })).toBe(false);
    // A foal bred by the tester's stable (origin "bred") that has raced.
    const [mare] = await h.db.select({ id: horses.id }).from(horses).where(eq(horses.ownerStableId, t.stableId)).limit(2);
    expect(mare).toBeDefined();
    const m = await playtestMetrics(h.db, { now: at(9 * DAY) });
    expect(m.missIt.responses).toBeGreaterThanOrEqual(1);
    expect(m.missIt.very).toBeGreaterThanOrEqual(1);
    expect(m.missIt.recent[0]).toMatchObject({ rating: 3, message: "My filly won the Cup" });
    expect(m.breeding.testers).toBeGreaterThanOrEqual(1);
    expect(m.breeding.bred).toBe(0);
    await h.db.update(horses).set({ origin: "bred", starts: 1 }).where(eq(horses.id, mare!.id));
    const m2 = await playtestMetrics(h.db, { now: at(9 * DAY) });
    expect(m2.breeding.foalsBorn).toBeGreaterThanOrEqual(1);
    expect(m2.breeding.foalsRaced).toBeGreaterThanOrEqual(1);
  });
});

describe("beta metrics: real players per Live race", () => {
  it("averages player runners over the Live races run in the last 7 days and counts the ones folded empty", async () => {
    const h3 = await memoryDb();
    try {
      const now = at(20 * DAY);
      const mk = (k: number, postTime: Date) =>
        createRace(h3.db, { kind: "scheduled", name: `Live ${k}`, raceClass: "maiden", conditions: {}, postTime, entriesCloseAt: new Date(postTime.getTime() - 30_000), slotKey: `${SLOT_KEY_PREFIX}${900_000 + k}` });
      const runners = (players: number, house: number) => [
        ...Array.from({ length: players }, (_, i) => ({ gate: i + 1, horseId: randomUUID(), isHouse: false, stableId: randomUUID(), tactic: "front" })),
        ...Array.from({ length: house }, (_, i) => ({ gate: players + i + 1, horseId: randomUUID(), isHouse: true, stableId: null, tactic: "front" })),
      ];
      const run = async (k: number, players: number, house: number, postTime = new Date(now.getTime() - DAY)) => {
        const r = await mk(k, postTime);
        await h3.db.update(races).set({ status: "settled", field: { raceId: r.id, runners: runners(players, house) } }).where(eq(races.id, r.id));
      };
      await run(1, 3, 5);
      await run(2, 1, 7);
      await run(3, 5, 0, new Date(now.getTime() - 9 * DAY)); // older than a week: not counted
      const off = await mk(4, new Date(now.getTime() - 2 * DAY));
      await h3.db.update(races).set({ status: "cancelled" }).where(eq(races.id, off.id));
      await mk(5, new Date(now.getTime() + DAY)); // still to run
      const m = await playtestMetrics(h3.db, { now });
      expect(m.livePlayers).toEqual({ racesRun: 2, playersPerRace: 2, folded: 1, foldedPct: 33.3 });
    } finally {
      await h3.close();
    }
  });
});

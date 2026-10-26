import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { betaRewards, horses, inviteCodes, ledgerAccounts, testerRewards, testers } from "../schema";
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
  FEEDBACK_PER_HOUR,
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

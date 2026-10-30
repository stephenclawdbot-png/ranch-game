import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ACTIVE_PLAYER,
  BASE_STALLS,
  DAILY_GOAL_CREDITS,
  DAILY_GOALS_PER_DAY,
  MAX_STALLS,
  appraise,
  insurancePayout,
  insurancePremium,
  listBlock,
  listingCeiling,
  listingFloor,
  marketFee,
  promoteFromNursery,
  stallsFree,
  storyReward,
  tradeBlock,
  weeklyFlow,
  START_FACILITIES,
  STORY_CHAPTER_CAP,
  STORY_FIRST_WIN_REWARD,
} from "./economy";
import { bankCap, canRefill, dailyAllowance, entryCost, grantFor, refill, refundEntries, spendEntries, NEW_ENTRY_BANK, ENTRY_BANK_MAX, ENTRY_DAILY_MAX } from "./entries";
import { DAY, T0, makeHorse } from "./test-helpers";

describe("weekly faucet/sink balance (active player)", () => {
  it("spend ≈ earn (ratio 0.85–1.15) inside the Live entry budget (10–15/day)", () => {
    const f = weeklyFlow(ACTIVE_PLAYER);
    expect(f.ratioPermille).toBeGreaterThanOrEqual(850);
    expect(f.ratioPermille).toBeLessThanOrEqual(1150);
    expect(f.entriesPerDay).toBeGreaterThanOrEqual(10);
    expect(f.entriesPerDay).toBeLessThanOrEqual(15);
  });
  it("no time-based fees: an idle week costs nothing", () => {
    const idle = weeklyFlow({ ...ACTIVE_PLAYER, startsByTier: {}, storyFirstWinsPerWeek: 0, storyReplaysPerWeek: 0, dailyGoalsPerWeek: 0, dailyCupsPerWeek: 0, trainingSessionsPerWeek: 0, vetTreatmentsPerWeek: 0, coveringsPerWeek: 0, paddockBuysPerWeek: 0, scansPerWeek: 0, entryRefillsPerWeek: 0, insurancePerWeek: 0, facilitySpendPerWeek: 0 });
    expect(idle.spent).toBe(0);
    expect(idle.earned).toBe(0);
  });
  it("three daily goals at 45 credits each (owner decisions 2026-10-26: 3 × 60; 2026-10-30: trimmed to 3 × 45)", () => {
    expect(DAILY_GOALS_PER_DAY).toBe(3);
    expect(DAILY_GOAL_CREDITS).toBe(45);
    const f = weeklyFlow({ ...ACTIVE_PLAYER, dailyGoalsPerWeek: DAILY_GOALS_PER_DAY * 7 });
    expect(f.faucets.dailyGoals).toBe(3 * 7 * DAILY_GOAL_CREDITS);
  });
});

describe("story rewards", () => {
  it("full reward on the first win, minimal on replays, capped per chapter", () => {
    expect(storyReward({ chapter: "club", won: true, alreadyWon: false, chapterEarned: 0 })).toBe(STORY_FIRST_WIN_REWARD.club);
    expect(storyReward({ chapter: "club", won: true, alreadyWon: true, chapterEarned: 0 })).toBeLessThanOrEqual(20);
    expect(storyReward({ chapter: "club", won: false, alreadyWon: false, chapterEarned: 0 })).toBeLessThanOrEqual(20);
    expect(storyReward({ chapter: "club", won: true, alreadyWon: false, chapterEarned: STORY_CHAPTER_CAP.club - 5 })).toBe(5);
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.boolean(), fc.boolean()), { maxLength: 500 }), (runs) => {
        let earned = 0;
        for (const [won, already] of runs) earned += storyReward({ chapter: "county", won, alreadyWon: already, chapterEarned: earned });
        expect(earned).toBeLessThanOrEqual(STORY_CHAPTER_CAP.county);
      }),
    );
  });
});

describe("stable entries (§4f)", () => {
  it("grants +10 per local day lazily and idempotently, rolling over to the bank cap", () => {
    let b = grantFor(NEW_ENTRY_BANK, 100);
    expect(b.balance).toBe(10);
    expect(grantFor(b, 100)).toBe(b);
    expect(grantFor(b, 99)).toBe(b);
    b = grantFor(b, 101);
    expect(b.balance).toBe(20);
    b = grantFor(b, 110);
    expect(b.balance).toBe(20);
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 })), { maxLength: 80 }), fc.integer({ min: 0, max: 5 }), (steps, tier) => {
        let bank = { ...NEW_ENTRY_BANK, tier };
        let day = 0;
        for (const [gap, spend] of steps) {
          day += gap;
          bank = grantFor(bank, day);
          bank = spendEntries(bank, spend) ?? bank;
          bank = refill(bank, day) ?? bank;
          expect(bank.balance).toBeGreaterThanOrEqual(0);
          expect(bank.balance).toBeLessThanOrEqual(bankCap(tier) + 5);
        }
      }),
    );
  });
  it("costs: 1 Live, 2 Feature/Graded, 0 Story and Daily Cup; refill once a day below 5", () => {
    expect(entryCost({ tier: "maiden", kind: "regular" })).toBe(1);
    expect(entryCost({ tier: "g3", kind: "regular" })).toBe(2);
    expect(entryCost({ tier: "g1", kind: "weekend_feature" })).toBe(2);
    expect(entryCost({ tier: "daily_cup", kind: "daily_cup" })).toBe(0);
    expect(entryCost("story")).toBe(0);
    const low = { ...NEW_ENTRY_BANK, balance: 3, lastGrantDay: 5 };
    expect(canRefill(low, 5)).toBe(true);
    const r = refill(low, 5)!;
    expect(r.balance).toBe(8);
    expect(refill({ ...r, balance: 2 }, 5)).toBeNull();
    expect(canRefill({ ...low, balance: 5 }, 6)).toBe(false);
    expect(spendEntries({ ...low, balance: 1 }, 2)).toBeNull();
    expect(refundEntries({ ...low, balance: 1 }, 2).balance).toBe(3);
    expect(dailyAllowance(99)).toBe(ENTRY_DAILY_MAX);
    expect(bankCap(99)).toBe(ENTRY_BANK_MAX);
  });
});

describe("stalls, appraisal and the market", () => {
  it("stall cap and nursery promotion", () => {
    const hs = Array.from({ length: 7 }, (_, i) => makeHorse(`s${i}`, { id: `s${i}` }));
    const withNursery = [...hs.slice(0, 5), { ...hs[5]!, location: "nursery" as const }, { ...hs[6]!, location: "legacy_farm" as const }];
    expect(stallsFree(withNursery, START_FACILITIES)).toBe(BASE_STALLS - 5);
    const promoted = promoteFromNursery(withNursery, START_FACILITIES);
    expect(promoted.filter((h) => h.location === "nursery").length).toBe(0);
    expect(stallsFree(hs, { ...START_FACILITIES, stalls: 100 })).toBe(MAX_STALLS - 7);
  });
  it("appraisal uses only visible information, rewards record and remaining breedings", () => {
    const h = makeHorse("ap", { starts: 10 });
    const better = { ...h, record: { ...h.record, wins: 5, earnings: 5000 }, rating: { ...h.rating, peakOr: 80 } };
    expect(appraise(better)).toBeGreaterThan(appraise(h));
    const spent = { ...h, breeding: { used: 4, bySeason: [] } };
    expect(appraise(spent)).toBeLessThan(appraise(h));
    expect(listingFloor(h)).toBe(Math.ceil(appraise(h) * 0.7));
    expect(listingCeiling(h)).toBe(Math.floor(appraise(h) * 3));
    expect(insurancePremium(h)).toBeLessThan(insurancePayout(h));
    expect(marketFee(1000)).toBe(50);
  });
  it("sell requirements, bindings and linked accounts", () => {
    const seller = { createdAtMs: T0 - 8 * DAY, racesRun: 25, emailVerified: true };
    const h = makeHorse("m", { starts: 6 });
    const price = appraise(h);
    const flags = { enteredInRace: false, locked: false };
    expect(listBlock(h, seller, price, T0, flags)).toBeNull();
    expect(listBlock(h, { ...seller, createdAtMs: T0 - 2 * DAY }, price, T0, flags)).toBe("account_too_new");
    expect(listBlock(h, { ...seller, racesRun: 5 }, price, T0, flags)).toBe("not_enough_races");
    expect(listBlock(h, { ...seller, emailVerified: false }, price, T0, flags)).toBe("email_unverified");
    expect(listBlock({ ...h, binding: "club_bred" }, seller, price, T0, flags)).toBe("club_bred");
    expect(listBlock({ ...h, binding: "until_5_starts", record: { ...h.record, starts: 4 } }, seller, price, T0, flags)).toBe("bound_until_5_starts");
    expect(listBlock({ ...h, binding: "until_5_starts", record: { ...h.record, starts: 5 } }, seller, price, T0, flags)).toBeNull();
    expect(listBlock(h, seller, Math.floor(price * 0.5), T0, flags)).toBe("below_floor");
    expect(listBlock(h, seller, price * 3, T0, flags)).toBeNull();
    expect(listBlock(h, seller, price * 3 + 1, T0, flags)).toBe("above_ceiling");
    expect(listBlock(h, seller, price, T0, { ...flags, enteredInRace: true })).toBe("entered_in_race");
    expect(tradeBlock("a", "b", { linked: [["b", "a"]] })).toBe("linked_accounts");
    expect(tradeBlock("a", "a", { linked: [] })).toBe("self_trade");
    expect(tradeBlock("a", "c", { linked: [["b", "a"]] })).toBeNull();
  });
});

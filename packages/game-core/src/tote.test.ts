import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  TOTE_MAX_STAKE_PER_DAY,
  TOTE_MAX_STAKE_PER_RACE,
  TOTE_MIN_STAKE,
  TOTE_TAKEOUT_PERMILLE,
  TOTE_USDG_UNIT,
  formatToteAmount,
  formatToteOdds,
  settleTotePool,
  toteDayAllowance,
  toteExclusionEnd,
  totePlaces,
  totePoolView,
  toteRaceAllowance,
  toteReturnIfPlaced,
  toteSettlementBalanced,
  toteStakeProblem,
  toteTakeout,
  toteUsdgEnabledFrom,
  type ToteBetIn,
  type ToteFinisher,
} from "./tote";

const field = (n: number): ToteFinisher[] => Array.from({ length: n }, (_, i) => ({ horseId: `h${i + 1}`, position: i + 1 }));
const bet = (id: string, horseId: string, stake: number): ToteBetIn => ({ id, horseId, stake });
const paid = (s: ReturnType<typeof settleTotePool>, id: string) => s.payouts.find((p) => p.betId === id)?.amount ?? 0;

describe("tote knobs", () => {
  it("takes 15 % and has the agreed limits", () => {
    expect(TOTE_TAKEOUT_PERMILLE).toBe(150);
    expect(TOTE_MIN_STAKE).toEqual({ CR: 10, TUSDG: TOTE_USDG_UNIT / 2 });
    expect(TOTE_MAX_STAKE_PER_RACE).toEqual({ CR: 1000, TUSDG: 10 * TOTE_USDG_UNIT });
    expect(TOTE_MAX_STAKE_PER_DAY).toEqual({ CR: 5000, TUSDG: 50 * TOTE_USDG_UNIT });
    expect(toteTakeout(1000)).toBe(150);
    expect(toteTakeout(99)).toBe(14);
  });

  it("place terms: 3 from 8 runners, 2 from 5 to 7, none below 5", () => {
    expect([3, 4, 5, 7, 8, 12].map(totePlaces)).toEqual([0, 0, 2, 2, 3, 3]);
  });

  it("T-USDG only in practice mode", () => {
    expect(toteUsdgEnabledFrom({ USDG_MODE: "practice" })).toBe(true);
    for (const m of ["live", "mock", "off", "", undefined, "PRACTICE"]) expect(toteUsdgEnabledFrom({ USDG_MODE: m })).toBe(false);
  });
});

describe("live odds", () => {
  it("odds = pool x (1 - take) / stake on the runner", () => {
    const v = totePoolView("win", ["h1", "h2", "h3"], new Map([["h1", 300], ["h2", 100]]), 8);
    expect(v.total).toBe(400);
    expect(v.takeout).toBe(60);
    expect(v.net).toBe(340);
    expect(v.runners.map((r) => r.oddsMilli)).toEqual([1133, 3400, null]);
    expect(v.runners.map((r) => r.sharePermille)).toEqual([750, 250, 0]);
    expect(formatToteOdds(3400)).toBe("3.40");
    expect(formatToteOdds(null)).toBe("–");
  });

  it("place odds divide by the paying places", () => {
    const v = totePoolView("place", ["h1", "h2"], new Map([["h1", 100], ["h2", 100]]), 8);
    expect(v.places).toBe(3);
    expect(v.runners[0]!.oddsMilli).toBe(Math.floor((170 * 1000) / 300));
  });

  it("the bet slip's return counts the new bet in the pool", () => {
    // pool 400 + 100 on h2: net 425, h2 has 200 -> 100 returns 212
    expect(toteReturnIfPlaced("win", new Map([["h1", 300], ["h2", 100]]), "h2", 100, 8)).toBe(212);
    expect(toteReturnIfPlaced("place", new Map(), "h1", 100, 4)).toBe(0);
  });
});

describe("settleTotePool", () => {
  it("a single winner takes the net pool pro rata, rounding to the house", () => {
    const s = settleTotePool("win", [bet("a", "h1", 100), bet("b", "h1", 33), bet("c", "h2", 200), bet("d", "h3", 17)], field(8));
    expect(s.total).toBe(350);
    expect(s.takeout).toBe(52);
    expect(s.net).toBe(298);
    expect(paid(s, "a")).toBe(Math.floor((298 * 100) / 133));
    expect(paid(s, "b")).toBe(Math.floor((298 * 33) / 133));
    expect(paid(s, "c")).toBe(0);
    expect(s.winningTickets).toBe(2);
    expect(s.dividends).toEqual([{ horseId: "h1", position: 1, stake: 133, amount: 298, perUnitMilli: 2240 }]);
    expect(toteSettlementBalanced(s)).toBe(true);
    expect(s.remainder).toBe(298 - paid(s, "a") - paid(s, "b"));
  });

  it("dead heat for first: each dead-heated runner shares half the net pool", () => {
    const fin = field(8).map((f) => (f.horseId === "h2" ? { ...f, position: 1 } : f));
    const s = settleTotePool("win", [bet("a", "h1", 100), bet("b", "h2", 300), bet("c", "h3", 600)], fin);
    expect(s.net).toBe(850);
    expect(paid(s, "a")).toBe(425);
    expect(paid(s, "b")).toBe(425);
    expect(s.dividends.map((d) => d.perUnitMilli)).toEqual([4250, 1416]);
    expect(toteSettlementBalanced(s)).toBe(true);
  });

  it("dead heat for the last place splits that place", () => {
    // 8 runners, places 1..3; h3 and h4 dead-heat for third.
    const fin = field(8).map((f) => (f.horseId === "h4" ? { ...f, position: 3 } : f));
    const s = settleTotePool("place", [bet("a", "h1", 100), bet("b", "h2", 100), bet("c", "h3", 100), bet("d", "h4", 100), bet("e", "h5", 600)], fin);
    expect(s.net).toBe(850);
    const third = Math.floor(850 / 3);
    expect(paid(s, "a")).toBe(third);
    expect(paid(s, "b")).toBe(third);
    expect(paid(s, "c")).toBe(Math.floor(850 / 6));
    expect(paid(s, "d")).toBe(Math.floor(850 / 6));
    expect(toteSettlementBalanced(s)).toBe(true);
  });

  it("an unbacked placed runner's part goes to the other placed runners", () => {
    const s = settleTotePool("place", [bet("a", "h1", 100), bet("b", "h2", 100), bet("c", "h7", 300)], field(8));
    expect(paid(s, "a")).toBe(212);
    expect(paid(s, "b")).toBe(212);
    expect(toteSettlementBalanced(s)).toBe(true);
  });

  it("nobody backed the winner: the net pool goes back to every staker", () => {
    const s = settleTotePool("win", [bet("a", "h2", 100), bet("b", "h3", 300)], field(6));
    expect(s.outcome).toBe("no_winner");
    expect(s.net).toBe(340);
    expect(paid(s, "a")).toBe(85);
    expect(paid(s, "b")).toBe(255);
    expect(toteSettlementBalanced(s)).toBe(true);
  });

  it("non-runners are refunded in full and kept out of the pool", () => {
    const s = settleTotePool("win", [bet("a", "h1", 100), bet("b", "gone", 500)], field(5));
    expect(s.refunds).toEqual([{ betId: "b", amount: 500 }]);
    expect(s.total).toBe(100);
    expect(paid(s, "a")).toBe(85);
    expect(toteSettlementBalanced(s)).toBe(true);
  });

  it("no place pool under 5 runners: every place bet refunded", () => {
    const s = settleTotePool("place", [bet("a", "h1", 100)], field(4));
    expect(s.outcome).toBe("void");
    expect(s.refunds).toEqual([{ betId: "a", amount: 100 }]);
    expect(s.total).toBe(0);
  });

  it("payouts + take + remainder = pool for any pool (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ h: fc.integer({ min: 1, max: 10 }), s: fc.integer({ min: 1, max: 100_000 }) }), { minLength: 0, maxLength: 40 }),
        fc.integer({ min: 1, max: 12 }),
        fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 12, maxLength: 12 }),
        fc.constantFrom<"win" | "place">("win", "place"),
        (raw, n, pos, kind) => {
          // positions with possible dead heats (sorted so they stay a plausible result)
          const sortedPos = pos.slice(0, n).sort((a, b) => a - b);
          const fin = Array.from({ length: n }, (_, i) => ({ horseId: `h${i + 1}`, position: Math.min(sortedPos[i]!, i + 1) }));
          const bets = raw.map((r, i) => bet(`b${String(i).padStart(3, "0")}`, `h${r.h}`, r.s));
          const s = settleTotePool(kind, bets, fin);
          const refunded = s.refunds.reduce((a, r) => a + r.amount, 0);
          const staked = bets.reduce((a, b) => a + b.stake, 0);
          expect(toteSettlementBalanced(s)).toBe(true);
          expect(s.total + refunded).toBe(staked);
          expect(s.takeout).toBe(toteTakeout(s.total));
          // no winner is paid more than the net pool
          expect(s.payouts.reduce((a, p) => a + p.amount, 0)).toBeLessThanOrEqual(s.net);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is independent of bet order", () => {
    const bets = [bet("a", "h1", 70), bet("b", "h2", 33), bet("c", "h1", 41), bet("d", "h3", 9)];
    expect(settleTotePool("place", bets, field(8))).toEqual(settleTotePool("place", [...bets].reverse(), field(8)));
  });
});

describe("limits", () => {
  it("credits: 1,000 per race or 10 % of balance, whichever is lower", () => {
    expect(toteRaceAllowance({ currency: "CR", balance: 50_000, stakedOnRace: 0 })).toBe(1000);
    expect(toteRaceAllowance({ currency: "CR", balance: 3_000, stakedOnRace: 0 })).toBe(300);
    expect(toteRaceAllowance({ currency: "CR", balance: 2_900, stakedOnRace: 100 })).toBe(200);
    expect(toteRaceAllowance({ currency: "CR", balance: 50_000, stakedOnRace: 0, own: { perRace: 50, perDay: null } })).toBe(50);
    expect(toteRaceAllowance({ currency: "TUSDG", balance: 1, stakedOnRace: 0 })).toBe(10 * TOTE_USDG_UNIT);
  });

  it("per day and the minimum", () => {
    expect(toteDayAllowance({ currency: "CR", stakedToday: 4_900 })).toBe(100);
    expect(toteDayAllowance({ currency: "CR", stakedToday: 0, own: { perRace: null, perDay: 200 } })).toBe(200);
    const base = { currency: "CR" as const, balance: 100_000, stakedOnRace: 0, stakedToday: 0 };
    expect(toteStakeProblem({ ...base, stake: 9 })).toBe("below_min");
    expect(toteStakeProblem({ ...base, stake: 10 })).toBeNull();
    expect(toteStakeProblem({ ...base, stake: 1001 })).toBe("race_limit");
    expect(toteStakeProblem({ ...base, stake: 500, stakedToday: 4_600 })).toBe("day_limit");
    expect(toteStakeProblem({ ...base, currency: "TUSDG", stake: 400_000 })).toBe("below_min");
    expect(toteStakeProblem({ ...base, currency: "TUSDG", stake: 500_000, balance: 100 })).toBe("balance");
  });

  it("self-exclusion lengths", () => {
    expect(toteExclusionEnd("24h", 0)).toBe(86_400_000);
    expect(toteExclusionEnd("30d", 0)).toBe(30 * 86_400_000);
    expect(toteExclusionEnd("permanent", 0)).toBeNull();
  });

  it("formats amounts", () => {
    expect(formatToteAmount("CR", 1250)).toBe("1,250 credits");
    expect(formatToteAmount("TUSDG", 2_500_000)).toBe("2.50 T-USDG");
  });
});

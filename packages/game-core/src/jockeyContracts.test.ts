import { describe, expect, it } from "vitest";
import {
  JOCKEY_WAGE,
  blockingPairs,
  contractEndWeek,
  jockeyMorale,
  jockeyWants,
  matchJockeys,
  nextBrokenWeeks,
  offerTermsProblem,
  offerUtility,
  rankOffersForJockey,
  stablePrestige,
  wageDue,
  windowDeadlineMs,
  windowWeekAt,
  type MatchOffer,
  type OfferFacts,
} from "./jockeyContracts";
import { Rng, seedFrom } from "./rng";
import { weekIndex, weekStartMs } from "./time";

const base: OfferFacts = { wage: 250, weeks: 8, promisedRides: 2, stableQuality: 50, prestige: 200, current: false, weeksTogether: 0, bigWinsTogether: 0 };

describe("utility per personality", () => {
  it("money-minded jockeys follow the wage", () => {
    expect(offerUtility("money", "C", { ...base, wage: 500 })).toBeGreaterThan(offerUtility("money", "C", { ...base, stableQuality: 90, prestige: 900 }));
  });
  it("ambitious jockeys follow the horses and the prestige", () => {
    expect(offerUtility("ambitious", "C", { ...base, stableQuality: 90, prestige: 800 })).toBeGreaterThan(offerUtility("ambitious", "C", { ...base, wage: 500 }));
  });
  it("loyal jockeys stay with the current stable, more so with time and big wins together", () => {
    const stay = { ...base, current: true, weeksTogether: 6, bigWinsTogether: 2 };
    expect(offerUtility("loyal", "C", stay)).toBeGreaterThan(offerUtility("loyal", "C", { ...base, wage: 450 }));
    expect(offerUtility("loyal", "C", stay)).toBeGreaterThan(offerUtility("loyal", "C", { ...stay, weeksTogether: 0, bigWinsTogether: 0 }));
    // Loyalty counts twice for a loyal jockey: the same stay is worth more to them than to a money-minded one, relative to the wage.
    const gainLoyal = offerUtility("loyal", "C", stay) - offerUtility("loyal", "C", base);
    const gainMoney = offerUtility("money", "C", stay) - offerUtility("money", "C", base);
    expect(gainLoyal).toBeGreaterThan(gainMoney * 2 - 1);
  });
  it("workhorses follow the rides promised", () => {
    expect(offerUtility("workhorse", "C", { ...base, promisedRides: 6 })).toBeGreaterThan(offerUtility("workhorse", "C", { ...base, wage: 600 }));
  });
  it("contract length preference: ambitious jockeys like short, the rest 8 weeks", () => {
    expect(offerUtility("ambitious", "C", { ...base, weeks: 4 })).toBeGreaterThan(offerUtility("ambitious", "C", { ...base, weeks: 8 }));
    expect(offerUtility("money", "C", { ...base, weeks: 8 })).toBeGreaterThan(offerUtility("money", "C", { ...base, weeks: 4 }));
  });
  it("prestige grows with tier, trophies and recent winners, capped at 1000", () => {
    expect(stablePrestige({ tier: 1, tiers: 5, trophies: 0, recentWinners: 0 })).toBe(0);
    expect(stablePrestige({ tier: 5, tiers: 5, trophies: 10, recentWinners: 20 })).toBe(1000);
    expect(stablePrestige({ tier: 3, tiers: 5, trophies: 1, recentWinners: 2 })).toBe(200 + 60 + 60);
  });
  it("wants line reflects weights and situation", () => {
    expect(jockeyWants("workhorse", "C", { wage: 250, ridesLastWeek: 0, stableQuality: 70, prestige: 600 })).toContain("more rides");
    expect(jockeyWants("ambitious", "C", { wage: 250, ridesLastWeek: 5, stableQuality: 40, prestige: 100 })).toEqual(expect.arrayContaining(["better horses", "a bigger stage"]));
    expect(jockeyWants("money", "B", { wage: 400, ridesLastWeek: 5, stableQuality: 70, prestige: 600 })).toContain("wage 600+");
  });
});

describe("contracts", () => {
  it("terms within bounds", () => {
    const fee = 1000;
    expect(offerTermsProblem({ wage: JOCKEY_WAGE.C, length: "4w", promisedRides: 2, buyout: 2000 }, "C", fee)).toBeNull();
    expect(offerTermsProblem({ wage: 10, length: "4w", promisedRides: 2, buyout: 2000 }, "C", fee)).toMatch(/wage/);
    expect(offerTermsProblem({ wage: 250, length: "4w", promisedRides: 11, buyout: 2000 }, "C", fee)).toMatch(/rides/);
    expect(offerTermsProblem({ wage: 250, length: "4w", promisedRides: 1, buyout: 50 }, "C", fee)).toMatch(/buyout/);
  });
  it("apprentice free weeks", () => {
    expect(wageDue({ wage: 100, wageFreeUntilWeek: 10 }, 9)).toBe(0);
    expect(wageDue({ wage: 100, wageFreeUntilWeek: 10 }, 10)).toBe(100);
    expect(wageDue({ wage: 100, wageFreeUntilWeek: null }, 1)).toBe(100);
  });
  it("window clock: Sunday 20:00 UTC", () => {
    const w = weekIndex(Date.UTC(2026, 10, 2, 12)); // Monday
    const d = new Date(windowDeadlineMs(w));
    expect([d.getUTCDay(), d.getUTCHours()]).toEqual([0, 20]);
    expect(windowWeekAt(windowDeadlineMs(w) - 1)).toBe(w);
    expect(windowWeekAt(windowDeadlineMs(w))).toBe(w + 1);
  });
  it("contract ends", () => {
    expect(contractEndWeek("4w", 100, [])).toBe(104);
    expect(contractEndWeek("8w", 100, [])).toBe(108);
    const seasonEnd = weekStartMs(103) + 3 * 86_400_000;
    expect(contractEndWeek("season", 100, [seasonEnd])).toBe(102);
    expect(contractEndWeek("season", 101, [seasonEnd, seasonEnd + 28 * 86_400_000])).toBe(106);
  });
  it("morale", () => {
    expect(nextBrokenWeeks(0, 3, 2)).toBe(1);
    expect(nextBrokenWeeks(1, 3, 3)).toBe(0);
    expect(jockeyMorale(nextBrokenWeeks(1, 2, 0))).toBe("wants_out");
    expect(jockeyMorale(1)).toBe("unsettled");
  });
});

function randomInstance(seed: string) {
  const r = new Rng(seedFrom("inst", seed));
  const nj = 1 + r.int(14);
  const ns = 1 + r.int(7);
  const offers: MatchOffer[] = [];
  const capacity: Record<string, number> = {};
  for (let s = 0; s < ns; s++) capacity[`s${s}`] = r.int(4);
  for (let j = 0; j < nj; j++)
    for (let s = 0; s < ns; s++)
      // Few distinct values so exact ties are common.
      if (r.chance(600)) offers.push({ jockeyId: `j${j}`, stableId: `s${s}`, utility: r.int(4), priority: r.int(3) });
  return { offers, capacity, seed };
}

describe("deferred acceptance", () => {
  it("is stable (no blocking pairs) and within capacity on random instances", () => {
    for (let i = 0; i < 400; i++) {
      const inst = randomInstance(`r${i}`);
      const m = matchJockeys(inst);
      expect(blockingPairs(inst, m)).toEqual([]);
      const per: Record<string, number> = {};
      for (const [j, s] of m) {
        per[s] = (per[s] ?? 0) + 1;
        expect(inst.offers.some((o) => o.jockeyId === j && o.stableId === s)).toBe(true);
      }
      for (const [s, n] of Object.entries(per)) expect(n).toBeLessThanOrEqual(inst.capacity[s]!);
    }
  });
  it("is deterministic whatever the input order", () => {
    for (let i = 0; i < 100; i++) {
      const inst = randomInstance(`d${i}`);
      const a = matchJockeys(inst);
      const rng = new Rng(seedFrom("shuffle", i));
      const shuffled = [...inst.offers];
      for (let k = shuffled.length - 1; k > 0; k--) {
        const x = rng.int(k + 1);
        [shuffled[k], shuffled[x]] = [shuffled[x]!, shuffled[k]!];
      }
      const b = matchJockeys({ ...inst, offers: shuffled });
      expect([...b].sort()).toEqual([...a].sort());
    }
  });
  it("is jockey-optimal on a classic instance", () => {
    const offers: MatchOffer[] = [
      { jockeyId: "a", stableId: "X", utility: 2, priority: 1 },
      { jockeyId: "a", stableId: "Y", utility: 1, priority: 2 },
      { jockeyId: "b", stableId: "X", utility: 1, priority: 2 },
      { jockeyId: "b", stableId: "Y", utility: 2, priority: 1 },
    ];
    const m = matchJockeys({ offers, capacity: { X: 1, Y: 1 }, seed: "s" });
    expect(m.get("a")).toBe("X");
    expect(m.get("b")).toBe("Y");
  });
  it("breaks exact ties by the seeded draw, reproducibly", () => {
    const offers: MatchOffer[] = [
      { jockeyId: "j", stableId: "X", utility: 5, priority: 1 },
      { jockeyId: "j", stableId: "Y", utility: 5, priority: 1 },
    ];
    const picks = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const seed = `seed${i}`;
      const first = rankOffersForJockey(offers, seed)[0]!.stableId;
      expect(rankOffersForJockey([...offers].reverse(), seed)[0]!.stableId).toBe(first);
      expect(matchJockeys({ offers, capacity: { X: 1, Y: 1 }, seed }).get("j")).toBe(first);
      picks.add(first);
    }
    expect(picks.size).toBe(2);
  });
});

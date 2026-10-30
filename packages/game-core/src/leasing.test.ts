import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  LEASE_FEE_MAX,
  LEASE_OWNER_SHARE_MAX_PCT,
  LEASE_OWNER_SHARE_MIN_PCT,
  LEASE_RELIST_COOLDOWN_DAYS,
  LEASE_TERMS_DAYS,
  LEASE_UNRATED_STARS,
  LEASE_WEEKLY_STARTS_DEFAULT,
  LESSEE_MIN_ACCOUNT_DAYS,
  LESSEE_MIN_LIVE_STARTS,
  MAX_LEASES_PER_LESSEE,
  MAX_OPEN_LEASE_OFFERS,
  averageStarsTenths,
  leaseConditionLabel,
  leaseEndsAtMs,
  leaseFeeCap,
  leaseFeeSplit,
  leaseOfferProblem,
  leaseOfferProblemText,
  leaseShareSplit,
  maxLeasesOut,
  meetsMinRating,
} from "./leasing";
import { MS_PER_DAY } from "./time";

describe("leasing config", () => {
  it("has the owner's numbers", () => {
    expect([...LEASE_TERMS_DAYS]).toEqual([7, 14, 28]);
    expect([LEASE_OWNER_SHARE_MIN_PCT, LEASE_OWNER_SHARE_MAX_PCT]).toEqual([30, 80]);
    expect(LEASE_FEE_MAX).toBe(0);
    expect(MAX_LEASES_PER_LESSEE).toBe(2);
    expect(MAX_OPEN_LEASE_OFFERS).toBe(3);
    expect(LEASE_RELIST_COOLDOWN_DAYS).toBe(7);
    expect([LESSEE_MIN_ACCOUNT_DAYS, LESSEE_MIN_LIVE_STARTS]).toEqual([7, 10]);
    expect(LEASE_WEEKLY_STARTS_DEFAULT).toBe(4);
  });

  it("no upfront fee in the beta; the fee path caps at 10% of the appraisal when enabled", () => {
    expect(leaseFeeCap(50_000)).toBe(0);
    expect(leaseFeeCap(5_000, 2_000)).toBe(500);
    expect(leaseFeeCap(100_000, 2_000)).toBe(2_000);
    expect(leaseFeeSplit(0)).toEqual({ cut: 0, ownerReceives: 0 });
    expect(leaseFeeSplit(1_000)).toEqual({ cut: 100, ownerReceives: 900 });
    fc.assert(fc.property(fc.integer({ min: 0, max: 2_000 }), (fee) => leaseFeeSplit(fee).cut + leaseFeeSplit(fee).ownerReceives === fee));
  });

  it("splits a purse exactly, rounding to the lessee", () => {
    expect(leaseShareSplit(1_000, 50)).toEqual({ owner: 500, lessee: 500 });
    expect(leaseShareSplit(333, 30)).toEqual({ owner: 99, lessee: 234 });
    expect(leaseShareSplit(1, 80)).toEqual({ owner: 0, lessee: 1 });
    expect(leaseShareSplit(0, 80)).toEqual({ owner: 0, lessee: 0 });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: LEASE_OWNER_SHARE_MIN_PCT, max: LEASE_OWNER_SHARE_MAX_PCT }), (prize, pct) => {
        const s = leaseShareSplit(prize, pct);
        return s.owner + s.lessee === prize && s.owner * 100 <= prize * pct && (prize === 0 || (s.owner + 1) * 100 > prize * pct);
      }),
    );
  });

  it("owners may lease out min(3, 25% of their racing horses), at least 1", () => {
    expect(maxLeasesOut(0)).toBe(1);
    expect(maxLeasesOut(3)).toBe(1);
    expect(maxLeasesOut(8)).toBe(2);
    expect(maxLeasesOut(12)).toBe(3);
    expect(maxLeasesOut(40)).toBe(3);
  });

  it("ratings: unrated lessees count as 3 stars against a minimum", () => {
    expect(averageStarsTenths(0, 0)).toBeNull();
    expect(averageStarsTenths(13, 3)).toBe(43);
    expect(meetsMinRating(0, 0, null)).toBe(true);
    expect(meetsMinRating(0, 0, LEASE_UNRATED_STARS)).toBe(true);
    expect(meetsMinRating(0, 0, 4)).toBe(false);
    expect(meetsMinRating(9, 2, 4)).toBe(true);
    expect(meetsMinRating(7, 2, 4)).toBe(false);
  });

  it("condition labels", () => {
    expect(leaseConditionLabel({ fatigue: 100, injured: false }, 600)).toBe("fresh");
    expect(leaseConditionLabel({ fatigue: 700, injured: false }, 600)).toBe("tired");
    expect(leaseConditionLabel({ fatigue: 0, injured: true }, 600)).toBe("injured");
  });

  it("validates offers", () => {
    const ok = { termDays: 14, ownerSharePct: 50, fee: 0, feeCap: 0, maxLiveStartsPerWeek: 4, minLesseeRating: null };
    expect(leaseOfferProblem(ok)).toBeNull();
    expect(leaseOfferProblem({ ...ok, termDays: 10 })).toBe("term");
    expect(leaseOfferProblem({ ...ok, termDays: 56 })).toBe("term");
    expect(leaseOfferProblem({ ...ok, ownerSharePct: 29 })).toBe("share");
    expect(leaseOfferProblem({ ...ok, ownerSharePct: 81 })).toBe("share");
    expect(leaseOfferProblem({ ...ok, ownerSharePct: 50.5 })).toBe("share");
    expect(leaseOfferProblem({ ...ok, fee: 1 })).toBe("fee");
    expect(leaseOfferProblem({ ...ok, fee: 500, feeCap: 500 })).toBeNull();
    expect(leaseOfferProblem({ ...ok, maxLiveStartsPerWeek: 1 })).toBe("weekly_starts");
    expect(leaseOfferProblem({ ...ok, maxLiveStartsPerWeek: 8 })).toBe("weekly_starts");
    expect(leaseOfferProblem({ ...ok, minLesseeRating: 6 })).toBe("min_rating");
    expect(leaseOfferProblem({ ...ok, minLesseeRating: 4 })).toBeNull();
    expect(leaseOfferProblemText("fee", 0)).toMatch(/no upfront fee/);
  });

  it("term end is whole days after the start", () => {
    expect(leaseEndsAtMs(1_000, 7)).toBe(1_000 + 7 * MS_PER_DAY);
  });
});

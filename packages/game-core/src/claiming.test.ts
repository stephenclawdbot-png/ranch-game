import { describe, expect, it } from "vitest";
import { CLAIM_PRICE_MAX_PERMILLE, CLAIM_PRICE_MIN_PERMILLE, CLAIM_REENTRY_LOCK_MS, claimingBandOrder, claimPriceBounds, claimPriceProblem, claimSettlement } from "./claiming";
import { LISTING_CEILING_PERMILLE, LISTING_FLOOR_PERMILLE } from "./economy";

describe("claiming races", () => {
  it("uses the market's appraisal band", () => {
    expect(CLAIM_PRICE_MIN_PERMILLE).toBe(700);
    expect(CLAIM_PRICE_MAX_PERMILLE).toBe(3000);
    expect(CLAIM_PRICE_MIN_PERMILLE).toBe(LISTING_FLOOR_PERMILLE);
    expect(CLAIM_PRICE_MAX_PERMILLE).toBe(LISTING_CEILING_PERMILLE);
    expect(CLAIM_REENTRY_LOCK_MS).toBe(3 * 86_400_000);
  });
  it("bounds the claim price", () => {
    expect(claimPriceBounds(1000)).toEqual({ min: 700, max: 3000 });
    expect(claimPriceBounds(1)).toEqual({ min: 1, max: 3 });
    expect(claimPriceProblem(699, 1000)).toMatch(/at least 700/);
    expect(claimPriceProblem(3001, 1000)).toMatch(/at most 3000/);
    expect(claimPriceProblem(1.5, 1000)).toMatch(/whole/);
    expect(claimPriceProblem(700, 1000)).toBeNull();
    expect(claimPriceProblem(3000, 1000)).toBeNull();
  });
  it("burns the market fee", () => {
    expect(claimSettlement(1000)).toEqual({ toOwner: 950, fee: 50 });
    expect(claimSettlement(19)).toEqual({ toOwner: 19, fee: 0 });
  });
  it("rotates the bands day by day", () => {
    expect(claimingBandOrder(0)).toEqual([0, 1, 2]);
    expect(claimingBandOrder(1)).toEqual([1, 2, 0]);
    expect(claimingBandOrder(5)).toEqual([2, 0, 1]);
    expect(claimingBandOrder(-1)).toEqual([2, 0, 1]);
  });
});

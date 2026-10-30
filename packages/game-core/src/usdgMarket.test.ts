import { describe, expect, it } from "vitest";
import {
  DEFAULT_USDG_POLICY,
  USDG_FEE_BPS_CAP,
  USDG_UNIT,
  formatUsdgDollars,
  formatUsdgToken,
  minNextBid,
  usdgFee,
  usdgFromDecimal,
  usdgHorseRef,
  usdgPolicyFromEnv,
  usdgPriceOutlier,
  usdgRegistrationBlock,
  usdgRegistrationChecks,
  usdgSellerReceives,
  type UsdgRegistrationFacts,
} from "./usdgMarket";

const eligible: UsdgRegistrationFacts = {
  ownedByCaller: true,
  racingAge: true,
  liveStarts: 5,
  onLegacyFarm: false,
  enteredInRace: false,
  listed: false,
  bound: false,
  origin: "bred",
  premiumPull: false,
  walletVerified: true,
  termsAccepted: true,
};

describe("USDG market knobs", () => {
  it("defaults match the spec (docs/usdg-market.md)", () => {
    expect(DEFAULT_USDG_POLICY.minLiveStarts).toBe(5);
    expect(DEFAULT_USDG_POLICY.registrationFee).toBe(2 * USDG_UNIT);
    expect(DEFAULT_USDG_POLICY.feeBps).toBe(500);
    expect(DEFAULT_USDG_POLICY.minPrice).toBe(USDG_UNIT);
    expect(DEFAULT_USDG_POLICY.auctionHours).toEqual([24, 48, 72]);
    expect(DEFAULT_USDG_POLICY.paymentWindowMs).toBe(24 * 3_600_000);
    expect(DEFAULT_USDG_POLICY.nonPayerBarMs).toBe(7 * 86_400_000);
    expect(USDG_FEE_BPS_CAP).toBe(1000);
  });

  it("env overrides apply within bounds, bad values fall back", () => {
    const p = usdgPolicyFromEnv({ USDG_MIN_STARTS: "8", USDG_REGISTRATION_FEE: "2.5", USDG_FEE_BPS: "700", USDG_MIN_PRICE: "3", USDG_PAYMENT_WINDOW_HOURS: "12", USDG_NONPAYER_BAR_DAYS: "14" });
    expect(p).toMatchObject({ minLiveStarts: 8, registrationFee: 2_500_000, feeBps: 700, minPrice: 3_000_000, paymentWindowMs: 12 * 3_600_000, nonPayerBarMs: 14 * 86_400_000 });
    const bad = usdgPolicyFromEnv({ USDG_MIN_STARTS: "-1", USDG_REGISTRATION_FEE: "abc", USDG_FEE_BPS: "1001", USDG_MIN_PRICE: "0", USDG_PAYMENT_WINDOW_HOURS: "100" });
    expect(bad).toEqual(DEFAULT_USDG_POLICY);
    expect(usdgPolicyFromEnv({})).toEqual(DEFAULT_USDG_POLICY);
  });

  it("parses and formats amounts (6 decimals)", () => {
    expect(usdgFromDecimal("2")).toBe(2_000_000);
    expect(usdgFromDecimal("0.000001")).toBe(1);
    expect(usdgFromDecimal("1.1234567")).toBeNull();
    expect(usdgFromDecimal("-1")).toBeNull();
    expect(formatUsdgDollars(12_500_000)).toBe("$12.50");
    expect(formatUsdgDollars(1_234_567_000_000)).toBe("$1,234,567.00");
    expect(formatUsdgToken(12_500_000)).toBe("12.5 USDG");
    expect(formatUsdgToken(2_000_000)).toBe("2 USDG");
  });

  it("fee math: floor of price × bps; seller gets the rest", () => {
    expect(usdgFee(25 * USDG_UNIT, 500)).toBe(1_250_000);
    expect(usdgFee(1_000_001, 500)).toBe(50_000);
    expect(usdgSellerReceives(25 * USDG_UNIT, 500)).toBe(23_750_000);
    for (let price = 1; price < 5_000_000; price += 77_777) expect(usdgFee(price, 500) + usdgSellerReceives(price, 500)).toBe(price);
  });

  it("bids: the first must meet the reserve; then +5 % with a 0.50 USDG minimum", () => {
    expect(minNextBid(DEFAULT_USDG_POLICY, 10 * USDG_UNIT, null)).toBe(10 * USDG_UNIT);
    expect(minNextBid(DEFAULT_USDG_POLICY, 10 * USDG_UNIT, 10 * USDG_UNIT)).toBe(10_500_000);
    expect(minNextBid(DEFAULT_USDG_POLICY, USDG_UNIT, 2 * USDG_UNIT)).toBe(2_500_000);
    expect(minNextBid(DEFAULT_USDG_POLICY, USDG_UNIT, 100 * USDG_UNIT)).toBe(105 * USDG_UNIT);
  });
});

describe("USDG registration requirements", () => {
  it("an eligible horse passes every check", () => {
    expect(usdgRegistrationChecks(eligible).every((c) => c.ok)).toBe(true);
    expect(usdgRegistrationBlock(eligible)).toBeNull();
  });

  it.each([
    [{ ownedByCaller: false }, "owned"],
    [{ racingAge: false }, "racing_age"],
    [{ liveStarts: 4 }, "live_starts"],
    [{ onLegacyFarm: true }, "not_legacy_farm"],
    [{ enteredInRace: true }, "not_in_race"],
    [{ listed: true }, "not_listed"],
    [{ bound: true }, "not_bound"],
    [{ origin: "starter" }, "not_starter_or_gift"],
    [{ origin: "gift" }, "not_starter_or_gift"],
    [{ premiumPull: true }, "not_premium_pull"],
    [{ walletVerified: false }, "wallet"],
    [{ termsAccepted: false }, "terms"],
  ] as const)("%o blocks with %s", (patch, key) => {
    expect(usdgRegistrationBlock({ ...eligible, ...patch })).toBe(key);
  });

  it("the Live-starts requirement follows the policy", () => {
    expect(usdgRegistrationBlock({ ...eligible, liveStarts: 7 }, { minLiveStarts: 8 })).toBe("live_starts");
    expect(usdgRegistrationBlock({ ...eligible, liveStarts: 0 }, { minLiveStarts: 0 })).toBeNull();
  });
});

describe("horse reference", () => {
  it("is keccak256 of the namespaced lowercase uuid (golden vector shared with the contracts adapter)", () => {
    // Golden vector computed with viem's keccak256 (the contracts adapter's horseRef): keccak, not NIST SHA3.
    expect(usdgHorseRef("6f1c1f9e-2d0c-4f43-9b4c-2b2f1d7e8a10")).toBe("0x9041cc5c2089a18acfc39f8dab1120cebaeb3ea74bca57ac72c0b01ebb12c5bb");
    expect(usdgHorseRef("6F1C1F9E-2D0C-4F43-9B4C-2B2F1D7E8A10")).toBe(usdgHorseRef("6f1c1f9e-2d0c-4f43-9b4c-2b2f1d7e8a10"));
  });
});

describe("price review", () => {
  const recent = [10, 12, 9, 11, 10].map((p) => ({ price: p * USDG_UNIT, appraisal: 1000 }));
  it("needs comparables; flags 3x above or below the median price per appraisal", () => {
    expect(usdgPriceOutlier({ price: 100 * USDG_UNIT, appraisal: 1000 }, recent.slice(0, 2))).toEqual({ flagged: false, ratio: null });
    expect(usdgPriceOutlier({ price: 20 * USDG_UNIT, appraisal: 1000 }, recent).flagged).toBe(false);
    expect(usdgPriceOutlier({ price: 31 * USDG_UNIT, appraisal: 1000 }, recent).flagged).toBe(true);
    expect(usdgPriceOutlier({ price: 3 * USDG_UNIT, appraisal: 1000 }, recent).flagged).toBe(true);
    // A horse appraised 3x higher may sell for 3x more without a flag.
    expect(usdgPriceOutlier({ price: 30 * USDG_UNIT, appraisal: 3000 }, recent).flagged).toBe(false);
  });
});

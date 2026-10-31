import { describe, expect, it } from "vitest";
import {
  formatRealToteUsdg,
  parseRealToteStake,
  REAL_TOTE_CONFIRM_ABOVE,
  REAL_TOTE_FIELD_LOCK_MS,
  REAL_TOTE_MAX_STAKE_PER_BET,
  REAL_TOTE_MAX_STAKE_PER_DAY,
  REAL_TOTE_MAX_STAKE_PER_RACE,
  REAL_TOTE_MIN_STAKE,
  REAL_TOTE_TAKEOUT_BPS,
  realToteAllowance,
  realToteBetsCloseMs,
  realToteEntriesCloseMs,
  realToteGate,
  realToteMarketCloseMs,
  realToteKeeperBackoffMs,
  realTotePermitExpiryMs,
  realTotePermitWindowS,
  realToteStakeProblem,
} from "./realTote";
import { TOTE_TAKEOUT_PERMILLE } from "./tote";

const POST = 1_800_000_000_000;

describe("real-USDG tote (dormant)", () => {
  it("is off unless all three switches are set", () => {
    expect(realToteGate({})).toEqual({ enabled: false, missing: ["REAL_TOTE_ENABLED", "WEB3_ENABLED", "TOTE_POOLS_ADDRESS"] });
    expect(realToteGate({ REAL_TOTE_ENABLED: "true" }).enabled).toBe(false);
    expect(realToteGate({ REAL_TOTE_ENABLED: "true", WEB3_ENABLED: "true" }).missing).toEqual(["TOTE_POOLS_ADDRESS"]);
    expect(realToteGate({ REAL_TOTE_ENABLED: "1", WEB3_ENABLED: "true", TOTE_POOLS_ADDRESS: "0xabc" }).enabled).toBe(false);
    expect(realToteGate({ REAL_TOTE_ENABLED: "true", WEB3_ENABLED: "true", TOTE_POOLS_ADDRESS: " " }).enabled).toBe(false);
    expect(realToteGate({ REAL_TOTE_ENABLED: "true", WEB3_ENABLED: "true", TOTE_POOLS_ADDRESS: "0xabc" })).toEqual({ enabled: true, missing: [] });
  });

  it("locks the field earlier, closes betting before the off and keeps permits inside the window", () => {
    expect(realToteEntriesCloseMs(POST, POST - 60_000)).toBe(POST - REAL_TOTE_FIELD_LOCK_MS);
    expect(realToteEntriesCloseMs(POST, POST - 3_600_000)).toBe(POST - 3_600_000); // already earlier: unchanged
    expect(realToteMarketCloseMs(POST)).toBe(POST - 60_000);
    expect(realToteBetsCloseMs(POST)).toBe(POST - 120_000);
    expect(realTotePermitExpiryMs(POST - 600_000, POST)).toBe(POST - 480_000);
    expect(realTotePermitExpiryMs(POST - 130_000, POST)).toBe(POST - 120_000);
    expect(REAL_TOTE_TAKEOUT_BPS).toBe(TOTE_TAKEOUT_PERMILLE * 10);
  });

  it("a permit's on-chain window: issued 30 s back (clock skew), well inside the contract's 10 min from issue", () => {
    const w = realTotePermitWindowS(POST - 600_000, POST);
    expect(w).toEqual({ issuedAt: (POST - 630_000) / 1000, expiry: (POST - 480_000) / 1000 });
    expect(w.expiry - w.issuedAt).toBeLessThanOrEqual(600);
  });

  it("keeper backoff doubles from 30 s and caps at 30 min", () => {
    expect([1, 2, 3, 10, 50].map(realToteKeeperBackoffMs)).toEqual([30_000, 60_000, 120_000, 1_800_000, 1_800_000]);
  });

  it("allowance: per bet, per race, per day and the player's own lower limits", () => {
    expect(realToteAllowance({ stakedOnRace: 0, stakedToday: 0 })).toBe(REAL_TOTE_MAX_STAKE_PER_BET);
    expect(realToteAllowance({ stakedOnRace: REAL_TOTE_MAX_STAKE_PER_RACE - 5, stakedToday: 0 })).toBe(5);
    expect(realToteAllowance({ stakedOnRace: 0, stakedToday: REAL_TOTE_MAX_STAKE_PER_DAY })).toBe(0);
    expect(realToteAllowance({ stakedOnRace: 10, stakedToday: 10, own: { perRace: 30, perDay: null } })).toBe(20);
    expect(realToteAllowance({ stakedOnRace: 50, stakedToday: 0, own: { perRace: 30, perDay: null } })).toBe(0);
  });

  it("fat-finger guard: bounds and a second confirmation above the threshold", () => {
    const allowance = REAL_TOTE_MAX_STAKE_PER_BET;
    expect(realToteStakeProblem({ stake: 0, allowance, confirmed: false })).toBe("invalid");
    expect(realToteStakeProblem({ stake: 1.5, allowance, confirmed: false })).toBe("invalid");
    expect(realToteStakeProblem({ stake: REAL_TOTE_MIN_STAKE - 1, allowance, confirmed: false })).toBe("below_min");
    expect(realToteStakeProblem({ stake: REAL_TOTE_MAX_STAKE_PER_BET + 1, allowance, confirmed: true })).toBe("above_max");
    expect(realToteStakeProblem({ stake: 20 * REAL_TOTE_MIN_STAKE, allowance: 10 * REAL_TOTE_MIN_STAKE, confirmed: true })).toBe("over_allowance");
    expect(realToteStakeProblem({ stake: REAL_TOTE_CONFIRM_ABOVE, allowance, confirmed: false })).toBe(null);
    expect(realToteStakeProblem({ stake: REAL_TOTE_CONFIRM_ABOVE + 1, allowance, confirmed: false })).toBe("needs_confirmation");
    expect(realToteStakeProblem({ stake: REAL_TOTE_CONFIRM_ABOVE + 1, allowance, confirmed: true })).toBe(null);
  });

  it("parses typed stakes strictly and formats them", () => {
    expect(parseRealToteStake("12")).toBe(12_000_000);
    expect(parseRealToteStake(" 0.75 ")).toBe(750_000);
    expect(parseRealToteStake("1.000001")).toBe(1_000_001);
    for (const bad of ["", "1,000", "1e3", "-5", "1.0000001", "abc", "12.", ".5", "12345678"]) expect(parseRealToteStake(bad)).toBe(null);
    expect(formatRealToteUsdg(12_345_678)).toBe("12.34 USDG");
    expect(formatRealToteUsdg(1_250_000_000)).toBe("1,250.00 USDG");
  });
});

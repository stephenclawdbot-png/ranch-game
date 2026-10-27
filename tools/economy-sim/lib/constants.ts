/**
 * Every number the sim uses that exists in the game. Game rules come straight from
 * @thoroughbred/game-core (imported, so they stay in sync). The closed-beta money rules live
 * in packages/db and apps/web, which pull in Postgres/viem, so they are MIRRORED here and
 * checked against the source text by `checkSync()` (run on every sim start; a mismatch
 * aborts the run so stale numbers never reach docs/economy/results).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as gc from "../../../packages/game-core/src/index.ts";
import { REPO_ROOT } from "./out.ts";

export { gc };

// ---------------------------------------------------------------------------
// Game rules (imported from game-core)
// ---------------------------------------------------------------------------

export const GAME = {
  starterGrant: gc.STARTER_GRANT,
  purse: gc.PURSE_BY_TIER,
  entryFee: gc.ENTRY_FEE_BY_TIER,
  weekendFeaturePurse: gc.WEEKEND_FEATURE_PURSE,
  seasonFinalPurse: gc.SEASON_FINAL_PURSE,
  /** Documented in game-core but NOT granted anywhere in packages/db or apps/web (audit finding). */
  dailyGoalCredits: gc.DAILY_GOAL_CREDITS,
  dailyGoalsPerDay: gc.DAILY_GOALS_PER_DAY,
  dailyCupCredits: gc.DAILY_CUP_CREDITS,
  storyFirstWin: gc.STORY_FIRST_WIN_REWARD,
  storyReplay: gc.STORY_REPLAY_REWARD,
  storyCap: gc.STORY_CHAPTER_CAP,
  storyRacesPerChapter: gc.STORY_CHAPTER_DEFS.map((c) => c.races.length),
  storyStrength: Object.fromEntries(gc.STORY_CHAPTER_DEFS.map((c) => [c.id, c.races.map((r) => r.strength)])) as Record<gc.StoryChapter, number[]>,
  vet: gc.VET_TREATMENT_COST,
  scan: gc.PEDIGREE_SCAN_COST,
  insurancePremiumPermille: gc.INSURANCE_PREMIUM_PERMILLE,
  insurancePayoutPermille: gc.INSURANCE_PAYOUT_PERMILLE,
  marketFeePermille: gc.MARKET_FEE_PERMILLE,
  listingFloorPermille: gc.LISTING_FLOOR_PERMILLE,
  baseStalls: gc.BASE_STALLS,
  maxStalls: gc.MAX_STALLS,
  stallCost: gc.stallCost,
  facility: gc.FACILITY_COSTS,
  workouts: gc.WORKOUTS,
  trainingSlots: gc.BASE_SLOTS,
  breedingBaseFee: gc.BREEDING_BASE_FEE,
  studBurnPermille: gc.STUD_FEE_BURN_PERMILLE,
  breedingsLifetime: gc.BREEDINGS_LIFETIME,
  marePerSeason: gc.MARE_PER_SEASON,
  breedFromStarts: gc.BREED_FROM_STARTS,
  careToRacing: gc.CARE_TO_RACING,
  careerMaxStarts: gc.CAREER_MAX_STARTS,
  startsPerDay: gc.MAX_STARTS_PER_DAY,
  releaseCredits: gc.RELEASE_TO_CLUB_CREDITS,
  entryDaily: gc.ENTRY_DAILY_BASE,
  entryBank: gc.ENTRY_BANK_BASE,
  entryRefillAmount: gc.ENTRY_REFILL_AMOUNT,
  entryRefillBelow: gc.ENTRY_REFILL_BELOW,
  entryRefillCost: gc.ENTRY_REFILL_COST,
  entryTierCost: gc.ENTRY_TIER_COST,
  paddockPrice: gc.PADDOCK_PACK_PRICE,
  freePaddockEvery: gc.FREE_PADDOCK_EVERY_PLAY_DAYS,
  paddockBuysPerWeek: gc.PADDOCK_CREDIT_BUYS_PER_WEEK,
  premiumPerWeek: gc.PREMIUM_PER_WEEK,
  cropCap: gc.SEASON_FOAL_CROP_CAP,
  packOdds: gc.PACK_ODDS,
  packPity: gc.PACK_PITY,
  racePoints: gc.RACE_POINTS,
  startPoint: gc.START_POINT,
  weeklyRacePointsCap: gc.WEEKLY_RACE_POINTS_CAP,
  cupFieldSize: gc.CUP_FIELD_SIZE,
  seasonDays: gc.SEASON_DAYS,
  tierCycle: gc.TIER_CYCLE,
  sellerMinAgeDays: gc.SELLER_MIN_AGE_DAYS,
  sellerMinRaces: gc.SELLER_MIN_RACES,
  starterPlan: gc.STARTER_PLAN,
  launchMeanCeiling: gc.LAUNCH_MEAN_CEILING,
  ceilingStep: gc.CEILING_STEP_PER_SEASON,
} as const;

/** Sum of the six-place purse split (engine PRIZE_SPLIT_PCT / db purseSplitBps). */
export const PURSE_SPLIT = [0.55, 0.2, 0.12, 0.07, 0.04, 0.02] as const;

// ---------------------------------------------------------------------------
// Closed-beta money rules (mirrored; verified by checkSync)
// ---------------------------------------------------------------------------

/** packages/db/src/services/betaMoney.ts DEFAULT_POOL_RULES */
export const POOL_RULES = {
  budgetBps: 2_500,
  capUsdCents: 1_000,
  minActiveDays: 4,
  paidRanks: 10,
  minPayoutUsdCents: 50,
  excludePremiumHorses: true,
  excludeFlagged: true,
  vestDays: 14,
} as const;

/** packages/db/src/services/affiliates.ts DEFAULT_AFFILIATE_CONFIG */
export const AFFILIATE = {
  ref1Bps: 1_000,
  ref2Bps: 300,
  windowDays: 90,
  weeklyCapUsdCents: 5_000,
  ownerWeeklyCapUsdCents: null as number | null,
  activeRewardCredits: 250,
  activeMinRaces: 5,
  activeMinPlayDays: 3,
} as const;

/** apps/web/src/server/chain/config.ts PREMIUM_PACK_USD_CENTS default; ChainAdmin deploy defaults. */
export const BETA = {
  premiumUsdCents: 499,
  poolBps: 3_000,
  deployCapUsd: 25,
  maxQtyPerQuote: 10,
} as const;

/** packages/contracts/contracts/{PremiumStore,PrizePool}.sol and the mock adapter defaults. */
export const CONTRACT = {
  minPoolBps: 1_000,
  maxPoolBps: 5_000,
  ref1Cap: 1_500,
  ref2Cap: 500,
  maxEpochBpsDefault: 5_000,
  claimWindowDays: 56,
  minEpochIntervalDays: 6,
} as const;

/**
 * Chain cost assumptions (Robinhood Chain, docs/web3.md §1: 0.02 gwei observed on mainnet).
 * Gas units are estimates for these contracts; the L1 data fee dominates on Arbitrum chains.
 */
export const GAS = {
  gweiL2: 0.02,
  purchaseGas: 220_000,
  claimGas: 110_000,
  postEpochGas: 150_000,
  /** L1 data fee per tx in USD (Arbitrum-style, post-4844 blobs): a conservative flat estimate. */
  l1DataFeeUsd: 0.02,
  /** One-time cost for a tester to get ETH onto Robinhood Chain (L1 bridge tx or CEX withdrawal fee). */
  onrampUsd: 2.5,
} as const;

// ---------------------------------------------------------------------------
// Sync check
// ---------------------------------------------------------------------------

function src(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

function expectMatch(errors: string[], file: string, text: string, re: RegExp, expected: number | string, label: string) {
  const m = text.match(re);
  if (!m) {
    errors.push(`${file}: could not find ${label}`);
    return;
  }
  const got = m[1]!.replace(/_/g, "");
  if (String(got) !== String(expected)) errors.push(`${file}: ${label} is ${got} in code but ${expected} in the sim`);
}

/** Verifies the mirrored constants against the source files. Returns the list of mismatches. */
export function checkSync(): string[] {
  const errors: string[] = [];
  const bm = "packages/db/src/services/betaMoney.ts";
  const t1 = src(bm);
  expectMatch(errors, bm, t1, /budgetBps:\s*([\d_]+),\n\s*capUsdCents/, POOL_RULES.budgetBps, "budgetBps");
  expectMatch(errors, bm, t1, /capUsdCents:\s*([\d_]+),\n\s*minActiveDays/, POOL_RULES.capUsdCents, "capUsdCents");
  expectMatch(errors, bm, t1, /minActiveDays:\s*(\d+),\n\s*paidRanks/, POOL_RULES.minActiveDays, "minActiveDays");
  expectMatch(errors, bm, t1, /paidRanks:\s*(\d+),\n\s*minPayoutUsdCents/, POOL_RULES.paidRanks, "paidRanks");
  expectMatch(errors, bm, t1, /minPayoutUsdCents:\s*(\d+),\n\s*excludePremiumHorses/, POOL_RULES.minPayoutUsdCents, "minPayoutUsdCents");
  expectMatch(errors, bm, t1, /vestDays:\s*(\d+),\n\};/, POOL_RULES.vestDays, "vestDays");
  const af = "packages/db/src/services/affiliates.ts";
  const t2 = src(af);
  expectMatch(errors, af, t2, /ref1Bps:\s*([\d_]+),\n\s*ref2Bps:\s*[\d_]+,\n\s*windowDays/, AFFILIATE.ref1Bps, "ref1Bps");
  expectMatch(errors, af, t2, /ref2Bps:\s*([\d_]+),\n\s*windowDays:/, AFFILIATE.ref2Bps, "ref2Bps");
  expectMatch(errors, af, t2, /windowDays:\s*(\d+),\n\s*weeklyCapUsdCents:/, AFFILIATE.windowDays, "windowDays");
  expectMatch(errors, af, t2, /weeklyCapUsdCents:\s*([\d_]+),\n\s*ownerWeeklyCapUsdCents:/, AFFILIATE.weeklyCapUsdCents, "weeklyCapUsdCents");
  expectMatch(errors, af, t2, /activeReward:\s*\{\s*credits:\s*(\d+)/, AFFILIATE.activeRewardCredits, "activeReward.credits");
  const cf = "apps/web/src/server/chain/config.ts";
  expectMatch(errors, cf, src(cf), /PREMIUM_PACK_USD_CENTS\?\.trim\(\)\s*\|\|\s*(\d+)/, BETA.premiumUsdCents, "PREMIUM_PACK_USD_CENTS default");
  const ps = "packages/contracts/contracts/PremiumStore.sol";
  const t3 = src(ps);
  expectMatch(errors, ps, t3, /MIN_POOL_BPS = ([\d_]+);/, CONTRACT.minPoolBps, "MIN_POOL_BPS");
  expectMatch(errors, ps, t3, /MAX_POOL_BPS = ([\d_]+);/, CONTRACT.maxPoolBps, "MAX_POOL_BPS");
  expectMatch(errors, ps, t3, /REF1_BPS_CAP = ([\d_]+);/, CONTRACT.ref1Cap, "REF1_BPS_CAP");
  expectMatch(errors, ps, t3, /REF2_BPS_CAP = ([\d_]+);/, CONTRACT.ref2Cap, "REF2_BPS_CAP");
  const ca = "apps/web/src/components/chain/admin/ChainAdmin.tsx";
  const t4 = src(ca);
  expectMatch(errors, ca, t4, /setPoolPct\] = useState\((\d+)\)/, BETA.poolBps / 100, "deploy pool %");
  expectMatch(errors, ca, t4, /setCapUsd\] = useState\((\d+)\)/, BETA.deployCapUsd, "deploy per-player cap $");
  // Daily goals: the sim assumes they are NOT paid; flag it the day someone implements them.
  const goalsPaid = ["packages/db/src/services", "apps/web/src/server"].some((dir) => {
    try {
      return execSync(`grep -rl "DAILY_GOAL_CREDITS" ${resolve(REPO_ROOT, dir)} || true`, { encoding: "utf8" }).trim().length > 0;
    } catch {
      return false;
    }
  });
  if (goalsPaid) errors.push("DAILY_GOAL_CREDITS is now referenced by the server: set GOALS_IMPLEMENTED=true in models/credits.ts and rerun");
  return errors;
}

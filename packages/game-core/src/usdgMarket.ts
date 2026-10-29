/**
 * The USDG horse market (docs/usdg-market.md): every knob in one place, plus the pure rules
 * (registration requirements, fees, bid increments, price review). Amounts are integer
 * micro-USDG (USDG has 6 decimals: 1 USDG = 1_000_000), always "dollars" to players.
 *
 * Owner decision 2026-10-29: registered horses can be bought, sold and auctioned for USDG
 * (testnet first). Stable Credits stay closed: never bought, sold, bridged or transferred for
 * money. A registered horse trades only for USDG from then on.
 *
 * Env overrides (server only, read through `usdgPolicyFromEnv(process.env)`; all optional):
 *   USDG_MIN_STARTS              Live starts a horse needs before it can register (default 5)
 *   USDG_REGISTRATION_FEE        registration fee in USDG, e.g. "2" or "2.50" (default 2)
 *   USDG_FEE_BPS                 marketplace fee in bps (default 500 = 5 %, max 1000). MUST equal
 *                                the HorseMarket contract's feeBps or signed orders revert.
 *   USDG_MIN_PRICE               lowest price / reserve in USDG (default 1)
 *   USDG_PAYMENT_WINDOW_HOURS    an auction winner's time to pay (default 24, max 72)
 *   USDG_NONPAYER_BAR_DAYS       USDG bidding bar after a missed payment (default 7)
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { MS_PER_DAY, MS_PER_HOUR } from "./time";

/**
 * The horse's on-chain reference in HorseMarket orders and events:
 * keccak256(utf8("posttime:horse:<lowercase uuid>")), 0x-prefixed. Byte-identical to
 * `horseRef` in packages/contracts/adapter/horseMarket.ts (tested in apps/web).
 */
export function usdgHorseRef(horseId: string): string {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(`posttime:horse:${horseId.toLowerCase()}`)))}`;
}

export const USDG_DECIMALS = 6;
/** 1 USDG in base units. */
export const USDG_UNIT = 1_000_000;

/** Live starts (scheduled, Feature, Final; not Story or quick races) before a horse can register. */
export const USDG_MIN_STARTS = 5;
/** Registration fee, paid once per horse to the treasury (a sink against farming free horses for cash). */
export const USDG_REGISTRATION_FEE = 2 * USDG_UNIT;
/** Marketplace fee on every USDG sale, to the treasury. */
export const USDG_FEE_BPS = 500;
/** On-chain hard cap of the marketplace fee (HorseMarket.MAX_FEE_BPS). */
export const USDG_FEE_BPS_CAP = 1_000;
/** Lowest fixed price, reserve or bid. */
export const USDG_MIN_PRICE = 1 * USDG_UNIT;
/** Technical ceiling (keeps amounts safe integers); dollar prices are otherwise set by players. */
export const USDG_MAX_PRICE = 1_000_000 * USDG_UNIT;
/** Auction lengths a seller can choose (24-72 h). */
export const USDG_AUCTION_HOURS = [24, 48, 72] as const;
/** Fixed-price listing lengths; the longest equals the credits market's listing limit. */
export const USDG_FIXED_LISTING_DAYS = [3, 7, 14] as const;
/** After an auction closes, the top bidder has this long to pay; then the next bidder is offered. */
export const USDG_PAYMENT_WINDOW_MS = 24 * MS_PER_HOUR;
/** A winner who doesn't pay can't bid in USDG auctions for this long. */
export const USDG_NONPAYER_BAR_MS = 7 * MS_PER_DAY;
/** A fixed-price buy (and a registration) holds its signed order this long; the lot is reserved meanwhile. */
export const USDG_QUOTE_TTL_MS = 15 * 60_000;
/** A bid must beat the best bid by 5 %, and by at least 0.50 USDG. */
export const USDG_BID_INCREMENT_BPS = 500;
export const USDG_BID_INCREMENT_MIN = USDG_UNIT / 2;
/** Sales priced over 3x (or under a third of) recent comparable sales are flagged for review (wash-trading signal). */
export const USDG_REVIEW_RATIO = 3;
/** How many recent sales the review compares against (needs at least USDG_REVIEW_MIN_COMPARABLES). */
export const USDG_REVIEW_COMPARABLES = 20;
export const USDG_REVIEW_MIN_COMPARABLES = 3;

export interface UsdgPolicy {
  minLiveStarts: number;
  registrationFee: number;
  feeBps: number;
  minPrice: number;
  maxPrice: number;
  auctionHours: readonly number[];
  fixedListingDays: readonly number[];
  paymentWindowMs: number;
  nonPayerBarMs: number;
  quoteTtlMs: number;
  bidIncrementBps: number;
  bidIncrementMin: number;
  reviewRatio: number;
}

export const DEFAULT_USDG_POLICY: UsdgPolicy = {
  minLiveStarts: USDG_MIN_STARTS,
  registrationFee: USDG_REGISTRATION_FEE,
  feeBps: USDG_FEE_BPS,
  minPrice: USDG_MIN_PRICE,
  maxPrice: USDG_MAX_PRICE,
  auctionHours: USDG_AUCTION_HOURS,
  fixedListingDays: USDG_FIXED_LISTING_DAYS,
  paymentWindowMs: USDG_PAYMENT_WINDOW_MS,
  nonPayerBarMs: USDG_NONPAYER_BAR_MS,
  quoteTtlMs: USDG_QUOTE_TTL_MS,
  bidIncrementBps: USDG_BID_INCREMENT_BPS,
  bidIncrementMin: USDG_BID_INCREMENT_MIN,
  reviewRatio: USDG_REVIEW_RATIO,
};

/** "2", "2.5", "0.000001" USDG -> micro-USDG. Null when malformed or more than 6 decimals. */
export function usdgFromDecimal(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const n = Number(whole) * USDG_UNIT + Number(frac.padEnd(6, "0"));
  return Number.isSafeInteger(n) ? n : null;
}

function envNum(env: Record<string, string | undefined>, name: string): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The policy with optional env overrides (out-of-range values fall back to the defaults). */
export function usdgPolicyFromEnv(env: Record<string, string | undefined>): UsdgPolicy {
  const p = { ...DEFAULT_USDG_POLICY };
  const starts = envNum(env, "USDG_MIN_STARTS");
  if (starts !== null && Number.isInteger(starts) && starts <= 40) p.minLiveStarts = starts;
  const fee = env.USDG_REGISTRATION_FEE ? usdgFromDecimal(env.USDG_REGISTRATION_FEE) : null;
  if (fee !== null && fee > 0) p.registrationFee = fee;
  const bps = envNum(env, "USDG_FEE_BPS");
  if (bps !== null && Number.isInteger(bps) && bps <= USDG_FEE_BPS_CAP) p.feeBps = bps;
  const min = env.USDG_MIN_PRICE ? usdgFromDecimal(env.USDG_MIN_PRICE) : null;
  if (min !== null && min > 0 && min < p.maxPrice) p.minPrice = min;
  const win = envNum(env, "USDG_PAYMENT_WINDOW_HOURS");
  if (win !== null && win >= 1 && win <= 72) p.paymentWindowMs = Math.round(win * MS_PER_HOUR);
  const bar = envNum(env, "USDG_NONPAYER_BAR_DAYS");
  if (bar !== null && bar <= 365) p.nonPayerBarMs = Math.round(bar * MS_PER_DAY);
  return p;
}

/** Marketplace fee (floor), what HorseMarket checks within rounding. */
export function usdgFee(price: number, feeBps: number): number {
  return Math.floor((price * feeBps) / 10_000);
}

export function usdgSellerReceives(price: number, feeBps: number): number {
  return price - usdgFee(price, feeBps);
}

/** The lowest acceptable next bid: the reserve, or the best bid plus the increment. */
export function minNextBid(policy: Pick<UsdgPolicy, "bidIncrementBps" | "bidIncrementMin">, reserve: number, best: number | null): number {
  if (best === null) return reserve;
  return best + Math.max(policy.bidIncrementMin, Math.ceil((best * policy.bidIncrementBps) / 10_000));
}

/** "$12.50" (USDG is a dollar stablecoin). Sub-cent amounts keep their digits. */
export function formatUsdgDollars(micro: number): string {
  const cents = micro / 10_000;
  const digits = Number.isInteger(cents) ? 2 : 6;
  return `$${(micro / USDG_UNIT).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
}

/** "12.5 USDG" (the token amount, trailing zeros trimmed). */
export function formatUsdgToken(micro: number): string {
  const whole = Math.floor(micro / USDG_UNIT);
  const frac = String(micro % USDG_UNIT).padStart(6, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} USDG`;
}

// ---------------------------------------------------------------------------
// Registration requirements (the horse-page checklist and the server check)
// ---------------------------------------------------------------------------

export type UsdgRequirementKey =
  | "owned"
  | "racing_age"
  | "live_starts"
  | "not_legacy_farm"
  | "not_in_race"
  | "not_listed"
  | "not_bound"
  | "not_starter_or_gift"
  | "not_premium_pull"
  | "wallet"
  | "terms";

export interface UsdgRegistrationFacts {
  ownedByCaller: boolean;
  racingAge: boolean;
  liveStarts: number;
  onLegacyFarm: boolean;
  enteredInRace: boolean;
  /** Listed on the credits market (or already on the USDG market). */
  listed: boolean;
  /** Club-bred: starters, free-pack foals, Club-bred horses (horses.bound), or still under trade_min_starts. */
  bound: boolean;
  origin: string;
  /** The horse itself came out of a Premium Pack (its foals can register). */
  premiumPull: boolean;
  /** A SIWE-verified wallet is linked (one wallet per account). */
  walletVerified: boolean;
  /** The seller confirmed they are 18+ and accept the USDG market terms. */
  termsAccepted: boolean;
}

export interface UsdgRequirement {
  key: UsdgRequirementKey;
  ok: boolean;
}

/** Every requirement, in checklist order, with whether it is met. */
export function usdgRegistrationChecks(f: UsdgRegistrationFacts, policy: Pick<UsdgPolicy, "minLiveStarts"> = DEFAULT_USDG_POLICY): UsdgRequirement[] {
  return [
    { key: "owned", ok: f.ownedByCaller },
    { key: "racing_age", ok: f.racingAge },
    { key: "live_starts", ok: f.liveStarts >= policy.minLiveStarts },
    { key: "not_legacy_farm", ok: !f.onLegacyFarm },
    { key: "not_in_race", ok: !f.enteredInRace },
    { key: "not_listed", ok: !f.listed },
    { key: "not_bound", ok: !f.bound },
    { key: "not_starter_or_gift", ok: f.origin !== "starter" && f.origin !== "gift" && f.origin !== "house" },
    { key: "not_premium_pull", ok: !f.premiumPull },
    { key: "wallet", ok: f.walletVerified },
    { key: "terms", ok: f.termsAccepted },
  ];
}

/** The first unmet requirement, or null when the horse can register. */
export function usdgRegistrationBlock(f: UsdgRegistrationFacts, policy: Pick<UsdgPolicy, "minLiveStarts"> = DEFAULT_USDG_POLICY): UsdgRequirementKey | null {
  return usdgRegistrationChecks(f, policy).find((r) => !r.ok)?.key ?? null;
}

// ---------------------------------------------------------------------------
// Price review (wash-trading signal): compare price per appraisal credit with recent sales
// ---------------------------------------------------------------------------

/**
 * True when a sale's price, relative to the horse's appraisal, is more than `reviewRatio` times
 * above or below the median of recent comparable sales. Needs enough comparables; the sale still
 * goes through (dollar prices are the players'), it is only flagged for a human to look at.
 */
export function usdgPriceOutlier(
  sale: { price: number; appraisal: number },
  recent: readonly { price: number; appraisal: number }[],
  reviewRatio: number = USDG_REVIEW_RATIO,
): { flagged: boolean; ratio: number | null } {
  if (recent.length < USDG_REVIEW_MIN_COMPARABLES) return { flagged: false, ratio: null };
  const per = (s: { price: number; appraisal: number }) => s.price / Math.max(1, s.appraisal);
  const sorted = recent.map(per).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  if (median <= 0) return { flagged: false, ratio: null };
  const ratio = per(sale) / median;
  return { flagged: ratio > reviewRatio || ratio < 1 / reviewRatio, ratio };
}

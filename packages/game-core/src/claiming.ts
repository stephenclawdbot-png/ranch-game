/**
 * Claiming races: the race is the market (race meetings plan, 2026-10-30, item 4).
 *
 * One race a day is a claiming race: every runner carries a claim price set
 * by its owner at entry, inside the market's appraisal band, and any other stable with a free stall
 * and the credits can lodge a claim on it until entries close. More than one claim on a horse is
 * decided by a draw from the race seed at the lock. After the race the horse moves to the winning
 * claimant whatever the result: the old owner keeps the purse and receives the price minus the
 * market's fee (burned). A fatal injury voids the claim.
 *
 * Which slot: one of the day's handicaps, the band rotating day by day (claimingBandOrder): the
 * day's last handicap in that band (the three bands' last ones run in the 16:00, 19:00 and 22:00
 * UTC meetings, packages/db card.ts claimingSlotOfDay); a calendar race on that slot moves the
 * claiming race to the next band. The slot only becomes a
 * claiming race when at least `CLAIMING_MIN_ELIGIBLE` horses could enter one today; otherwise it
 * stays the ordinary handicap it would have been (the check runs when the card is published).
 *
 * Integer maths only, like the rest of game-core.
 */
import { LISTING_CEILING_PERMILLE, LISTING_FLOOR_PERMILLE, marketFee } from "./economy";
import { MS_PER_DAY } from "./time";

/** Lowest claim price, per mille of the horse's appraisal (the market's listing floor: 70%). */
export const CLAIM_PRICE_MIN_PERMILLE = LISTING_FLOOR_PERMILLE;
/** Highest claim price, per mille of the horse's appraisal (the market's ceiling: 3x). */
export const CLAIM_PRICE_MAX_PERMILLE = LISTING_CEILING_PERMILLE;
/** A horse claimed in a claiming race can't run in another claiming race for this many days. */
export const CLAIM_REENTRY_LOCK_DAYS = 3;
/** CLAIM_REENTRY_LOCK_DAYS in ms. */
export const CLAIM_REENTRY_LOCK_MS = CLAIM_REENTRY_LOCK_DAYS * MS_PER_DAY;
/** Claiming races a day. */
export const CLAIMING_RACES_PER_DAY = 1;
/**
 * Fewest horses that could enter a claiming race today (tradeable for credits, still racing,
 * inside the band) for the day's claiming slot to be published as one; below this
 * the slot stays the ordinary handicap. A fresh world has none for weeks (starter horses are
 * Club-bred and untradeable, foals are not of racing age), and a handicap was being
 * called off every day for an empty claiming race. Checked once, when the card is published
 * (24 h ahead), and the published race keeps its kind for good.
 */
export const CLAIMING_MIN_ELIGIBLE = 6;
/** Claims one stable may lodge in one claiming race. */
export const CLAIMS_PER_STABLE_PER_RACE = 1;

/** Claim price band for a horse of this appraisal: [70%, 300%], rounded inwards (never inverted). */
export function claimPriceBounds(appraisal: number): { min: number; max: number } {
  const min = Math.max(1, Math.ceil((appraisal * CLAIM_PRICE_MIN_PERMILLE) / 1000));
  const max = Math.max(min, Math.floor((appraisal * CLAIM_PRICE_MAX_PERMILLE) / 1000));
  return { min, max };
}

/** Why a claim price is refused for this appraisal, or null when it is inside the band. */
export function claimPriceProblem(price: number, appraisal: number): string | null {
  if (!Number.isSafeInteger(price) || price <= 0) return "the claim price must be a whole number of credits";
  const { min, max } = claimPriceBounds(appraisal);
  if (price < min) return `the claim price must be at least ${min} (70% of the appraisal)`;
  if (price > max) return `the claim price can be at most ${max} (3x the appraisal)`;
  return null;
}

/** What a claim moves: the old owner receives price - fee; the fee (the market's 5%) is burned. */
export function claimSettlement(price: number): { toOwner: number; fee: number } {
  const fee = marketFee(price);
  return { toOwner: price - fee, fee };
}

/**
 * Order in which a day tries the three handicap bands (0 = 0-55, 1 = 50-75, 2 = 70-95): starts at
 * `day mod 3` (day = days since the Unix epoch) and wraps, so the claiming race rotates through
 * the bands day by day and the next band takes over when a calendar race holds that day's band.
 */
export function claimingBandOrder(day: number): number[] {
  const first = ((day % 3) + 3) % 3;
  return [first, (first + 1) % 3, (first + 2) % 3];
}


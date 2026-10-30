/**
 * The Club seeds the markets (race meetings plan, 2026-10-30, item 6).
 *
 * At beta size nothing reaches the credits market (starter, gift and Club-bred horses never sell;
 * bred foals need 5 starts) and the lease board stays thin. So the Club, the game's house, lists a
 * few of its own racing horses for sale and offers a few on lease every day, and backs off as
 * players supply their own: every Club lot or offer is one fewer slot when players list.
 *
 * Money: what a player pays the Club is burned (a credit sink, never a faucet), and so is the
 * Club's owner share of the purses a leased Club horse wins. A Club horse that is bought becomes an
 * ordinary player horse (the resale lock applies; it stays Club-bred for the USDG market).
 *
 * Integer maths only, like the rest of game-core.
 */
import { Rng, seedFrom } from "./rng";

/** Club horses minted and listed for sale each UTC day (while there is room under the cap). */
export const CLUB_SALE_LISTINGS_PER_DAY = 3;
/** Most Club sale lots live at once; every live player lot takes one away (never below 0). */
export const CLUB_SALE_LISTINGS_MAX = 6;
/** Club asking price, per mille of the horse's appraisal (110%: inside the 70%-300% listing band). */
export const CLUB_SALE_PRICE_PERMILLE = 1100;
/** A Club lot stays up as long as a player's default lot (72 h), then the horse goes back to the Club. */
export const CLUB_SALE_LISTING_HOURS = 72;
/** Most Club lease offers open at once; every open player offer takes one away (never below 0). */
export const CLUB_LEASE_OFFERS_MAX = 4;
/** Lease terms the Club offers, in days (alternating). */
export const CLUB_LEASE_TERMS_DAYS = [7, 14] as const;
/** The Club's share of purses won on a Club lease, in percent (burned). */
export const CLUB_LEASE_OWNER_SHARE_PCT = 50;
/** Rating band most Club horses come from (inclusive). */
export const CLUB_RATING_MIN = 30;
export const CLUB_RATING_MAX = 70;
/** Chance (per mille) that a Club sale horse comes from the better band instead. */
export const CLUB_BETTER_HORSE_PERMILLE = 150;
/** The better band (inclusive). */
export const CLUB_BETTER_RATING_MIN = 71;
export const CLUB_BETTER_RATING_MAX = 90;

/** How many Club lots may be live: max(0, CLUB_SALE_LISTINGS_MAX - live player lots). */
export function clubSaleCap(livePlayerLots: number): number {
  return Math.max(0, CLUB_SALE_LISTINGS_MAX - Math.max(0, livePlayerLots));
}

/** How many Club lots to list today: up to the daily count, never past the cap. */
export function clubSaleLotsToList(liveClubLots: number, livePlayerLots: number): number {
  return Math.max(0, Math.min(CLUB_SALE_LISTINGS_PER_DAY, clubSaleCap(livePlayerLots) - liveClubLots));
}

/** How many Club lease offers may be open: max(0, CLUB_LEASE_OFFERS_MAX - open player offers). */
export function clubLeaseCap(openPlayerOffers: number): number {
  return Math.max(0, CLUB_LEASE_OFFERS_MAX - Math.max(0, openPlayerOffers));
}

/** The Club's asking price for a horse of this appraisal (rounded down, at least 1). */
export function clubSalePrice(appraisal: number): number {
  return Math.max(1, Math.floor((appraisal * CLUB_SALE_PRICE_PERMILLE) / 1000));
}

/** The rating of the `index`-th Club sale horse minted on `day`: mostly 30-70, now and then better. Deterministic. */
export function clubSaleRating(day: string, index: number): number {
  const rng = new Rng(seedFrom("club-sale-rating", day, index));
  return rng.chance(CLUB_BETTER_HORSE_PERMILLE) ? rng.range(CLUB_BETTER_RATING_MIN, CLUB_BETTER_RATING_MAX) : rng.range(CLUB_RATING_MIN, CLUB_RATING_MAX);
}

/** The lease term of the `index`-th Club offer made on `day`. */
export function clubLeaseTermDays(day: string, index: number): number {
  return CLUB_LEASE_TERMS_DAYS[new Rng(seedFrom("club-lease-term", day, index)).int(CLUB_LEASE_TERMS_DAYS.length)]!;
}

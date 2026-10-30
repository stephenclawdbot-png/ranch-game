/**
 * Horse leasing (owner request 2026-10-30): an owner offers a racing horse for a fixed term; another
 * stable takes the lease, keeps the horse in one of its own stalls, cares for it, trains it and
 * races it in its own silks. The owner keeps ownership (breeding, selling and retiring stay theirs:
 * rent racers, buy breeders). Every purse the horse wins during the term is split automatically:
 * the owner's share to the owner, the rest to the lessee. A lease creates no credits: the purse is
 * the race's own purse, split exactly.
 *
 * Controls (owner, 2026-10-30), all tuned here:
 *   - credit moving: no upfront fee in the beta (LEASE_FEE_MAX = 0; the fee path stays for later),
 *     linked accounts refused both ways, lessees need an established stable (age + Live starts),
 *     reciprocal leases (A to B and B to A) are flagged for review;
 *   - keep the market alive: few horses out on lease per owner (a share of their racing string),
 *     few open offers, a cooldown before a returned horse is offered again, short terms only;
 *   - welfare: a leased horse can't be entered tired, can't be ridden all out unless the owner
 *     allows it, has a weekly Live-start cap set by the owner, and comes home after a moderate or
 *     worse injury; condition is recorded at the start and the return; owners rate lessees;
 *   - cornering: at most MAX_LEASES_PER_LESSEE leases per stable (each needs a free stall), and
 *     the lease board shuffles listings of similar quality daily.
 *
 * Integer maths only, like the rest of game-core.
 */
import { MS_PER_DAY } from "./time";

// ---------------------------------------------------------------------------
// Terms and money
// ---------------------------------------------------------------------------

/** Lease terms on offer, in days (nothing longer). The term starts when the lease is taken. */
export const LEASE_TERMS_DAYS = [7, 14, 28] as const;
export type LeaseTermDays = (typeof LEASE_TERMS_DAYS)[number];

/** The owner's share of every purse the horse wins on lease, in whole percent: at least this ... */
export const LEASE_OWNER_SHARE_MIN_PCT = 30;
/** ... and at most this. The lessee gets the rest (so the lessee always keeps at least 20%). */
export const LEASE_OWNER_SHARE_MAX_PCT = 80;
/** The owner's share the offer form starts at. */
export const LEASE_OWNER_SHARE_DEFAULT_PCT = 50;

/**
 * Highest upfront lease fee in credits. 0 in the beta: the prize split is the only money a lease
 * moves (an upfront fee is a straight credit transfer between two players, the easiest way for an
 * alt to pay a main). The code path is kept: set this to e.g. 2,000 to allow fees, which are then
 * capped by LEASE_FEE_APPRAISAL_PERMILLE of the horse's appraisal and LEASE_FEE_CUT_PERMILLE burned.
 */
export const LEASE_FEE_MAX = 0;
/** When fees are enabled: the fee is at most this share (permille) of the horse's appraisal. */
export const LEASE_FEE_APPRAISAL_PERMILLE = 100;
/** When fees are enabled: platform cut of the fee, permille, burned (a credit sink). */
export const LEASE_FEE_CUT_PERMILLE = 100;

/** An open lease offer stays on the board this many days, then lapses. */
export const LEASE_OFFER_DAYS = 7;

/**
 * A lease needs this many career starts left (of the 40): a horse about to run out of starts is
 * not worth a term, and the lessee should get real racing out of it.
 */
export const LEASE_MIN_STARTS_LEFT = 5;

// ---------------------------------------------------------------------------
// Caps (keep the market alive, stop cornering)
// ---------------------------------------------------------------------------

/** Horses one owner may have out on lease at once: at most this many ... */
export const MAX_LEASES_OUT_PER_OWNER = 3;
/** ... and at most this share (permille) of the owner's racing horses, rounded down ... */
export const LEASES_OUT_SHARE_PERMILLE = 250;
/** ... but always at least this many (a small stable can still lease one horse). */
export const MIN_LEASES_OUT_PER_OWNER = 1;
/** Open lease offers one owner may have on the board at once. */
export const MAX_OPEN_LEASE_OFFERS = 3;
/** Horses one stable may hold on lease at once (each also needs a free stall). */
export const MAX_LEASES_PER_LESSEE = 2;
/** A horse back from a lease can't be offered again for this many days. */
export const LEASE_RELIST_COOLDOWN_DAYS = 7;

// ---------------------------------------------------------------------------
// Lessee eligibility (fresh alts can't lease)
// ---------------------------------------------------------------------------

/** The lessee's account must be at least this many days old. */
export const LESSEE_MIN_ACCOUNT_DAYS = 7;
/** The lessee's stable must have run at least this many Live starts (settled races). */
export const LESSEE_MIN_LIVE_STARTS = 10;
/** Leases between the same two stables in opposite directions within this window are flagged. */
export const LEASE_RECIPROCAL_WINDOW_DAYS = 14;

// ---------------------------------------------------------------------------
// Welfare
// ---------------------------------------------------------------------------

/** Owner's weekly cap on Live starts for the leased horse (per UTC week): at least ... */
export const LEASE_WEEKLY_STARTS_MIN = 2;
/** ... at most ... */
export const LEASE_WEEKLY_STARTS_MAX = 7;
/** ... and this by default. */
export const LEASE_WEEKLY_STARTS_DEFAULT = 4;
/** Owner ratings of a lessee: 1..5 stars, once per finished lease. */
export const LEASE_RATING_MIN = 1;
export const LEASE_RATING_MAX = 5;
/**
 * A lessee nobody has rated yet counts as this many stars against an owner's minimum rating
 * (so a listing asking for 4+ stars needs a proven lessee, while 3 or less lets newcomers in).
 */
export const LEASE_UNRATED_STARS = 3;
/** Injuries on lease that send the horse home straight after the race (the lease ends early). */
export const LEASE_INJURY_RETURNS: readonly string[] = ["moderate", "career_ending", "fatal"];

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------

/** Highest upfront fee the owner may ask for a horse with this appraisal (0 while fees are off). */
export function leaseFeeCap(appraisal: number, feeMax: number = LEASE_FEE_MAX): number {
  if (feeMax <= 0) return 0;
  return Math.min(feeMax, Math.floor((Math.max(0, appraisal) * LEASE_FEE_APPRAISAL_PERMILLE) / 1000));
}

/** The upfront fee split: the platform cut (burned) and what the owner receives. */
export function leaseFeeSplit(fee: number): { cut: number; ownerReceives: number } {
  const cut = Math.floor((fee * LEASE_FEE_CUT_PERMILLE) / 1000);
  return { cut, ownerReceives: fee - cut };
}

/**
 * A purse won on lease, split: the owner's share rounded down, the lessee gets the rest (so the
 * rounding always goes to the lessee and owner + lessee === prize exactly).
 */
export function leaseShareSplit(prize: number, ownerSharePct: number): { owner: number; lessee: number } {
  if (prize <= 0) return { owner: 0, lessee: 0 };
  const owner = Math.floor((prize * ownerSharePct) / 100);
  return { owner, lessee: prize - owner };
}

/** When a lease taken at `startMs` for `termDays` ends. */
export function leaseEndsAtMs(startMs: number, termDays: number): number {
  return startMs + termDays * MS_PER_DAY;
}

/** How many horses an owner with `racingHorses` racing horses may have out on lease at once. */
export function maxLeasesOut(racingHorses: number): number {
  const byShare = Math.floor((Math.max(0, racingHorses) * LEASES_OUT_SHARE_PERMILLE) / 1000);
  return Math.min(MAX_LEASES_OUT_PER_OWNER, Math.max(MIN_LEASES_OUT_PER_OWNER, byShare));
}

/** A lessee's average star rating in tenths (e.g. 43 = 4.3 stars), or null when unrated. */
export function averageStarsTenths(sum: number, count: number): number | null {
  if (count <= 0) return null;
  return Math.floor((sum * 10 + Math.floor(count / 2)) / count);
}

/** Whether a lessee with this rating record meets an owner's minimum (null = no minimum). */
export function meetsMinRating(sum: number, count: number, minStars: number | null): boolean {
  if (minStars === null) return true;
  if (count <= 0) return LEASE_UNRATED_STARS >= minStars;
  return sum >= minStars * count;
}

export type LeaseConditionLabel = "fresh" | "tired" | "injured";

/** The condition report label for a horse at the start or the end of a lease. */
export function leaseConditionLabel(c: { fatigue: number; injured: boolean }, tiredThreshold: number): LeaseConditionLabel {
  if (c.injured) return "injured";
  return c.fatigue > tiredThreshold ? "tired" : "fresh";
}

export interface LeaseOfferInput {
  termDays: number;
  ownerSharePct: number;
  fee: number;
  /** leaseFeeCap(appraisal) of the horse being offered. */
  feeCap: number;
  maxLiveStartsPerWeek: number;
  /** Minimum lessee rating in stars, or null for none. */
  minLesseeRating: number | null;
}

export type LeaseOfferProblem = "term" | "share" | "fee" | "weekly_starts" | "min_rating";

/** Checks an offer's terms. Returns the first problem, or null. */
export function leaseOfferProblem(o: LeaseOfferInput): LeaseOfferProblem | null {
  if (!(LEASE_TERMS_DAYS as readonly number[]).includes(o.termDays)) return "term";
  if (!Number.isInteger(o.ownerSharePct) || o.ownerSharePct < LEASE_OWNER_SHARE_MIN_PCT || o.ownerSharePct > LEASE_OWNER_SHARE_MAX_PCT) return "share";
  if (!Number.isSafeInteger(o.fee) || o.fee < 0 || o.fee > o.feeCap) return "fee";
  if (!Number.isInteger(o.maxLiveStartsPerWeek) || o.maxLiveStartsPerWeek < LEASE_WEEKLY_STARTS_MIN || o.maxLiveStartsPerWeek > LEASE_WEEKLY_STARTS_MAX) return "weekly_starts";
  if (o.minLesseeRating !== null && (!Number.isInteger(o.minLesseeRating) || o.minLesseeRating < LEASE_RATING_MIN || o.minLesseeRating > LEASE_RATING_MAX)) return "min_rating";
  return null;
}

/** Plain-words text for an offer problem. */
export function leaseOfferProblemText(p: LeaseOfferProblem, feeCap: number): string {
  switch (p) {
    case "term":
      return `Choose a term of ${LEASE_TERMS_DAYS.join(", ")} days.`;
    case "share":
      return `Your share of the prizes must be ${LEASE_OWNER_SHARE_MIN_PCT}–${LEASE_OWNER_SHARE_MAX_PCT}%.`;
    case "fee":
      return feeCap > 0 ? `The upfront fee can be 0 to ${feeCap} credits for this horse.` : "Leases have no upfront fee: the prize split is the price.";
    case "weekly_starts":
      return `Weekly Live starts must be ${LEASE_WEEKLY_STARTS_MIN}–${LEASE_WEEKLY_STARTS_MAX}.`;
    case "min_rating":
      return `A minimum lessee rating is ${LEASE_RATING_MIN}–${LEASE_RATING_MAX} stars (or none).`;
  }
}

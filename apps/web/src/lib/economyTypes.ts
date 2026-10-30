/**
 * Shapes the economy screens (breeding barn, stud book, packs, market) receive. Types only:
 * safe to import from client components.
 */
import type { Horse, Silks } from "@thoroughbred/shared";
import type { BreedingFees, BreedingPreview, PityState } from "@thoroughbred/game-core";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type PackType = "paddock" | "premium";

/** A horse as the economy screens show it. */
export interface EcoHorse {
  id: string;
  horse: Horse;
  /** One-line genetics, e.g. "bay roan · Sabino · 88% TB" (null for legacy rows). */
  geneticsLine: string | null;
  stage: string;
  careerStatus: "racing" | "retired" | "pasture";
  starts: number;
  rating: number;
}

// ---------------------------------------------------------------------------
// Breeding
// ---------------------------------------------------------------------------

export interface BreedingHorse extends EcoHorse {
  /** null = can breed now. */
  block: string | null;
  /** Plain-words reason when blocked. */
  reason: string | null;
  used: number;
  lifetime: number;
  usedThisSeason: number;
  perSeason: number;
  /** Standing at stud (stallions). */
  studFee: number | null;
  /** Highest stud fee this stallion may stand at (his appraisal, game-core studFeeCeiling); null for legacy rows. */
  studFeeMax?: number | null;
  /** Standing at stud for a USDG fee instead (micro-USDG; registered stallions only). */
  studFeeUsdg?: number | null;
  /** Registered for the USDG market (may stand for a USDG fee). */
  usdgRegistered?: boolean;
}

export interface StudView extends EcoHorse {
  /** Credits stud fee (0 when he stands for USDG). */
  studFee: number;
  /** USDG stud fee (micro-USDG), paid on-chain to his owner; null = a credits stud. */
  studFeeUsdg: number | null;
  stableName: string;
  silks: Silks;
  mine: boolean;
  /** A Club house stallion (fee to the Club; always available to breed with). */
  club: boolean;
  block: string | null;
  reason: string | null;
  used: number;
  lifetime: number;
}

export interface PregnancyCard {
  id: string;
  damId: string;
  damName: string;
  sireId: string;
  sireName: string;
  conceivedAtMs: number;
  dueAtMs: number;
  /** sha256 of the inheritance seed, sealed at covering. */
  seedCommitment: string;
  /** Revealed at foaling. */
  seed: string | null;
  status: "carrying" | "foaled";
  coiPermille: number;
  foal: EcoHorse | null;
}

export interface BreedingView {
  season: number;
  seasonEndsAtMs: number;
  baseFee: number;
  studBurnPermille: number;
  lifetime: number;
  minStarts: number;
  pregnancyMs: number;
  mares: BreedingHorse[];
  stallions: BreedingHorse[];
  /** Other stables' stallions at stud (yours are in `stallions`). */
  studs: StudView[];
  pregnancies: PregnancyCard[];
  credits: number;
  stalls: { used: number; slots: number; overflow: boolean };
  /** USDG stud fees (registered stallions): null while the USDG market is off. Amounts micro-USDG. */
  usdg: { mock: boolean; feeBps: number; studFeeMin: number; studFeeMax: number; quoteMinutes: number } | null;
  serverNowMs: number;
}

export interface PreviewView {
  sireId: string;
  damId: string;
  sireName: string;
  damName: string;
  ownSire: boolean;
  /** null = this cover can go ahead. */
  block: string | null;
  reason: string | null;
  preview: BreedingPreview;
  fees: BreedingFees;
  /** The stallion stands for a USDG stud fee (micro-USDG), paid on-chain to his owner: not in credits. */
  usdgStudFee: number | null;
  /** The market fee out of it (to the Club), and the stable that receives the rest. */
  usdgFee: number | null;
  stallionOwner: string | null;
  parents: { sire: number; dam: number };
  /**
   * Where the predicted foal's overall would rank among the game's horses: "top N%" for its
   * p10 / p50 / p90 outcomes (lower is better).
   */
  topPercent: { p10: number; p50: number; p90: number } | null;
  populationSize: number;
  credits: number;
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

export interface PackOffer {
  type: PackType;
  name: string;
  price: number;
  /** Published odds, basis points (sum 10,000). */
  odds: { rarity: Rarity; bp: number }[];
  /** Pity: guaranteed minimum within N pulls, with the player's current count. */
  pity: { min: Rarity; within: number; since: number; left: number }[];
  paidThisWeek: number;
  weeklyLimit: number;
  freeAvailable: number;
  totalPulls: number;
  nextSeedCommitment: string;
  /** Can this pack be pulled right now (credits)? */
  enabled: boolean;
  /** Why not (shown on the button). */
  disabledReason: string | null;
  /** Premium is a demo: no real payments in Phase 1. */
  demo: boolean;
}

export interface PullRow {
  id: string;
  packType: PackType;
  pullIndex: number;
  rarity: Rarity;
  pityApplied: "rare" | "epic" | null;
  horseId: string | null;
  horseName: string | null;
  /** One-line genetics of the pulled foal (null for legacy rows). */
  geneticsLine: string | null;
  free: boolean;
  price: number;
  createdAtMs: number;
  seedCommitment: string;
}

export interface PacksView {
  paddock: PackOffer;
  premium: PackOffer;
  crop: { season: number; cap: number; produced: number; remaining: number };
  playDays: number;
  freeEvery: number;
  /** Play day on which the next free Paddock Pack is earned. */
  nextFreeAtPlayDay: number;
  /** Every pack foal's potential per stat is at most this (the season ceiling). */
  ceiling: number;
  credits: number;
  stalls: { used: number; slots: number; free: number };
  pulls: PullRow[];
  serverNowMs: number;
}

export interface PullResultView {
  pull: PullRow;
  foal: EcoHorse | null;
  seedReveal: string;
  nextSeedCommitment: string;
  duplicate: boolean;
}

export interface PullProofView {
  pull: PullRow;
  accountId: string;
  seasonNumber: number;
  seedReveal: string;
  chain: { pullIndex: number; seedReveal: string; seasonNumber: number; rarity: string }[];
  pityBefore: PityState;
  genome: unknown;
  sex: "colt" | "filly" | null;
  checks: Record<"commitment" | "chain" | "rarity" | "pity" | "genome" | "sex", boolean>;
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export interface ListingView extends EcoHorse {
  listingId: string;
  price: number;
  appraisal: number;
  /** 5% burned on sale. */
  fee: number;
  sellerReceives: number;
  sellerStableName: string;
  sellerSilks: Silks;
  expiresAtMs: number;
  mine: boolean;
  /** Sale catalogue lot number (stable for the listing's life). */
  lot: number;
  sireName: string | null;
  damName: string | null;
}

export interface SellableHorse extends EcoHorse {
  appraisal: number;
  floor: number;
  /** Maximum listing price: 3x the appraisal. */
  ceiling: number;
  /** null = can be listed (if the seller requirements are met). */
  lock: string | null;
  lockReason: string | null;
  /** While lock === "resale_lock": when the horse was bought and when it can be listed again. */
  boughtAtMs: number | null;
  resaleUntilMs: number | null;
  listingId: string | null;
}

export interface SellerView {
  ok: boolean;
  accountAgeDays: number;
  minAccountAgeDays: number;
  oldEnoughAtMs: number | null;
  races: number;
  minRaces: number;
  emailVerified: boolean;
  /** A verified email is only required when MARKET_REQUIRE_VERIFIED_EMAIL is on. */
  emailRequired: boolean;
  missing: string[];
}

export interface MarketView {
  listings: ListingView[];
  mine: ListingView[];
  horses: SellableHorse[];
  seller: SellerView;
  feePermille: number;
  floorPermille: number;
  ceilingPermille: number;
  maxListingDays: number;
  credits: number;
  stalls: { used: number; slots: number; free: number };
  serverNowMs: number;
}

// ---------------------------------------------------------------------------
// Leasing (Sales > Lease; packages/db leasing.ts, numbers in game-core leasing.ts)
// ---------------------------------------------------------------------------

/** A lessee's public record (lease board, owners' views). */
export interface LesseeRecordView {
  leases: number;
  races: number;
  injuries: number;
  /** Average fatigue (0..1000) of horses when entered on lease; null = none yet. */
  avgFatigueAtEntry: number | null;
  ratings: number;
  /** Average stars in tenths (43 = 4.3); null when unrated. */
  starsTenths: number | null;
}

export interface LeaseTermsView {
  termDays: number;
  ownerSharePct: number;
  lesseeSharePct: number;
  fee: number;
  allowAllOut: boolean;
  maxLiveStartsPerWeek: number;
  minLesseeRating: number | null;
}

/** One open offer on the lease board. */
export interface LeaseListingView extends EcoHorse, LeaseTermsView {
  listingId: string;
  ownerStableName: string;
  ownerSilks: Silks;
  /** Last three finishing positions, newest first. */
  form: number[];
  wins: number;
  expiresAtMs: number;
  /** The owner has never leased a horse out before. */
  newOwner: boolean;
  mine: boolean;
  /** Why the viewer can't take it (null = they can). */
  takeBlock: string | null;
}

/** One of the viewer's own horses on the Offer list. */
export interface LeaseOfferable extends EcoHorse {
  /** Why it can't be offered right now (null = it can). */
  block: string | null;
  /** Its open offer, if any. */
  offerId: string | null;
  feeCap: number;
}

/** A lease the viewer is part of (as owner or lessee): active, or ended in the last 30 days. */
export interface LeaseRowView {
  leaseId: string;
  role: "owner" | "lessee";
  horse: EcoHorse;
  otherStableName: string;
  status: "active" | "ended";
  endReason: string | null;
  startsAtMs: number;
  endsAtMs: number;
  endedAtMs: number | null;
  ownerSharePct: number;
  allowAllOut: boolean;
  maxLiveStartsPerWeek: number;
  races: number;
  ownerEarned: number;
  lesseeEarned: number;
  returnPending: boolean;
  startCondition: string | null;
  endCondition: string | null;
  ownerRating: number | null;
  /** The owner may rate this (ended, not yet rated). */
  canRate: boolean;
  /** The lessee's record (owners see who has their horse). */
  lesseeRecord: LesseeRecordView | null;
}

export interface LeaseOfferRow extends LeaseTermsView {
  listingId: string;
  horseId: string;
  horseName: string;
  expiresAtMs: number;
}

export interface LeaseView {
  board: LeaseListingView[];
  offers: LeaseOfferRow[];
  leases: LeaseRowView[];
  horses: LeaseOfferable[];
  me: {
    /** Can this stable take leases (account age, Live starts, lease cap)? */
    eligible: boolean;
    problems: string[];
    accountAgeDays: number;
    liveStarts: number;
    activeLeases: number;
    record: LesseeRecordView;
    caps: { racingHorses: number; maxOut: number; out: number; openOffers: number; maxOpenOffers: number };
  };
  config: LeaseConfigView;
  stalls: { used: number; slots: number; free: number };
  serverNowMs: number;
}

export interface LeaseConfigView {
  terms: number[];
  shareMin: number;
  shareMax: number;
  shareDefault: number;
  weeklyMin: number;
  weeklyMax: number;
  weeklyDefault: number;
  feeMax: number;
  offerDays: number;
  cooldownDays: number;
  maxLesseeLeases: number;
  maxOpenOffers: number;
  maxOutCap: number;
  outSharePct: number;
  minAccountDays: number;
  minLiveStarts: number;
  unratedStars: number;
  minStartsLeft: number;
}

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
}

export interface StudView extends EcoHorse {
  studFee: number;
  stableName: string;
  silks: Silks;
  mine: boolean;
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
}

export interface SellableHorse extends EcoHorse {
  appraisal: number;
  floor: number;
  /** null = can be listed (if the seller requirements are met). */
  lock: string | null;
  lockReason: string | null;
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
  missing: string[];
}

export interface MarketView {
  listings: ListingView[];
  mine: ListingView[];
  horses: SellableHorse[];
  seller: SellerView;
  feePermille: number;
  floorPermille: number;
  maxListingDays: number;
  credits: number;
  stalls: { used: number; slots: number; free: number };
  serverNowMs: number;
}

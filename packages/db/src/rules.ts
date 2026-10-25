/**
 * Hard rules the persistence layer enforces (game-design §4a + amendments, §4b, §7, §8), plus the pluggable
 * game hooks. Pure rule maths (genetics, ratings, injury risk, pack odds) belongs to
 * @thoroughbred/game-core; the web app passes game-core implementations in `GameHooks`.
 * The defaults here are deterministic placeholders so the database layer is usable and
 * testable on its own.
 */
import { seededUniform } from "./crypto";
import type { HorseRow, RaceRow } from "./schema";

export const RULES = {
  /** Career clock (§4a amendments): juvenile 0-6, prime 7-28, veteran 29-40, retire at 40. */
  maxStarts: 40,
  juvenileUntilStarts: 6,
  primeUntilStarts: 28,
  /** Foal growth by counted care sessions: 5 to wean, +7 yearling, +7 racing age. */
  careToWean: 5,
  careToYearling: 12,
  careToRacing: 19,
  /** Breeding (§4a / §7). */
  breedingLifetimeLimit: 4,
  marePerSeason: 1,
  stallionPerSeason: 4,
  /** Racing horses may breed from this many starts; racing-retired horses always may. */
  breedingMinStarts: 25,
  pregnancyMs: 24 * 60 * 60 * 1000,
  breedingBaseFee: 250,
  studPlatformBps: 1000,
  /** Racing. Hard cap of starts per horse per UTC day (by post time). */
  startsPerDay: 3,
  purseSplitBps: [6000, 2000, 1000, 500, 300, 200] as readonly number[],
  insurancePremium: 300,
  insurancePayout: 2_000,
  /** Market (§4b): 5% burned fee, price floor at 70% of appraisal, seller requirements. */
  marketFeeBps: 500,
  listingFloorBps: 7000,
  maxListingMs: 14 * 24 * 60 * 60 * 1000,
  sellerMinAccountAgeMs: 7 * 24 * 60 * 60 * 1000,
  sellerMinRaces: 20,
  /** Release to the Club pays a few credits. */
  releasePayout: 50,
  /** Accounts / stables. */
  startingCredits: 5_000,
  starterHorses: 3,
  defaultStallSlots: 6,
  maxStallSlots: 24,
  /** Foaling may use one nursery overflow slot beyond the stalls. */
  nurseryOverflowSlots: 1,
  /** Packs (§4b): free Paddock every 3rd play day; weekly purchase limits; global crop. */
  freePaddockEveryPlayDays: 3,
  paidPaddockPerWeek: 3,
  premiumPerWeek: 10,
  foalCropPerSeason: 10_000,
  /** Care brings an injury's recovery end forward by this much (vet nurse effect). */
  careHealMs: 12 * 60 * 60 * 1000,
  /** Competition seasons: 4 real weeks from this epoch (a Monday). */
  seasonEpochMs: Date.UTC(2026, 0, 5),
  seasonMs: 28 * 24 * 60 * 60 * 1000,
} as const;

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export const RARITY_ORDER: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

export interface PackDefinition {
  price: number;
  /** Published odds; weights sum to 1. */
  odds: Partial<Record<Rarity, number>>;
  /** Guarantee Rare-or-better within `rare` pulls and Epic-or-better within `epic` pulls. */
  pity: { rare: number; epic: number } | null;
}

export const PACKS: Record<string, PackDefinition> = {
  paddock: { price: 500, odds: { common: 0.75, uncommon: 0.25 }, pity: null },
  premium: {
    price: 2_500,
    odds: { common: 0.5, uncommon: 0.3, rare: 0.15, epic: 0.045, legendary: 0.005 },
    pity: { rare: 10, epic: 50 },
  },
};

export type Stage = "foal" | "weanling" | "yearling" | "juvenile" | "prime" | "veteran";

/** Stage from the career clock (care sessions in the nursery, then starts). Never from time. */
export function stageFor(careSessions: number, starts: number): Stage {
  if (careSessions < RULES.careToWean) return "foal";
  if (careSessions < RULES.careToYearling) return "weanling";
  if (careSessions < RULES.careToRacing) return "yearling";
  if (starts <= RULES.juvenileUntilStarts) return "juvenile";
  if (starts <= RULES.primeUntilStarts) return "prime";
  return "veteran";
}

export function seasonNumberAt(at: Date): number {
  return Math.max(1, Math.floor((at.getTime() - RULES.seasonEpochMs) / RULES.seasonMs) + 1);
}

export function seasonBounds(n: number): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(RULES.seasonEpochMs + (n - 1) * RULES.seasonMs);
  return { startsAt, endsAt: new Date(startsAt.getTime() + RULES.seasonMs) };
}

export function bps(amount: number, basisPoints: number): number {
  return Math.floor((amount * basisPoints) / 10_000);
}

// ---------------------------------------------------------------------------
// Game hooks (game-core injection points)
// ---------------------------------------------------------------------------

/** Everything needed to create a horse row; produced by game-core in production. */
export interface HorseSpec {
  name: string;
  sex: "male" | "female";
  genome: unknown;
  appearance: unknown;
  stats: unknown;
  maturityType?: "early" | "normal" | "late";
  rating?: number;
  /** Nursery progress at creation (starters arrive at racing age = 19; pack horses are foals = 0). */
  careSessions?: number;
}

export interface RaceEligibilityInput {
  horse: HorseRow;
  race: RaceRow;
  now: Date;
}

export interface GameHooks {
  /** A starter horse for a brand-new stable (deterministic from the seed). */
  starterHorse(input: { seed: string; index: number }): HorseSpec;
  /** A pack horse of the given rarity (under the genetic ceiling). */
  packHorse(input: { seed: string; rarity: Rarity; packType: string }): HorseSpec;
  /** Inheritance: the foal of `sire` x `dam` from the committed seed. */
  breedFoal(input: { seed: string; sire: HorseRow; dam: HorseRow; name?: string }): HorseSpec;
  /** Extra race eligibility (class, rating band, conditions). Return a reason to refuse, or null. */
  raceEligibility?(input: RaceEligibilityInput): string | null;
  /** Rarity roll from a uniform in [0,1) and the pack's published odds. */
  rollRarity?(input: { u: number; pack: PackDefinition }): Rarity;
  /** Appraised market value in credits (listing floor = 70% of it). */
  appraise?(horse: HorseRow): number;
}

const NAMES_A = ["Copper", "Velvet", "Amber", "Harbour", "Quiet", "Northern", "Saffron", "Moonlit", "Brass", "Willow"];
const NAMES_B = ["Ledger", "Reverie", "Promise", "Comet", "Lantern", "Meridian", "Sonnet", "Parade", "Echo", "Waltz"];
const STAT_KEYS = ["speed", "stamina", "burst", "durability", "adaptability", "temperament"] as const;

function placeholderSpec(seed: string, label: string, ceiling: number, careSessions: number, name?: string): HorseSpec {
  const u = seededUniform(seed, label);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(u() * xs.length)]!;
  const alleles = Object.fromEntries(
    STAT_KEYS.map((k) => [k, [Math.round(300 + u() * (ceiling - 300)), Math.round(300 + u() * (ceiling - 300))]]),
  );
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, Math.round(((alleles[k] as number[])[0]! + (alleles[k] as number[])[1]!) / 2)]));
  return {
    name: name ?? `${pick(NAMES_A)} ${pick(NAMES_B)}`,
    sex: u() < 0.5 ? "male" : "female",
    genome: { placeholder: true, version: 0, alleles },
    appearance: { coat: pick(["bay", "chestnut", "black", "grey"]), face: "none", legs: ["none", "none", "none", "none"] },
    stats,
    maturityType: pick(["early", "normal", "late"] as const),
    careSessions,
  };
}

const RARITY_CEILING: Record<Rarity, number> = { common: 520, uncommon: 560, rare: 600, epic: 640, legendary: 680 };

/** Deterministic placeholder hooks. Replace with game-core in the web app. */
export const defaultHooks: GameHooks = {
  starterHorse: ({ seed, index }) => placeholderSpec(seed, `starter:${index}`, 520, RULES.careToRacing),
  packHorse: ({ seed, rarity }) => placeholderSpec(seed, `pack:${rarity}`, RARITY_CEILING[rarity], 0),
  breedFoal: ({ seed, sire, dam, name }) => {
    const spec = placeholderSpec(seed, `foal:${sire.id}:${dam.id}`, 640, 0, name);
    return { ...spec, careSessions: 0 };
  },
};

export function defaultRollRarity({ u, pack }: { u: number; pack: PackDefinition }): Rarity {
  let acc = 0;
  for (const r of RARITY_ORDER) {
    acc += pack.odds[r] ?? 0;
    if (u < acc) return r;
  }
  // Floating-point tail (u just below 1): the last tier offered.
  return [...RARITY_ORDER].reverse().find((r) => (pack.odds[r] ?? 0) > 0) ?? "common";
}

/** Fallback appraisal: rating, career stage and remaining breedings. game-core replaces it. */
export function defaultAppraise(h: HorseRow): number {
  const base = 400 + h.rating * 40;
  const careerLeft = h.careerStatus === "racing" ? (RULES.maxStarts - h.starts) / RULES.maxStarts : 0;
  const breedLeft = (RULES.breedingLifetimeLimit - h.breedingCount) / RULES.breedingLifetimeLimit;
  return Math.max(100, Math.round(base * (0.5 + careerLeft) + 300 * breedLeft));
}

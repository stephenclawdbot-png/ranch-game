/**
 * Hard rules the persistence layer enforces (game-design §4a + amendments, §4b, §7, §8), plus the pluggable
 * game hooks. Pure rule maths (genetics, ratings, injury risk, pack odds) belongs to
 * @thoroughbred/game-core; the web app passes game-core implementations in `GameHooks`.
 * The defaults here are deterministic placeholders so the database layer is usable and
 * testable on its own.
 */
import * as gc from "@thoroughbred/game-core";
import { seededUniform } from "./crypto";
import type { HorseRow, RaceRow } from "./schema";

export const RULES = {
  /** Career clock (§4a amendments): juvenile 0-6, prime 7-28, veteran 29-40, retire at 40. */
  maxStarts: gc.CAREER_MAX_STARTS,
  juvenileUntilStarts: gc.JUVENILE_MAX_STARTS,
  primeUntilStarts: gc.PRIME_MAX_STARTS,
  /** Foal growth by counted care sessions: 5 to wean, +7 yearling, +7 racing age. */
  careToWean: gc.CARE_TO_WEAN,
  careToYearling: gc.CARE_TO_YEARLING,
  careToRacing: gc.CARE_TO_RACING,
  /** Breeding (§4a / §7). */
  breedingLifetimeLimit: gc.BREEDINGS_LIFETIME,
  marePerSeason: gc.MARE_PER_SEASON,
  stallionPerSeason: gc.STALLION_PER_SEASON,
  /** Racing horses may breed from this many starts; racing-retired horses always may. */
  breedingMinStarts: gc.BREED_FROM_STARTS,
  pregnancyMs: gc.PREGNANCY_MS,
  breedingBaseFee: gc.BREEDING_BASE_FEE,
  studPlatformBps: gc.STUD_FEE_BURN_PERMILLE * 10,
  /** Racing. Hard cap of starts per horse per UTC day (by post time). */
  startsPerDay: gc.MAX_STARTS_PER_DAY,
  /** Live races (scheduled, feature, final) per horse per day. */
  liveStartsPerDay: gc.MAX_LIVE_STARTS_PER_DAY,
  /** Same split as the engine's PRIZE_SPLIT_PCT, so the result board and the ledger agree. */
  purseSplitBps: [5500, 2000, 1200, 700, 400, 200] as readonly number[],
  insurancePremium: 300,
  insurancePayout: 2_000,
  /** Market (§4b): 5% burned fee, price floor at 70% of appraisal, ceiling at 3x (AUDIT §6), 72 h resale lock, seller requirements. */
  marketFeeBps: gc.MARKET_FEE_PERMILLE * 10,
  listingFloorBps: gc.LISTING_FLOOR_PERMILLE * 10,
  listingCeilingBps: gc.LISTING_CEILING_PERMILLE * 10,
  resaleLockMs: gc.RESALE_LOCK_MS,
  maxListingMs: 14 * 24 * 60 * 60 * 1000,
  sellerMinAccountAgeMs: gc.SELLER_MIN_AGE_DAYS * 24 * 60 * 60 * 1000,
  sellerMinRaces: gc.SELLER_MIN_RACES,
  /** Release to the Club pays a few credits. */
  releasePayout: 50,
  /** Accounts / stables. */
  startingCredits: gc.STARTER_GRANT,
  starterHorses: 3,
  defaultStallSlots: gc.BASE_STALLS,
  maxStallSlots: gc.MAX_STALLS,
  /** Foaling may use one nursery overflow slot beyond the stalls. */
  nurseryOverflowSlots: 1,
  /** Packs (§4b): free Paddock every 3rd play day; weekly purchase limits; global crop. */
  freePaddockEveryPlayDays: gc.FREE_PADDOCK_EVERY_PLAY_DAYS,
  paidPaddockPerWeek: gc.PADDOCK_CREDIT_BUYS_PER_WEEK,
  premiumPerWeek: gc.PREMIUM_PER_WEEK,
  foalCropPerSeason: gc.SEASON_FOAL_CROP_CAP,
  /** Care brings an injury's recovery end forward by this much (vet nurse effect). */
  careHealMs: 12 * 60 * 60 * 1000,
  /** Stable entries (§4f). */
  entryDailyAllowance: gc.ENTRY_DAILY_BASE,
  entryBankCap: gc.ENTRY_BANK_BASE,
  entryMaxAllowance: gc.ENTRY_DAILY_MAX,
  entryMaxCap: gc.ENTRY_BANK_MAX,
  entryRefillAmount: gc.ENTRY_REFILL_AMOUNT,
  /** Refill only while the bank is below this. */
  entryRefillBelow: gc.ENTRY_REFILL_BELOW,
  entryRefillPrice: gc.ENTRY_REFILL_COST,
  timezoneChangeMs: gc.TZ_CHANGE_MIN_DAYS * 24 * 60 * 60 * 1000,
  /** Live card (§4d): a race every 15 minutes (game-core SLOT_INTERVAL_MS); entries close 30 s before the off. */
  slotMs: gc.SLOT_INTERVAL_MS,
  entriesCloseBeforePostMs: gc.ENTRY_CLOSE_BEFORE_MS,
  /**
   * How far ahead the card is published (entries open at publication). Six hours = 24 races
   * at 15-minute spacing: one whole class cycle (20 races) is always open, so every horse can
   * be entered now in a race that suits it later in the day.
   */
  cardHorizonMs: 6 * 60 * 60 * 1000,
  minField: 8,
  maxField: 12,
  /** Settle once the broadcast is surely over (races run < 150 s). */
  settleAfterPostMs: 150 * 1000,
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

const oddsOf = (t: gc.PackType) => Object.fromEntries(Object.entries(gc.PACK_ODDS[t]).map(([r, v]) => [r, v / 10_000])) as PackDefinition["odds"];

/** Pity in PackDefinition's shape, straight from game-core's PACK_PITY (never hardcoded here). */
const pityOf = (t: gc.PackType): PackDefinition["pity"] => {
  const within = (min: Rarity) => gc.PACK_PITY[t].find((p) => p.min === min)?.within;
  const rare = within("rare");
  const epic = within("epic");
  return rare !== undefined && epic !== undefined ? { rare, epic } : null;
};

/** Published odds and pity come from game-core (PACK_ODDS / PACK_PITY); the pull itself is gc.pullPack. */
export const PACKS: Record<string, PackDefinition> = {
  paddock: { price: gc.PADDOCK_PACK_PRICE, odds: oddsOf("paddock"), pity: pityOf("paddock") },
  /** Premium is mocked in Phase 1 (credits). */
  premium: { price: 2_500, odds: oddsOf("premium"), pity: pityOf("premium") },
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
  starterHorse(input: { seed: string; index: number; season?: number }): HorseSpec;
  /** A pack horse (a foal) of the given rarity; `genome` when game-core already minted it. */
  packHorse(input: { seed: string; rarity: Rarity; packType: string; season?: number; genome?: unknown; sex?: "colt" | "filly" }): HorseSpec;
  /** Inheritance: the foal of `sire` x `dam` from the committed seed (coi in permille). */
  breedFoal(input: { seed: string; sire: HorseRow; dam: HorseRow; name?: string; coi?: number; season?: number; family?: HorseRow[] }): HorseSpec;
  /** Extra race eligibility (class, rating band, conditions). Return a reason to refuse, or null. */
  raceEligibility?(input: RaceEligibilityInput): string | null;
  /** A house (Club AI) horse for a Live field, deterministic from the race seed. */
  houseHorse?(input: { seed: string; index: number; raceClass: string; rating: number; season?: number }): HorseSpec;
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

/** Placeholder hooks with no genetics (tests of pure persistence). Production uses gameCoreHooks. */
export const placeholderHooks: GameHooks = {
  starterHorse: ({ seed, index }) => placeholderSpec(seed, `starter:${index}`, 520, RULES.careToRacing),
  packHorse: ({ seed, rarity }) => placeholderSpec(seed, `pack:${rarity}`, RARITY_CEILING[rarity], 0),
  breedFoal: ({ seed, sire, dam, name }) => {
    const spec = placeholderSpec(seed, `foal:${sire.id}:${dam.id}`, 640, 0, name);
    return { ...spec, careSessions: 0 };
  },
};


/** Fallback appraisal: rating, career stage and remaining breedings. game-core replaces it. */
export function defaultAppraise(h: HorseRow): number {
  const base = 400 + h.rating * 40;
  const careerLeft = h.careerStatus === "racing" ? (RULES.maxStarts - h.starts) / RULES.maxStarts : 0;
  const breedLeft = (RULES.breedingLifetimeLimit - h.breedingCount) / RULES.breedingLifetimeLimit;
  return Math.max(100, Math.round(base * (0.5 + careerLeft) + 300 * breedLeft));
}

// ---------------------------------------------------------------------------
// Seller requirements (§4b), configurable by environment
// ---------------------------------------------------------------------------

export interface SellerPolicy {
  minAccountAgeDays: number;
  minRaces: number;
  /** A verified email is required to sell. Off by default until an email flow ships. */
  requireVerifiedEmail: boolean;
}

function envInt(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * The market's seller requirements. Env (all optional):
 * - `MARKET_REQUIRE_VERIFIED_EMAIL` = "1"/"true" to require a verified email (default off:
 *   there is no email verification flow yet);
 * - `MARKET_SELLER_MIN_ACCOUNT_DAYS` (default 7);
 * - `MARKET_SELLER_MIN_RACES` (default 20).
 */
export function sellerPolicy(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): SellerPolicy {
  const email = (env.MARKET_REQUIRE_VERIFIED_EMAIL ?? "").trim().toLowerCase();
  return {
    minAccountAgeDays: envInt(env, "MARKET_SELLER_MIN_ACCOUNT_DAYS", gc.SELLER_MIN_AGE_DAYS),
    minRaces: envInt(env, "MARKET_SELLER_MIN_RACES", gc.SELLER_MIN_RACES),
    requireVerifiedEmail: email === "1" || email === "true" || email === "yes",
  };
}

/** The same policy in game-core's shape. */
export function gcSellerPolicy(p: SellerPolicy = sellerPolicy()): gc.SellerPolicy {
  return { minAgeDays: p.minAccountAgeDays, minRaces: p.minRaces, requireVerifiedEmail: p.requireVerifiedEmail };
}

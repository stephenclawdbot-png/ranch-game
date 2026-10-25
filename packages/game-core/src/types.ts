/**
 * @thoroughbred/game-core — core domain types and zod schemas.
 *
 * Everything here is JSON-serialisable (plain objects, arrays, numbers, strings, booleans,
 * null) so `packages/db` can store genomes and horse state as jsonb and re-validate on read.
 *
 * Units:
 *   stats / alleles / permille values -> integers 0..1000
 *   time                              -> ms since epoch (always passed in, never read)
 *   days                              -> integer UTC day index (floor(ms / 86_400_000))
 *   credits                           -> integers (Stable Credits, never cashable)
 *
 * Career clock (game-design §4a): horses age by career activity (care sessions, starts),
 * never by calendar time. Seasons exist only for competitions and the per-season breeding cap.
 */
import { z } from "zod";
import { HorseRecordSchema, RunningStyleSchema, SexSchema, SurfaceSchema, GoingSchema, WeatherSchema } from "@thoroughbred/shared";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const Permille = z.number().int().min(0).max(1000);
export const NonNegInt = z.number().int().min(0);
export const Credits = z.number().int();

export const STAT_KEYS = ["speed", "stamina", "burst", "durability", "adaptability", "temperament"] as const;
export const StatKeySchema = z.enum(STAT_KEYS);
export type StatKey = z.infer<typeof StatKeySchema>;

/** A value per stat. */
export type StatRecord<T> = Record<StatKey, T>;
export function statRecordSchema<T extends z.ZodTypeAny>(v: T) {
  return z.object({ speed: v, stamina: v, burst: v, durability: v, adaptability: v, temperament: v });
}

export const GradeSchema = z.enum(["E", "D", "C", "B", "A", "S"]);
export type Grade = z.infer<typeof GradeSchema>;

export const RaritySchema = z.enum(["common", "uncommon", "rare", "epic", "legendary"]);
export type Rarity = z.infer<typeof RaritySchema>;
export const RARITY_ORDER: readonly Rarity[] = RaritySchema.options;

// ---------------------------------------------------------------------------
// Genome
// ---------------------------------------------------------------------------

/** One allele of a stat locus, 0..1000. */
export const AlleleSchema = Permille;
export const AllelePairSchema = z.tuple([AlleleSchema, AlleleSchema]);
export type AllelePair = z.infer<typeof AllelePairSchema>;

export const DistanceAlleleSchema = z.enum(["sprint", "mile", "middle", "staying"]);
export type DistanceAllele = z.infer<typeof DistanceAlleleSchema>;
/** Surface alleles: TT -> turf, DD -> dirt, TD -> synthetic (the versatile all-weather type). */
export const SurfaceAlleleSchema = z.enum(["T", "D"]);
export type SurfaceAllele = z.infer<typeof SurfaceAlleleSchema>;
/** Maturity alleles: early / normal / late peaker (sum rule: EN -> early, EL -> normal, NL -> late). */
export const MaturityAlleleSchema = z.enum(["early", "normal", "late"]);
export type MaturityAllele = z.infer<typeof MaturityAlleleSchema>;
export const MaturityTypeSchema = MaturityAlleleSchema;
export type MaturityType = MaturityAllele;

export const CoatGenesSchema = z.object({
  /** Extension (MC1R): E dominant (black pigment), e recessive (red). */
  extension: z.tuple([z.enum(["E", "e"]), z.enum(["E", "e"])]),
  /** Agouti (ASIP): A (bay) > At (seal brown / dark bay) > a (non-agouti, black). */
  agouti: z.tuple([z.enum(["A", "At", "a"]), z.enum(["A", "At", "a"])]),
  /** Cream (SLC45A2): incomplete dominant dilution. */
  cream: z.tuple([z.enum(["n", "Cr"]), z.enum(["n", "Cr"])]),
  /** Grey (STX17): dominant, born coloured and greys out with career. */
  grey: z.tuple([z.enum(["n", "G"]), z.enum(["n", "G"])]),
  /** Roan (KIT): dominant. */
  roan: z.tuple([z.enum(["n", "Rn"]), z.enum(["n", "Rn"])]),
  /** Dun (TBX3): dominant dilution with primitive markings. */
  dun: z.tuple([z.enum(["n", "D"]), z.enum(["n", "D"])]),
  /** Liver modifier: recessive l/l darkens chestnut to liver chestnut. */
  liver: z.tuple([z.enum(["L", "l"]), z.enum(["L", "l"])]),
  /** Sabino-1 (KIT): incomplete dominant white patterning. */
  sabino: z.tuple([z.enum(["n", "Sb1"]), z.enum(["n", "Sb1"])]),
});
export type CoatGenes = z.infer<typeof CoatGenesSchema>;

/** Signed polygenic morph allele, -1000..1000 (scaled onto the rig's morph ranges). */
export const MorphAlleleSchema = z.number().int().min(-1000).max(1000);
export const MORPH_KEYS = ["legLength", "neckLength", "girth", "height", "headSize"] as const;
export type MorphKey = (typeof MORPH_KEYS)[number];
export const MorphGenesSchema = z.object({
  legLength: z.tuple([MorphAlleleSchema, MorphAlleleSchema]),
  neckLength: z.tuple([MorphAlleleSchema, MorphAlleleSchema]),
  girth: z.tuple([MorphAlleleSchema, MorphAlleleSchema]),
  height: z.tuple([MorphAlleleSchema, MorphAlleleSchema]),
  headSize: z.tuple([MorphAlleleSchema, MorphAlleleSchema]),
});
export type MorphGenes = z.infer<typeof MorphGenesSchema>;

/** Categorical part-variant alleles (lower index is dominant), map to pixel-rig `variants`. */
const VariantAllele = z.number().int().min(0).max(7);
export const VariantGenesSchema = z.object({
  head: z.tuple([VariantAllele, VariantAllele]),
  mane: z.tuple([VariantAllele, VariantAllele]),
  tail: z.tuple([VariantAllele, VariantAllele]),
  build: z.tuple([VariantAllele, VariantAllele]),
});
export type VariantGenes = z.infer<typeof VariantGenesSchema>;

export const BREEDS = ["thoroughbred", "arabian", "quarterHorse", "akhalTeke"] as const;
export const BreedSchema = z.enum(BREEDS);
export type Breed = z.infer<typeof BreedSchema>;
/** Breed shares in permille; always sums to 1000. */
export const BreedSharesSchema = z
  .object({ thoroughbred: Permille, arabian: Permille, quarterHorse: Permille, akhalTeke: Permille })
  .refine((b) => b.thoroughbred + b.arabian + b.quarterHorse + b.akhalTeke === 1000, "breed shares must sum to 1000");
export type BreedShares = z.infer<typeof BreedSharesSchema>;

/** Genetic quirks, hidden until revealed through racing. Each locus: 0/1 copies per allele. */
export const QUIRK_KEYS = ["mudlark", "gateShy", "lateKick", "crowdShy"] as const;
export const QuirkKeySchema = z.enum(QUIRK_KEYS);
export type QuirkKey = z.infer<typeof QuirkKeySchema>;
const Bit = z.union([z.literal(0), z.literal(1)]);
export const QuirkGenesSchema = z.object({
  mudlark: z.tuple([Bit, Bit]),
  gateShy: z.tuple([Bit, Bit]),
  lateKick: z.tuple([Bit, Bit]),
  crowdShy: z.tuple([Bit, Bit]),
});
export type QuirkGenes = z.infer<typeof QuirkGenesSchema>;

export const GENOME_VERSION = 1 as const;
export const GenomeSchema = z.object({
  version: z.literal(GENOME_VERSION),
  /** Diploid stat loci. Potential = blend of the two alleles with partial dominance of the higher one. */
  stats: statRecordSchema(AllelePairSchema),
  distance: z.tuple([DistanceAlleleSchema, DistanceAlleleSchema]),
  /** Small polygenic shift of the preferred trip, metres per allele (-150..150). */
  distanceMod: z.tuple([z.number().int().min(-150).max(150), z.number().int().min(-150).max(150)]),
  surface: z.tuple([SurfaceAlleleSchema, SurfaceAlleleSchema]),
  style: z.tuple([RunningStyleSchema, RunningStyleSchema]),
  maturity: z.tuple([MaturityAlleleSchema, MaturityAlleleSchema]),
  coat: CoatGenesSchema,
  /** Polygenic white-spotting tendency, 0..100 per allele. */
  white: z.tuple([z.number().int().min(0).max(100), z.number().int().min(0).max(100)]),
  morph: MorphGenesSchema,
  variants: VariantGenesSchema,
  quirks: QuirkGenesSchema,
  breed: BreedSharesSchema,
  /** Per-horse uint32 for marking placement and the pixel-rig `seed` (not inherited). */
  markingSeed: z.number().int().min(0).max(0xffffffff),
});
export type Genome = z.infer<typeof GenomeSchema>;

/** Expressed look knobs for @thoroughbred/pixel-rig (`factory.create(appearance, look)`). */
export const RigLookSchema = z.object({
  variants: z.object({ head: z.number().int(), mane: z.number().int(), tail: z.number().int(), build: z.number().int() }),
  morph: z.object({ legLength: z.number(), neckLength: z.number(), girth: z.number(), height: z.number(), headSize: z.number() }),
  seed: z.number().int().min(0),
  sabino: z.number().min(0).max(1),
});
export type RigLook = z.infer<typeof RigLookSchema>;

// ---------------------------------------------------------------------------
// Horse state (persisted; the shared `Horse` is a derived race snapshot)
// ---------------------------------------------------------------------------

/**
 * Stage, derived from career activity (see lifecycle.stageOf):
 *   foal (0-4 care) -> weanling (5-11) -> yearling (12-18) -> juvenile (0-8 starts)
 *   -> prime (9-35) -> veteran (36-50) -> stud (racing retired, breedings left)
 *   -> pasture (permanent Legend state; never death).
 */
export const GameStageSchema = z.enum(["foal", "weanling", "yearling", "juvenile", "prime", "veteran", "stud", "pasture"]);
export type GameStage = z.infer<typeof GameStageSchema>;

export const RetireReasonSchema = z.enum(["choice", "max_starts", "injury"]);
export type RetireReason = z.infer<typeof RetireReasonSchema>;

export const InjurySeveritySchema = z.enum(["minor", "moderate", "career_ending"]);
export type InjurySeverity = z.infer<typeof InjurySeveritySchema>;

export const InjurySchema = z.object({
  severity: InjurySeveritySchema,
  /** When it happened (ms). Healing progresses with real time from here. */
  atMs: z.number().int(),
  /** Healing units required (1 unit = 1 real day at base vet level). */
  unitsRequired: NonNegInt,
  /** Extra units earned from care sessions / vet treatment during recovery. */
  bonusUnits: NonNegInt,
  /** Vet facility level at the time (speeds healing). */
  vetLevel: z.number().int().min(0).max(3),
  /** Race id or "training". */
  source: z.string(),
});
export type Injury = z.infer<typeof InjurySchema>;

export const RecentRunSchema = z.object({
  atMs: z.number().int(),
  position: z.number().int().min(1),
  fieldSize: z.number().int().min(1),
  raceId: z.string(),
});
export type RecentRun = z.infer<typeof RecentRunSchema>;

export const PregnancySchema = z.object({
  sireId: z.string(),
  coveredAtMs: z.number().int(),
  dueAtMs: z.number().int(),
  /** 64-hex seed used to produce the foal genome (committed at covering). */
  foalSeed: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Pregnancy = z.infer<typeof PregnancySchema>;

export const HorseStateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(32),
  sex: SexSchema,
  ownerId: z.string().min(1),
  sireId: z.string().nullable(),
  damId: z.string().nullable(),
  generation: NonNegInt,
  genome: GenomeSchema,
  bornAtMs: z.number().int(),
  /** Competition season in which the horse was born/minted (display, pack ceilings). */
  bornSeason: z.number().int().min(1),
  care: z.object({
    /** Counted care sessions (max one per real day). Drives foal growth. */
    sessions: NonNegInt,
    lastCareDay: z.number().int().nullable(),
    /** Rolling care quality 0..1000 (right feed for the horse's needs). */
    quality: Permille,
  }),
  condition: z.object({
    /** Built by work and races; never decays from elapsed time. */
    fitness: Permille,
    /** Fatigue as of `fatigueAtMs`; recovers with real time (recovery counts as healing). */
    fatigue: Permille,
    fatigueAtMs: z.number().int(),
    /** Last hard workout or race (drives the 3-5 day freshness peak). */
    lastHardWorkMs: z.number().int().nullable(),
    /** Bond with the stable, 0..1000. Never decays. */
    bond: Permille,
  }),
  training: z.object({
    /** Training realisation per stat, 600..1000 permille of potential. Never decreases. */
    realisation: statRecordSchema(z.number().int().min(600).max(1000)),
    /** Week index (floor(day / 7)) the session counter refers to. */
    week: z.number().int(),
    sessionsThisWeek: NonNegInt,
  }),
  career: z.object({
    starts: z.number().int().min(0).max(50),
    racingRetired: z.object({ reason: RetireReasonSchema, atStarts: NonNegInt }).nullable(),
    pastured: z.boolean(),
    insured: z.boolean(),
  }),
  injury: InjurySchema.nullable(),
  rating: z.object({
    /** Official rating (handicap mark), 0..140. */
    or: z.number().int().min(0).max(140),
    ratedRuns: NonNegInt,
    peakOr: z.number().int().min(0).max(140),
  }),
  record: HorseRecordSchema,
  recentRuns: z.array(RecentRunSchema).max(10),
  breeding: z.object({
    used: z.number().int().min(0).max(4),
    /** Coverings per competition season. */
    bySeason: z.array(z.object({ season: z.number().int().min(1), count: z.number().int().min(1) })),
  }),
  pregnancy: PregnancySchema.nullable(),
  reveal: z.object({ scanned: z.boolean(), quirks: z.array(QuirkKeySchema) }),
});
export type HorseState = z.infer<typeof HorseStateSchema>;

/** Minimal pedigree index for COI and kin checks. */
export const PedigreeEntrySchema = z.object({ sireId: z.string().nullable(), damId: z.string().nullable(), generation: NonNegInt });
export type PedigreeEntry = z.infer<typeof PedigreeEntrySchema>;
export type PedigreeIndex = Readonly<Record<string, PedigreeEntry>>;

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export const WorkoutSchema = z.enum(["speed_work", "stamina_gallops", "gate_practice", "swimming", "rest", "race_prep"]);
export type Workout = z.infer<typeof WorkoutSchema>;
/** Weekly plan: 3 slots (4 with the Trainer facility). Sessions run when the player triggers them. */
export const TrainingPlanSchema = z.object({ slots: z.array(WorkoutSchema).min(3).max(4) });
export type TrainingPlan = z.infer<typeof TrainingPlanSchema>;

export const RideIntensitySchema = z.enum(["conservative", "normal", "all_out"]);
export type RideIntensity = z.infer<typeof RideIntensitySchema>;

// ---------------------------------------------------------------------------
// Racing structure
// ---------------------------------------------------------------------------

export const RaceTierSchema = z.enum([
  "trial",
  "maiden",
  "novice",
  "hcp_0_55",
  "hcp_50_75",
  "hcp_70_95",
  "listed",
  "g3",
  "g2",
  "g1",
  "quick",
  "daily_cup",
]);
export type RaceTier = z.infer<typeof RaceTierSchema>;

export const RaceKindSchema = z.enum(["regular", "quick", "weekend_feature", "feature_qualifier", "season_final", "daily_cup"]);
export type RaceKind = z.infer<typeof RaceKindSchema>;

export const RaceSlotSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: RaceKindSchema,
  tier: RaceTierSchema,
  season: z.number().int().min(1),
  postTimeMs: z.number().int(),
  entryCloseMs: z.number().int(),
  distanceM: z.number().int().min(800).max(4000),
  surface: SurfaceSchema,
  goingForecast: GoingSchema,
  weather: WeatherSchema,
  purse: NonNegInt,
  entryFee: NonNegInt,
  maxRunners: z.number().int().min(2).max(16),
  /** Handicap races assign weights by OR. */
  handicap: z.boolean(),
  division: z.string().nullable(),
});
export type RaceSlot = z.infer<typeof RaceSlotSchema>;

// ---------------------------------------------------------------------------
// Economy / ledger
// ---------------------------------------------------------------------------

/**
 * Account ids: "player:<id>" (credit balances, never negative), "escrow:<id>",
 * "system:<name>" (faucets/sinks; may be negative — the issuer side of double entry).
 */
export const AccountIdSchema = z.string().regex(/^(player|escrow|system):[A-Za-z0-9_.:-]+$/);
export type AccountId = z.infer<typeof AccountIdSchema>;

export const PostingSchema = z.object({ account: AccountIdSchema, amount: z.number().int() });
export type Posting = z.infer<typeof PostingSchema>;

export const LedgerTxKindSchema = z.enum([
  "purse",
  "daily_goal",
  "daily_cup",
  "starter_grant",
  "training",
  "entry_fee",
  "vet",
  "insurance_premium",
  "insurance_payout",
  "breeding_fee",
  "stud_fee",
  "pack",
  "scan",
  "facility",
  "stall_slot",
  "market_sale",
  "market_escrow",
  "market_refund",
  "adjustment",
]);
export type LedgerTxKind = z.infer<typeof LedgerTxKindSchema>;

export const LedgerTxSchema = z.object({
  id: z.string().min(1),
  /** Unique per logical operation (e.g. "purse:race-123:horse-9"). Replays are no-ops. */
  idempotencyKey: z.string().min(1),
  kind: LedgerTxKindSchema,
  atMs: z.number().int(),
  postings: z.array(PostingSchema).min(2),
  memo: z.string().optional(),
});
export type LedgerTx = z.infer<typeof LedgerTxSchema>;

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

export const PackTypeSchema = z.enum(["paddock", "premium"]);
export type PackType = z.infer<typeof PackTypeSchema>;

export const PityStateSchema = z.object({
  /** Pulls since the last Rare-or-better result. */
  sinceRare: NonNegInt,
  /** Pulls since the last Epic-or-better result. */
  sinceEpic: NonNegInt,
  /** Total pulls, used in the seed label. */
  pulls: NonNegInt,
});
export type PityState = z.infer<typeof PityStateSchema>;

export const PackPullSchema = z.object({
  pack: PackTypeSchema,
  pullIndex: NonNegInt,
  season: z.number().int().min(1),
  seedCommitment: z.string().regex(/^[0-9a-f]{64}$/),
  pullSeed: z.string().regex(/^[0-9a-f]{64}$/),
  rarity: RaritySchema,
  pityTriggered: z.enum(["none", "rare", "epic"]),
  roll: z.number().int().min(0),
  genome: GenomeSchema,
});
export type PackPull = z.infer<typeof PackPullSchema>;

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

export const LeagueTierSchema = z.enum(["bronze", "silver", "gold", "platinum", "champion"]);
export type LeagueTier = z.infer<typeof LeagueTierSchema>;

export const LeagueMemberSchema = z.object({ ownerId: z.string(), points: z.number().int(), wins: NonNegInt, bestFinish: z.number().int().min(0) });
export type LeagueMember = z.infer<typeof LeagueMemberSchema>;

export const LeagueSchema = z.object({
  id: z.string(),
  week: z.number().int(),
  tier: LeagueTierSchema,
  members: z.array(LeagueMemberSchema).max(30),
});
export type League = z.infer<typeof LeagueSchema>;

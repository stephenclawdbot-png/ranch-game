/**
 * Postgres schema (Drizzle) for Project Thoroughbred.
 *
 * Conventions
 * - Every entity has an immutable UUID primary key (gen_random_uuid()).
 * - Money (Stable Credits) is an integer `bigint` (mode "number": safe to 2^53).
 * - Complex rule objects owned by @thoroughbred/game-core (genomes, appearance, plans,
 *   snapshots, race results) are stored as jsonb so game-core can evolve independently.
 * - Hard invariants are enforced by the database, not only by services:
 *   unique indexes (one care session per horse per day, one cup entry per player per day,
 *   one mare cover per season, one active listing per horse, ...), CHECK constraints
 *   (breeding_count 0..4, non-negative balances, positive prices) and the ledger triggers
 *   in migration 0001 (postings append-only, every transaction sums to zero, balances
 *   change only through postings).
 *
 * Keep this file free of workspace imports: drizzle-kit loads it directly.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const credits = (name: string) => bigint(name, { mode: "number" });

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const horseSexEnum = pgEnum("horse_sex", ["male", "female"]);
/**
 * Career clock (game-design §4a): horses age by activity, never by calendar time.
 * Nursery stages advance with counted care sessions (5 / 7 / 7); racing stages with starts
 * (0-8 juvenile, 9-35 prime, 36-50 veteran). Racing retirement is a separate status.
 */
export const horseStageEnum = pgEnum("horse_stage", ["foal", "weanling", "yearling", "juvenile", "prime", "veteran"]);
export const careerStatusEnum = pgEnum("career_status", [
  "racing", // in training / racing (or still in the nursery)
  "retired", // racing retired: stud or broodmare career while breedings remain
  "pasture", // Pasture / Legend: permanent, irreversible, never deleted
]);
export const retirementReasonEnum = pgEnum("retirement_reason", ["choice", "max_starts", "injury"]);
export const maturityTypeEnum = pgEnum("maturity_type", ["early", "normal", "late"]);
export const horseOriginEnum = pgEnum("horse_origin", ["starter", "bred", "pack", "gift", "house", "admin"]);
export const horseLockEnum = pgEnum("horse_lock", ["race", "market"]);
export const seasonStatusEnum = pgEnum("season_status", ["upcoming", "active", "closed"]);
export const pregnancyStatusEnum = pgEnum("pregnancy_status", ["carrying", "foaled", "lost"]);
export const raceKindEnum = pgEnum("race_kind", ["quick", "scheduled", "daily_cup", "feature", "final", "trial"]);
export const raceStatusEnum = pgEnum("race_status", ["open", "closed", "settled", "cancelled"]);
export const ledgerAccountKindEnum = pgEnum("ledger_account_kind", [
  "player", // a stable's spendable credits (never negative)
  "mint", // system source of new credits: purses, grants, rewards (may go negative)
  "burn", // system sink: fees, packs, upkeep (credits leave circulation)
  "treasury", // studio revenue
  "escrow", // held funds (e.g. future stud bookings / bids)
]);
export const listingStatusEnum = pgEnum("listing_status", ["active", "sold", "cancelled", "expired"]);
export const rarityEnum = pgEnum("rarity", ["common", "uncommon", "rare", "epic", "legendary"]);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Anonymous device account. The browser holds a random 256-bit token in an httpOnly
 * cookie; only its sha256 is stored. Email / wallet can be linked later.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    displayName: text("display_name"),
    email: text("email"),
    walletAddress: text("wallet_address"),
    /** Accounts sharing a link group (same person / device cluster) get trades flagged. */
    linkGroup: uuid("link_group"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("accounts_token_hash_uq").on(t.tokenHash),
    uniqueIndex("accounts_email_uq").on(sql`lower(${t.email})`),
    uniqueIndex("accounts_wallet_uq").on(t.walletAddress),
  ],
);

export const stables = pgTable(
  "stables",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    /** Silks: { primary, secondary, pattern, cap } (shared SilksSchema). */
    silks: jsonb("silks").notNull(),
    /**
     * Stall capacity (licence base + facility upgrades). There are no time-based fees:
     * capacity is the stable-size limit. Occupancy = horses not at pasture + foals on the
     * way (carrying pregnancies of the stable's mares). Enforced under a stable row lock on
     * every acquisition (pack, market buy, breeding, grants); foaling never fails.
     */
    stallSlots: integer("stall_slots").notNull().default(6),
    licenceLevel: integer("licence_level").notNull().default(1),
    /** Facility levels, e.g. { trainer: 1, vet: 0, stalls: 0 }. */
    facilities: jsonb("facilities").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("stables_account_uq").on(t.accountId),
    check("stables_name_len", sql`char_length(${t.name}) between 1 and 40`),
    check("stables_slots", sql`${t.stallSlots} between 1 and 200`),
  ],
);

// ---------------------------------------------------------------------------
// Seasons (4 real weeks each)
// ---------------------------------------------------------------------------

export const seasons = pgTable(
  "seasons",
  {
    id: id(),
    number: integer("number").notNull(),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    status: seasonStatusEnum("status").notNull().default("upcoming"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("seasons_number_uq").on(t.number), check("seasons_range", sql`${t.endsAt} > ${t.startsAt}`)],
);

// ---------------------------------------------------------------------------
// Horses
// ---------------------------------------------------------------------------

export const horses = pgTable(
  "horses",
  {
    id: id(),
    /** Single owner column: a horse can never be owned by two stables. Null = house/system horse. */
    ownerStableId: uuid("owner_stable_id").references(() => stables.id),
    name: text("name").notNull(),
    sex: horseSexEnum("sex").notNull(),
    gelded: boolean("gelded").notNull().default(false),
    sireId: uuid("sire_id").references((): AnyPgColumn => horses.id),
    damId: uuid("dam_id").references((): AnyPgColumn => horses.id),
    generation: integer("generation").notNull().default(0),
    origin: horseOriginEnum("origin").notNull(),
    /** Informational only (competition season of birth); horses never age by calendar. */
    birthSeasonNumber: integer("birth_season_number"),
    bornAt: ts("born_at").notNull().defaultNow(),
    /** game-core Genome (alleles, aptitude, coat, morph, maturity, quirks, breed share). */
    genome: jsonb("genome").notNull(),
    /** Derived look for the pixel rig (coat, markings, morphs). */
    appearance: jsonb("appearance").notNull(),
    /** Current-stat snapshot (refreshed after care / training / races). */
    stats: jsonb("stats").notNull(),
    maturityType: maturityTypeEnum("maturity_type").notNull().default("normal"),
    /** Official rating (handicapper's mark). */
    rating: integer("rating").notNull().default(0),
    stage: horseStageEnum("stage").notNull(),
    careerStatus: careerStatusEnum("career_status").notNull().default("racing"),
    retirementReason: retirementReasonEnum("retirement_reason"),
    retiredAt: ts("retired_at"),
    pasturedAt: ts("pastured_at"),
    /** Counted care sessions (nursery growth is driven by these). */
    careSessions: integer("care_sessions").notNull().default(0),
    /** Rolling care quality, permille. */
    careQuality: integer("care_quality").notNull().default(0),
    /** Condition snapshots, permille (0..1000). None of these decay with elapsed time. */
    fitness: integer("fitness").notNull().default(500),
    fatigue: integer("fatigue").notNull().default(0),
    freshness: integer("freshness").notNull().default(1000),
    form: integer("form").notNull().default(500),
    morale: integer("morale").notNull().default(500),
    /** Owner bond, permille. Never decays from absence. */
    bond: integer("bond").notNull().default(0),
    /**
     * game-core dynamics that need no constraints: per-stat training realisation, fatigue
     * timestamp, last hard work, training week counters, recent runs, rated-run counts.
     */
    dynamics: jsonb("dynamics").notNull().default({}),
    /** Revealed genetic quirks, e.g. ["mudlark"]. Hidden ones live in the genome. */
    quirks: jsonb("quirks").notNull().default([]),
    /** Pedigree Scan bought (potential ranges narrowed). */
    scanned: boolean("scanned").notNull().default(false),
    /** Current injury { kind, severity, careerEnding } or null. Heals in real time. */
    injury: jsonb("injury"),
    /** Real-time recovery end; care and the vet facility can bring it forward. */
    injuredUntil: ts("injured_until"),
    insured: boolean("insured").notNull().default(false),
    breedingCount: integer("breeding_count").notNull().default(0),
    /** Public stud fee in credits; null = not standing at stud. */
    studFee: credits("stud_fee"),
    /** Exclusive lock: in a race field or listed on the market. */
    lockKind: horseLockEnum("lock_kind"),
    lockRef: uuid("lock_ref"),
    /** Career starts: the career clock (max 50). */
    starts: integer("starts").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    places: integer("places").notNull().default(0),
    shows: integer("shows").notNull().default(0),
    earnings: credits("earnings").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("horses_owner_idx").on(t.ownerStableId),
    index("horses_sire_idx").on(t.sireId),
    index("horses_dam_idx").on(t.damId),
    index("horses_rating_idx").on(t.rating),
    check("horses_breeding_count", sql`${t.breedingCount} between 0 and 4`),
    check("horses_not_own_parent", sql`${t.sireId} is distinct from ${t.id} and ${t.damId} is distinct from ${t.id}`),
    check("horses_distinct_parents", sql`${t.sireId} is null or ${t.damId} is null or ${t.sireId} <> ${t.damId}`),
    check("horses_lock_consistent", sql`(${t.lockKind} is null) = (${t.lockRef} is null)`),
    check("horses_rating", sql`${t.rating} between 0 and 140`),
    check("horses_stud_fee", sql`${t.studFee} is null or ${t.studFee} >= 0`),
    check("horses_name_len", sql`char_length(${t.name}) between 1 and 32`),
    check("horses_starts", sql`${t.starts} between 0 and 50 and ${t.wins} + ${t.places} + ${t.shows} <= ${t.starts}`),
    check(
      "horses_meters",
      sql`least(${t.fitness}, ${t.fatigue}, ${t.freshness}, ${t.form}, ${t.morale}, ${t.bond}, ${t.careQuality}) >= 0 and greatest(${t.fitness}, ${t.fatigue}, ${t.freshness}, ${t.form}, ${t.morale}, ${t.bond}, ${t.careQuality}) <= 1000`,
    ),
    check(
      "horses_retirement_consistent",
      sql`(${t.careerStatus} = 'racing') = (${t.retirementReason} is null) and (${t.careerStatus} = 'racing') = (${t.retiredAt} is null)`,
    ),
    check("horses_pasture_consistent", sql`(${t.careerStatus} = 'pasture') = (${t.pasturedAt} is not null)`),
    check("horses_mandatory_retirement", sql`${t.starts} < 50 or ${t.careerStatus} <> 'racing'`),
    index("horses_owner_status_idx").on(t.ownerStableId, t.careerStatus),
  ],
);

/**
 * Pedigree closure table: one row per (ancestor, descendant, depth) with the number of
 * distinct paths at that depth (>1 only under inbreeding). depth 1 = parent.
 */
export const lineageEdges = pgTable(
  "lineage_edges",
  {
    ancestorId: uuid("ancestor_id")
      .notNull()
      .references(() => horses.id),
    descendantId: uuid("descendant_id")
      .notNull()
      .references(() => horses.id),
    depth: integer("depth").notNull(),
    paths: integer("paths").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.ancestorId, t.descendantId, t.depth] }),
    index("lineage_descendant_idx").on(t.descendantId, t.depth),
    check("lineage_depth", sql`${t.depth} >= 1`),
    check("lineage_not_self", sql`${t.ancestorId} <> ${t.descendantId}`),
  ],
);

// ---------------------------------------------------------------------------
// Care & training
// ---------------------------------------------------------------------------

export const careLog = pgTable(
  "care_log",
  {
    id: id(),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    /** UTC calendar day. One counted session per horse per day (unique). */
    day: date("day", { mode: "string" }).notNull(),
    actions: jsonb("actions").notNull(),
    quality: integer("quality").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("care_log_horse_day_uq").on(t.horseId, t.day), index("care_log_account_idx").on(t.accountId, t.day)],
);

export const trainingPlans = pgTable(
  "training_plans",
  {
    id: id(),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    /** Monday (UTC) of the plan week. */
    weekStart: date("week_start", { mode: "string" }).notNull(),
    /** game-core TrainingPlan (3+ slots). */
    plan: jsonb("plan").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => accounts.id),
    appliedAt: ts("applied_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("training_plans_horse_week_uq").on(t.horseId, t.weekStart)],
);

// ---------------------------------------------------------------------------
// Ledger (double-entry). Balances only change via postings (trigger, migration 0001).
// ---------------------------------------------------------------------------

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: id(),
    kind: ledgerAccountKindEnum("kind").notNull(),
    /** Owning game account for kind = player; null for system accounts. */
    ownerAccountId: uuid("owner_account_id").references(() => accounts.id),
    currency: text("currency").notNull().default("CR"),
    /** Cached balance, maintained only by the postings trigger. */
    balance: credits("balance").notNull().default(0),
    allowNegative: boolean("allow_negative").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ledger_accounts_owner_uq").on(t.ownerAccountId, t.kind, t.currency),
    uniqueIndex("ledger_accounts_system_uq")
      .on(t.kind, t.currency)
      .where(sql`${t.ownerAccountId} is null`),
    check("ledger_accounts_non_negative", sql`${t.allowNegative} or ${t.balance} >= 0`),
    check("ledger_accounts_owner_kind", sql`(${t.kind} = 'player') = (${t.ownerAccountId} is not null)`),
  ],
);

export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: id(),
    /** Caller-supplied key; the same key can never post twice. */
    idempotencyKey: text("idempotency_key").notNull(),
    kind: text("kind").notNull(),
    memo: text("memo"),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ledger_transactions_idem_uq").on(t.idempotencyKey), index("ledger_transactions_kind_idx").on(t.kind)],
);

export const ledgerPostings = pgTable(
  "ledger_postings",
  {
    id: id(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    ledgerAccountId: uuid("ledger_account_id")
      .notNull()
      .references(() => ledgerAccounts.id),
    /** Signed: positive credits the account, negative debits it. */
    amount: credits("amount").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_postings_txn_idx").on(t.transactionId),
    index("ledger_postings_account_idx").on(t.ledgerAccountId, t.createdAt),
    check("ledger_postings_nonzero", sql`${t.amount} <> 0`),
  ],
);

// ---------------------------------------------------------------------------
// Breeding
// ---------------------------------------------------------------------------

export const breedingEvents = pgTable(
  "breeding_events",
  {
    id: id(),
    sireId: uuid("sire_id")
      .notNull()
      .references(() => horses.id),
    damId: uuid("dam_id")
      .notNull()
      .references(() => horses.id),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => accounts.id),
    sireOwnerStableId: uuid("sire_owner_stable_id").references(() => stables.id),
    damOwnerStableId: uuid("dam_owner_stable_id").references(() => stables.id),
    seasonNumber: integer("season_number").notNull(),
    baseFee: credits("base_fee").notNull().default(0),
    studFee: credits("stud_fee").notNull().default(0),
    /** Estimated coefficient of inbreeding of the foal, in basis points. */
    coiBp: integer("coi_bp").notNull().default(0),
    ledgerTransactionId: uuid("ledger_transaction_id").references(() => ledgerTransactions.id),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("breeding_events_idem_uq").on(t.idempotencyKey),
    /** A mare is covered at most once per season. */
    uniqueIndex("breeding_events_dam_season_uq").on(t.damId, t.seasonNumber),
    index("breeding_events_sire_season_idx").on(t.sireId, t.seasonNumber),
    check("breeding_events_not_self", sql`${t.sireId} <> ${t.damId}`),
  ],
);

export const pregnancies = pgTable(
  "pregnancies",
  {
    id: id(),
    breedingEventId: uuid("breeding_event_id")
      .notNull()
      .references(() => breedingEvents.id),
    sireId: uuid("sire_id")
      .notNull()
      .references(() => horses.id),
    damId: uuid("dam_id")
      .notNull()
      .references(() => horses.id),
    conceivedAt: ts("conceived_at").notNull(),
    dueAt: ts("due_at").notNull(),
    status: pregnancyStatusEnum("status").notNull().default("carrying"),
    /** sha256 of the inheritance seed, published at cover time. */
    seedCommitment: text("seed_commitment").notNull(),
    /** Secret until foaling, then revealed. */
    seed: text("seed").notNull(),
    seedRevealed: boolean("seed_revealed").notNull().default(false),
    foalId: uuid("foal_id").references(() => horses.id),
    foaledAt: ts("foaled_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("pregnancies_event_uq").on(t.breedingEventId),
    uniqueIndex("pregnancies_foal_uq").on(t.foalId),
    /** A mare carries at most one foal at a time. */
    uniqueIndex("pregnancies_dam_carrying_uq")
      .on(t.damId)
      .where(sql`${t.status} = 'carrying'`),
    index("pregnancies_due_idx").on(t.status, t.dueAt),
  ],
);

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

export const races = pgTable(
  "races",
  {
    id: id(),
    kind: raceKindEnum("kind").notNull(),
    name: text("name").notNull(),
    raceClass: text("race_class").notNull(),
    seasonNumber: integer("season_number"),
    /** Conditions: distanceM, surface, going, weather, rating band, age limits ... */
    conditions: jsonb("conditions").notNull(),
    postTime: ts("post_time").notNull(),
    entriesCloseAt: ts("entries_close_at").notNull(),
    status: raceStatusEnum("status").notNull().default("open"),
    maxRunners: integer("max_runners").notNull().default(12),
    purse: credits("purse").notNull().default(0),
    entryFee: credits("entry_fee").notNull().default(0),
    /** sha256(seed) published when entries open. */
    seedCommitment: text("seed_commitment").notNull(),
    /** Secret until settlement; never served before post time. */
    seed: text("seed").notNull(),
    createdAt: createdAt(),
    settledAt: ts("settled_at"),
  },
  (t) => [
    index("races_post_time_idx").on(t.postTime),
    index("races_status_idx").on(t.status, t.postTime),
    check("races_close_before_post", sql`${t.entriesCloseAt} <= ${t.postTime}`),
    check("races_runners", sql`${t.maxRunners} between 2 and 16`),
    check("races_money", sql`${t.purse} >= 0 and ${t.entryFee} >= 0`),
  ],
);

export const raceEntries = pgTable(
  "race_entries",
  {
    id: id(),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    /** Entering stable; null for house horses. */
    stableId: uuid("stable_id").references(() => stables.id),
    gate: integer("gate").notNull(),
    tactic: text("tactic").notNull(),
    /** Immutable copy of the horse at entry (stats, rating, fitness, genome-derived traits). */
    snapshot: jsonb("snapshot").notNull(),
    weightKg: integer("weight_kg"),
    finishPosition: integer("finish_position"),
    finishTimeUs: bigint("finish_time_us", { mode: "number" }),
    prize: credits("prize").notNull().default(0),
    ratingBefore: integer("rating_before").notNull(),
    ratingAfter: integer("rating_after"),
    enteredAt: createdAt(),
  },
  (t) => [
    uniqueIndex("race_entries_race_horse_uq").on(t.raceId, t.horseId),
    uniqueIndex("race_entries_race_gate_uq").on(t.raceId, t.gate),
    index("race_entries_horse_idx").on(t.horseId, t.enteredAt),
    check("race_entries_gate", sql`${t.gate} between 1 and 16`),
  ],
);

export const raceResults = pgTable("race_results", {
  raceId: uuid("race_id")
    .primaryKey()
    .references(() => races.id),
  seedCommitment: text("seed_commitment").notNull(),
  seedReveal: text("seed_reveal").notNull(),
  resultHash: text("result_hash").notNull(),
  engineVersion: text("engine_version"),
  /** Finish order, times, margins (game/engine RaceResult). Replay is recomputed, not stored. */
  result: jsonb("result").notNull(),
  ledgerTransactionId: uuid("ledger_transaction_id").references(() => ledgerTransactions.id),
  settledAt: createdAt(),
});

/** One Daily Cup run per player per UTC day. */
export const dailyCupEntries = pgTable(
  "daily_cup_entries",
  {
    id: id(),
    day: date("day", { mode: "string" }).notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    raceId: uuid("race_id").references(() => races.id),
    snapshot: jsonb("snapshot").notNull(),
    finishPosition: integer("finish_position"),
    finishTimeUs: bigint("finish_time_us", { mode: "number" }),
    points: integer("points").notNull().default(0),
    result: jsonb("result"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("daily_cup_account_day_uq").on(t.accountId, t.day),
    index("daily_cup_board_idx").on(t.day, t.points, t.finishTimeUs),
  ],
);

// ---------------------------------------------------------------------------
// Leagues (weekly, 30 owners)
// ---------------------------------------------------------------------------

export const leagues = pgTable(
  "leagues",
  {
    id: id(),
    seasonNumber: integer("season_number").notNull(),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    tier: integer("tier").notNull(),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull().default(30),
    createdAt: createdAt(),
  },
  (t) => [index("leagues_week_tier_idx").on(t.weekStart, t.tier)],
);

export const leagueMembers = pgTable(
  "league_members",
  {
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    /** Denormalised so an owner is in exactly one league per week. */
    weekStart: date("week_start", { mode: "string" }).notNull(),
    points: integer("points").notNull().default(0),
    finalRank: integer("final_rank"),
    movement: integer("movement"),
    joinedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.leagueId, t.accountId] }),
    uniqueIndex("league_members_account_week_uq").on(t.accountId, t.weekStart),
    index("league_members_points_idx").on(t.leagueId, t.points),
  ],
);

// ---------------------------------------------------------------------------
// Market (credits only)
// ---------------------------------------------------------------------------

export const marketListings = pgTable(
  "market_listings",
  {
    id: id(),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    sellerStableId: uuid("seller_stable_id")
      .notNull()
      .references(() => stables.id),
    price: credits("price").notNull(),
    status: listingStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    closedAt: ts("closed_at"),
  },
  (t) => [
    /** The horse itself is the escrow: one active listing per horse. */
    uniqueIndex("market_listings_horse_active_uq")
      .on(t.horseId)
      .where(sql`${t.status} = 'active'`),
    index("market_listings_status_idx").on(t.status, t.expiresAt),
    index("market_listings_seller_idx").on(t.sellerStableId),
    check("market_listings_price", sql`${t.price} > 0`),
    check("market_listings_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const trades = pgTable(
  "trades",
  {
    id: id(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => marketListings.id),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    sellerStableId: uuid("seller_stable_id")
      .notNull()
      .references(() => stables.id),
    buyerStableId: uuid("buyer_stable_id")
      .notNull()
      .references(() => stables.id),
    price: credits("price").notNull(),
    fee: credits("fee").notNull(),
    ledgerTransactionId: uuid("ledger_transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    flagged: boolean("flagged").notNull().default(false),
    flagReason: text("flag_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("trades_listing_uq").on(t.listingId),
    index("trades_horse_idx").on(t.horseId),
    check("trades_parties", sql`${t.sellerStableId} <> ${t.buyerStableId}`),
  ],
);

// ---------------------------------------------------------------------------
// Packs (seeded, committed, with pity)
// ---------------------------------------------------------------------------

/** Per player per pack type pity counters plus the pre-committed seed of the next pull. */
export const packPity = pgTable(
  "pack_pity",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    packType: text("pack_type").notNull(),
    totalPulls: integer("total_pulls").notNull().default(0),
    sinceRare: integer("since_rare").notNull().default(0),
    sinceEpic: integer("since_epic").notNull().default(0),
    nextSeedCommitment: text("next_seed_commitment").notNull(),
    nextSeed: text("next_seed").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.packType] })],
);

export const packPulls = pgTable(
  "pack_pulls",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    packType: text("pack_type").notNull(),
    /** 1-based pull number for this account + pack type. */
    pullIndex: integer("pull_index").notNull(),
    seedCommitment: text("seed_commitment").notNull(),
    seedReveal: text("seed_reveal").notNull(),
    rarity: rarityEnum("rarity").notNull(),
    pityApplied: text("pity_applied"),
    horseId: uuid("horse_id").references(() => horses.id),
    price: credits("price").notNull().default(0),
    ledgerTransactionId: uuid("ledger_transaction_id").references(() => ledgerTransactions.id),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("pack_pulls_idem_uq").on(t.idempotencyKey),
    uniqueIndex("pack_pulls_account_index_uq").on(t.accountId, t.packType, t.pullIndex),
  ],
);

// ---------------------------------------------------------------------------
// Status, legacy, audit, config
// ---------------------------------------------------------------------------

export const achievements = pgTable(
  "achievements",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    code: text("code").notNull(),
    horseId: uuid("horse_id").references(() => horses.id),
    data: jsonb("data"),
    earnedAt: createdAt(),
  },
  (t) => [uniqueIndex("achievements_account_code_uq").on(t.accountId, t.code)],
);

export const hallOfFame = pgTable(
  "hall_of_fame",
  {
    id: id(),
    /** Deterministic key, e.g. "season-final:5:sprint", "record:turf:1200". Prevents duplicates. */
    entryKey: text("entry_key").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    horseId: uuid("horse_id").references(() => horses.id),
    accountId: uuid("account_id").references(() => accounts.id),
    seasonNumber: integer("season_number"),
    data: jsonb("data"),
    inductedAt: createdAt(),
  },
  (t) => [uniqueIndex("hall_of_fame_key_uq").on(t.entryKey), index("hall_of_fame_category_idx").on(t.category, t.inductedAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorAccountId: uuid("actor_account_id").references(() => accounts.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId), index("audit_log_actor_idx").on(t.actorAccountId, t.createdAt)],
);

/** Tunable economy numbers (purses, fees, odds). Values are jsonb; code has defaults. */
export const economyConfig = pgTable("economy_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type AccountRow = typeof accounts.$inferSelect;
export type StableRow = typeof stables.$inferSelect;
export type HorseRow = typeof horses.$inferSelect;
export type NewHorseRow = typeof horses.$inferInsert;
export type RaceRow = typeof races.$inferSelect;
export type RaceEntryRow = typeof raceEntries.$inferSelect;
export type ListingRow = typeof marketListings.$inferSelect;
export type PregnancyRow = typeof pregnancies.$inferSelect;
export type LedgerAccountRow = typeof ledgerAccounts.$inferSelect;

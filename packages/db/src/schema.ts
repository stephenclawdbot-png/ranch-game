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
  numeric,
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
  "pasture", // Pasture / Legend on the Legacy Farm: permanent, needs no stall, never deleted
]);
export const retirementReasonEnum = pgEnum("retirement_reason", ["choice", "max_starts", "injury"]);
export const maturityTypeEnum = pgEnum("maturity_type", ["early", "normal", "late"]);
export const horseOriginEnum = pgEnum("horse_origin", ["starter", "bred", "pack", "gift", "house", "admin"]);
export const horseLockEnum = pgEnum("horse_lock", ["race", "market"]);
export const seasonStatusEnum = pgEnum("season_status", ["upcoming", "active", "closed"]);
export const pregnancyStatusEnum = pgEnum("pregnancy_status", ["carrying", "foaled", "lost"]);
/**
 * quick = Story-mode solo race (free); scheduled = Live card race (1 entry);
 * feature / final = Live feature & championship races (2 entries); daily_cup (free); trial.
 */
export const raceKindEnum = pgEnum("race_kind", ["quick", "scheduled", "daily_cup", "feature", "final", "trial"]);
/** open (entries) -> locked (field snapshot at entry close) -> settled; cancelled = abandoned. */
export const raceStatusEnum = pgEnum("race_status", ["open", "locked", "settled", "cancelled"]);
export const entryStatusEnum = pgEnum("entry_status", ["entered", "scratched"]);
export const entryMovementKindEnum = pgEnum("entry_movement_kind", ["daily", "refill", "race", "refund", "adjustment"]);
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
    /** IANA timezone from the device at signup; drives the local-midnight entry allowance. */
    timezone: text("timezone").notNull().default("UTC"),
    /** Last timezone change (at most one change per 30 days). */
    timezoneChangedAt: ts("timezone_changed_at"),
    /** Verified email: required to sell on the market and for ranked rewards. */
    emailVerifiedAt: ts("email_verified_at"),
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

export const accountLinkKindEnum = pgEnum("account_link_kind", ["device", "fingerprint", "ip_hash", "wallet", "email"]);

/**
 * Identity signals per account (hashed; never raw IPs or fingerprints). Two accounts that
 * share any (kind, value_hash) are linked: trades between them are blocked and their
 * ranked results are reviewed.
 */
export const accountLinks = pgTable(
  "account_links",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    kind: accountLinkKindEnum("kind").notNull(),
    valueHash: text("value_hash").notNull(),
    firstSeenAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("account_links_account_signal_uq").on(t.accountId, t.kind, t.valueHash),
    index("account_links_signal_idx").on(t.kind, t.valueHash),
  ],
);

/** Anti-fraud events for review (blocked linked trades, suspicious patterns ...). */
export const fraudEvents = pgTable(
  "fraud_events",
  {
    id: id(),
    accountId: uuid("account_id").references(() => accounts.id),
    relatedAccountId: uuid("related_account_id").references(() => accounts.id),
    kind: text("kind").notNull(),
    severity: integer("severity").notNull().default(1),
    data: jsonb("data"),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("fraud_events_account_idx").on(t.accountId, t.createdAt), index("fraud_events_kind_idx").on(t.kind, t.createdAt)],
);

/** Distinct UTC days on which the account played (drives "free Paddock Pack every 3rd play day"). */
export const accountPlayDays = pgTable(
  "account_play_days",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    day: date("day", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.day] })],
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
     * Stall capacity (licence base + facility upgrades, 6 → 24). There are no time-based fees:
     * capacity is the stable-size limit. Occupancy = owned horses not on the Legacy Farm
     * (career_status 'pasture') + foals on the way (carrying pregnancies of the stable's
     * mares). Every acquisition (pack, market buy, grant) needs occupancy < slots, checked
     * under a stable row lock. Covering a mare may use the single nursery overflow slot
     * (occupancy < slots + 1), and foaling never fails: the foal always arrives, at worst
     * in overflow, which blocks further acquisitions until a stall is freed.
     */
    stallSlots: integer("stall_slots").notNull().default(6),
    licenceLevel: integer("licence_level").notNull().default(1),
    /** Facility levels, e.g. { trainer: 1, vet: 0, stalls: 0 }. */
    facilities: jsonb("facilities").notNull().default({}),
    /**
     * Live-racing entry bank (game-design §4f). Changes only with an entry_movements row,
     * in the same transaction. +allowance at local midnight (lazy, once per local date),
     * rollover up to the cap.
     */
    entryBalance: integer("entry_balance").notNull().default(0),
    entryAllowance: integer("entry_allowance").notNull().default(10),
    entryCap: integer("entry_cap").notNull().default(20),
    createdAt: createdAt(),
  },
  (t) => [
    check("stables_entry_balance", sql`${t.entryBalance} >= 0`),
    check("stables_entry_tiers", sql`${t.entryAllowance} between 1 and 15 and ${t.entryCap} between ${t.entryAllowance} and 30`),
    uniqueIndex("stables_account_uq").on(t.accountId),
    check("stables_name_len", sql`char_length(${t.name}) between 1 and 40`),
    /** 6 stalls at start, facilities add more, hard maximum 24 (game-design §4b). */
    check("stables_slots", sql`${t.stallSlots} between 1 and 24`),
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
    /** Instant `fatigue` refers to; game-core recovers fatigue lazily on read (fatigueAt). */
    fatigueAt: ts("fatigue_at"),
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
    /**
     * Club-bred (starter / free-pack) horses can never be sold, traded or transferred
     * (release to the Club is allowed).
     */
    bound: boolean("bound").notNull().default(false),
    /** Starts required before the horse may change hands (5 for foals of bound parents). */
    tradeMinStarts: integer("trade_min_starts").notNull().default(0),
    /** Released to the Club (owner becomes null). Released horses leave the player's stalls. */
    releasedAt: ts("released_at"),
    releasedFromStableId: uuid("released_from_stable_id").references(() => stables.id),
    /** Exclusive lock: in a race field or listed on the market. */
    lockKind: horseLockEnum("lock_kind"),
    lockRef: uuid("lock_ref"),
    /** Career starts: the career clock (max 40). */
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
    check("horses_starts", sql`${t.starts} between 0 and 40 and ${t.wins} + ${t.places} + ${t.shows} <= ${t.starts}`),
    check(
      "horses_meters",
      sql`least(${t.fitness}, ${t.fatigue}, ${t.freshness}, ${t.form}, ${t.morale}, ${t.bond}, ${t.careQuality}) >= 0 and greatest(${t.fitness}, ${t.fatigue}, ${t.freshness}, ${t.form}, ${t.morale}, ${t.bond}, ${t.careQuality}) <= 1000`,
    ),
    check(
      "horses_retirement_consistent",
      sql`(${t.careerStatus} = 'racing') = (${t.retirementReason} is null) and (${t.careerStatus} = 'racing') = (${t.retiredAt} is null)`,
    ),
    check("horses_pasture_consistent", sql`(${t.careerStatus} = 'pasture') = (${t.pasturedAt} is not null)`),
    check("horses_mandatory_retirement", sql`${t.starts} < 40 or ${t.careerStatus} <> 'racing'`),
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
    /** Foal coefficient of inbreeding, permille (game-core Pregnancy.coi). */
    coi: integer("coi").notNull().default(0),
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
    /** Live card slot ("live:<slot index>"): one race per slot, however many instances publish. */
    slotKey: text("slot_key"),
    maxRunners: integer("max_runners").notNull().default(12),
    /** Field size the lock fills to with house horses (8-12). */
    targetRunners: integer("target_runners").notNull().default(10),
    /** Stable entries consumed per entry (Live 1, feature/graded 2, Story & Daily Cup 0). */
    entryCost: integer("entry_cost").notNull().default(0),
    /** Locked field (runners, gates, snapshots) produced at entry close; seed excluded. */
    field: jsonb("field"),
    fieldHash: text("field_hash"),
    lockedAt: ts("locked_at"),
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
    uniqueIndex("races_slot_uq").on(t.slotKey),
    check("races_target", sql`${t.targetRunners} between 2 and ${t.maxRunners} and ${t.entryCost} between 0 and 2`),
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
    status: entryStatusEnum("status").notNull().default("entered"),
    isHouse: boolean("is_house").notNull().default(false),
    /** Stable entries consumed (refunded only if the race is abandoned). */
    entryCost: integer("entry_cost").notNull().default(0),
    /** Drawn from the race seed when the field locks. */
    gate: integer("gate"),
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
    scratchedAt: ts("scratched_at"),
  },
  (t) => [
    uniqueIndex("race_entries_race_horse_uq").on(t.raceId, t.horseId),
    uniqueIndex("race_entries_race_gate_uq").on(t.raceId, t.gate),
    index("race_entries_horse_idx").on(t.horseId, t.enteredAt),
    index("race_entries_stable_idx").on(t.stableId, t.enteredAt),
    check("race_entries_gate", sql`${t.gate} is null or ${t.gate} between 1 and 16`),
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

/** Append-only log of entry-bank changes; grants are unique per (stable, local date, kind). */
export const entryMovements = pgTable(
  "entry_movements",
  {
    id: id(),
    stableId: uuid("stable_id")
      .notNull()
      .references(() => stables.id),
    kind: entryMovementKindEnum("kind").notNull(),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    /** Player-local calendar date for daily / refill grants. */
    localDate: date("local_date", { mode: "string" }),
    raceId: uuid("race_id").references(() => races.id),
    horseId: uuid("horse_id").references(() => horses.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("entry_movements_grant_uq")
      .on(t.stableId, t.localDate, t.kind)
      .where(sql`${t.kind} in ('daily', 'refill')`),
    uniqueIndex("entry_movements_refund_uq")
      .on(t.raceId, t.horseId)
      .where(sql`${t.kind} = 'refund'`),
    index("entry_movements_stable_idx").on(t.stableId, t.createdAt),
    check("entry_movements_balance", sql`${t.balanceAfter} >= 0`),
  ],
);

/** Player inbox: race results while away, foalings, sales ... Idempotent per (account, dedupe key). */
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    kind: text("kind").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    data: jsonb("data"),
    raceId: uuid("race_id").references(() => races.id),
    horseId: uuid("horse_id").references(() => horses.id),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inbox_items_dedupe_uq").on(t.accountId, t.dedupeKey), index("inbox_items_account_idx").on(t.accountId, t.createdAt)],
);

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
    /** Appraised value at listing time; price must be >= 70% of it (anti-dumping floor). */
    appraisal: credits("appraisal").notNull(),
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
    /** Free Paddock Pack (play-day entitlement); its horse is bound (Club-bred). */
    free: boolean("free").notNull().default(false),
    /** Monday (UTC) of the pull's week, for the weekly purchase limits. */
    weekStart: date("week_start", { mode: "string" }).notNull(),
    seasonNumber: integer("season_number").notNull(),
    ledgerTransactionId: uuid("ledger_transaction_id").references(() => ledgerTransactions.id),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("pack_pulls_idem_uq").on(t.idempotencyKey),
    index("pack_pulls_week_idx").on(t.accountId, t.packType, t.weekStart),
    uniqueIndex("pack_pulls_account_index_uq").on(t.accountId, t.packType, t.pullIndex),
  ],
);

/**
 * Seasonal global foal crop: every pack horse consumes one unit. Incremented with a single
 * guarded UPDATE (produced < cap), so concurrent pulls can never oversell the crop.
 */
export const foalCrop = pgTable(
  "foal_crop",
  {
    seasonNumber: integer("season_number").primaryKey(),
    cap: integer("cap").notNull(),
    produced: integer("produced").notNull().default(0),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("foal_crop_bounds", sql`${t.produced} between 0 and ${t.cap}`)],
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

// ---------------------------------------------------------------------------
// Closed playtest (invite codes, testers, feedback, telemetry, beta rewards).
// These tables SURVIVE the playtest reset (services/playtest.ts): they reference accounts by
// plain uuid columns (no foreign keys), so wiping game progress never cascades into them.
// ---------------------------------------------------------------------------

/** Invite codes for the closed playtest (PLAYTEST_MODE=1). */
export const inviteCodes = pgTable(
  "invite_codes",
  {
    code: text("code").primaryKey(),
    maxUses: integer("max_uses").notNull().default(1),
    uses: integer("uses").notNull().default(0),
    note: text("note"),
    /** The tester who used it last (one per use; see testers.invite_code for all). */
    usedBy: uuid("used_by"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [check("invite_codes_uses", sql`${t.uses} >= 0 and ${t.maxUses} >= 1 and ${t.uses} <= ${t.maxUses}`)],
);

/**
 * A playtester. Survives the reset: after a reset the tester re-joins with the same invite
 * code and gets re-linked (account_id is set to the new account).
 */
export const testers = pgTable(
  "testers",
  {
    id: id(),
    inviteCode: text("invite_code").notNull(),
    /** The current account (null after a reset until the tester re-joins). No FK on purpose. */
    accountId: uuid("account_id"),
    stableName: text("stable_name"),
    /** EVM address (Robinhood Chain) for the exclusive item and beta rewards. */
    walletAddress: text("wallet_address"),
    /**
     * Set when the address was proven with a SIWE (EIP-4361) signature (services/betaMoney.ts).
     * Only verified wallets can buy with ETH or receive Prize Pool allocations, and a verified
     * wallet belongs to exactly one tester (partial unique index below).
     */
    walletVerifiedAt: ts("wallet_verified_at"),
    joinedAt: createdAt(),
    lastSeenAt: ts("last_seen_at"),
  },
  (t) => [
    uniqueIndex("testers_account_uq").on(t.accountId),
    uniqueIndex("testers_wallet_verified_uq").on(sql`lower(${t.walletAddress})`).where(sql`${t.walletVerifiedAt} is not null`),
    index("testers_invite_idx").on(t.inviteCode),
    check("testers_wallet", sql`${t.walletAddress} is null or ${t.walletAddress} ~ '^0x[0-9a-fA-F]{40}$'`),
  ],
);

/** Exclusive-item entitlements and similar tester perks (kept across resets). */
export const testerRewards = pgTable(
  "tester_rewards",
  {
    id: id(),
    testerId: uuid("tester_id")
      .notNull()
      .references(() => testers.id),
    kind: text("kind").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tester_rewards_uq").on(t.testerId, t.kind)],
);

/** In-game feedback (bug / idea / confusing / fun). */
export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    accountId: uuid("account_id"),
    testerId: uuid("tester_id"),
    stableId: uuid("stable_id"),
    /** Who sent it when there is no account (sha256 of the IP, for rate limiting only). */
    senderKey: text("sender_key").notNull(),
    category: text("category").notNull(),
    rating: integer("rating"),
    message: text("message").notNull(),
    route: text("route"),
    viewport: text("viewport"),
    userAgent: text("user_agent"),
    clientErrors: jsonb("client_errors"),
    status: text("status").notNull().default("new"),
    /** Accepted as a bug report (earns the bug bounty). */
    acceptedBug: boolean("accepted_bug").notNull().default(false),
    adminNote: text("admin_note"),
    createdAt: createdAt(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [
    index("feedback_created_idx").on(t.createdAt),
    index("feedback_sender_idx").on(t.senderKey, t.createdAt),
    check("feedback_category", sql`${t.category} in ('bug', 'idea', 'confusing', 'fun')`),
    check("feedback_status", sql`${t.status} in ('new', 'resolved')`),
    check("feedback_rating", sql`${t.rating} is null or ${t.rating} between 1 and 5`),
    check("feedback_message_len", sql`char_length(${t.message}) between 1 and 4000`),
  ],
);

/** First-party, privacy-light telemetry (no third parties; routes only, never query strings). */
export const telemetryEvents = pgTable(
  "telemetry_events",
  {
    id: id(),
    accountId: uuid("account_id"),
    testerId: uuid("tester_id"),
    name: text("name").notNull(),
    props: jsonb("props"),
    createdAt: createdAt(),
  },
  (t) => [index("telemetry_name_idx").on(t.name, t.createdAt), index("telemetry_account_idx").on(t.accountId, t.createdAt), index("telemetry_tester_idx").on(t.testerId, t.createdAt)],
);

/** Beta reward rules (USD, paid manually in USDG by the operator). Editable in /admin. */
export const betaRewardRules = pgTable("beta_reward_rules", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  amountUsdCents: integer("amount_usd_cents").notNull(),
  config: jsonb("config").notNull().default({}),
  active: boolean("active").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Beta rewards earned by testers. One row per (tester, rule, period). Never credits. */
export const betaRewards = pgTable(
  "beta_rewards",
  {
    id: id(),
    testerId: uuid("tester_id")
      .notNull()
      .references(() => testers.id),
    ruleKey: text("rule_key").notNull(),
    period: text("period").notNull(),
    amountUsdCents: integer("amount_usd_cents").notNull(),
    status: text("status").notNull().default("pending"),
    txHash: text("tx_hash"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("beta_rewards_uq").on(t.testerId, t.ruleKey, t.period),
    check("beta_rewards_status", sql`${t.status} in ('pending', 'approved', 'paid', 'void')`),
    check("beta_rewards_amount", sql`${t.amountUsdCents} >= 0`),
    check("beta_rewards_tx", sql`${t.txHash} is null or ${t.txHash} ~ '^0x[0-9a-fA-F]{64}$'`),
    check("beta_rewards_paid_tx", sql`${t.status} <> 'paid' or ${t.txHash} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Beta money (closed beta, docs/web3.md "Beta money flow"): SIWE wallet challenges, ETH
// checkout orders and on-chain Prize Pool epochs/allocations. Real money: these tables
// SURVIVE the playtest reset (no foreign keys to accounts; not in RESET_TABLES).
// Wei amounts are numeric(78,0) strings.
// ---------------------------------------------------------------------------

const wei = (name: string) => numeric(name, { precision: 78, scale: 0 });

/** One-time SIWE nonces (EIP-4361). */
export const walletChallenges = pgTable(
  "wallet_challenges",
  {
    nonce: text("nonce").primaryKey(),
    accountId: uuid("account_id").notNull(),
    message: text("message").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("wallet_challenges_account_idx").on(t.accountId, t.createdAt)],
);

/** An ETH checkout: the server's quote (EIP-712 EthQuote), then the payment and fulfilment. */
export const chainOrders = pgTable(
  "chain_orders",
  {
    id: id(),
    /** bytes32 hex, the on-chain orderId (single-use in PremiumStore). */
    orderId: text("order_id").notNull(),
    accountId: uuid("account_id").notNull(),
    testerId: uuid("tester_id"),
    wallet: text("wallet").notNull(),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull(),
    usdCents: integer("usd_cents").notNull(),
    priceWei: wei("price_wei").notNull(),
    /** ETH/USD median used for the quote (micro-dollars per ETH) and the source prices (audit). */
    ethUsdMicros: bigint("eth_usd_micros", { mode: "number" }).notNull(),
    priceSources: jsonb("price_sources"),
    chainId: integer("chain_id").notNull(),
    storeAddress: text("store_address").notNull(),
    deadline: ts("deadline").notNull(),
    /** quoted -> submitted (tx hash known) -> paid (verified on-chain) -> fulfilled; or expired / rejected. */
    status: text("status").notNull().default("quoted"),
    txHash: text("tx_hash"),
    /** Pack pulls granted for this order (one per quantity). */
    pullIds: jsonb("pull_ids"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    paidAt: ts("paid_at"),
    fulfilledAt: ts("fulfilled_at"),
  },
  (t) => [
    uniqueIndex("chain_orders_order_uq").on(t.orderId),
    uniqueIndex("chain_orders_tx_uq").on(t.txHash),
    index("chain_orders_account_idx").on(t.accountId, t.createdAt),
    index("chain_orders_status_idx").on(t.status, t.createdAt),
    check("chain_orders_status", sql`${t.status} in ('quoted', 'submitted', 'paid', 'fulfilled', 'expired', 'rejected')`),
    check("chain_orders_qty", sql`${t.quantity} between 1 and 10`),
    check("chain_orders_order_hex", sql`${t.orderId} ~ '^0x[0-9a-f]{64}$'`),
    check("chain_orders_tx_hex", sql`${t.txHash} is null or ${t.txHash} ~ '^0x[0-9a-f]{64}$'`),
  ],
);

/** A weekly Prize Pool epoch (draft computed from league/cup/activity data, then posted on-chain). */
export const poolEpochs = pgTable(
  "pool_epochs",
  {
    id: id(),
    chainId: integer("chain_id").notNull(),
    poolAddress: text("pool_address").notNull(),
    /** On-chain epoch id (sequential per pool). */
    epochId: integer("epoch_id").notNull(),
    /** "weekly" or "season" (season-end bonus). */
    kind: text("kind").notNull().default("weekly"),
    /** The UTC week (Monday) the scores come from. */
    weekStart: date("week_start", { mode: "string" }).notNull(),
    status: text("status").notNull().default("draft"),
    root: text("root").notNull(),
    totalWei: wei("total_wei").notNull(),
    leafCount: integer("leaf_count").notNull(),
    /** The pool's free balance when computed and the budget taken from it. */
    availableWei: wei("available_wei").notNull(),
    ethUsdMicros: bigint("eth_usd_micros", { mode: "number" }).notNull(),
    priceSources: jsonb("price_sources"),
    /** Rules used (budget share, caps in USD, payout curve, activity minimum...). */
    config: jsonb("config").notNull(),
    vestStart: ts("vest_start").notNull(),
    vestEnd: ts("vest_end").notNull(),
    txHash: text("tx_hash"),
    postedAt: ts("posted_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("pool_epochs_uq").on(t.chainId, t.poolAddress, t.epochId),
    check("pool_epochs_status", sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  ],
);

/** One player's allocation in an epoch (with its Merkle proof). */
export const poolAllocations = pgTable(
  "pool_allocations",
  {
    id: id(),
    epochRowId: uuid("epoch_row_id")
      .notNull()
      .references(() => poolEpochs.id),
    accountId: uuid("account_id").notNull(),
    testerId: uuid("tester_id"),
    wallet: text("wallet").notNull(),
    stableName: text("stable_name"),
    rank: integer("rank").notNull(),
    score: integer("score").notNull(),
    activeDays: integer("active_days").notNull(),
    usdCents: integer("usd_cents").notNull(),
    amountWei: wei("amount_wei").notNull(),
    leaf: text("leaf").notNull(),
    proof: jsonb("proof").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("pool_allocations_wallet_uq").on(t.epochRowId, t.wallet),
    uniqueIndex("pool_allocations_account_uq").on(t.epochRowId, t.accountId),
    index("pool_allocations_wallet_idx").on(t.wallet),
  ],
);

export type ChainOrderRow = typeof chainOrders.$inferSelect;
export type PoolEpochRow = typeof poolEpochs.$inferSelect;
export type PoolAllocationRow = typeof poolAllocations.$inferSelect;

export type AccountRow = typeof accounts.$inferSelect;
export type StableRow = typeof stables.$inferSelect;
export type HorseRow = typeof horses.$inferSelect;
export type NewHorseRow = typeof horses.$inferInsert;
export type RaceRow = typeof races.$inferSelect;
export type RaceEntryRow = typeof raceEntries.$inferSelect;
export type ListingRow = typeof marketListings.$inferSelect;
export type PregnancyRow = typeof pregnancies.$inferSelect;
export type LedgerAccountRow = typeof ledgerAccounts.$inferSelect;
export type TesterRow = typeof testers.$inferSelect;
export type FeedbackRow = typeof feedback.$inferSelect;
export type BetaRewardRow = typeof betaRewards.$inferSelect;
export type BetaRewardRuleRow = typeof betaRewardRules.$inferSelect;

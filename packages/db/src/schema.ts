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
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
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
/** Postgres bytea: raw binary (stable photos). Node-side type is Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

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
/** race: in a field · market: listed · stud: a mare booked to a USDG-fee stallion while her stud fee is being paid (lock_ref = usdg_orders.id). */
export const horseLockEnum = pgEnum("horse_lock", ["race", "market", "stud"]);
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
  "tote_house", // the tote's house take (game-core TOTE_TAKEOUT_PERMILLE): never spendable by any player path
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
    // Case-insensitive backstop (wallets are stored checksummed): the race two accounts
    // set the same wallet loses here instead of ending up with two owners.
    uniqueIndex("accounts_wallet_lower_uq").on(sql`lower(${t.walletAddress})`),
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

/**
 * Extra devices linked to an account with a one-time code (no email, no passwords): phones,
 * other browsers. Same token convention as accounts: the device holds a random 256-bit
 * token; only its sha256 (`token_hash`) is stored. The original browser token stays on
 * `accounts.token_hash` and can't be revoked from the device list.
 */
export const accountDevices = pgTable(
  "account_devices",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    tokenHash: text("token_hash").notNull(),
    /** Free-form device name sent when linking, e.g. "iPhone · Safari". */
    label: text("label"),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("account_devices_token_hash_uq").on(t.tokenHash),
    index("account_devices_account_idx").on(t.accountId),
  ],
);

/**
 * One-time device-link codes: 8 characters from an unambiguous alphabet, shown as
 * XXXX-XXXX, valid 10 minutes, single use. Only the code's sha256 (`code_hash`) is stored;
 * a new code expires the account's previous unused ones.
 */
export const linkCodes = pgTable(
  "link_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    /** Failed redemptions against this code (expired/used): telemetry, plus the per-IP limit. */
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => [index("link_codes_account_idx").on(t.accountId)],
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
    /** sha256 hex of the stored stable photo; null = no photo (silks show). */
    photoHash: text("photo_hash"),
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

/** Public registration numbers (G<generation>-<reg_no>): one global, never reused sequence. */
export const horseRegSeq = pgSequence("horse_reg_seq", { startWith: 1 });

export const horses = pgTable(
  "horses",
  {
    id: id(),
    /** Single owner column: a horse can never be owned by two stables. Null = house/system horse. */
    ownerStableId: uuid("owner_stable_id").references(() => stables.id),
    /**
     * The stable racing the horse on lease (services/leasing.ts), null when it is at home. Ownership
     * never moves: owner_stable_id stays the owner. While set, the horse stands in the lessee's
     * stall (it frees the owner's), the lessee cares for, trains and races it, and every owner-only
     * act (sell, breed, retire, release, rename, stud, USDG) is refused. The horse's "keeper" (who
     * may act on it day to day) is coalesce(lessee_stable_id, owner_stable_id).
     */
    lesseeStableId: uuid("lessee_stable_id").references(() => stables.id),
    name: text("name").notNull(),
    /**
     * Public registration sequence, shown as G<generation>-<reg_no zero-padded>. Assigned by
     * the column default on insert (so every code path, old or new, gets one); unique.
     */
    regNo: integer("reg_no").notNull().default(sql`nextval('horse_reg_seq')`),
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
    /** Public stud fee in credits; null = not standing at stud for credits. */
    studFee: credits("stud_fee"),
    /**
     * Public stud fee in micro-USDG for a stallion registered for the USDG market (paid by the
     * mare's owner through HorseMarket.payStudFee); null = none. Never set together with stud_fee.
     */
    studFeeUsdg: bigint("stud_fee_usdg", { mode: "number" }),
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
    /** Exclusive lock: in a race field, listed on the market, or booked for a USDG covering. */
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
    uniqueIndex("horses_reg_no_uq").on(t.regNo),
    /** Name lookups for the uniqueness check (case-insensitive; enforced in services/naming.ts). */
    index("horses_name_lower_idx").using("btree", sql`lower(${t.name})`),
    index("horses_sire_idx").on(t.sireId),
    index("horses_dam_idx").on(t.damId),
    index("horses_rating_idx").on(t.rating),
    check("horses_breeding_count", sql`${t.breedingCount} between 0 and 4`),
    check("horses_not_own_parent", sql`${t.sireId} is distinct from ${t.id} and ${t.damId} is distinct from ${t.id}`),
    check("horses_distinct_parents", sql`${t.sireId} is null or ${t.damId} is null or ${t.sireId} <> ${t.damId}`),
    check("horses_lock_consistent", sql`(${t.lockKind} is null) = (${t.lockRef} is null)`),
    check("horses_rating", sql`${t.rating} between 0 and 140`),
    check("horses_stud_fee", sql`${t.studFee} is null or ${t.studFee} >= 0`),
    check("horses_stud_fee_usdg", sql`${t.studFeeUsdg} is null or (${t.studFeeUsdg} > 0 and ${t.studFee} is null)`),
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
    index("horses_lessee_idx").on(t.lesseeStableId),
    check("horses_lessee_not_owner", sql`${t.lesseeStableId} is null or ${t.lesseeStableId} is distinct from ${t.ownerStableId}`),
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
  (t) => [
    uniqueIndex("care_log_horse_day_uq").on(t.horseId, t.day),
    index("care_log_account_idx").on(t.accountId, t.day),
    /** The horse's log (services/horseLog.ts) pages care sessions by time. */
    index("care_log_horse_created_idx").on(t.horseId, t.createdAt),
  ],
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

/**
 * The horse's log of things no other table keeps (services/horseLog.ts): each training session
 * (workout, realisation gained per stat, fatigue before and after, realisation after), vet
 * treatments, injuries picked up in a race and quirks revealed by one. Races, care, ratings,
 * ownership, leases and breeding are read from their own tables. Append-only; one row per
 * (horse, dedupe key), so a retried write is a no-op.
 */
export const horseLog = pgTable(
  "horse_log",
  {
    id: id(),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    /** training | vet | injury | quirk */
    kind: text("kind").notNull(),
    /** The stable that kept the horse at the time (null for a house horse). */
    stableId: uuid("stable_id").references(() => stables.id),
    raceId: uuid("race_id").references(() => races.id),
    at: ts("at").notNull(),
    data: jsonb("data").notNull().default({}),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("horse_log_horse_key_uq").on(t.horseId, t.dedupeKey), index("horse_log_horse_at_idx").on(t.horseId, t.at)],
);

export type HorseLogRow = typeof horseLog.$inferSelect;

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
    /** Live card slot (card.ts slotKeyOf: "live15m:<slot index>"; "live:<index>" on the old 3-minute card): one race per slot, however many instances publish. */
    slotKey: text("slot_key"),
    maxRunners: integer("max_runners").notNull().default(12),
    /** Field size the lock fills to with house horses (RULES.minField..maxField: 5-12). */
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
    /** Claim price the owner set at entry: claiming races only (services/claiming.ts). */
    claimPrice: credits("claim_price"),
    /**
     * The jockey booked for this ride (services/jockeys.ts): one of the stable's own or a Club
     * freelancer. Null for entries made before jockeys, house runners and non-Live races; the
     * lock then assigns one (the field freezes who actually rode).
     */
    jockeyId: uuid("jockey_id").references((): AnyPgColumn => jockeys.id),
    enteredAt: createdAt(),
    scratchedAt: ts("scratched_at"),
  },
  (t) => [
    uniqueIndex("race_entries_race_horse_uq").on(t.raceId, t.horseId),
    index("race_entries_jockey_idx").on(t.jockeyId),
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

/**
 * "What if?" re-runs (services/whatIf.ts, apps/web server/whatIf.ts): a settled race simulated
 * again with one change to one runner, same seed and same field. A counterfactual cache only:
 * settlement, ratings, form, records and the ledger never read it. One row per (race, horse,
 * change key); `resolved` holds the changed runner exactly as it re-ran (so the what-if replay
 * re-simulates identically later), `summary` the comparison the sheet shows.
 */
export const whatIfRuns = pgTable(
  "what_if_runs",
  {
    id: id(),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    /** Canonical change ("tactic:closer", "jockey:grade:A" ...). */
    changeKey: text("change_key").notNull(),
    /** The engine version the race locked with (and the re-run ran under). */
    engineVersion: text("engine_version").notNull(),
    resolved: jsonb("resolved").notNull(),
    summary: jsonb("summary").notNull(),
    /** The stable that first asked for it. */
    stableId: uuid("stable_id").references(() => stables.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("what_if_runs_uq").on(t.raceId, t.horseId, t.changeKey)],
);

export type WhatIfRunRow = typeof whatIfRuns.$inferSelect;

/**
 * Race sponsorships (services/sponsorship.ts): a stable pays credits (burned) to have a future
 * Live card slot carry its name. One sponsor per slot (unique slot index, first come first
 * served); one row per (account, idempotency key). `raceId` is set when the sponsor is applied
 * to the slot's published race; `refundedAt` when the race was abandoned (or could no longer
 * be named) and the price went back.
 */
export const raceSponsorships = pgTable(
  "race_sponsorships",
  {
    id: id(),
    /** Live card slot index (slot key `live:<index>`). */
    slotIndex: integer("slot_index").notNull(),
    postTime: ts("post_time").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    stableId: uuid("stable_id")
      .notNull()
      .references(() => stables.id),
    /** Snapshots at purchase: the race keeps the name and silks it was sold under. */
    stableName: text("stable_name").notNull(),
    silks: jsonb("silks"),
    price: credits("price").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    ledgerTransactionId: uuid("ledger_transaction_id").references(() => ledgerTransactions.id),
    raceId: uuid("race_id").references(() => races.id),
    refundedAt: ts("refunded_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("race_sponsorships_slot_uq").on(t.slotIndex),
    uniqueIndex("race_sponsorships_key_uq").on(t.accountId, t.idempotencyKey),
    index("race_sponsorships_stable_idx").on(t.stableId, t.postTime),
    index("race_sponsorships_race_idx").on(t.raceId),
    check("race_sponsorships_price", sql`${t.price} > 0`),
  ],
);

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

/**
 * One completed daily goal per player per LOCAL date. The PK is the idempotency unit; the
 * payment's ledger key (`daily-goal:<account>:<day>:<goal>` in completeGoal) matches it, so a
 * retry or double tap pays once and a new local day starts clean.
 */
export const dailyGoalEnum = pgEnum("daily_goal", ["race", "care", "cup"]);

export const dailyGoals = pgTable(
  "daily_goals",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    /** The player's local calendar date (same boundary as care sessions / entries). */
    localDate: date("local_date", { mode: "string" }).notNull(),
    goal: dailyGoalEnum("goal").notNull(),
    completedAt: ts("completed_at").notNull(),
    /** The `daily_goal` ledger transaction that paid the reward. */
    ledgerTxId: uuid("ledger_tx_id")
      .notNull()
      .references(() => ledgerTransactions.id),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.localDate, t.goal] })],
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
    /** Null on a Club lot (club = true): the Club sells its own horse (services/clubMarket.ts). */
    sellerStableId: uuid("seller_stable_id").references(() => stables.id),
    /** A Club lot: listed by the Club's daily job, proceeds burned. */
    club: boolean("club").notNull().default(false),
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
    check("market_listings_club", sql`${t.club} = (${t.sellerStableId} is null)`),
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
    /** Null on a Club sale (club = true): the price was burned. */
    sellerStableId: uuid("seller_stable_id").references(() => stables.id),
    club: boolean("club").notNull().default(false),
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
    /**
     * "admin" = a root code from /admin (signups get the OWNER account as inviter), or
     * "referral" = an account's personal referral code (services/affiliates.ts).
     */
    kind: text("kind").notNull().default("admin"),
    /** The account whose personal code this is (kind "referral"). No FK: survives resets. */
    ownerAccountId: uuid("owner_account_id"),
    createdAt: createdAt(),
  },
  (t) => [
    check("invite_codes_uses", sql`${t.uses} >= 0 and ${t.maxUses} >= 1 and ${t.uses} <= ${t.maxUses}`),
    check("invite_codes_kind", sql`${t.kind} in ('admin', 'referral')`),
    uniqueIndex("invite_codes_referral_owner_uq").on(t.ownerAccountId).where(sql`${t.kind} = 'referral'`),
  ],
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

/**
 * One-time SIWE nonces (EIP-4361). `purpose` "link" = verify a payout wallet for the
 * signed-in account (account_id set); "login" = wallet sign-in with no session yet
 * (account_id null until the wallet is matched to a stable).
 */
export const walletChallenges = pgTable(
  "wallet_challenges",
  {
    nonce: text("nonce").primaryKey(),
    accountId: uuid("account_id"),
    message: text("message").notNull(),
    purpose: text("purpose").notNull().default("link"),
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
    /** Affiliate plan signed into the quote (level 1 = inviter, level 2 = upstream). */
    ref1AccountId: uuid("ref1_account_id"),
    ref1Wallet: text("ref1_wallet"),
    ref1Bps: integer("ref1_bps").notNull().default(0),
    ref2AccountId: uuid("ref2_account_id"),
    ref2Wallet: text("ref2_wallet"),
    ref2Bps: integer("ref2_bps").notNull().default(0),
    /** From the verified PurchasedWithEth event. */
    poolShareWei: wei("pool_share_wei"),
    treasuryWei: wei("treasury_wei"),
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

/**
 * The affiliate tree (2 levels). One row per invitee, written once at signup; inviter and
 * upstream never change (no cycles: an inviter always signed up before the invitee). Wiped
 * by the playtest reset with the accounts (RESET_TABLES); earnings below survive.
 */
export const referrals = pgTable(
  "referrals",
  {
    accountId: uuid("account_id").primaryKey(),
    /** Level 1: the code's owner, or the OWNER account for a root (admin) code. */
    inviterAccountId: uuid("inviter_account_id"),
    /** Level 2: the inviter's own inviter (denormalised at signup). */
    upstreamAccountId: uuid("upstream_account_id"),
    viaCode: text("via_code").notNull(),
    createdAt: createdAt(),
    /** Admin revocation: no future commissions from this invitee (past on-chain payments are final). */
    revokedAt: ts("revoked_at"),
    revokedReason: text("revoked_reason"),
    /** When the invitee became active and the inviter got the in-game signup reward. */
    activatedAt: ts("activated_at"),
  },
  (t) => [index("referrals_inviter_idx").on(t.inviterAccountId), index("referrals_upstream_idx").on(t.upstreamAccountId)],
);

/** Affiliate commissions actually paid on-chain (from verified ReferralCommission events). */
export const referralEarnings = pgTable(
  "referral_earnings",
  {
    id: id(),
    orderId: text("order_id").notNull(),
    level: integer("level").notNull(),
    inviterAccountId: uuid("inviter_account_id").notNull(),
    inviteeAccountId: uuid("invitee_account_id").notNull(),
    wallet: text("wallet").notNull(),
    amountWei: wei("amount_wei").notNull(),
    usdCents: integer("usd_cents").notNull(),
    /** The instant payment failed; the referrer must call withdrawReferral(). */
    deferred: boolean("deferred").notNull().default(false),
    txHash: text("tx_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("referral_earnings_uq").on(t.orderId, t.level),
    index("referral_earnings_inviter_idx").on(t.inviterAccountId, t.createdAt),
    check("referral_earnings_level", sql`${t.level} in (1, 2)`),
  ],
);

export type ReferralRow = typeof referrals.$inferSelect;
export type ReferralEarningRow = typeof referralEarnings.$inferSelect;
export type ChainOrderRow = typeof chainOrders.$inferSelect;
export type PoolEpochRow = typeof poolEpochs.$inferSelect;
export type PoolAllocationRow = typeof poolAllocations.$inferSelect;

export type AccountRow = typeof accounts.$inferSelect;
export type StableRow = typeof stables.$inferSelect;
export type HorseRow = typeof horses.$inferSelect;
export type NewHorseRow = typeof horses.$inferInsert;
export type RaceRow = typeof races.$inferSelect;
export type RaceSponsorshipRow = typeof raceSponsorships.$inferSelect;
export type RaceEntryRow = typeof raceEntries.$inferSelect;
export type ListingRow = typeof marketListings.$inferSelect;
export type PregnancyRow = typeof pregnancies.$inferSelect;
export type LedgerAccountRow = typeof ledgerAccounts.$inferSelect;
export type TesterRow = typeof testers.$inferSelect;
export type FeedbackRow = typeof feedback.$inferSelect;
export type BetaRewardRow = typeof betaRewards.$inferSelect;
export type BetaRewardRuleRow = typeof betaRewardRules.$inferSelect;

// ---------------------------------------------------------------------------
// USDG horse market (docs/usdg-market.md; services/usdgMarket.ts)
// ---------------------------------------------------------------------------

/** micro-USDG (6 decimals): 1 USDG = 1_000_000. Safe integers up to the 1,000,000 USDG cap. */
const usdg = (name: string) => bigint(name, { mode: "number" });

/**
 * A horse registered for the USDG market (registration fee paid on-chain, verified). Once
 * registered, a horse trades only for USDG. Follows the horse through the playtest reset (the
 * paid order itself lives in usdg_orders, which survives it).
 */
export const usdgRegistrations = pgTable(
  "usdg_registrations",
  {
    id: id(),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    /** The account that registered (and paid). */
    accountId: uuid("account_id").notNull(),
    orderId: text("order_id").notNull(),
    wallet: text("wallet").notNull(),
    fee: usdg("fee").notNull(),
    txHash: text("tx_hash"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("usdg_registrations_horse_uq").on(t.horseId), uniqueIndex("usdg_registrations_order_uq").on(t.orderId)],
);

/**
 * A registered horse for sale for USDG: a fixed price or an auction (price = reserve). The horse
 * is locked to the listing (horses.lock_kind 'market', lock_ref = this id) while it is `active`
 * or `closed` (an auction that ended and is being offered to its bidders in turn).
 */
export const usdgListings = pgTable(
  "usdg_listings",
  {
    id: id(),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    sellerAccountId: uuid("seller_account_id").notNull(),
    sellerStableId: uuid("seller_stable_id")
      .notNull()
      .references(() => stables.id),
    /** The seller's verified wallet at listing time: where `price - fee` is paid. */
    sellerWallet: text("seller_wallet").notNull(),
    /** "fixed" | "auction" */
    kind: text("kind").notNull(),
    /** Fixed price, or the auction's reserve. */
    price: usdg("price").notNull(),
    /** Credits appraisal at listing time (the price review compares price per appraisal). */
    appraisal: credits("appraisal").notNull(),
    /** active -> sold | cancelled | expired (fixed) ; active -> closed (offering) -> sold | unsold (auction). */
    status: text("status").notNull().default("active"),
    endsAt: ts("ends_at").notNull(),
    /** The sale order currently offered/reserved for this listing (usdg_orders.order_id). */
    offerOrderId: text("offer_order_id"),
    createdAt: createdAt(),
    closedAt: ts("closed_at"),
  },
  (t) => [
    uniqueIndex("usdg_listings_horse_open_uq")
      .on(t.horseId)
      .where(sql`${t.status} in ('active', 'closed')`),
    index("usdg_listings_status_idx").on(t.status, t.endsAt),
    index("usdg_listings_seller_idx").on(t.sellerStableId),
    check("usdg_listings_kind", sql`${t.kind} in ('fixed', 'auction')`),
    check("usdg_listings_status", sql`${t.status} in ('active', 'closed', 'sold', 'cancelled', 'expired', 'unsold')`),
    check("usdg_listings_price", sql`${t.price} > 0`),
    check("usdg_listings_ends", sql`${t.endsAt} > ${t.createdAt}`),
  ],
);

/**
 * An auction bid, signed off-chain by the bidder's linked wallet (EIP-712 Bid, checked by the
 * server). No money moves until the auction closes and the winner pays a SaleOrder.
 */
export const usdgBids = pgTable(
  "usdg_bids",
  {
    id: id(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => usdgListings.id),
    accountId: uuid("account_id").notNull(),
    wallet: text("wallet").notNull(),
    amount: usdg("amount").notNull(),
    /** uint256 nonce as a decimal string (from the bidder's wallet prompt). */
    nonce: text("nonce").notNull(),
    signature: text("signature").notNull(),
    /** active | offered (won the close, payment window open) | won (paid) | defaulted (didn't pay) | void (bidder ineligible) */
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("usdg_bids_signature_uq").on(t.signature),
    uniqueIndex("usdg_bids_nonce_uq").on(t.listingId, t.accountId, t.nonce),
    index("usdg_bids_listing_idx").on(t.listingId, t.amount),
    check("usdg_bids_amount", sql`${t.amount} > 0`),
    check("usdg_bids_status", sql`${t.status} in ('active', 'offered', 'won', 'defaulted', 'void')`),
  ],
);

/**
 * Every USDG payment the server signs: a registration fee, a horse sale or a stud fee. Written
 * BEFORE the order is signed; fulfilled once, idempotently, after the chain shows `Registered` /
 * `Sold` / `StudFeePaid`. A stud order (kind 'stud'): horse_id is the stallion, mare_id the mare,
 * seller_* the stallion's owner; fulfilment runs the covering (breeding_event_id).
 * Real money: survives the playtest reset (no foreign keys).
 */
export const usdgOrders = pgTable(
  "usdg_orders",
  {
    id: id(),
    /** bytes32 hex (lowercase), the on-chain orderId (single-use in HorseMarket). */
    orderId: text("order_id").notNull(),
    /** "registration" | "sale" | "stud" */
    kind: text("kind").notNull(),
    /** Who pays: the owner (registration), the buyer (sale) or the mare's owner (stud). */
    accountId: uuid("account_id").notNull(),
    wallet: text("wallet").notNull(),
    horseId: uuid("horse_id").notNull(),
    horseRef: text("horse_ref").notNull(),
    listingId: uuid("listing_id"),
    bidId: uuid("bid_id"),
    sellerAccountId: uuid("seller_account_id"),
    sellerWallet: text("seller_wallet"),
    /** Stud orders: the mare to cover and her on-chain ref. */
    mareId: uuid("mare_id"),
    mareRef: text("mare_ref"),
    /** Stud orders: the credits base fee held in escrow at the quote (burned at the covering, released otherwise). */
    creditsHeld: bigint("credits_held", { mode: "number" }),
    /** Stud orders: the covering this payment produced. */
    breedingEventId: uuid("breeding_event_id"),
    /** Sale price, the registration fee, or the stud fee. */
    price: usdg("price").notNull(),
    /** Marketplace fee to the treasury (registration: the whole fee). */
    fee: usdg("fee").notNull(),
    token: text("token").notNull(),
    chainId: integer("chain_id").notNull(),
    marketAddress: text("market_address").notNull(),
    deadline: ts("deadline").notNull(),
    /** pending (signed, maybe submitted: tx_hash set) -> paid (verified on-chain) -> fulfilled ; or expired. */
    status: text("status").notNull().default("pending"),
    txHash: text("tx_hash"),
    /** Price review (wash-trading signal): far from recent comparable sales. The sale still stands. */
    flagged: boolean("flagged").notNull().default(false),
    flagReason: text("flag_reason"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    paidAt: ts("paid_at"),
    fulfilledAt: ts("fulfilled_at"),
    expiredAt: ts("expired_at"),
  },
  (t) => [
    uniqueIndex("usdg_orders_order_uq").on(t.orderId),
    uniqueIndex("usdg_orders_tx_uq").on(t.txHash),
    index("usdg_orders_account_idx").on(t.accountId, t.createdAt),
    index("usdg_orders_status_idx").on(t.status, t.deadline),
    index("usdg_orders_listing_idx").on(t.listingId),
    index("usdg_orders_horse_idx").on(t.horseId, t.kind, t.status),
    uniqueIndex("usdg_orders_breeding_uq").on(t.breedingEventId),
    check("usdg_orders_kind", sql`${t.kind} in ('registration', 'sale', 'stud')`),
    check("usdg_orders_stud", sql`(${t.kind} = 'stud') = (${t.mareId} is not null)`),
    check("usdg_orders_status", sql`${t.status} in ('pending', 'paid', 'fulfilled', 'expired')`),
    check("usdg_orders_amounts", sql`${t.price} > 0 and ${t.fee} >= 0 and ${t.fee} <= ${t.price}`),
    check("usdg_orders_order_hex", sql`${t.orderId} ~ '^0x[0-9a-f]{64}$'`),
    check("usdg_orders_tx_hex", sql`${t.txHash} is null or ${t.txHash} ~ '^0x[0-9a-f]{64}$'`),
  ],
);

export type UsdgRegistrationRow = typeof usdgRegistrations.$inferSelect;
export type UsdgListingRow = typeof usdgListings.$inferSelect;
export type UsdgBidRow = typeof usdgBids.$inferSelect;
export type UsdgOrderRow = typeof usdgOrders.$inferSelect;

// ---------------------------------------------------------------------------
// Horse leasing (services/leasing.ts; the numbers live in game-core leasing.ts)
// ---------------------------------------------------------------------------

/**
 * An owner's open offer to lease one racing horse: term, the owner's share of the prizes and an
 * optional upfront fee. One active offer per horse (partial unique index). The horse is NOT locked
 * while on offer (it can still race at home); taking the lease re-checks everything.
 * status: active -> sold (taken: lease_id set) | cancelled (withdrawn, or the horse stopped
 * qualifying) | expired.
 */
export const horseLeaseListings = pgTable(
  "horse_lease_listings",
  {
    id: id(),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    /** Null on a Club offer (club = true): the Club leases out its own horse (services/clubMarket.ts). */
    ownerStableId: uuid("owner_stable_id").references(() => stables.id),
    club: boolean("club").notNull().default(false),
    termDays: integer("term_days").notNull(),
    ownerSharePct: integer("owner_share_pct").notNull(),
    fee: credits("fee").notNull().default(0),
    /** Welfare terms the owner sets (game-core leasing.ts): all-out rides allowed, weekly Live-start cap. */
    allowAllOut: boolean("allow_all_out").notNull().default(false),
    maxLiveStartsPerWeek: integer("max_live_starts_per_week").notNull().default(4),
    /** Minimum lessee rating in stars (1..5), null = anyone eligible. */
    minLesseeRating: integer("min_lessee_rating"),
    status: listingStatusEnum("status").notNull().default("active"),
    leaseId: uuid("lease_id"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    closedAt: ts("closed_at"),
  },
  (t) => [
    uniqueIndex("horse_lease_listings_horse_active_uq")
      .on(t.horseId)
      .where(sql`${t.status} = 'active'`),
    index("horse_lease_listings_status_idx").on(t.status, t.expiresAt),
    index("horse_lease_listings_owner_idx").on(t.ownerStableId, t.status),
    check(
      "horse_lease_listings_terms",
      sql`${t.termDays} between 1 and 60 and ${t.ownerSharePct} between 0 and 100 and ${t.fee} >= 0 and ${t.maxLiveStartsPerWeek} between 1 and 21 and (${t.minLesseeRating} is null or ${t.minLesseeRating} between 1 and 5)`,
    ),
    check("horse_lease_listings_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
    check("horse_lease_listings_club", sql`${t.club} = (${t.ownerStableId} is null)`),
  ],
);

/**
 * A lease in force ('active') or finished ('ended'). One active lease per horse (partial unique
 * index); horses.lessee_stable_id mirrors the active lease. Running totals of the purse shares
 * (owner_earned / lessee_earned, races) feed the stable views and the end-of-lease inbox notes.
 * end_requested_at: the lessee handed the horse back while it was entered in a race; it goes home
 * once that race settles (or is abandoned).
 */
export const horseLeases = pgTable(
  "horse_leases",
  {
    id: id(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => horseLeaseListings.id),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    /** Null on a Club lease (club = true): the owner's purse share is burned. */
    ownerStableId: uuid("owner_stable_id").references(() => stables.id),
    club: boolean("club").notNull().default(false),
    lesseeStableId: uuid("lessee_stable_id")
      .notNull()
      .references(() => stables.id),
    termDays: integer("term_days").notNull(),
    ownerSharePct: integer("owner_share_pct").notNull(),
    fee: credits("fee").notNull().default(0),
    /** Platform cut of the fee (burned). */
    feeCut: credits("fee_cut").notNull().default(0),
    allowAllOut: boolean("allow_all_out").notNull().default(false),
    maxLiveStartsPerWeek: integer("max_live_starts_per_week").notNull().default(4),
    /** Condition report { fitness, fatigue, injury, rating } at the start and at the return. */
    startCondition: jsonb("start_condition"),
    endCondition: jsonb("end_condition"),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    /** active | ended */
    status: text("status").notNull().default("active"),
    /** term | returned | injured | retired | died */
    endReason: text("end_reason"),
    endRequestedAt: ts("end_requested_at"),
    endedAt: ts("ended_at"),
    races: integer("races").notNull().default(0),
    ownerEarned: credits("owner_earned").notNull().default(0),
    lesseeEarned: credits("lessee_earned").notNull().default(0),
    /** Lessee record: entries made on lease, the horse's fatigue summed over them, injuries on lease. */
    entries: integer("entries").notNull().default(0),
    fatigueAtEntrySum: integer("fatigue_at_entry_sum").notNull().default(0),
    injuries: integer("injuries").notNull().default(0),
    /** The owner's 1-5 star rating of the lessee, once the lease has ended (once). */
    ownerRating: integer("owner_rating"),
    ratedAt: ts("rated_at"),
    feeTransactionId: uuid("fee_transaction_id").references(() => ledgerTransactions.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("horse_leases_listing_uq").on(t.listingId),
    uniqueIndex("horse_leases_horse_active_uq")
      .on(t.horseId)
      .where(sql`${t.status} = 'active'`),
    index("horse_leases_owner_idx").on(t.ownerStableId, t.status),
    index("horse_leases_lessee_idx").on(t.lesseeStableId, t.status),
    index("horse_leases_due_idx").on(t.status, t.endsAt),
    /** Every lease a horse has had (the horse's log). */
    index("horse_leases_horse_idx").on(t.horseId, t.startsAt),
    check("horse_leases_parties", sql`${t.ownerStableId} <> ${t.lesseeStableId}`),
    check("horse_leases_status", sql`${t.status} in ('active', 'ended')`),
    check("horse_leases_club", sql`${t.club} = (${t.ownerStableId} is null)`),
    check("horse_leases_ended", sql`(${t.status} = 'ended') = (${t.endedAt} is not null)`),
    check("horse_leases_range", sql`${t.endsAt} > ${t.startsAt}`),
    check("horse_leases_rating", sql`${t.ownerRating} is null or (${t.ownerRating} between 1 and 5 and ${t.status} = 'ended')`),
    check("horse_leases_record", sql`${t.entries} >= 0 and ${t.fatigueAtEntrySum} >= 0 and ${t.injuries} >= 0`),
    check(
      "horse_leases_money",
      sql`${t.fee} >= 0 and ${t.feeCut} >= 0 and ${t.feeCut} <= ${t.fee} and ${t.ownerEarned} >= 0 and ${t.lesseeEarned} >= 0 and ${t.races} >= 0`,
    ),
  ],
);

export type HorseLeaseListingRow = typeof horseLeaseListings.$inferSelect;
export type HorseLeaseRow = typeof horseLeases.$inferSelect;

// ---------------------------------------------------------------------------
// Stable photos (owner decision 2026-10-30; the rules live in game-core stablePhoto.ts)
// ---------------------------------------------------------------------------

/**
 * A stable's stored photo: the re-encoded 256x256 WebP (services/stablePhoto.ts) plus the daily
 * upload counter. One row per stable, kept across removals (image emptied) so the rate limit
 * survives a removal; `stables.photo_hash` is what says a photo is currently set.
 */
export const stablePhotos = pgTable("stable_photos", {
  stableId: uuid("stable_id")
    .primaryKey()
    .references(() => stables.id),
  /** The stored WebP bytes; an empty buffer when no photo is set (the counter row survives). */
  image: bytea("image").notNull(),
  hash: text("hash").notNull(),
  bytes: integer("bytes").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  /** UTC day the upload counter counts ("YYYY-MM-DD"); a new day resets uploadsToday. */
  uploadsDay: text("uploads_day").notNull(),
  uploadsToday: integer("uploads_today").notNull().default(0),
});

export type StablePhotoRow = typeof stablePhotos.$inferSelect;

// ---------------------------------------------------------------------------
// The Club seeds the markets (game-core clubMarket.ts, services/clubMarket.ts)
// ---------------------------------------------------------------------------

/**
 * One row per UTC day the Club's market job has run: the job inserts its day first and does
 * nothing when the row already exists, so reruns on the same day never list twice.
 */
export const clubMarketDays = pgTable("club_market_days", {
  day: text("day").primaryKey(),
  listed: integer("listed").notNull().default(0),
  offered: integer("offered").notNull().default(0),
  withdrawn: integer("withdrawn").notNull().default(0),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Claiming races (game-core claiming.ts, services/claiming.ts)
// ---------------------------------------------------------------------------

/**
 * A claim lodged on a runner in a claiming race. The claimant's credits are held in escrow from
 * the claim. Status: `lodged` until the lock, then `drawn` (won the draw) or `lost` (refunded);
 * at settlement `claimed` (the horse moved) or `void` (fatal injury, or no free stall: refunded);
 * `refunded` when the horse was scratched or the race abandoned. One claim per stable per race.
 */
export const raceClaims = pgTable(
  "race_claims",
  {
    id: id(),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => raceEntries.id),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    /** The owner who entered the horse (receives the price minus the fee). */
    ownerStableId: uuid("owner_stable_id")
      .notNull()
      .references(() => stables.id),
    claimantStableId: uuid("claimant_stable_id")
      .notNull()
      .references(() => stables.id),
    price: credits("price").notNull(),
    status: text("status").notNull().default("lodged"),
    /** Burned at the transfer (the market's 5%); 0 until then. */
    fee: credits("fee").notNull().default(0),
    escrowTransactionId: uuid("escrow_transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    /** The sale (escrow → owner + burn) or the refund (escrow → claimant). */
    closeTransactionId: uuid("close_transaction_id").references(() => ledgerTransactions.id),
    createdAt: createdAt(),
    closedAt: ts("closed_at"),
  },
  (t) => [
    uniqueIndex("race_claims_race_claimant_uq").on(t.raceId, t.claimantStableId),
    index("race_claims_horse_idx").on(t.horseId, t.status),
    index("race_claims_claimant_idx").on(t.claimantStableId, t.status),
    check("race_claims_status", sql`${t.status} in ('lodged', 'drawn', 'lost', 'claimed', 'void', 'refunded')`),
    check("race_claims_price", sql`${t.price} > 0`),
  ],
);

export type RaceClaimRow = typeof raceClaims.$inferSelect;

// ---------------------------------------------------------------------------
// Shared rate limits (apps/web src/server/rateLimit.ts counts here; services/rateLimit.ts)
// ---------------------------------------------------------------------------

/**
 * Shared rate-limit counters, one row per key per fixed window (rateLimit service).
 * Keys are opaque `${limiter}:${subject}` strings, so every serverless instance counts
 * against the same quota instead of its own memory.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    /** Start of the fixed window, in ms since epoch. */
    windowStart: bigint("window_start", { mode: "number" }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export type RateLimitRow = typeof rateLimits.$inferSelect;

// ---------------------------------------------------------------------------
// Jockeys (docs/design/jockeys.md, Phase 1: roster and riding; services/jockeys.ts)
// ---------------------------------------------------------------------------

/**
 * Computer-controlled riders. `stable_id` null = a Club freelancer (any stable can book one for a
 * ride, or sign them); otherwise the stable that holds them (at most JOCKEYS_PER_STABLE_MAX).
 * Skills and potential are game-core JockeySkills ({ gate, pace, finish, handling }, 0..1000).
 * Credits only: nothing here is ever bought or paid in USDG.
 */
export const jockeys = pgTable(
  "jockeys",
  {
    id: id(),
    name: text("name").notNull(),
    /** 64-hex seed the name, personality, potential and career length were drawn from. */
    seed: text("seed").notNull(),
    /** Start of the riding career (stage and retirement count from here). */
    bornAt: ts("born_at").notNull(),
    stage: text("stage").notNull().default("apprentice"),
    personality: text("personality").notNull(),
    skills: jsonb("skills").notNull(),
    potential: jsonb("potential").notNull(),
    experience: integer("experience").notNull().default(0),
    rides: integer("rides").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    stableId: uuid("stable_id").references(() => stables.id),
    /** When the current stable took them on (null for freelancers). */
    joinedAt: ts("joined_at"),
    /** The stable that last let them go, and when (linked-account refusal on signing). */
    lastStableId: uuid("last_stable_id").references(() => stables.id),
    releasedAt: ts("released_at"),
    retireAt: ts("retire_at").notNull(),
    retirementAnnouncedAt: ts("retirement_announced_at"),
    retiredAt: ts("retired_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("jockeys_stable_idx").on(t.stableId, t.retiredAt),
    index("jockeys_active_idx").on(t.retiredAt, t.stableId),
    check("jockeys_stage", sql`${t.stage} in ('apprentice', 'prime', 'veteran')`),
    check("jockeys_personality", sql`${t.personality} in ('money', 'ambitious', 'loyal', 'workhorse')`),
    check("jockeys_counts", sql`${t.rides} >= 0 and ${t.wins} between 0 and ${t.rides} and ${t.experience} >= 0`),
  ],
);

export type JockeyRow = typeof jockeys.$inferSelect;

/**
 * One ride: written when the field locks (who rode which horse, frozen with the field), the result
 * filled in at settlement (in the settlement's transaction, so growth is applied exactly once).
 */
export const jockeyRides = pgTable(
  "jockey_rides",
  {
    id: id(),
    jockeyId: uuid("jockey_id")
      .notNull()
      .references(() => jockeys.id),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    /** The horse's stable for this race (null = a Club runner). */
    stableId: uuid("stable_id").references(() => stables.id),
    /** The jockey's own stable at the lock (null = rode as a freelancer). */
    jockeyStableId: uuid("jockey_stable_id").references(() => stables.id),
    postTime: ts("post_time").notNull(),
    claimLb: integer("claim_lb").notNull().default(0),
    /** Freelance fee paid for this ride (0 for own jockeys and Club runners). */
    fee: credits("fee").notNull().default(0),
    position: integer("position"),
    experience: integer("experience"),
    settledAt: ts("settled_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("jockey_rides_race_jockey_uq").on(t.raceId, t.jockeyId),
    uniqueIndex("jockey_rides_race_horse_uq").on(t.raceId, t.horseId),
    index("jockey_rides_jockey_idx").on(t.jockeyId, t.postTime),
    index("jockey_rides_post_idx").on(t.postTime),
  ],
);

export type JockeyRideRow = typeof jockeyRides.$inferSelect;

/**
 * Career path: debut, signed (by a stable), released (back to the Club pool), retirement
 * announced, retired. `key` makes each event idempotent.
 */
export const jockeyEvents = pgTable(
  "jockey_events",
  {
    id: id(),
    key: text("key").notNull(),
    jockeyId: uuid("jockey_id")
      .notNull()
      .references(() => jockeys.id),
    kind: text("kind").notNull(),
    stableId: uuid("stable_id").references(() => stables.id),
    at: ts("at").notNull(),
    data: jsonb("data").notNull().default({}),
  },
  (t) => [
    uniqueIndex("jockey_events_key_uq").on(t.key),
    index("jockey_events_jockey_idx").on(t.jockeyId, t.at),
    index("jockey_events_stable_idx").on(t.stableId, t.kind),
    check("jockey_events_kind", sql`${t.kind} in ('debut', 'signed', 'released', 'retirement_announced', 'retired')`),
  ],
);

export type JockeyEventRow = typeof jockeyEvents.$inferSelect;

/** Weekly jockey jobs (intake, veteran decline) that ran, one row per game week (idempotency). */
export const jockeyWeeks = pgTable("jockey_weeks", {
  week: integer("week").primaryKey(),
  data: jsonb("data").notNull().default({}),
  ranAt: ts("ran_at").notNull(),
});

/**
 * The racing news (services/news.ts): short public items written from facts at the event
 * (settlement, a sale, maintenance). One row per dedupe key. `publicAt` hides an item about a
 * race until its broadcast is over. `stableIds` are the stables involved (owners, buyer and
 * seller, a jockey's stable) for the "My stable" tab.
 */
export const newsItems = pgTable(
  "news_items",
  {
    id: id(),
    dedupeKey: text("dedupe_key").notNull(),
    kind: text("kind").notNull(),
    headline: text("headline").notNull(),
    href: text("href").notNull(),
    publicAt: ts("public_at").notNull(),
    raceId: uuid("race_id").references(() => races.id),
    horseId: uuid("horse_id").references(() => horses.id),
    jockeyId: uuid("jockey_id").references(() => jockeys.id),
    stableIds: uuid("stable_ids").array().notNull().default(sql`'{}'::uuid[]`),
    data: jsonb("data").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("news_items_dedupe_uq").on(t.dedupeKey),
    index("news_items_public_idx").on(t.publicAt),
    index("news_items_stables_idx").using("gin", t.stableIds),
  ],
);

export type NewsItemRow = typeof newsItems.$inferSelect;

/**
 * Campaign targets (services/planner.ts): a horse aimed at a future race, by card slot index (a
 * calendar race can be pinned before it is published; `raceId` is set once it is, or at once for
 * a published race). Up to five active per horse. `removedAt` + `removedReason` when it ran, was
 * scratched, became ineligible or the race went by; reminders are sent once each.
 */
export const raceTargets = pgTable(
  "race_targets",
  {
    id: id(),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    stableId: uuid("stable_id")
      .notNull()
      .references(() => stables.id),
    slotIndex: integer("slot_index").notNull(),
    raceId: uuid("race_id").references(() => races.id),
    name: text("name").notNull(),
    raceClass: text("race_class").notNull(),
    postTime: ts("post_time").notNull(),
    remindedOpenAt: ts("reminded_open_at"),
    remindedCloseAt: ts("reminded_close_at"),
    removedAt: ts("removed_at"),
    removedReason: text("removed_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("race_targets_active_uq")
      .on(t.horseId, t.slotIndex)
      .where(sql`${t.removedAt} is null`),
    index("race_targets_stable_idx").on(t.stableId, t.postTime),
    index("race_targets_horse_idx").on(t.horseId, t.postTime),
    index("race_targets_due_idx")
      .on(t.postTime)
      .where(sql`${t.removedAt} is null`),
  ],
);

export type RaceTargetRow = typeof raceTargets.$inferSelect;

// ---------------------------------------------------------------------------
// The tote: spectator pool betting on Live card races (services/tote.ts, game-core tote.ts)
// ---------------------------------------------------------------------------

export const totePoolEnum = pgEnum("tote_pool", ["win", "place"]);
/**
 * open: stake held in escrow until settlement. won / lost: settled (payout may be 0).
 * returned: nobody backed a paying runner, the net pool came back pro rata. void: refunded in
 * full (non-runner, abandoned race, no place pool, or a conflict of interest found later).
 */
export const toteBetStatusEnum = pgEnum("tote_bet_status", ["open", "won", "lost", "returned", "void"]);

/**
 * One bet: a stake on one runner in one pool (WIN or PLACE) in one currency ("CR" Stable Credits,
 * "TUSDG" practice T-USDG). The stake moves player -> escrow when placed and is paid out (or
 * refunded) from escrow at settlement. Never accepted at or after the off.
 */
export const toteBets = pgTable(
  "tote_bets",
  {
    id: id(),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    stableId: uuid("stable_id").references(() => stables.id),
    horseId: uuid("horse_id")
      .notNull()
      .references(() => horses.id),
    pool: totePoolEnum("pool").notNull(),
    currency: text("currency").notNull(),
    stake: credits("stake").notNull(),
    status: toteBetStatusEnum("status").notNull().default("open"),
    payout: credits("payout").notNull().default(0),
    voidReason: text("void_reason"),
    /** Client key for one bet slip submission: a double tap places one bet. */
    clientKey: text("client_key").notNull(),
    placedAt: ts("placed_at").notNull(),
    settledAt: ts("settled_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("tote_bets_client_key_uq").on(t.accountId, t.clientKey),
    index("tote_bets_race_idx").on(t.raceId, t.pool, t.currency, t.status),
    index("tote_bets_account_idx").on(t.accountId, t.placedAt),
    index("tote_bets_open_idx")
      .on(t.raceId)
      .where(sql`${t.status} = 'open'`),
    check("tote_bets_stake_positive", sql`${t.stake} > 0`),
    check("tote_bets_payout_non_negative", sql`${t.payout} >= 0`),
    check("tote_bets_currency", sql`${t.currency} in ('CR', 'TUSDG')`),
  ],
);

/**
 * One settled pool (race x pool x currency): the public "Tote audit". Written once, in the
 * settlement transaction; total = paid + takeout + remainder exactly (CHECK).
 */
export const totePools = pgTable(
  "tote_pools",
  {
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id),
    pool: totePoolEnum("pool").notNull(),
    currency: text("currency").notNull(),
    /** paid | no_winner | void | empty | abandoned */
    outcome: text("outcome").notNull(),
    places: integer("places").notNull(),
    takeoutPermille: integer("takeout_permille").notNull(),
    total: credits("total").notNull(),
    takeout: credits("takeout").notNull(),
    paid: credits("paid").notNull(),
    remainder: credits("remainder").notNull(),
    /** Stakes returned in full, outside the pool (non-runners, void pools, abandoned races). */
    refunded: credits("refunded").notNull(),
    tickets: integer("tickets").notNull(),
    winningTickets: integer("winning_tickets").notNull(),
    bettors: integer("bettors").notNull(),
    /** [{horseId, name, position, stake, amount, perUnitMilli}] */
    dividends: jsonb("dividends").notNull(),
    ledgerTransactionId: uuid("ledger_transaction_id"),
    settledAt: ts("settled_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.raceId, t.pool, t.currency] }),
    index("tote_pools_settled_idx").on(t.settledAt),
    check("tote_pools_balanced", sql`${t.total} = ${t.paid} + ${t.takeout} + ${t.remainder}`),
  ],
);

/**
 * A player's betting settings: the 18+ confirmation, their own (lower) limits and any
 * self-exclusion. Lowering a limit is immediate; a raise waits TOTE_LIMIT_RAISE_DELAY_MS
 * (`pending_limits` from `pending_at`). A self-exclusion can't be shortened or lifted early;
 * `excluded_permanent` never ends.
 */
export const toteSettings = pgTable("tote_settings", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id),
  adultConfirmedAt: ts("adult_confirmed_at"),
  /** {CR: {perRace, perDay}, TUSDG: {perRace, perDay}}, base units, null = the game's limit. */
  limits: jsonb("limits").notNull().default({}),
  pendingLimits: jsonb("pending_limits"),
  pendingAt: ts("pending_at"),
  excludedUntil: ts("excluded_until"),
  excludedPermanent: boolean("excluded_permanent").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type ToteBetRow = typeof toteBets.$inferSelect;
export type TotePoolRow = typeof totePools.$inferSelect;
export type ToteSettingsRow = typeof toteSettings.$inferSelect;

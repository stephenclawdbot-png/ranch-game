/**
 * Domain errors. Route handlers map `code` to an HTTP status (see `httpStatusFor`).
 * Database constraint violations that encode a game rule are translated into the same
 * codes, so a rule is reported identically whether the service check or the database
 * backstop caught it.
 */
export type DomainErrorCode =
  | "NOT_FOUND"
  | "NOT_OWNER"
  | "INVALID_INPUT"
  | "INSUFFICIENT_FUNDS"
  | "IDEMPOTENCY_CONFLICT"
  | "STABLE_FULL"
  | "HORSE_LOCKED"
  | "HORSE_IN_FOAL"
  | "HORSE_INJURED"
  | "HORSE_RETIRED"
  | "HORSE_NOT_OF_AGE"
  | "RACE_LIMIT"
  | "RACE_CLOSED"
  | "RACE_FULL"
  | "STABLE_ALREADY_ENTERED"
  | "NOT_ELIGIBLE"
  | "TOO_EARLY"
  | "ALREADY_CARED_TODAY"
  | "DAILY_CUP_ALREADY_ENTERED"
  | "SELF_BREEDING"
  | "KIN_BREEDING"
  | "BREEDING_LIMIT"
  | "BREEDING_SEASON_LIMIT"
  | "BREEDING_NOT_ELIGIBLE"
  | "LISTING_NOT_ACTIVE"
  | "LISTING_EXPIRED"
  | "CANNOT_BUY_OWN"
  | "PERMANENT_STATE"
  | "HORSE_BOUND"
  | "PACK_LIMIT"
  | "CROP_SOLD_OUT"
  | "LINKED_ACCOUNTS"
  | "SELLER_REQUIREMENTS"
  | "PRICE_BELOW_FLOOR"
  | "PRICE_ABOVE_CEILING"
  | "RESALE_LOCKED"
  | "INSUFFICIENT_ENTRIES"
  | "ENTRY_REFILL_UNAVAILABLE"
  | "TIMEZONE_LOCKED"
  | "NAME_TAKEN"
  /** A horse registered for the USDG market trades only for USDG (docs/usdg-market.md). */
  | "USDG_ONLY"
  /** Barred from USDG bidding after not paying for a won auction. */
  | "USDG_BARRED"
  /** Another stable already sponsors that Live card slot (services/sponsorship.ts). */
  | "ALREADY_SPONSORED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: DomainErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(e: unknown, code?: DomainErrorCode): e is DomainError {
  return e instanceof DomainError && (code === undefined || e.code === code);
}

export function httpStatusFor(code: DomainErrorCode): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "NOT_OWNER":
      return 403;
    case "INVALID_INPUT":
      return 400;
    case "TOO_EARLY":
      return 425;
    case "INSUFFICIENT_FUNDS":
      return 402;
    default:
      return 409;
  }
}

interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
  cause?: unknown;
}

/** Walks `cause` chains (drizzle wraps driver errors) to find the Postgres error. */
export function pgError(e: unknown): PgErrorLike | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const c = cur as PgErrorLike;
    if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code)) return c;
    cur = c.cause;
  }
  return null;
}

/** Postgres SQLSTATEs worth retrying a whole transaction for. */
export function isRetryable(e: unknown): boolean {
  const code = pgError(e)?.code;
  return code === "40001" || code === "40P01";
}

const CONSTRAINT_CODES: Record<string, DomainErrorCode> = {
  ledger_accounts_non_negative: "INSUFFICIENT_FUNDS",
  care_log_horse_day_uq: "ALREADY_CARED_TODAY",
  daily_cup_account_day_uq: "DAILY_CUP_ALREADY_ENTERED",
  breeding_events_dam_season_uq: "BREEDING_SEASON_LIMIT",
  horses_breeding_count: "BREEDING_LIMIT",
  breeding_events_not_self: "SELF_BREEDING",
  pregnancies_dam_carrying_uq: "HORSE_IN_FOAL",
  market_listings_horse_active_uq: "HORSE_LOCKED",
  usdg_listings_horse_open_uq: "HORSE_LOCKED",
  race_entries_race_horse_uq: "HORSE_LOCKED",
  horses_mandatory_retirement: "HORSE_RETIRED",
  foal_crop_bounds: "CROP_SOLD_OUT",
  stables_slots: "INVALID_INPUT",
  stables_entry_balance: "INSUFFICIENT_ENTRIES",
};

/** Translates rule-encoding constraint violations into DomainErrors; returns other errors unchanged. */
export function translateDbError(e: unknown): unknown {
  if (e instanceof DomainError) return e;
  const pg = pgError(e);
  if (!pg) return e;
  const mapped = pg.constraint ? CONSTRAINT_CODES[pg.constraint] : undefined;
  if (mapped) return new DomainError(mapped, pg.message, { constraint: pg.constraint });
  if (pg.code === "23001") {
    const msg = pg.message ?? "";
    if (/bound|starts before/.test(msg)) return new DomainError("HORSE_BOUND", msg);
    if (/in foal/.test(msg)) return new DomainError("HORSE_IN_FOAL", msg);
    if (/entered in a race/.test(msg)) return new DomainError("HORSE_LOCKED", msg);
    return new DomainError("PERMANENT_STATE", msg);
  }
  return e;
}

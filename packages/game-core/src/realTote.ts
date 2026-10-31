/**
 * The REAL-USDG tote: a DORMANT scaffold (docs/usdg-tote.md). Nothing here runs unless
 * `REAL_TOTE_ENABLED=true` AND `WEB3_ENABLED=true` AND `TOTE_POOLS_ADDRESS` is set, and that
 * needs legal approval first. The in-game tote (tote.ts: credits and practice T-USDG) is not
 * affected by anything in this file.
 *
 * Real money changes three things, all race-level and only for races flagged for it:
 *  - the field locks earlier (`REAL_TOTE_FIELD_LOCK_MS` before the off) so bettors see the final
 *    field, and the on-chain market opens then;
 *  - betting closes before the off (`realToteBetsCloseMs`): the market closes
 *    `REAL_TOTE_ENTROPY_LEAD_MS` before the off, and the contract refuses bets a further
 *    `REAL_TOTE_CLOSE_MARGIN_MS` before that (sequencer clock drift);
 *  - the race runs on finalSeed = sha256(serverSeed ‖ entropy), where the entropy is a future
 *    mix of several block hashes fixed on chain after betting closed. Nobody, the operator
 *    included, can know the outcome while bets are open (residual trust: docs/usdg-tote.md).
 *
 * Stakes stay in the TotePools contract; the database only mirrors chain events for display.
 * The pool maths are tote.ts's (the contract implements the same rules on chain, including the
 * minimum pool and "winners never lose").
 *
 * Integer maths only, no clocks: callers pass time in.
 */
import { MS_PER_DAY, MS_PER_MINUTE } from "./time";
import { TOTE_TAKEOUT_PERMILLE, type TotePlayerLimits } from "./tote";

/** USDG base units per USDG (6 decimals). */
export const REAL_TOTE_UNIT = 1_000_000;

/** The field of a real-money race locks this long before the off (instead of at the usual time). */
export const REAL_TOTE_FIELD_LOCK_MS = 15 * MS_PER_MINUTE;

/** The on-chain market closes this long before the off; the entropy block is fixed in that gap. */
export const REAL_TOTE_ENTROPY_LEAD_MS = 1 * MS_PER_MINUTE;

/** Mirrors TotePools.CLOSE_MARGIN: bets are refused this long before the market close. */
export const REAL_TOTE_CLOSE_MARGIN_MS = 1 * MS_PER_MINUTE;

/** A BetPermit is valid this long (and never past the betting close). The contract caps it at 10 min. */
export const REAL_TOTE_PERMIT_TTL_MS = 2 * MS_PER_MINUTE;

/** Takeout in basis points: the same 15 % as the in-game tote. */
export const REAL_TOTE_TAKEOUT_BPS = TOTE_TAKEOUT_PERMILLE * 10;

/** Smallest bet: 1 USDG. */
export const REAL_TOTE_MIN_STAKE = 1 * REAL_TOTE_UNIT;
/** Largest single bet: 100 USDG (TotePools.maxStakePerBet). */
export const REAL_TOTE_MAX_STAKE_PER_BET = 100 * REAL_TOTE_UNIT;
/** Most one account may stake on one race: 250 USDG (TotePools.maxStakePerWalletPerRace). */
export const REAL_TOTE_MAX_STAKE_PER_RACE = 250 * REAL_TOTE_UNIT;
/** Most one account may stake per UTC day: 500 USDG. */
export const REAL_TOTE_MAX_STAKE_PER_DAY = 500 * REAL_TOTE_UNIT;
/** Largest pool per race and pool kind: 50,000 USDG (TotePools market maxPool). */
export const REAL_TOTE_MAX_POOL = 50_000 * REAL_TOTE_UNIT;

/** Stakes above this need a second, explicit confirmation in the bet slip (fat fingers). */
export const REAL_TOTE_CONFIRM_ABOVE = 25 * REAL_TOTE_UNIT;

export type RealToteGateMissing = "REAL_TOTE_ENABLED" | "WEB3_ENABLED" | "TOTE_POOLS_ADDRESS";

/**
 * The one switch. On only when REAL_TOTE_ENABLED=true, WEB3_ENABLED=true and TOTE_POOLS_ADDRESS
 * is set; with any of them missing every real-tote entry point refuses.
 */
export function realToteGate(env: Record<string, string | undefined>): { enabled: boolean; missing: RealToteGateMissing[] } {
  const missing: RealToteGateMissing[] = [];
  if (env.REAL_TOTE_ENABLED?.trim().toLowerCase() !== "true") missing.push("REAL_TOTE_ENABLED");
  if (env.WEB3_ENABLED?.trim().toLowerCase() !== "true") missing.push("WEB3_ENABLED");
  if (!env.TOTE_POOLS_ADDRESS?.trim()) missing.push("TOTE_POOLS_ADDRESS");
  return { enabled: missing.length === 0, missing };
}

/** When a real-money race's field locks: the usual time, or REAL_TOTE_FIELD_LOCK_MS before the off if that is earlier. */
export function realToteEntriesCloseMs(postTimeMs: number, entriesCloseMs: number): number {
  return Math.min(entriesCloseMs, postTimeMs - REAL_TOTE_FIELD_LOCK_MS);
}

/** The on-chain market's closeTime (ms): the entropy can be locked from here. */
export function realToteMarketCloseMs(postTimeMs: number): number {
  return postTimeMs - REAL_TOTE_ENTROPY_LEAD_MS;
}

/** The last moment a bet can land on chain (ms): the market close less the contract's margin. */
export function realToteBetsCloseMs(postTimeMs: number): number {
  return realToteMarketCloseMs(postTimeMs) - REAL_TOTE_CLOSE_MARGIN_MS;
}

/** A permit issued at `nowMs` expires at this time: a short TTL, never past the betting close. */
export function realTotePermitExpiryMs(nowMs: number, postTimeMs: number): number {
  return Math.min(nowMs + REAL_TOTE_PERMIT_TTL_MS, realToteBetsCloseMs(postTimeMs));
}

/**
 * A permit's on-chain `issuedAt` is backdated by this much (the chain's clock can lag ours). The
 * contract refuses a permit before `issuedAt` and more than 10 minutes after it.
 */
export const REAL_TOTE_PERMIT_CLOCK_SKEW_MS = 30_000;

/** A permit's on-chain validity window, unix seconds: [issuedAt, expiry]. */
export function realTotePermitWindowS(nowMs: number, postTimeMs: number): { issuedAt: number; expiry: number } {
  return { issuedAt: Math.floor((nowMs - REAL_TOTE_PERMIT_CLOCK_SKEW_MS) / 1000), expiry: Math.floor(realTotePermitExpiryMs(nowMs, postTimeMs) / 1000) };
}

/** An expired permit that no mirrored bet used is checked on chain (nonceUsed) after this grace, then stops counting. */
export const REAL_TOTE_PERMIT_LAPSE_GRACE_MS = 1 * MS_PER_MINUTE;

/** TotePools deployment: consecutive block hashes mixed into the entropy (ENTROPY_BLOCKS). */
export const REAL_TOTE_ENTROPY_BLOCKS = 3;

/** TotePools deployment: MAX_SETTLE_DELAY. After it an unsettled market expires to refunds (anyone can call it). */
export const REAL_TOTE_MAX_SETTLE_DELAY_MS = 1 * MS_PER_DAY;

/** A result public this long but still not posted on chain raises a "withheld result" alert. */
export const REAL_TOTE_RESULT_ALERT_MS = 30 * MS_PER_MINUTE;

/** The keeper retries a failing step with backoff and parks the market (with an alert) after this many failures in a row. */
export const REAL_TOTE_KEEPER_MAX_ATTEMPTS = 6;

/** Wait before the keeper retries a step that failed `attempts` times in a row: 30 s doubling, at most 30 min. */
export function realToteKeeperBackoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 30 * MS_PER_MINUTE);
}

/** The most this account may still stake (base units) on this race and today, with its own lower limits. */
export function realToteAllowance(input: { stakedOnRace: number; stakedToday: number; own?: TotePlayerLimits | null }): number {
  let race = REAL_TOTE_MAX_STAKE_PER_RACE;
  let day = REAL_TOTE_MAX_STAKE_PER_DAY;
  if (input.own?.perRace != null) race = Math.min(race, input.own.perRace);
  if (input.own?.perDay != null) day = Math.min(day, input.own.perDay);
  return Math.max(0, Math.min(REAL_TOTE_MAX_STAKE_PER_BET, race - input.stakedOnRace, day - input.stakedToday));
}

export type RealToteStakeProblem = "invalid" | "below_min" | "above_max" | "over_allowance" | "needs_confirmation";

/**
 * The bet slip's fat-finger guard: a whole positive amount, at least the minimum, at most the
 * per-bet maximum and what the player has left, and a second confirmation above
 * REAL_TOTE_CONFIRM_ABOVE. Null = fine to send.
 */
export function realToteStakeProblem(input: { stake: number; allowance: number; confirmed: boolean }): RealToteStakeProblem | null {
  if (!Number.isSafeInteger(input.stake) || input.stake <= 0) return "invalid";
  if (input.stake < REAL_TOTE_MIN_STAKE) return "below_min";
  if (input.stake > REAL_TOTE_MAX_STAKE_PER_BET) return "above_max";
  if (input.stake > input.allowance) return "over_allowance";
  if (input.stake > REAL_TOTE_CONFIRM_ABOVE && !input.confirmed) return "needs_confirmation";
  return null;
}

/**
 * Parses what a player typed ("12", "12.5", "0.75") into USDG base units. Strict on purpose:
 * no thousands separators, no exponent, at most 6 decimals, nothing above the per-bet maximum's
 * order of magnitude. Null = not a valid amount (the slip shows why instead of guessing).
 */
export function parseRealToteStake(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,7}(\.\d{1,6})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const units = Number(whole) * REAL_TOTE_UNIT + Number(frac.padEnd(6, "0"));
  return Number.isSafeInteger(units) ? units : null;
}

/** "12.50 USDG" (rounded down to cents). */
export function formatRealToteUsdg(units: number): string {
  const whole = Math.floor(units / REAL_TOTE_UNIT);
  const cents = Math.floor((units % REAL_TOTE_UNIT) / 10_000);
  return `${whole.toLocaleString("en-GB")}.${String(cents).padStart(2, "0")} USDG`;
}

/** Start of the UTC day containing `nowMs` (the daily limit's window). */
export function realToteDayStartMs(nowMs: number): number {
  return Math.floor(nowMs / MS_PER_DAY) * MS_PER_DAY;
}

/**
 * The tote: spectator pool betting on Live card races (owner decision 2026-10-31: "Live betting
 * using T-USDG & credits with live odds for spectators. We need it for economy sink and fun + it's
 * testing. Credits are not cashed out, it stays in game.").
 *
 * Pure parimutuel only. The game never sets odds, never bets and carries no liability: every
 * stake goes into a pool, the house take (`TOTE_TAKEOUT_PERMILLE`) comes off the top, and the
 * winners share what is left pro rata to their stakes. Odds are pool maths and nothing else.
 *
 * - Pools per race: WIN, and PLACE when the field has at least `TOTE_PLACE_MIN_FIELD` runners
 *   (`totePlaces`: top 3 from 8 runners, top 2 from 5 to 7). One set per currency: Stable
 *   Credits ("CR") and, only in practice mode, T-USDG ("TUSDG", test dollars; base units of
 *   1/1,000,000 like USDG).
 * - Settlement (`settleTotePool`): take = floor(pool x permille / 1000); the net pool is split
 *   into equal parts, one per paying place (1 for WIN, `places` for PLACE); each part goes to the
 *   backers of the runner in that place. Dead heats share the places they cover (two horses
 *   dead-heating for first in the WIN pool get half the net pool each). A part whose runner
 *   nobody backed goes to the other paying runners. If nobody backed any paying runner, the net
 *   pool goes back to every staker pro rata (no carryover). Every amount rounds down; the
 *   leftover units go to the house with the take, so payouts + take + remainder = pool exactly.
 * - Stakes on a non-runner (scratched, or never made the field) are refunded in full and are not
 *   part of the pool. An abandoned race refunds everything (no take).
 *
 * Integer maths only (BigInt inside the pool split), no clocks: callers pass time in.
 */
import { MS_PER_DAY, MS_PER_HOUR } from "./time";

export type ToteCurrency = "CR" | "TUSDG";
export const TOTE_CURRENCIES = ["CR", "TUSDG"] as const satisfies readonly ToteCurrency[];
export type TotePoolKind = "win" | "place";
export const TOTE_POOL_KINDS = ["win", "place"] as const satisfies readonly TotePoolKind[];

/** Race kinds with a tote: the Live card (scheduled, Feature, Final). Never Story, the Daily Cup, quick races or what-if. */
export const TOTE_RACE_KINDS = ["scheduled", "feature", "final"] as const;

/** T-USDG base units per T-USDG (6 decimals, like USDG). */
export const TOTE_USDG_UNIT = 1_000_000;

/**
 * The house take, permille of each pool (150 = 15 %). It goes to the `tote_house` ledger account
 * (never spendable by any player path), so for the credits economy it is a sink: those credits
 * leave circulation. Rounding remainders go there too.
 */
export const TOTE_TAKEOUT_PERMILLE = 150;

/** Smallest bet, base units: 10 credits; 0.5 T-USDG. */
export const TOTE_MIN_STAKE: Readonly<Record<ToteCurrency, number>> = { CR: 10, TUSDG: TOTE_USDG_UNIT / 2 };

/**
 * Most one account can stake on one race (all pools together), base units: 1,000 credits or
 * 10 % of the credits balance (`TOTE_MAX_STAKE_BALANCE_PERMILLE`), whichever is lower; 10 T-USDG.
 */
export const TOTE_MAX_STAKE_PER_RACE: Readonly<Record<ToteCurrency, number>> = { CR: 1_000, TUSDG: 10 * TOTE_USDG_UNIT };

/** Credits only: the per-race cap is also this share (permille) of balance + what is already on the race. */
export const TOTE_MAX_STAKE_BALANCE_PERMILLE = 100;

/** Most one account can stake per UTC day, base units: 5,000 credits; 50 T-USDG. */
export const TOTE_MAX_STAKE_PER_DAY: Readonly<Record<ToteCurrency, number>> = { CR: 5_000, TUSDG: 50 * TOTE_USDG_UNIT };

/** A place pool needs this many runners; below it there is no place pool. */
export const TOTE_PLACE_MIN_FIELD = 5;
/** From this many runners the place pool pays the first three (below it, the first two). */
export const TOTE_PLACE_THREE_FROM = 8;

/** Self-exclusion lengths a player can choose. None can be undone early. */
export const TOTE_SELF_EXCLUSION_MS = {
  "24h": 24 * MS_PER_HOUR,
  "7d": 7 * MS_PER_DAY,
  "30d": 30 * MS_PER_DAY,
  permanent: null,
} as const satisfies Record<string, number | null>;
export type ToteSelfExclusion = keyof typeof TOTE_SELF_EXCLUSION_MS;

/** A player's own limit takes effect at once when lowered; a raise (or removal) waits this long. */
export const TOTE_LIMIT_RAISE_DELAY_MS = 24 * MS_PER_HOUR;

/** How often the tote panel refreshes the pools before the off (ms). */
export const TOTE_ODDS_POLL_MS = 5_000;

/** Paying places in the PLACE pool for a field of `runners`: 3 from 8, 2 from 5 to 7, none below 5. */
export function totePlaces(runners: number): 0 | 2 | 3 {
  if (runners >= TOTE_PLACE_THREE_FROM) return 3;
  if (runners >= TOTE_PLACE_MIN_FIELD) return 2;
  return 0;
}

/** Paying places of a pool (WIN always 1). */
export function totePayingPlaces(kind: TotePoolKind, runners: number): number {
  return kind === "win" ? 1 : totePlaces(runners);
}

/** The house take on a pool total (rounded down). */
export function toteTakeout(total: number, permille: number = TOTE_TAKEOUT_PERMILLE): number {
  return Math.floor((total * permille) / 1000);
}

/** Is T-USDG betting switched on? Only when the practice-USDG mode is: never live, mock or off. */
export function toteUsdgEnabledFrom(env: { USDG_MODE?: string | undefined }): boolean {
  return env.USDG_MODE === "practice";
}

// ---------------------------------------------------------------------------
// Live odds
// ---------------------------------------------------------------------------

export interface ToteRunnerOdds {
  horseId: string;
  /** Stakes on this runner in this pool. */
  stake: number;
  /** Share of the pool's stakes, permille (the share bar). */
  sharePermille: number;
  /**
   * Decimal odds x 1000 (what 1 unit returns, stake included) if this runner wins (WIN) or
   * places (PLACE) at the current pool; null when nobody has backed it yet. PLACE assumes every
   * other paying place is backed too (it can only be higher otherwise).
   */
  oddsMilli: number | null;
}

export interface TotePoolView {
  kind: TotePoolKind;
  total: number;
  takeout: number;
  net: number;
  places: number;
  runners: ToteRunnerOdds[];
}

/**
 * Live odds from the pool alone: odds = (pool x (1 - take)) / (stake on the runner x places).
 * `stakes` maps runner -> total staked; `runnerIds` lists every runner (unbacked ones show null).
 */
export function totePoolView(kind: TotePoolKind, runnerIds: readonly string[], stakes: ReadonlyMap<string, number>, fieldSize: number, permille: number = TOTE_TAKEOUT_PERMILLE): TotePoolView {
  const places = totePayingPlaces(kind, fieldSize);
  let total = 0;
  for (const id of runnerIds) total += stakes.get(id) ?? 0;
  const takeout = toteTakeout(total, permille);
  const net = total - takeout;
  const runners = runnerIds.map((horseId) => {
    const stake = stakes.get(horseId) ?? 0;
    return {
      horseId,
      stake,
      sharePermille: total > 0 ? Math.floor((stake * 1000) / total) : 0,
      oddsMilli: stake > 0 && places > 0 ? Math.floor((net * 1000) / (stake * places)) : null,
    };
  });
  return { kind, total, takeout, net, places, runners };
}

/**
 * What a new bet would return at the current pool if its runner wins / places (stake included),
 * counting the bet itself in the pool. Changes until the off as other bets arrive.
 */
export function toteReturnIfPlaced(kind: TotePoolKind, stakes: ReadonlyMap<string, number>, horseId: string, stake: number, fieldSize: number, permille: number = TOTE_TAKEOUT_PERMILLE): number {
  const places = totePayingPlaces(kind, fieldSize);
  if (places === 0 || stake <= 0) return 0;
  let total = stake;
  for (const v of stakes.values()) total += v;
  const net = total - toteTakeout(total, permille);
  const onRunner = (stakes.get(horseId) ?? 0) + stake;
  return Math.floor((net * stake) / (onRunner * places));
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export interface ToteBetIn {
  id: string;
  horseId: string;
  stake: number;
}

export interface ToteFinisher {
  horseId: string;
  /** Finishing position (1 = winner). Equal positions are dead heats. */
  position: number;
}

export interface ToteDividend {
  horseId: string;
  position: number;
  /** Stakes on this runner. */
  stake: number;
  /** The part of the net pool this runner's backers share. */
  amount: number;
  /** Dividend per 1 unit staked x 1000 (stake included), rounded down. */
  perUnitMilli: number;
}

export interface ToteSettlement {
  kind: TotePoolKind;
  /** Paying places used (1 for WIN; 0 = no place pool: everything refunded). */
  places: number;
  /** The pool: stakes on runners (refunds excluded). */
  total: number;
  takeout: number;
  net: number;
  /** What each bet gets back (only bets with something to pay). */
  payouts: { betId: string; amount: number }[];
  /** Stakes returned in full and outside the pool: non-runners, or every bet of a void pool. */
  refunds: { betId: string; amount: number }[];
  /** Rounding leftovers (to the house with the take). total = sum(payouts) + takeout + remainder. */
  remainder: number;
  /**
   * paid: winners shared the net pool; no_winner: nobody backed a paying runner, so the net pool
   * went back to every staker pro rata; void: no pool (too few runners for PLACE); empty: no stakes.
   */
  outcome: "paid" | "no_winner" | "void" | "empty";
  dividends: ToteDividend[];
  /** Bets that shared in a winning dividend. */
  winningTickets: number;
}

/** lcm(1..24): every dead-heat share is a whole multiple of 1/L. */
const DEAD_HEAT_DENOM = 5_354_228_880n;

/**
 * Settles one pool exactly. `finishers` is the field that ran (every runner, with positions);
 * bets on any other horse are non-runners and refunded in full. Pure and deterministic: the
 * same bets and result always give the same numbers, whatever order the bets come in.
 */
export function settleTotePool(kind: TotePoolKind, bets: readonly ToteBetIn[], finishers: readonly ToteFinisher[], permille: number = TOTE_TAKEOUT_PERMILLE): ToteSettlement {
  for (const b of bets) if (!Number.isSafeInteger(b.stake) || b.stake <= 0) throw new Error(`bad stake on bet ${b.id}`);
  const ran = new Map(finishers.map((f) => [f.horseId, f.position]));
  const places = totePayingPlaces(kind, finishers.length);
  const sorted = [...bets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const refunds: ToteSettlement["refunds"] = [];
  const live: ToteBetIn[] = [];
  for (const b of sorted) {
    if (!ran.has(b.horseId) || places === 0) refunds.push({ betId: b.id, amount: b.stake });
    else live.push(b);
  }
  const base = { kind, places, refunds, payouts: [] as ToteSettlement["payouts"], dividends: [] as ToteDividend[], winningTickets: 0 };
  if (places === 0) return { ...base, total: 0, takeout: 0, net: 0, remainder: 0, outcome: refunds.length ? "void" : "empty" };
  const total = live.reduce((s, b) => s + b.stake, 0);
  if (total === 0) return { ...base, total: 0, takeout: 0, net: 0, remainder: 0, outcome: "empty" };
  const takeout = toteTakeout(total, permille);
  const net = total - takeout;

  const onRunner = new Map<string, number>();
  for (const b of live) onRunner.set(b.horseId, (onRunner.get(b.horseId) ?? 0) + b.stake);

  // Dead heats: k runners tied at position p cover places p..p+k-1; each takes the paying ones
  // among them (those <= places) divided by k, as a multiple of 1/L.
  const tie = new Map<number, number>();
  for (const p of ran.values()) tie.set(p, (tie.get(p) ?? 0) + 1);
  const weight = new Map<string, bigint>();
  for (const [horseId, p] of ran) {
    const k = tie.get(p)!;
    const covered = Math.max(0, Math.min(places, p + k - 1) - p + 1);
    if (covered > 0) weight.set(horseId, (BigInt(covered) * DEAD_HEAT_DENOM) / BigInt(k));
  }
  // Only backed paying runners share (an unbacked runner's part goes to the others).
  const paying = [...weight.entries()].filter(([id]) => (onRunner.get(id) ?? 0) > 0).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const W = paying.reduce((s, [, w]) => s + w, 0n);
  const payouts: ToteSettlement["payouts"] = [];
  const netB = BigInt(net);

  if (W === 0n) {
    // Nobody backed a paying runner: the net pool goes back to every staker pro rata.
    const totalB = BigInt(total);
    for (const b of live) {
      const amount = Number((netB * BigInt(b.stake)) / totalB);
      if (amount > 0) payouts.push({ betId: b.id, amount });
    }
    const paid = payouts.reduce((s, p) => s + p.amount, 0);
    return { ...base, payouts, total, takeout, net, remainder: net - paid, outcome: "no_winner" };
  }

  const dividends: ToteDividend[] = [];
  let winningTickets = 0;
  for (const [horseId, w] of paying) {
    const S = onRunner.get(horseId)!;
    const amount = Number((netB * w) / W);
    dividends.push({ horseId, position: ran.get(horseId)!, stake: S, amount, perUnitMilli: Math.floor((amount * 1000) / S) });
    for (const b of live) {
      if (b.horseId !== horseId) continue;
      winningTickets++;
      const a = Number((BigInt(amount) * BigInt(b.stake)) / BigInt(S));
      if (a > 0) payouts.push({ betId: b.id, amount: a });
    }
  }
  dividends.sort((a, b) => a.position - b.position || (a.horseId < b.horseId ? -1 : 1));
  const paid = payouts.reduce((s, p) => s + p.amount, 0);
  return { ...base, payouts, dividends, winningTickets, total, takeout, net, remainder: net - paid, outcome: "paid" };
}

/** Checks the conservation law of a settlement: every unit of the pool is paid out or kept by the house. */
export function toteSettlementBalanced(s: ToteSettlement): boolean {
  const paid = s.payouts.reduce((a, p) => a + p.amount, 0);
  return paid + s.takeout + s.remainder === s.total && s.remainder >= 0 && s.takeout >= 0;
}

// ---------------------------------------------------------------------------
// Limits and self-exclusion
// ---------------------------------------------------------------------------

/** A player's own (lower) limits, base units; null = the game's limit. */
export interface TotePlayerLimits {
  perRace: number | null;
  perDay: number | null;
}

/** The most this account may still stake on this race in this currency. */
export function toteRaceAllowance(input: { currency: ToteCurrency; balance: number; stakedOnRace: number; own?: TotePlayerLimits | null }): number {
  let cap = TOTE_MAX_STAKE_PER_RACE[input.currency];
  if (input.currency === "CR") cap = Math.min(cap, Math.floor(((input.balance + input.stakedOnRace) * TOTE_MAX_STAKE_BALANCE_PERMILLE) / 1000));
  if (input.own?.perRace != null) cap = Math.min(cap, input.own.perRace);
  return Math.max(0, cap - input.stakedOnRace);
}

/** The most this account may still stake today in this currency. */
export function toteDayAllowance(input: { currency: ToteCurrency; stakedToday: number; own?: TotePlayerLimits | null }): number {
  let cap = TOTE_MAX_STAKE_PER_DAY[input.currency];
  if (input.own?.perDay != null) cap = Math.min(cap, input.own.perDay);
  return Math.max(0, cap - input.stakedToday);
}

export type ToteStakeProblem = "below_min" | "race_limit" | "day_limit" | "balance";

/** Why a stake can't be placed (null = fine). */
export function toteStakeProblem(input: { currency: ToteCurrency; stake: number; balance: number; stakedOnRace: number; stakedToday: number; own?: TotePlayerLimits | null }): ToteStakeProblem | null {
  if (!Number.isSafeInteger(input.stake) || input.stake < TOTE_MIN_STAKE[input.currency]) return "below_min";
  if (input.stake > toteRaceAllowance(input)) return "race_limit";
  if (input.stake > toteDayAllowance(input)) return "day_limit";
  if (input.stake > input.balance) return "balance";
  return null;
}

/** When a self-exclusion chosen now ends (null = permanent). */
export function toteExclusionEnd(choice: ToteSelfExclusion, nowMs: number): number | null {
  const len = TOTE_SELF_EXCLUSION_MS[choice];
  return len === null ? null : nowMs + len;
}

/** Formats base units for people: "1,250 credits" / "2.50 T-USDG". */
export function formatToteAmount(currency: ToteCurrency, units: number): string {
  if (currency === "CR") return `${units.toLocaleString("en-GB")} credits`;
  const whole = Math.floor(units / TOTE_USDG_UNIT);
  const cents = Math.floor((units % TOTE_USDG_UNIT) / 10_000);
  return `${whole}.${String(cents).padStart(2, "0")} T-USDG`;
}

/** Decimal odds from milli ("3.40"), rounded down to 2 places. */
export function formatToteOdds(oddsMilli: number | null): string {
  if (oddsMilli === null) return "–";
  const hundredths = Math.floor(oddsMilli / 10);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

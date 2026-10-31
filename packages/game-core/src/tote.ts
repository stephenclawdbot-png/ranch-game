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
 * - Settlement (`settleTotePool`): take = floor(pool x permille / 1000). Every winning stake comes
 *   back first; the profit (net pool less the winning stakes) is split into equal parts, one per
 *   paying place (1 for WIN, `places` for PLACE); each part goes to the backers of the runner in
 *   that place. Dead heats share the places they cover. A part whose runner nobody backed goes to
 *   the other paying runners. If nobody backed any paying runner, the net pool goes back to every
 *   staker pro rata (no carryover). Every amount rounds down; the leftover units go to the house
 *   with the take, so payouts + take + remainder = pool exactly.
 * - Thin pools (owner decision 2026-10-31):
 *   - minimum pool: a pool needs at least `TOTE_MIN_POOL_BETTORS` distinct bettors backing at
 *     least `TOTE_MIN_POOL_RUNNERS` distinct runners (that ran); otherwise it is void and every
 *     stake is refunded in full, with no take;
 *   - winners never lose: a winning bet returns at least its stake. When the take would leave
 *     less than the winning stakes, the take is cut (down to zero) until it doesn't; the house
 *     never pays in. A zero take always covers them (the winning stakes are part of the pool);
 *     if it ever couldn't, the pool would be void.
 * - Stakes on a non-runner (scratched, or never made the field) are refunded in full and are not
 *   part of the pool. An abandoned race refunds everything (no take).
 *
 * Integer maths only (BigInt inside the pool split), no clocks: callers pass time in.
 */
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "./time";
import { isUsdgPracticeMode } from "./usdgMarket";

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

/** A pool needs at least this many distinct bettors (on runners that ran), or it is void and refunded. */
export const TOTE_MIN_POOL_BETTORS = 2;
/** ... backing at least this many distinct runners (that ran), or it is void and refunded. */
export const TOTE_MIN_POOL_RUNNERS = 2;

/** A place pool needs this many runners; below it there is no place pool. */
export const TOTE_PLACE_MIN_FIELD = 5;
/** From this many runners the place pool pays the first three (below it, the first two). */
export const TOTE_PLACE_THREE_FROM = 8;

/**
 * Breaks a player can choose. Time-outs (24 h, 7 d, 30 d) end by themselves. Self-exclusions
 * (6 months, 1 year, 5 years) last at least that long and then continue until the player asks
 * to end them, followed by TOTE_SELF_EXCLUSION_COOLING_OFF_MS; "permanent" never ends. None can
 * be shortened or lifted early.
 */
export const TOTE_SELF_EXCLUSION_MS = {
  "24h": 24 * MS_PER_HOUR,
  "7d": 7 * MS_PER_DAY,
  "30d": 30 * MS_PER_DAY,
  "6m": 182 * MS_PER_DAY,
  "1y": 365 * MS_PER_DAY,
  "5y": 1_826 * MS_PER_DAY,
  permanent: null,
} as const satisfies Record<string, number | null>;
export type ToteSelfExclusion = keyof typeof TOTE_SELF_EXCLUSION_MS;
export const TOTE_TIME_OUTS = ["24h", "7d", "30d"] as const satisfies readonly ToteSelfExclusion[];
export const TOTE_SELF_EXCLUSIONS = ["6m", "1y", "5y", "permanent"] as const satisfies readonly ToteSelfExclusion[];

/** A time-out ends by itself; a self-exclusion continues past its minimum until the player acts; permanent never ends. */
export function toteBreakKind(choice: ToteSelfExclusion): "time_out" | "self_exclusion" | "permanent" {
  if (choice === "permanent") return "permanent";
  return (TOTE_TIME_OUTS as readonly string[]).includes(choice) ? "time_out" : "self_exclusion";
}

/** After a player asks to end a self-exclusion (past its minimum), betting reopens this much later. */
export const TOTE_SELF_EXCLUSION_COOLING_OFF_MS = 1 * MS_PER_DAY;

/** A player's own limit takes effect at once when lowered; a raise (or removal) waits this long, then needs the player's confirmation. */
export const TOTE_LIMIT_RAISE_DELAY_MS = 24 * MS_PER_HOUR;

/** A reality check (time and net result this session) is due after this much betting activity. */
export const TOTE_REALITY_CHECK_MS = 60 * MS_PER_MINUTE;
/** A gap with no bets this long ends a betting session. */
export const TOTE_SESSION_GAP_MS = 30 * MS_PER_MINUTE;

/**
 * The current betting session's start: walking back from the latest bet, a session runs until a
 * gap of TOTE_SESSION_GAP_MS. Null when the last bet is that long ago (no session going on).
 */
export function toteSessionStart(betTimesMs: readonly number[], nowMs: number): number | null {
  const t = [...betTimesMs].sort((a, b) => b - a);
  if (!t.length || nowMs - t[0]! >= TOTE_SESSION_GAP_MS) return null;
  let start = t[0]!;
  for (let i = 1; i < t.length; i++) {
    if (start - t[i]! >= TOTE_SESSION_GAP_MS) break;
    start = t[i]!;
  }
  return start;
}

/** Is a reality check due: a session going on for TOTE_REALITY_CHECK_MS since it started or since the last acknowledged check? */
export function toteRealityCheckDue(sessionStartMs: number | null, lastAckMs: number | null, nowMs: number): boolean {
  if (sessionStartMs === null) return false;
  const from = lastAckMs !== null && lastAckMs > sessionStartMs ? lastAckMs : sessionStartMs;
  return nowMs - from >= TOTE_REALITY_CHECK_MS;
}

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
export function toteUsdgEnabledFrom(env: { readonly [key: string]: string | undefined }): boolean {
  return isUsdgPracticeMode(env);
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
   * places (PLACE) at the current pool; null when nobody has backed it yet. PLACE divides the net
   * pool by the paying places that can be backed (the places, or fewer when fewer runners are
   * backed): exact when the placed runners carry equal stakes. Never below 1.00: winners never
   * lose (the take is cut when it would make them).
   */
  oddsMilli: number | null;
  /**
   * PLACE only (null for WIN or an unbacked runner): what 1 unit returns if this runner places,
   * x 1000, from the least (the other places go to the most-backed runners) to the most (no other
   * backed runner places). A place dividend depends on which other runners place, so the panel
   * shows this range rather than one number.
   */
  oddsRangeMilli: [number, number] | null;
}

/** The place range for one runner at the current pool (see ToteRunnerOdds.oddsRangeMilli). */
export function totePlaceRangeMilli(stakes: ReadonlyMap<string, number>, horseId: string, places: number, permille: number = TOTE_TAKEOUT_PERMILLE): [number, number] | null {
  const S = stakes.get(horseId) ?? 0;
  if (S <= 0 || places <= 0) return null;
  let total = 0;
  const others: number[] = [];
  for (const [id, v] of stakes) {
    total += v;
    if (id !== horseId && v > 0) others.push(v);
  }
  const std = toteTakeout(total, permille);
  const milli = (amount: number) => Math.max(1000, Math.floor((amount * 1000) / S));
  // Most: the only backed runner to place takes the whole profit (the take is cut if it must be).
  const high = milli(Math.max(S, total - std));
  // Least: the other places go to the most-backed runners; their stakes come back first too.
  const top = others.sort((x, y) => y - x).slice(0, places - 1);
  const win = S + top.reduce((x, y) => x + y, 0);
  const take = Math.min(std, total - win);
  const profit = total - take - win;
  const low = milli(S + Math.floor(profit / (1 + top.length)));
  return [low, high];
}

export interface TotePoolView {
  kind: TotePoolKind;
  total: number;
  takeout: number;
  net: number;
  places: number;
  runners: ToteRunnerOdds[];
  /** Distinct players with a stake in this pool (null when the caller doesn't know). */
  bettors: number | null;
  /** Fewer than TOTE_MIN_POOL_BETTORS players or TOTE_MIN_POOL_RUNNERS runners backed so far: void (refunded) if it stays so. */
  thin: boolean;
}

/** Below the minimum pool (fewer than 2 players, or fewer than 2 runners backed): void at settlement. */
export function toteThinPool(bettors: number, backedRunners: number): boolean {
  return bettors < TOTE_MIN_POOL_BETTORS || backedRunners < TOTE_MIN_POOL_RUNNERS;
}

/** Parts the net pool is shown split into: 1 for WIN; for PLACE the paying places, or fewer when fewer runners are backed. */
function shownParts(kind: TotePoolKind, places: number, backed: number): number {
  return kind === "win" ? 1 : Math.max(1, Math.min(places, backed));
}

/**
 * Live odds from the pool alone: odds = (pool x (1 - take)) / (stake on the runner x parts), where
 * parts is 1 for WIN and the paying places for PLACE (fewer when fewer runners are backed).
 * `stakes` maps runner -> total staked; `runnerIds` lists every runner (unbacked ones show null).
 */
export function totePoolView(
  kind: TotePoolKind,
  runnerIds: readonly string[],
  stakes: ReadonlyMap<string, number>,
  fieldSize: number,
  permille: number = TOTE_TAKEOUT_PERMILLE,
  bettors: number | null = null,
): TotePoolView {
  const places = totePayingPlaces(kind, fieldSize);
  let total = 0;
  for (const id of runnerIds) total += stakes.get(id) ?? 0;
  const takeout = toteTakeout(total, permille);
  const net = total - takeout;
  const backed = runnerIds.filter((id) => (stakes.get(id) ?? 0) > 0).length;
  const parts = shownParts(kind, places, backed);
  const runners = runnerIds.map((horseId) => {
    const stake = stakes.get(horseId) ?? 0;
    return {
      horseId,
      stake,
      sharePermille: total > 0 ? Math.floor((stake * 1000) / total) : 0,
      oddsMilli: stake > 0 && places > 0 ? Math.max(1000, Math.floor((net * 1000) / (stake * parts))) : null,
      oddsRangeMilli: kind === "place" ? totePlaceRangeMilli(stakes, horseId, places, permille) : null,
    };
  });
  // Without a bettor count only the runner half of the rule can be shown.
  const thin = bettors === null ? backed < TOTE_MIN_POOL_RUNNERS : toteThinPool(bettors, backed);
  return { kind, total, takeout, net, places, runners, bettors, thin };
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
  let backed = 0;
  for (const [id, v] of stakes) if (v > 0 && id !== horseId) backed++;
  // Winners never lose: at least the stake back.
  return Math.max(stake, Math.floor((net * stake) / (onRunner * shownParts(kind, places, backed + 1))));
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export interface ToteBetIn {
  id: string;
  /** Who placed it (account id; a wallet on chain): the minimum pool counts distinct bettors. */
  bettor: string;
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
  /** What this runner's backers share: their stakes back plus their part of the profit. */
  amount: number;
  /** Dividend per 1 unit staked x 1000 (stake included), rounded down. Never below 1000. */
  perUnitMilli: number;
}

/**
 * Why a pool was void (every stake refunded in full, no take): no place pool for this field; a
 * thin pool (fewer than 2 bettors or 2 runners backed); or winners that even a zero take couldn't
 * pay back (impossible: kept as an assertion).
 */
export type ToteVoidReason = "no_place_pool" | "thin_pool" | "winners_short";

export interface ToteSettlement {
  kind: TotePoolKind;
  /** Paying places used (1 for WIN; 0 = no place pool: everything refunded). */
  places: number;
  /** The pool: stakes on runners (refunds excluded). */
  total: number;
  /** The take actually kept: the standard take, or less when it had to be cut so winners get their stakes back. */
  takeout: number;
  /** The standard take (floor(total x permille / 1000)); takeout < this when it was cut. */
  standardTakeout: number;
  net: number;
  /** What each bet gets back (only bets with something to pay). */
  payouts: { betId: string; amount: number }[];
  /** Stakes returned in full and outside the pool: non-runners, or every bet of a void pool. */
  refunds: { betId: string; amount: number }[];
  /** Rounding leftovers (to the house with the take). total = sum(payouts) + takeout + remainder. */
  remainder: number;
  /**
   * paid: winners shared the net pool; no_winner: nobody backed a paying runner, so the net pool
   * went back to every staker pro rata; void: every stake refunded (see voidReason); empty: no
   * stakes on runners that ran.
   */
  outcome: "paid" | "no_winner" | "void" | "empty";
  voidReason: ToteVoidReason | null;
  dividends: ToteDividend[];
  /** Bets that shared in a winning dividend. */
  winningTickets: number;
}

/** lcm(1..24): every dead-heat share is a whole multiple of 1/L. */
const DEAD_HEAT_DENOM = 5_354_228_880n;

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Settles one pool exactly. `finishers` is the field that ran (every runner, with positions);
 * bets on any other horse are non-runners and refunded in full. Pure and deterministic: the
 * same bets and result always give the same numbers, whatever order the bets come in.
 * TotePools.finalize implements the same rules on chain (packages/contracts, parity-tested).
 */
export function settleTotePool(kind: TotePoolKind, bets: readonly ToteBetIn[], finishers: readonly ToteFinisher[], permille: number = TOTE_TAKEOUT_PERMILLE): ToteSettlement {
  for (const b of bets) if (!Number.isSafeInteger(b.stake) || b.stake <= 0) throw new Error(`bad stake on bet ${b.id}`);
  const ran = new Map(finishers.map((f) => [f.horseId, f.position]));
  const places = totePayingPlaces(kind, finishers.length);
  const sorted = [...bets].sort(byId);
  const base = { kind, places, payouts: [] as ToteSettlement["payouts"], dividends: [] as ToteDividend[], winningTickets: 0 };
  const zero = { total: 0, takeout: 0, standardTakeout: 0, net: 0, remainder: 0 };
  /** Every stake back in full, no take. */
  const voidAll = (voidReason: ToteVoidReason): ToteSettlement => ({ ...base, ...zero, refunds: sorted.map((b) => ({ betId: b.id, amount: b.stake })), outcome: "void", voidReason });
  if (places === 0) return sorted.length ? voidAll("no_place_pool") : { ...base, ...zero, refunds: [], outcome: "empty", voidReason: null };
  const refunds: ToteSettlement["refunds"] = [];
  const live: ToteBetIn[] = [];
  for (const b of sorted) {
    if (!ran.has(b.horseId)) refunds.push({ betId: b.id, amount: b.stake });
    else live.push(b);
  }
  const total = live.reduce((s, b) => s + b.stake, 0);
  if (total === 0) return { ...base, ...zero, refunds, outcome: "empty", voidReason: null };
  // Minimum pool: 2 distinct bettors backing 2 distinct runners (that ran), or void.
  if (toteThinPool(new Set(live.map((b) => b.bettor)).size, new Set(live.map((b) => b.horseId)).size)) return voidAll("thin_pool");
  const standardTakeout = toteTakeout(total, permille);

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

  if (W === 0n) {
    // Nobody backed a paying runner (no winners): the net pool goes back to every staker pro rata.
    const net = total - standardTakeout;
    const netB = BigInt(net);
    const totalB = BigInt(total);
    for (const b of live) {
      const amount = Number((netB * BigInt(b.stake)) / totalB);
      if (amount > 0) payouts.push({ betId: b.id, amount });
    }
    const paid = payouts.reduce((s, p) => s + p.amount, 0);
    return { ...base, refunds, payouts, total, takeout: standardTakeout, standardTakeout, net, remainder: net - paid, outcome: "no_winner", voidReason: null };
  }

  // Winners never lose: their stakes come back first, so the take is at most what is left.
  const winningStakes = paying.reduce((s, [id]) => s + onRunner.get(id)!, 0);
  const takeout = Math.min(standardTakeout, total - winningStakes);
  const net = total - takeout;
  if (net < winningStakes) return voidAll("winners_short"); // can't happen: the winning stakes are part of the pool
  const profitB = BigInt(net - winningStakes);

  const dividends: ToteDividend[] = [];
  let winningTickets = 0;
  for (const [horseId, w] of paying) {
    const S = onRunner.get(horseId)!;
    const amount = S + Number((profitB * w) / W);
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
  return { ...base, refunds, payouts, dividends, winningTickets, total, takeout, standardTakeout, net, remainder: net - paid, outcome: "paid", voidReason: null };
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

/**
 * The tote: spectator pool betting on Live card races (game-core tote.ts holds the rules and the
 * pool maths; docs: apps/web wiki "The tote", docs/foundation/KNOBS.md §17).
 *
 * Fairness, provably: pure parimutuel. The game never sets odds, never bets (the Club doesn't
 * either) and carries no liability. Odds shown are pool maths only. Bets close at the off: every
 * bet takes the race row lock and is refused at or after the post time by the database clock
 * (`clock_timestamp()`), so the pools are frozen at the off and the result, fixed server-side when
 * the field locked, can never be bet on. Settlement waits until the result is public (the
 * broadcast is over: news.ts `raceResultPublicAt`), so payouts never spoil a race, and publishes
 * a per-pool audit row (`tote_pools`, CHECK total = paid + takeout + remainder).
 *
 * Money: a stake moves player -> escrow when placed; settlement moves escrow -> winners, and the
 * house take plus rounding remainders -> the `tote_house` system account, which no player path
 * ever spends (for the credits economy, a sink). Refunds (non-runners, abandoned races, voided
 * conflicts) go escrow -> player in full. One ledger transaction per pool, keyed, so settling
 * twice is a no-op.
 *
 * Integrity: no bets on a race where the bettor's stable, a linked account (same detection as
 * the market, with a fraud event) or a stable leasing to/from them has a runner; if such a horse
 * is entered after the bet, the bet is voided and refunded (races.ts enterRace calls
 * `voidConflictedToteBetsTx`). After settlement, a runner ridden "conservative" while accounts
 * linked to its connections bet against it raises a fraud event (a flag, no automatic action).
 *
 * Currencies: Stable Credits ("CR") always; T-USDG ("TUSDG", practice dollars) only while
 * `toteUsdgEnabled()` (USDG_MODE=practice). T-USDG balances live in the placeholder practice
 * ledger below (ledger accounts in currency TUSDG) until the practice-USDG mode wires its own.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import { gc } from "../gameCore";
import { fraudEvents, horses, raceEntries, races, stables, toteBets, totePools, toteSettings, type RaceRow, type ToteBetRow, type TotePoolRow, type ToteSettingsRow } from "../schema";
import type { Db, Executor, Tx } from "../types";
import { accountIdOfStable, areLinked } from "./accounts";
import { ensureSystemAccountId, getBalance, playerLedgerAccountId, post, type LedgerCurrency, type Posting } from "./ledger";
import { raceResultPublicAt } from "./news";
import { audit, rowsOf, runTx } from "./tx";

export type ToteCurrency = gc.ToteCurrency;
export type TotePoolKind = gc.TotePoolKind;

// ---------------------------------------------------------------------------
// Currencies and the practice ledger
// ---------------------------------------------------------------------------

/**
 * The one switch for T-USDG betting: on only when USDG_MODE=practice. Live, mock, off or unset
 * means T-USDG pools don't exist and every T-USDG bet is refused.
 */
export function toteUsdgEnabled(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): boolean {
  return gc.toteUsdgEnabledFrom(env);
}

/** Currencies open for betting right now. */
export function toteCurrencies(env?: Record<string, string | undefined>): ToteCurrency[] {
  return toteUsdgEnabled(env) ? ["CR", "TUSDG"] : ["CR"];
}

/** Where a tote currency's balances live: the player's account, the stakes' escrow and the house. */
export interface ToteLedger {
  playerAccount(ex: Executor, accountId: string): Promise<string>;
  balance(ex: Executor, accountId: string): Promise<number>;
  escrow(ex: Executor): Promise<string>;
  house(ex: Executor): Promise<string>;
}

function ledgerIn(currency: LedgerCurrency): ToteLedger {
  return {
    playerAccount: (ex, accountId) => playerLedgerAccountId(ex, accountId, currency),
    balance: (ex, accountId) => getBalance(ex, accountId, currency),
    escrow: (ex) => ensureSystemAccountId(ex, "escrow", currency),
    house: (ex) => ensureSystemAccountId(ex, "tote_house", currency),
  };
}

const creditsLedger = ledgerIn("CR");
/**
 * PLACEHOLDER practice ledger for T-USDG: ledger accounts in currency "TUSDG" (never mixed with
 * credits: every transaction is single-currency). The practice-USDG mode replaces it with
 * `setPracticeUsdgLedger` once it lands. Never real USDG, never a chain.
 */
let practiceLedger: ToteLedger = ledgerIn("TUSDG");

/** Wires the practice-USDG mode's own ledger in place of the placeholder. */
export function setPracticeUsdgLedger(l: ToteLedger): void {
  practiceLedger = l;
}

export function toteLedger(currency: ToteCurrency): ToteLedger {
  return currency === "CR" ? creditsLedger : practiceLedger;
}

/**
 * PLACEHOLDER practice faucet (tests, dev): mints T-USDG to a player on the placeholder ledger.
 * Refused unless practice mode is on. The practice-USDG mode brings the real one.
 */
export async function grantPracticeUsdg(db: Db, input: { accountId: string; amount: number; idempotencyKey: string; env?: Record<string, string | undefined> }): Promise<void> {
  if (!toteUsdgEnabled(input.env)) throw new DomainError("TOTE_UNAVAILABLE", "T-USDG exists only in practice mode");
  await runTx(db, async (tx) => {
    await post(tx, {
      idempotencyKey: input.idempotencyKey,
      kind: "practice_usdg_grant",
      postings: [
        { ledgerAccountId: await ensureSystemAccountId(tx, "mint", "TUSDG"), amount: -input.amount },
        { ledgerAccountId: await playerLedgerAccountId(tx, input.accountId, "TUSDG"), amount: input.amount },
      ],
    });
  });
}

// ---------------------------------------------------------------------------
// Runners and conflicts of interest
// ---------------------------------------------------------------------------

export function isToteRace(race: Pick<RaceRow, "kind">): boolean {
  return (gc.TOTE_RACE_KINDS as readonly string[]).includes(race.kind);
}

export interface ToteRunner {
  horseId: string;
  name: string;
  gate: number | null;
  /** The stable that entered it (the lessee while on lease); null for the Club. */
  stableId: string | null;
  /** The horse's owner now (differs from stableId on lease). */
  ownerStableId: string | null;
  stableName: string | null;
  isHouse: boolean;
  finishPosition: number | null;
  intensity: string | null;
}

async function runnersOf(ex: Executor, raceId: string): Promise<ToteRunner[]> {
  const rows = await ex
    .select({ e: raceEntries, ownerStableId: horses.ownerStableId, horseName: horses.name, stableName: stables.name })
    .from(raceEntries)
    .innerJoin(horses, eq(horses.id, raceEntries.horseId))
    .leftJoin(stables, eq(stables.id, raceEntries.stableId))
    .where(and(eq(raceEntries.raceId, raceId), eq(raceEntries.status, "entered")))
    .orderBy(asc(raceEntries.gate), asc(raceEntries.enteredAt), asc(raceEntries.id));
  return rows.map(({ e, ownerStableId, horseName, stableName }) => {
    const snap = (e.snapshot ?? {}) as { name?: unknown; plan?: { intensity?: unknown } };
    return {
      horseId: e.horseId,
      name: typeof snap.name === "string" ? snap.name : horseName,
      gate: e.gate,
      stableId: e.stableId,
      ownerStableId,
      stableName: e.isHouse ? null : stableName,
      isHouse: e.isHouse,
      finishPosition: e.finishPosition,
      intensity: typeof snap.plan?.intensity === "string" ? snap.plan.intensity : null,
    };
  });
}

/** Expected field size for place terms: the locked field, else entries topped up to the target (the Club fills at the lock). */
function fieldSizeOf(race: Pick<RaceRow, "field" | "status" | "maxRunners" | "targetRunners">, runners: number): number {
  if (race.field || race.status !== "open") return runners;
  return Math.max(runners, Math.min(race.maxRunners, race.targetRunners));
}

/** The bettor's stable plus every stable leasing a horse to or from it right now. */
async function interestedStables(ex: Executor, stableId: string | null): Promise<Set<string>> {
  const out = new Set<string>();
  if (!stableId) return out;
  out.add(stableId);
  const leased = await ex
    .select({ owner: horses.ownerStableId, lessee: horses.lesseeStableId })
    .from(horses)
    .where(and(isNotNull(horses.lesseeStableId), sql`(${horses.ownerStableId} = ${stableId} or ${horses.lesseeStableId} = ${stableId})`));
  for (const l of leased) {
    if (l.owner) out.add(l.owner);
    if (l.lessee) out.add(l.lessee);
  }
  return out;
}

export type ToteConflict = { kind: "own" | "lease" | "linked"; horseId: string; relatedAccountId: string | null };

/** Why this bettor may not bet on a race with these runners (null = no conflict). */
async function conflictOf(ex: Executor, bettor: { accountId: string; stableId: string | null }, runners: readonly Pick<ToteRunner, "horseId" | "stableId" | "ownerStableId">[]): Promise<ToteConflict | null> {
  const mine = await interestedStables(ex, bettor.stableId);
  const accountOf = new Map<string, string>();
  for (const r of runners) {
    for (const sid of [r.stableId, r.ownerStableId]) {
      if (!sid) continue;
      if (sid === bettor.stableId) return { kind: "own", horseId: r.horseId, relatedAccountId: null };
      if (mine.has(sid)) return { kind: "lease", horseId: r.horseId, relatedAccountId: await accountIdOfStable(ex, sid) };
    }
  }
  for (const r of runners) {
    for (const sid of [r.stableId, r.ownerStableId]) {
      if (!sid) continue;
      let acc = accountOf.get(sid);
      if (!acc) accountOf.set(sid, (acc = await accountIdOfStable(ex, sid)));
      if (acc !== bettor.accountId && (await areLinked(ex, bettor.accountId, acc))) return { kind: "linked", horseId: r.horseId, relatedAccountId: acc };
    }
  }
  return null;
}

const CONFLICT_MESSAGE: Record<ToteConflict["kind"], string> = {
  own: "you have a runner in this race, so you can't bet on it",
  lease: "a stable you lease with has a runner in this race, so you can't bet on it",
  linked: "an account linked to yours has a runner in this race, so you can't bet on it",
};

async function stableIdOf(ex: Executor, accountId: string): Promise<string | null> {
  const [s] = await ex.select({ id: stables.id }).from(stables).where(eq(stables.accountId, accountId));
  return s?.id ?? null;
}

// ---------------------------------------------------------------------------
// Settings: 18+, own limits, self-exclusion
// ---------------------------------------------------------------------------

type LimitsJson = Partial<Record<ToteCurrency, gc.TotePlayerLimits>>;

const NO_LIMITS: gc.TotePlayerLimits = { perRace: null, perDay: null };

function limitsOf(json: unknown): LimitsJson {
  const out: LimitsJson = {};
  const src = (json ?? {}) as Record<string, { perRace?: unknown; perDay?: unknown }>;
  for (const c of gc.TOTE_CURRENCIES) {
    const v = src[c];
    if (!v) continue;
    out[c] = { perRace: typeof v.perRace === "number" ? v.perRace : null, perDay: typeof v.perDay === "number" ? v.perDay : null };
  }
  return out;
}

/** The player's own limits in force at `now` (a pending raise counts once its delay has passed). */
export function effectiveToteLimits(row: Pick<ToteSettingsRow, "limits" | "pendingLimits" | "pendingAt"> | null | undefined, now: Date): LimitsJson {
  if (!row) return {};
  const base = limitsOf(row.limits);
  if (row.pendingLimits && row.pendingAt && row.pendingAt <= now) return { ...base, ...limitsOf(row.pendingLimits) };
  return base;
}

export function toteExcluded(row: Pick<ToteSettingsRow, "excludedUntil" | "excludedPermanent"> | null | undefined, now: Date): boolean {
  return !!row && (row.excludedPermanent || (!!row.excludedUntil && row.excludedUntil > now));
}

async function settingsRow(ex: Executor, accountId: string): Promise<ToteSettingsRow | null> {
  const [r] = await ex.select().from(toteSettings).where(eq(toteSettings.accountId, accountId));
  return r ?? null;
}

async function lockSettings(tx: Tx, accountId: string, now: Date): Promise<ToteSettingsRow> {
  await tx.insert(toteSettings).values({ accountId, updatedAt: now }).onConflictDoNothing();
  const [r] = await tx.select().from(toteSettings).where(eq(toteSettings.accountId, accountId)).for("update");
  return r!;
}

export interface ToteSettingsView {
  adultConfirmed: boolean;
  /** Own limits in force, base units (null = the game's limit). */
  limits: Record<ToteCurrency, gc.TotePlayerLimits>;
  /** A raise waiting for its delay, and when it applies. */
  pending: LimitsJson | null;
  pendingAtMs: number | null;
  excludedUntilMs: number | null;
  excludedPermanent: boolean;
  excluded: boolean;
  currencies: ToteCurrency[];
  game: { min: Record<ToteCurrency, number>; perRace: Record<ToteCurrency, number>; perDay: Record<ToteCurrency, number>; balancePermille: number; takeoutPermille: number };
}

export async function toteSettingsView(ex: Executor, accountId: string, now: Date, env?: Record<string, string | undefined>): Promise<ToteSettingsView> {
  const row = await settingsRow(ex, accountId);
  const eff = effectiveToteLimits(row, now);
  const pendingLive = row?.pendingLimits && row.pendingAt && row.pendingAt > now;
  return {
    adultConfirmed: !!row?.adultConfirmedAt,
    limits: { CR: eff.CR ?? NO_LIMITS, TUSDG: eff.TUSDG ?? NO_LIMITS },
    pending: pendingLive ? limitsOf(row!.pendingLimits) : null,
    pendingAtMs: pendingLive ? row!.pendingAt!.getTime() : null,
    excludedUntilMs: row?.excludedUntil && row.excludedUntil > now ? row.excludedUntil.getTime() : null,
    excludedPermanent: !!row?.excludedPermanent,
    excluded: toteExcluded(row, now),
    currencies: toteCurrencies(env),
    game: {
      min: { ...gc.TOTE_MIN_STAKE },
      perRace: { ...gc.TOTE_MAX_STAKE_PER_RACE },
      perDay: { ...gc.TOTE_MAX_STAKE_PER_DAY },
      balancePermille: gc.TOTE_MAX_STAKE_BALANCE_PERMILLE,
      takeoutPermille: gc.TOTE_TAKEOUT_PERMILLE,
    },
  };
}

/** The 18+ confirmation, stored once. */
export async function confirmToteAdult(db: Db, input: { accountId: string; now: Date }): Promise<void> {
  await runTx(db, async (tx) => {
    const row = await lockSettings(tx, input.accountId, input.now);
    if (row.adultConfirmedAt) return;
    await tx.update(toteSettings).set({ adultConfirmedAt: input.now, updatedAt: input.now }).where(eq(toteSettings.accountId, input.accountId));
    await audit(tx, { actor: input.accountId, action: "tote.adult_confirmed", entityType: "account", entityId: input.accountId });
  });
}

function validLimit(currency: ToteCurrency, v: number | null): number | null {
  if (v === null) return null;
  if (!Number.isSafeInteger(v) || v < gc.TOTE_MIN_STAKE[currency]) throw new DomainError("INVALID_INPUT", `a limit must be at least ${gc.formatToteAmount(currency, gc.TOTE_MIN_STAKE[currency])}`);
  return v;
}

const lowerOrEqual = (next: number | null, cur: number | null) => next !== null && (cur === null || next <= cur);

/**
 * Sets the player's own limits for one currency. Lowering is immediate; a raise or a removal
 * waits TOTE_LIMIT_RAISE_DELAY_MS (until then the lower limit stays in force).
 */
export async function setToteLimits(db: Db, input: { accountId: string; currency: ToteCurrency; perRace: number | null; perDay: number | null; now: Date }): Promise<ToteSettingsView> {
  if (!gc.TOTE_CURRENCIES.includes(input.currency)) throw new DomainError("INVALID_INPUT", "unknown currency");
  const perRace = validLimit(input.currency, input.perRace);
  const perDay = validLimit(input.currency, input.perDay);
  await runTx(db, async (tx) => {
    const row = await lockSettings(tx, input.accountId, input.now);
    const eff = effectiveToteLimits(row, input.now);
    const cur = eff[input.currency] ?? NO_LIMITS;
    // Pending raises that have matured become the base; unmatured ones for other currencies stay pending.
    const matured = row.pendingAt && row.pendingAt <= input.now;
    const pending: LimitsJson = matured ? {} : limitsOf(row.pendingLimits);
    const immediate: gc.TotePlayerLimits = {
      perRace: lowerOrEqual(perRace, cur.perRace) ? perRace : cur.perRace,
      perDay: lowerOrEqual(perDay, cur.perDay) ? perDay : cur.perDay,
    };
    const target: gc.TotePlayerLimits = { perRace, perDay };
    const raise = target.perRace !== immediate.perRace || target.perDay !== immediate.perDay;
    if (raise) pending[input.currency] = target;
    else delete pending[input.currency];
    const hasPending = Object.keys(pending).length > 0;
    await tx
      .update(toteSettings)
      .set({
        limits: { ...eff, [input.currency]: immediate },
        pendingLimits: hasPending ? pending : null,
        pendingAt: hasPending ? (raise ? new Date(input.now.getTime() + gc.TOTE_LIMIT_RAISE_DELAY_MS) : row.pendingAt) : null,
        updatedAt: input.now,
      })
      .where(eq(toteSettings.accountId, input.accountId));
    await audit(tx, { actor: input.accountId, action: "tote.limits", entityType: "account", entityId: input.accountId, data: { currency: input.currency, perRace, perDay, raise } });
  });
  return toteSettingsView(db, input.accountId, input.now);
}

/** Self-exclusion: can be lengthened, never shortened or lifted early; "permanent" never ends. */
export async function selfExcludeTote(db: Db, input: { accountId: string; choice: gc.ToteSelfExclusion; now: Date }): Promise<ToteSettingsView> {
  if (!(input.choice in gc.TOTE_SELF_EXCLUSION_MS)) throw new DomainError("INVALID_INPUT", "unknown exclusion length");
  await runTx(db, async (tx) => {
    const row = await lockSettings(tx, input.accountId, input.now);
    const end = gc.toteExclusionEnd(input.choice, input.now.getTime());
    const permanent = row.excludedPermanent || end === null;
    const until = end === null ? row.excludedUntil : new Date(Math.max(end, row.excludedUntil?.getTime() ?? 0));
    await tx.update(toteSettings).set({ excludedPermanent: permanent, excludedUntil: until, updatedAt: input.now }).where(eq(toteSettings.accountId, input.accountId));
    await audit(tx, { actor: input.accountId, action: "tote.self_exclude", entityType: "account", entityId: input.accountId, data: { choice: input.choice } });
  });
  return toteSettingsView(db, input.accountId, input.now);
}

// ---------------------------------------------------------------------------
// Placing a bet
// ---------------------------------------------------------------------------

export interface PlaceToteBetInput {
  accountId: string;
  raceId: string;
  horseId: string;
  pool: TotePoolKind;
  currency: ToteCurrency;
  stake: number;
  /** One per bet slip submission (a retry or double tap returns the same bet). */
  clientKey: string;
  now: Date;
  env?: Record<string, string | undefined>;
}

export interface ToteOptions {
  /**
   * Check the off against the database clock as well as `now` (default true; the later of the
   * two counts). Tests running on a fixed fake clock turn it off; production never does.
   */
  dbClock?: boolean;
}

async function dbClockNow(ex: Executor): Promise<Date> {
  const [r] = rowsOf<{ t: string | Date }>(await ex.execute(sql`select clock_timestamp() as t`));
  return new Date(r!.t);
}

const DAY_MS = 86_400_000;

async function stakedSum(ex: Executor, where: ReturnType<typeof and>): Promise<number> {
  const [r] = await ex.select({ s: sql<string>`coalesce(sum(${toteBets.stake}), 0)` }).from(toteBets).where(where);
  return Number(r?.s ?? 0);
}

export interface ToteBettorChecked {
  settings: ToteSettingsRow;
  runners: ToteRunner[];
  fieldSize: number;
  stableId: string | null;
}

/**
 * The bettor checks every tote bet runs, in this order: 18+ confirmed, not self-excluded, the
 * horse is running, a place pool exists for the field, and no conflict of interest (own runner,
 * a lease partner's, or a linked account's: the last also records a fraud event and comes back
 * as a DomainError for the caller to return so the event commits). Shared by the in-game tote and
 * the dormant real-USDG permits (realTote.ts). Caller holds the race row lock.
 */
export async function toteBettorChecksTx(
  tx: Tx,
  input: { accountId: string; race: RaceRow; horseId: string; pool: TotePoolKind; now: Date; fraudData: Record<string, unknown> },
): Promise<ToteBettorChecked | DomainError> {
  const { race } = input;
  const settings = await lockSettings(tx, input.accountId, input.now);
  if (!settings.adultConfirmedAt) throw new DomainError("TOTE_AGE_CONFIRM", "confirm you are 18 or over before your first bet");
  if (toteExcluded(settings, input.now)) throw new DomainError("TOTE_EXCLUDED", "you have taken a break from betting");

  const runners = await runnersOf(tx, race.id);
  if (!runners.some((r) => r.horseId === input.horseId)) throw new DomainError("NOT_FOUND", "that horse isn't running in this race");
  const fieldSize = fieldSizeOf(race, runners.length);
  if (input.pool === "place" && gc.totePlaces(fieldSize) === 0) throw new DomainError("TOTE_UNAVAILABLE", `no place pool with fewer than ${gc.TOTE_PLACE_MIN_FIELD} runners`);

  const stableId = await stableIdOf(tx, input.accountId);
  const conflict = await conflictOf(tx, { accountId: input.accountId, stableId }, runners);
  if (conflict) {
    if (conflict.kind === "linked") {
      await tx.insert(fraudEvents).values({
        accountId: input.accountId,
        relatedAccountId: conflict.relatedAccountId,
        kind: "tote_linked_bet_blocked",
        severity: 2,
        data: { raceId: race.id, horseId: conflict.horseId, betOn: input.horseId, ...input.fraudData },
      });
      return new DomainError("LINKED_ACCOUNTS", CONFLICT_MESSAGE.linked);
    }
    throw new DomainError("TOTE_CONFLICT", CONFLICT_MESSAGE[conflict.kind]);
  }
  return { settings, runners, fieldSize, stableId };
}

/**
 * Places one bet. Takes the race row lock, refuses at or after the off (database clock), checks
 * the bettor (18+, not self-excluded, no conflict of interest, limits, balance) and moves the
 * stake into escrow. Idempotent per (account, clientKey).
 */
export async function placeToteBet(db: Db, input: PlaceToteBetInput, opts: ToteOptions = {}): Promise<ToteBetRow> {
  if (input.pool !== "win" && input.pool !== "place") throw new DomainError("INVALID_INPUT", "pool must be win or place");
  if (!gc.TOTE_CURRENCIES.includes(input.currency)) throw new DomainError("INVALID_INPUT", "unknown currency");
  if (!input.clientKey || input.clientKey.length > 80) throw new DomainError("INVALID_INPUT", "bad bet slip key");
  // The hard lock: T-USDG betting is impossible unless practice mode is on.
  if (input.currency === "TUSDG" && !toteUsdgEnabled(input.env)) throw new DomainError("TOTE_UNAVAILABLE", "T-USDG betting is only open in practice mode");
  if (!Number.isSafeInteger(input.stake) || input.stake <= 0) throw new DomainError("INVALID_INPUT", "stake must be a whole positive amount");

  const out = await runTx(db, async (tx): Promise<ToteBetRow | DomainError> => {
    const [dup] = await tx.select().from(toteBets).where(and(eq(toteBets.accountId, input.accountId), eq(toteBets.clientKey, input.clientKey)));
    if (dup) return dup;
    const [race] = await tx.select().from(races).where(eq(races.id, input.raceId)).for("update");
    if (!race) throw new DomainError("NOT_FOUND", "race not found");
    if (!isToteRace(race)) throw new DomainError("TOTE_UNAVAILABLE", "the tote runs on Live card races only");
    if (race.status === "cancelled") throw new DomainError("RACE_CLOSED", "this race was called off");
    const clock = opts.dbClock === false ? input.now : new Date(Math.max(input.now.getTime(), (await dbClockNow(tx)).getTime()));
    if (race.status === "settled" || clock >= race.postTime) throw new DomainError("RACE_CLOSED", "betting closed at the off");

    const checked = await toteBettorChecksTx(tx, { accountId: input.accountId, race, horseId: input.horseId, pool: input.pool, now: input.now, fraudData: { stake: input.stake, currency: input.currency } });
    if (checked instanceof DomainError) return checked;
    const { settings, stableId } = checked;

    const ledger = toteLedger(input.currency);
    const balance = await ledger.balance(tx, input.accountId);
    const own = effectiveToteLimits(settings, input.now)[input.currency] ?? null;
    const dayStart = new Date(Math.floor(clock.getTime() / DAY_MS) * DAY_MS);
    const live = and(eq(toteBets.accountId, input.accountId), eq(toteBets.currency, input.currency), ne(toteBets.status, "void"));
    const stakedOnRace = await stakedSum(tx, and(live, eq(toteBets.raceId, race.id)));
    const stakedToday = await stakedSum(tx, and(live, gte(toteBets.placedAt, dayStart)));
    const problem = gc.toteStakeProblem({ currency: input.currency, stake: input.stake, balance, stakedOnRace, stakedToday, own });
    const fmt = (n: number) => gc.formatToteAmount(input.currency, n);
    if (problem === "below_min") throw new DomainError("TOTE_LIMIT", `the smallest bet is ${fmt(gc.TOTE_MIN_STAKE[input.currency])}`);
    if (problem === "race_limit") throw new DomainError("TOTE_LIMIT", `that's over the limit for one race: ${fmt(gc.toteRaceAllowance({ currency: input.currency, balance, stakedOnRace, own }))} left`);
    if (problem === "day_limit") throw new DomainError("TOTE_LIMIT", `that's over the daily limit: ${fmt(gc.toteDayAllowance({ currency: input.currency, stakedToday, own }))} left today`);
    if (problem === "balance") throw new DomainError("INSUFFICIENT_FUNDS", input.currency === "CR" ? "not enough credits" : "not enough T-USDG");

    const betId = randomUUID();
    await post(tx, {
      idempotencyKey: `tote-stake:${betId}`,
      kind: "tote_stake",
      meta: { raceId: race.id, pool: input.pool },
      postings: [
        { ledgerAccountId: await ledger.playerAccount(tx, input.accountId), amount: -input.stake },
        { ledgerAccountId: await ledger.escrow(tx), amount: input.stake },
      ],
    });
    const [bet] = await tx
      .insert(toteBets)
      .values({ id: betId, raceId: race.id, accountId: input.accountId, stableId, horseId: input.horseId, pool: input.pool, currency: input.currency, stake: input.stake, clientKey: input.clientKey, placedAt: clock })
      .returning();
    await audit(tx, { actor: input.accountId, action: "tote.bet", entityType: "race", entityId: race.id, data: { betId, horseId: input.horseId, pool: input.pool, currency: input.currency, stake: input.stake } });
    return bet!;
  });
  if (out instanceof DomainError) throw out;
  return out;
}

// ---------------------------------------------------------------------------
// Refunds (inside other services' transactions, race row already locked)
// ---------------------------------------------------------------------------

async function refundBetsTx(tx: Tx, bets: readonly ToteBetRow[], key: (b: ToteBetRow) => string, reason: string, now: Date): Promise<void> {
  for (const b of [...bets].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const ledger = toteLedger(b.currency as ToteCurrency);
    await post(tx, {
      idempotencyKey: key(b),
      kind: "tote_refund",
      meta: { raceId: b.raceId, betId: b.id, reason },
      postings: [
        { ledgerAccountId: await ledger.escrow(tx), amount: -b.stake },
        { ledgerAccountId: await ledger.playerAccount(tx, b.accountId), amount: b.stake },
      ],
    });
    await tx.update(toteBets).set({ status: "void", payout: b.stake, voidReason: reason, settledAt: now }).where(and(eq(toteBets.id, b.id), eq(toteBets.status, "open")));
  }
}

async function openBets(tx: Tx, raceId: string, extra?: ReturnType<typeof eq>): Promise<ToteBetRow[]> {
  return tx
    .select()
    .from(toteBets)
    .where(and(eq(toteBets.raceId, raceId), eq(toteBets.status, "open"), extra))
    .orderBy(asc(toteBets.id))
    .for("update");
}

/** A horse came out (scratched, or scratched at the lock): its stakes are refunded in full. */
export async function voidToteBetsOnHorseTx(tx: Tx, raceId: string, horseId: string, reason: string, now: Date): Promise<number> {
  const bets = await openBets(tx, raceId, eq(toteBets.horseId, horseId));
  await refundBetsTx(tx, bets, (b) => `tote-void:${b.id}`, reason, now);
  return bets.length;
}

/** The race was abandoned or called off: every stake back in full, no take. */
export async function refundToteRaceTx(tx: Tx, raceId: string, reason: string, now: Date): Promise<number> {
  const bets = await openBets(tx, raceId);
  if (!bets.length) return 0;
  await refundBetsTx(tx, bets, (b) => `tote-void:${b.id}`, reason, now);
  const groups = new Map<string, ToteBetRow[]>();
  for (const b of bets) groups.set(`${b.pool}|${b.currency}`, [...(groups.get(`${b.pool}|${b.currency}`) ?? []), b]);
  for (const [k, list] of groups) {
    const [pool, currency] = k.split("|") as [TotePoolKind, ToteCurrency];
    await tx
      .insert(totePools)
      .values({
        raceId,
        pool,
        currency,
        outcome: "abandoned",
        places: 0,
        takeoutPermille: gc.TOTE_TAKEOUT_PERMILLE,
        total: 0,
        takeout: 0,
        paid: 0,
        remainder: 0,
        refunded: list.reduce((s, b) => s + b.stake, 0),
        tickets: list.length,
        winningTickets: 0,
        bettors: new Set(list.map((b) => b.accountId)).size,
        dividends: [],
        settledAt: now,
      })
      .onConflictDoNothing();
  }
  return bets.length;
}

/**
 * A horse was just entered (races.ts enterRace, race row locked): any open bet on this race by a
 * bettor with an interest in that runner (their own stable, a lease partner, a linked account) is
 * voided and refunded. A linked bettor raises a fraud event.
 */
export async function voidConflictedToteBetsTx(tx: Tx, input: { raceId: string; horseId: string; stableId: string | null; ownerStableId: string | null; now: Date }): Promise<number> {
  const [any] = await tx.select({ id: toteBets.id }).from(toteBets).where(and(eq(toteBets.raceId, input.raceId), eq(toteBets.status, "open"))).limit(1);
  if (!any) return 0;
  const bets = await openBets(tx, input.raceId);
  const byBettor = new Map<string, ToteBetRow[]>();
  for (const b of bets) byBettor.set(b.accountId, [...(byBettor.get(b.accountId) ?? []), b]);
  let voided = 0;
  for (const [accountId, list] of [...byBettor.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const conflict = await conflictOf(tx, { accountId, stableId: list[0]!.stableId ?? (await stableIdOf(tx, accountId)) }, [{ horseId: input.horseId, stableId: input.stableId, ownerStableId: input.ownerStableId }]);
    if (!conflict) continue;
    if (conflict.kind === "linked") {
      await tx.insert(fraudEvents).values({ accountId, relatedAccountId: conflict.relatedAccountId, kind: "tote_linked_bet_voided", severity: 2, data: { raceId: input.raceId, horseId: input.horseId, bets: list.map((b) => b.id) } });
    }
    await refundBetsTx(tx, list, (b) => `tote-void:${b.id}`, `void: ${conflict.kind === "own" ? "you entered a runner" : conflict.kind === "lease" ? "a stable you lease with entered a runner" : "a linked account entered a runner"}`, input.now);
    voided += list.length;
  }
  return voided;
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export interface ToteDividendRow extends gc.ToteDividend {
  name: string;
}

export interface ToteSettleResult {
  settled: boolean;
  reason?: "not_tote" | "nothing_open" | "not_run" | "not_public";
}

/**
 * Settles every open bet on a race, once its result is public (or refunds them if it was
 * abandoned). Idempotent: one ledger transaction and one `tote_pools` row per pool, keyed.
 */
export async function settleTote(db: Db, raceId: string, now: Date): Promise<ToteSettleResult> {
  const [race] = await db.select().from(races).where(eq(races.id, raceId));
  if (!race || !isToteRace(race)) return { settled: false, reason: "not_tote" };
  const [open] = await db.select({ id: toteBets.id }).from(toteBets).where(and(eq(toteBets.raceId, raceId), eq(toteBets.status, "open"))).limit(1);
  if (!open) return { settled: false, reason: "nothing_open" };
  if (race.status === "cancelled") {
    await runTx(db, async (tx) => {
      await tx.select({ id: races.id }).from(races).where(eq(races.id, raceId)).for("update");
      await refundToteRaceTx(tx, raceId, "void: the race was abandoned", now);
    });
    return { settled: true };
  }
  if (race.status !== "settled") return { settled: false, reason: "not_run" };
  // Never before the result is public: payouts would spoil the broadcast.
  const publicAt = await raceResultPublicAt(db, raceId);
  if (!publicAt || now < publicAt) return { settled: false, reason: "not_public" };

  await runTx(db, async (tx) => {
    await tx.select({ id: races.id }).from(races).where(eq(races.id, raceId)).for("update");
    const bets = await openBets(tx, raceId);
    if (!bets.length) return;
    const runners = await runnersOf(tx, raceId);
    const finishers = runners.filter((r) => r.finishPosition !== null).map((r) => ({ horseId: r.horseId, position: r.finishPosition! }));
    const names = new Map(runners.map((r) => [r.horseId, r.name]));
    for (const currency of gc.TOTE_CURRENCIES) {
      for (const pool of gc.TOTE_POOL_KINDS) {
        const list = bets.filter((b) => b.currency === currency && b.pool === pool);
        if (list.length) await settlePoolTx(tx, { raceId, pool, currency, bets: list, finishers, names, now });
      }
    }
    await flagConservativeRidesTx(tx, raceId, runners);
    await audit(tx, { actor: null, action: "tote.settle", entityType: "race", entityId: raceId, data: { bets: bets.length } });
  });
  return { settled: true };
}

async function settlePoolTx(
  tx: Tx,
  input: { raceId: string; pool: TotePoolKind; currency: ToteCurrency; bets: ToteBetRow[]; finishers: gc.ToteFinisher[]; names: ReadonlyMap<string, string>; now: Date },
): Promise<void> {
  const { raceId, pool, currency, bets, now } = input;
  const s = gc.settleTotePool(pool, bets.map((b) => ({ id: b.id, bettor: b.accountId, horseId: b.horseId, stake: b.stake })), input.finishers);
  if (!gc.toteSettlementBalanced(s)) throw new Error(`tote pool ${raceId}/${pool}/${currency} does not balance`);
  const ledger = toteLedger(currency);
  const byId = new Map(bets.map((b) => [b.id, b]));
  const pay = new Map<string, number>(); // bet -> amount
  for (const p of s.payouts) pay.set(p.betId, p.amount);
  const refund = new Map<string, number>();
  for (const r of s.refunds) refund.set(r.betId, r.amount);
  const toAccount = new Map<string, number>();
  for (const [betId, amount] of [...pay, ...refund]) {
    const acc = byId.get(betId)!.accountId;
    toAccount.set(acc, (toAccount.get(acc) ?? 0) + amount);
  }
  const refunded = s.refunds.reduce((a, r) => a + r.amount, 0);
  const paid = s.payouts.reduce((a, p) => a + p.amount, 0);
  const house = s.takeout + s.remainder;
  const postings: Posting[] = [{ ledgerAccountId: await ledger.escrow(tx), amount: -(s.total + refunded) }];
  if (house > 0) postings.push({ ledgerAccountId: await ledger.house(tx), amount: house });
  for (const [acc, amount] of [...toAccount].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (amount > 0) postings.push({ ledgerAccountId: await ledger.playerAccount(tx, acc), amount });
  }
  let ledgerTransactionId: string | null = null;
  if (s.total + refunded > 0) {
    ledgerTransactionId = (await post(tx, { idempotencyKey: `tote-settle:${raceId}:${pool}:${currency}`, kind: "tote_settlement", meta: { raceId, pool, outcome: s.outcome }, postings })).transactionId;
  }
  const winners = new Set(s.dividends.map((d) => d.horseId));
  const voidWhy =
    s.voidReason === "no_place_pool"
      ? `void: no place pool with fewer than ${gc.TOTE_PLACE_MIN_FIELD} runners`
      : s.voidReason === "thin_pool"
        ? `void: fewer than ${gc.TOTE_MIN_POOL_BETTORS} players backing ${gc.TOTE_MIN_POOL_RUNNERS} runners`
        : s.voidReason === "winners_short"
          ? "void: the pool couldn't return the winners' stakes"
          : "void: non-runner";
  for (const b of bets) {
    const r = refund.get(b.id);
    const status = r !== undefined ? "void" : s.outcome === "no_winner" ? "returned" : winners.has(b.horseId) ? "won" : "lost";
    await tx
      .update(toteBets)
      .set({ status, payout: r ?? pay.get(b.id) ?? 0, voidReason: r !== undefined ? voidWhy : null, settledAt: now })
      .where(and(eq(toteBets.id, b.id), eq(toteBets.status, "open")));
  }
  const dividends: ToteDividendRow[] = s.dividends.map((d) => ({ ...d, name: input.names.get(d.horseId) ?? "Runner" }));
  await tx
    .insert(totePools)
    .values({
      raceId,
      pool,
      currency,
      outcome: s.outcome,
      places: s.places,
      takeoutPermille: gc.TOTE_TAKEOUT_PERMILLE,
      total: s.total,
      takeout: s.takeout,
      paid,
      remainder: s.remainder,
      refunded,
      tickets: bets.length,
      winningTickets: s.winningTickets,
      bettors: new Set(bets.map((b) => b.accountId)).size,
      dividends,
      ledgerTransactionId,
      settledAt: now,
    })
    .onConflictDoNothing();
}

/**
 * Best-effort integrity flag: a runner ridden "conservative" while accounts linked to its
 * connections (keeper or owner) bet on other runners. Raises a fraud event per (runner, bettor);
 * no automatic action.
 */
async function flagConservativeRidesTx(tx: Tx, raceId: string, runners: readonly ToteRunner[]): Promise<void> {
  const soft = runners.filter((r) => !r.isHouse && r.intensity === "conservative");
  if (!soft.length) return;
  const bets = await tx.select({ accountId: toteBets.accountId, horseId: toteBets.horseId }).from(toteBets).where(eq(toteBets.raceId, raceId));
  for (const r of soft) {
    const connections = new Set<string>();
    for (const sid of [r.stableId, r.ownerStableId]) if (sid) connections.add(await accountIdOfStable(tx, sid));
    const against = [...new Set(bets.filter((b) => b.horseId !== r.horseId).map((b) => b.accountId))].filter((a) => !connections.has(a)).sort();
    for (const bettor of against) {
      for (const conn of connections) {
        if (await areLinked(tx, conn, bettor)) {
          await tx.insert(fraudEvents).values({ accountId: conn, relatedAccountId: bettor, kind: "tote_conservative_ride_linked_bettor", severity: 2, data: { raceId, horseId: r.horseId } });
          break;
        }
      }
    }
  }
}

/** Backstop (driveCard / cron): settles open bets on races that are abandoned or whose result is public. */
export async function settleDueTote(db: Db, now: Date, limit = 20): Promise<string[]> {
  const due = rowsOf<{ race_id: string }>(
    await db.execute(sql`
      select distinct b.race_id from tote_bets b join races r on r.id = b.race_id
       where b.status = 'open' and r.status in ('settled', 'cancelled') limit ${limit}`),
  );
  const done: string[] = [];
  for (const { race_id } of due) {
    if ((await settleTote(db, race_id, now)).settled) done.push(race_id);
  }
  return done;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface ToteBoardRunner {
  horseId: string;
  name: string;
  gate: number | null;
  stableName: string | null;
  isHouse: boolean;
}

export interface ToteAuditRow {
  pool: TotePoolKind;
  currency: ToteCurrency;
  outcome: string;
  places: number;
  takeoutPermille: number;
  total: number;
  takeout: number;
  paid: number;
  remainder: number;
  refunded: number;
  tickets: number;
  winningTickets: number;
  bettors: number;
  dividends: ToteDividendRow[];
  /** Why a void pool was refunded: too few runners for a place pool, or a thin pool (under 2 players or 2 runners backed). */
  voidReason: "no_place_pool" | "thin_pool" | null;
  /** The take was cut below takeoutPermille so every winner got at least the stake back. */
  takeoutReduced: boolean;
  /** paid + takeout + remainder = total (always true; shown to players). */
  balanced: boolean;
}

export interface ToteBoard {
  raceId: string;
  /** open: taking bets; closed: the off has passed (pools frozen); settled: paid out (result public); abandoned: refunded. */
  status: "open" | "closed" | "settled" | "abandoned";
  postTimeMs: number;
  fieldLocked: boolean;
  fieldSize: number;
  places: number;
  takeoutPermille: number;
  currencies: ToteCurrency[];
  runners: ToteBoardRunner[];
  pools: { currency: ToteCurrency; win: gc.TotePoolView; place: gc.TotePoolView | null }[];
  audit: ToteAuditRow[];
}

/** Stakes on the race that count in the pools (everything but void bets), by currency, pool and runner. */
async function poolStakes(ex: Executor, raceId: string): Promise<Map<string, Map<string, number>>> {
  const rows = await ex
    .select({ currency: toteBets.currency, pool: toteBets.pool, horseId: toteBets.horseId, s: sql<string>`sum(${toteBets.stake})` })
    .from(toteBets)
    .where(and(eq(toteBets.raceId, raceId), ne(toteBets.status, "void")))
    .groupBy(toteBets.currency, toteBets.pool, toteBets.horseId);
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const k = `${r.currency}|${r.pool}`;
    if (!out.has(k)) out.set(k, new Map());
    out.get(k)!.set(r.horseId, Number(r.s));
  }
  return out;
}

/** Distinct players with a stake (on runners still in the race) per currency and pool: the minimum pool's count. */
async function poolBettors(ex: Executor, raceId: string): Promise<Map<string, number>> {
  const rows = await ex
    .select({ currency: toteBets.currency, pool: toteBets.pool, n: sql<number>`count(distinct ${toteBets.accountId})::int` })
    .from(toteBets)
    .where(and(eq(toteBets.raceId, raceId), ne(toteBets.status, "void")))
    .groupBy(toteBets.currency, toteBets.pool);
  return new Map(rows.map((r) => [`${r.currency}|${r.pool}`, Number(r.n)]));
}

function auditRow(p: TotePoolRow): ToteAuditRow {
  return {
    pool: p.pool,
    currency: p.currency as ToteCurrency,
    outcome: p.outcome,
    places: p.places,
    takeoutPermille: p.takeoutPermille,
    total: p.total,
    takeout: p.takeout,
    paid: p.paid,
    remainder: p.remainder,
    refunded: p.refunded,
    tickets: p.tickets,
    winningTickets: p.winningTickets,
    bettors: p.bettors,
    dividends: (p.dividends ?? []) as ToteDividendRow[],
    voidReason: p.outcome !== "void" ? null : p.places === 0 ? "no_place_pool" : "thin_pool",
    takeoutReduced: p.outcome === "paid" && p.takeout < gc.toteTakeout(p.total, p.takeoutPermille),
    balanced: p.paid + p.takeout + p.remainder === p.total,
  };
}

/**
 * The public tote board for a race: runners, live (or final) odds per currency and pool, and
 * after settlement the audit. Contains nothing about the result until it is public (settlement
 * only runs then). Null for races without a tote.
 */
export async function toteBoard(ex: Executor, raceId: string, now: Date, env?: Record<string, string | undefined>): Promise<ToteBoard | null> {
  const [race] = await ex.select().from(races).where(eq(races.id, raceId));
  if (!race || !isToteRace(race)) return null;
  const runners = await runnersOf(ex, raceId);
  const fieldSize = fieldSizeOf(race, runners.length);
  const stakes = await poolStakes(ex, raceId);
  const bettors = await poolBettors(ex, raceId);
  const settledPools = await ex.select().from(totePools).where(eq(totePools.raceId, raceId));
  const currencies = toteCurrencies(env);
  // T-USDG pools that exist from before practice mode was switched off still settle and show.
  for (const k of stakes.keys()) {
    const c = k.split("|")[0] as ToteCurrency;
    if (!currencies.includes(c)) currencies.push(c);
  }
  const ids = runners.map((r) => r.horseId);
  const pools = currencies.map((currency) => ({
    currency,
    win: gc.totePoolView("win", ids, stakes.get(`${currency}|win`) ?? new Map(), fieldSize, gc.TOTE_TAKEOUT_PERMILLE, bettors.get(`${currency}|win`) ?? 0),
    place:
      gc.totePlaces(fieldSize) > 0 ? gc.totePoolView("place", ids, stakes.get(`${currency}|place`) ?? new Map(), fieldSize, gc.TOTE_TAKEOUT_PERMILLE, bettors.get(`${currency}|place`) ?? 0) : null,
  }));
  const status: ToteBoard["status"] =
    race.status === "cancelled" ? "abandoned" : settledPools.length && race.status === "settled" ? "settled" : now >= race.postTime || race.status === "settled" ? "closed" : "open";
  return {
    raceId,
    status,
    postTimeMs: race.postTime.getTime(),
    fieldLocked: !!race.field,
    fieldSize,
    places: gc.totePlaces(fieldSize),
    takeoutPermille: gc.TOTE_TAKEOUT_PERMILLE,
    currencies,
    runners: runners.map((r) => ({ horseId: r.horseId, name: r.name, gate: r.gate, stableName: r.stableName, isHouse: r.isHouse })),
    pools,
    audit: settledPools.map(auditRow).sort((a, b) => (a.currency + a.pool < b.currency + b.pool ? -1 : 1)),
  };
}

export interface MyToteBet {
  id: string;
  raceId: string;
  horseId: string;
  horseName: string;
  pool: TotePoolKind;
  currency: ToteCurrency;
  stake: number;
  status: ToteBetRow["status"];
  payout: number;
  /** Open bets: what it returns at the current pool if it wins / places (changes until the off). */
  potentialReturn: number | null;
  voidReason: string | null;
  placedAtMs: number;
  raceName?: string;
  postTimeMs?: number;
}

export interface MyToteRace {
  bets: MyToteBet[];
  /** Can this player bet on this race now? */
  canBet: { ok: true } | { ok: false; reason: "closed" | "conflict" | "excluded" | "age" | "unavailable"; message: string };
  adultConfirmed: boolean;
  /** Per currency: what may still be staked on this race and today, the balance and the minimum. */
  allowance: { currency: ToteCurrency; race: number; day: number; balance: number; min: number }[];
}

function potentialReturnOf(b: Pick<ToteBetRow, "status" | "currency" | "pool" | "horseId" | "stake">, stakes: Map<string, Map<string, number>>, ids: readonly string[], fieldSize: number): number | null {
  if (b.status !== "open") return null;
  const view = gc.totePoolView(b.pool, ids, stakes.get(`${b.currency}|${b.pool}`) ?? new Map(), fieldSize);
  const odds = view.runners.find((r) => r.horseId === b.horseId)?.oddsMilli ?? null;
  return odds === null ? null : Math.floor((b.stake * odds) / 1000);
}

/** The signed-in player's side of a race's tote: their bets, whether they may bet, and their allowances. */
export async function myToteRace(ex: Executor, accountId: string, raceId: string, now: Date, env?: Record<string, string | undefined>): Promise<MyToteRace | null> {
  const [race] = await ex.select().from(races).where(eq(races.id, raceId));
  if (!race || !isToteRace(race)) return null;
  const runners = await runnersOf(ex, raceId);
  const fieldSize = fieldSizeOf(race, runners.length);
  const ids = runners.map((r) => r.horseId);
  const names = new Map(runners.map((r) => [r.horseId, r.name]));
  const stakes = await poolStakes(ex, raceId);
  const rows = await ex.select().from(toteBets).where(and(eq(toteBets.raceId, raceId), eq(toteBets.accountId, accountId))).orderBy(desc(toteBets.placedAt));
  const missing = rows.filter((b) => !names.has(b.horseId)).map((b) => b.horseId);
  if (missing.length) for (const h of await ex.select({ id: horses.id, name: horses.name }).from(horses).where(inArray(horses.id, missing))) names.set(h.id, h.name);
  const bets: MyToteBet[] = rows.map((b) => ({
    id: b.id,
    raceId: b.raceId,
    horseId: b.horseId,
    horseName: names.get(b.horseId) ?? "Runner",
    pool: b.pool,
    currency: b.currency as ToteCurrency,
    stake: b.stake,
    status: b.status,
    payout: b.payout,
    potentialReturn: potentialReturnOf(b, stakes, ids, fieldSize),
    voidReason: b.voidReason,
    placedAtMs: b.placedAt.getTime(),
  }));
  const settings = await settingsRow(ex, accountId);
  const currencies = toteCurrencies(env);
  const dayStart = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  const own = effectiveToteLimits(settings, now);
  const allowance = [];
  for (const currency of currencies) {
    const balance = await toteLedger(currency).balance(ex, accountId);
    const live = and(eq(toteBets.accountId, accountId), eq(toteBets.currency, currency), ne(toteBets.status, "void"));
    const stakedOnRace = await stakedSum(ex, and(live, eq(toteBets.raceId, raceId)));
    const stakedToday = await stakedSum(ex, and(live, gte(toteBets.placedAt, dayStart)));
    allowance.push({
      currency,
      race: gc.toteRaceAllowance({ currency, balance, stakedOnRace, own: own[currency] ?? null }),
      day: gc.toteDayAllowance({ currency, stakedToday, own: own[currency] ?? null }),
      balance,
      min: gc.TOTE_MIN_STAKE[currency],
    });
  }
  let canBet: MyToteRace["canBet"] = { ok: true };
  if (race.status === "cancelled" || race.status === "settled" || now >= race.postTime) canBet = { ok: false, reason: "closed", message: "Betting closed at the off." };
  else if (toteExcluded(settings, now)) canBet = { ok: false, reason: "excluded", message: "You've taken a break from betting." };
  else {
    const conflict = await conflictOf(ex, { accountId, stableId: await stableIdOf(ex, accountId) }, runners);
    if (conflict) canBet = { ok: false, reason: "conflict", message: CONFLICT_MESSAGE[conflict.kind].replace(/^./, (c) => c.toUpperCase()) + "." };
    else if (!settings?.adultConfirmedAt) canBet = { ok: false, reason: "age", message: "Confirm you are 18 or over to bet." };
  }
  return { bets, canBet, adultConfirmed: !!settings?.adultConfirmedAt, allowance };
}

export interface MyToteHistory {
  bets: MyToteBet[];
  /** Per currency, settled bets only (void excluded): staked, returned, net. Open = still running. */
  summary: { currency: ToteCurrency; staked: number; returned: number; net: number; open: number; bets: number; won: number }[];
}

/** The player's betting history, newest first, with P&L per currency. */
export async function myToteBets(ex: Executor, accountId: string, input: { now: Date; limit?: number }): Promise<MyToteHistory> {
  const rows = await ex
    .select({ b: toteBets, raceName: races.name, postTime: races.postTime, horseName: horses.name })
    .from(toteBets)
    .innerJoin(races, eq(races.id, toteBets.raceId))
    .innerJoin(horses, eq(horses.id, toteBets.horseId))
    .where(eq(toteBets.accountId, accountId))
    .orderBy(desc(toteBets.placedAt), desc(toteBets.id))
    .limit(Math.max(1, Math.min(200, input.limit ?? 100)));
  // Live potential returns for open bets, one pool read per race.
  const openRaces = [...new Set(rows.filter((r) => r.b.status === "open").map((r) => r.b.raceId))];
  const ctx = new Map<string, { stakes: Map<string, Map<string, number>>; ids: string[]; fieldSize: number }>();
  for (const raceId of openRaces) {
    const [race] = await ex.select().from(races).where(eq(races.id, raceId));
    const runners = await runnersOf(ex, raceId);
    ctx.set(raceId, { stakes: await poolStakes(ex, raceId), ids: runners.map((r) => r.horseId), fieldSize: race ? fieldSizeOf(race, runners.length) : runners.length });
  }
  const bets: MyToteBet[] = rows.map(({ b, raceName, postTime, horseName }) => {
    const c = ctx.get(b.raceId);
    return {
      id: b.id,
      raceId: b.raceId,
      horseId: b.horseId,
      horseName,
      pool: b.pool,
      currency: b.currency as ToteCurrency,
      stake: b.stake,
      status: b.status,
      payout: b.payout,
      potentialReturn: c ? potentialReturnOf(b, c.stakes, c.ids, c.fieldSize) : null,
      voidReason: b.voidReason,
      placedAtMs: b.placedAt.getTime(),
      raceName,
      postTimeMs: postTime.getTime(),
    };
  });
  const sums = rowsOf<{ currency: string; staked: string; returned: string; open: string; bets: number; won: number }>(
    await ex.execute(sql`
      select currency,
             coalesce(sum(stake) filter (where status in ('won', 'lost', 'returned')), 0) as staked,
             coalesce(sum(payout) filter (where status in ('won', 'lost', 'returned')), 0) as returned,
             coalesce(sum(stake) filter (where status = 'open'), 0) as open,
             count(*) filter (where status <> 'void')::int as bets,
             count(*) filter (where status = 'won')::int as won
        from tote_bets where account_id = ${accountId} group by currency order by currency`),
  );
  return {
    bets,
    summary: sums.map((s) => ({
      currency: s.currency as ToteCurrency,
      staked: Number(s.staked),
      returned: Number(s.returned),
      net: Number(s.returned) - Number(s.staked),
      open: Number(s.open),
      bets: Number(s.bets),
      won: Number(s.won),
    })),
  };
}

// ---------------------------------------------------------------------------
// Admin and economy health
// ---------------------------------------------------------------------------

export interface ToteAdminStats {
  /** Per currency: the house take and pool volume today (UTC) and over the last 7 days, bettors and races. */
  byCurrency: { currency: ToteCurrency; takeToday: number; takeWeek: number; volumeToday: number; volumeWeek: number; bettorsWeek: number; racesWeek: number; houseBalance: number }[];
  /** The last 7 UTC days, per currency. */
  days: { day: string; currency: ToteCurrency; take: number; volume: number; bettors: number; races: number }[];
  /** The biggest pools settled in the last 30 days. */
  biggest: { raceId: string; raceName: string; pool: TotePoolKind; currency: ToteCurrency; total: number; takeout: number; bettors: number; settledAtMs: number }[];
}

export async function toteAdminStats(ex: Executor, now: Date): Promise<ToteAdminStats> {
  const today = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  const week = new Date(today.getTime() - 6 * DAY_MS);
  const days = rowsOf<{ day: string; currency: string; take: string; volume: string; races: number }>(
    await ex.execute(sql`
      select to_char(date_trunc('day', settled_at at time zone 'UTC'), 'YYYY-MM-DD') as day, currency,
             coalesce(sum(takeout + remainder), 0) as take, coalesce(sum(total), 0) as volume, count(distinct race_id)::int as races
        from tote_pools where settled_at >= ${week} group by 1, 2 order by 1 desc, 2`),
  );
  const bettors = rowsOf<{ day: string; currency: string; n: number }>(
    await ex.execute(sql`
      select to_char(date_trunc('day', placed_at at time zone 'UTC'), 'YYYY-MM-DD') as day, currency, count(distinct account_id)::int as n
        from tote_bets where placed_at >= ${week} group by 1, 2`),
  );
  const weekBettors = rowsOf<{ currency: string; n: number }>(
    await ex.execute(sql`select currency, count(distinct account_id)::int as n from tote_bets where placed_at >= ${week} group by 1`),
  );
  const todayKey = today.toISOString().slice(0, 10);
  const dayRows = days.map((d) => ({
    day: d.day,
    currency: d.currency as ToteCurrency,
    take: Number(d.take),
    volume: Number(d.volume),
    races: Number(d.races),
    bettors: Number(bettors.find((b) => b.day === d.day && b.currency === d.currency)?.n ?? 0),
  }));
  const byCurrency = [];
  for (const currency of gc.TOTE_CURRENCIES) {
    const mine = dayRows.filter((d) => d.currency === currency);
    const [house] = rowsOf<{ b: string }>(await ex.execute(sql`select coalesce(sum(balance), 0) as b from ledger_accounts where kind = 'tote_house' and currency = ${currency}`));
    byCurrency.push({
      currency,
      takeToday: mine.filter((d) => d.day === todayKey).reduce((s, d) => s + d.take, 0),
      takeWeek: mine.reduce((s, d) => s + d.take, 0),
      volumeToday: mine.filter((d) => d.day === todayKey).reduce((s, d) => s + d.volume, 0),
      volumeWeek: mine.reduce((s, d) => s + d.volume, 0),
      bettorsWeek: Number(weekBettors.find((b) => b.currency === currency)?.n ?? 0),
      racesWeek: mine.reduce((s, d) => s + d.races, 0),
      houseBalance: Number(house?.b ?? 0),
    });
  }
  const big = await ex
    .select({ p: totePools, raceName: races.name })
    .from(totePools)
    .innerJoin(races, eq(races.id, totePools.raceId))
    .where(gte(totePools.settledAt, new Date(today.getTime() - 29 * DAY_MS)))
    .orderBy(desc(totePools.total))
    .limit(5);
  return {
    byCurrency,
    days: dayRows,
    biggest: big.map(({ p, raceName }) => ({ raceId: p.raceId, raceName, pool: p.pool, currency: p.currency as ToteCurrency, total: p.total, takeout: p.takeout + p.remainder, bettors: p.bettors, settledAtMs: p.settledAt.getTime() })),
  };
}

/** Credits tote figures for the economy health card: house take (a sink), pool volume, bettors. */
export async function toteCreditsHealth(ex: Executor, from: Date): Promise<{ houseTake: number; volume: number; bettors: number; races: number }> {
  const [p] = rowsOf<{ take: string; volume: string; races: number }>(
    await ex.execute(sql`select coalesce(sum(takeout + remainder), 0) as take, coalesce(sum(total), 0) as volume, count(distinct race_id)::int as races from tote_pools where currency = 'CR' and settled_at >= ${from}`),
  );
  const [b] = rowsOf<{ n: number }>(await ex.execute(sql`select count(distinct account_id)::int as n from tote_bets where currency = 'CR' and placed_at >= ${from}`));
  return { houseTake: Number(p?.take ?? 0), volume: Number(p?.volume ?? 0), bettors: Number(b?.n ?? 0), races: Number(p?.races ?? 0) };
}

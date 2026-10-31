/**
 * The REAL-USDG tote: a DORMANT scaffold (docs/usdg-tote.md). Every entry point refuses unless
 * REAL_TOTE_ENABLED=true, WEB3_ENABLED=true and TOTE_POOLS_ADDRESS is set (game-core
 * `realToteGate`), and switching it on needs legal approval first.
 *
 * Non-custodial: stakes go from the player's wallet straight into the TotePools contract and come
 * back only through the contract's claims. The database never holds or moves real money: it
 * records the race-level flag (`real_tote_races`), the BetPermits the server signed after the
 * usual tote checks (`real_tote_permits`, which also count toward the player's limits) and a
 * mirror of the contract's events for display (`real_tote_events`).
 *
 * What a flag on a race changes, and nothing else:
 *  - the field locks REAL_TOTE_FIELD_LOCK_MS before the off (bettors see the final field) and
 *    the market opens then;
 *  - betting closes before the off (gc.realToteBetsCloseMs);
 *  - the race runs on sha256(serverSeed ‖ entropy) (`resolveRealToteSeed`), the entropy being a
 *    mix of block hashes fixed on chain after betting closed. The choice of seed is persisted at the first
 *    simulation, so every server instance simulates the same race; if the entropy wasn't there
 *    in time the race runs on its server seed as usual and the market is cancelled (refunds;
 *    by the guardian once the entropy blocks were picked).
 *
 * The keeper's work list (`realToteDueWork`) is ordered by when each step fell due, retries with
 * backoff and parks a market that keeps failing (with an alert), so one stuck market never holds
 * up the others. Alerts go to the audit log as `real_tote.alert.<kind>`.
 */
import { randomBytes } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { commitSeed, mixSeedEntropy } from "../crypto";
import { DomainError } from "../errors";
import { gc } from "../gameCore";
import { accounts, fraudEvents, raceEntries, races, realToteEvents, realTotePermits, realToteRaces, type RaceRow, type RealToteRaceRow, type ToteSettingsRow } from "../schema";
import type { Db, Executor } from "../types";
import { areLinked } from "./accounts";
import { raceResultPublicAt } from "./news";
import { isToteRace, toteBettorChecksTx, type TotePoolKind } from "./tote";
import { audit, runTx } from "./tx";

type Env = Record<string, string | undefined>;
const processEnv = (): Env => (typeof process !== "undefined" ? process.env : {});

/** The one switch (see game-core realToteGate). */
export function realToteEnabled(env: Env = processEnv()): boolean {
  return gc.realToteGate(env).enabled;
}

function assertRealTote(env: Env | undefined): void {
  if (!realToteEnabled(env ?? processEnv())) throw new DomainError("TOTE_UNAVAILABLE", "real-money betting is switched off");
}

const MARKET_KEY_RE = /^0x[0-9a-f]{64}$/;

export async function getRealToteRace(ex: Executor, raceId: string): Promise<RealToteRaceRow | null> {
  const [r] = await ex.select().from(realToteRaces).where(eq(realToteRaces.raceId, raceId));
  return r ?? null;
}

// ---------------------------------------------------------------------------
// The race-level flag
// ---------------------------------------------------------------------------

/**
 * Flags an open Live card race for a real-money pool: moves its field lock to
 * REAL_TOTE_FIELD_LOCK_MS before the off (never later than it was) and records the market id
 * (`toteRaceKey(raceId)` from the chain adapter). Idempotent. Refused when switched off, for
 * races without a tote, once the field has locked, or when the new lock time has passed.
 */
export async function enableRealToteForRace(db: Db, input: { raceId: string; marketKey: string; now: Date; env?: Env }): Promise<RealToteRaceRow> {
  assertRealTote(input.env);
  if (!MARKET_KEY_RE.test(input.marketKey)) throw new DomainError("INVALID_INPUT", "bad market key");
  return runTx(db, async (tx) => {
    const [race] = await tx.select().from(races).where(eq(races.id, input.raceId)).for("update");
    if (!race) throw new DomainError("NOT_FOUND", "race not found");
    const existing = await getRealToteRace(tx, race.id);
    if (existing) return existing;
    if (!isToteRace(race)) throw new DomainError("TOTE_UNAVAILABLE", "the tote runs on Live card races only");
    if (race.status !== "open" || race.field) throw new DomainError("RACE_CLOSED", "the field has already locked");
    const post = race.postTime.getTime();
    const lockMs = gc.realToteEntriesCloseMs(post, race.entriesCloseAt.getTime());
    if (input.now.getTime() >= lockMs) throw new DomainError("RACE_CLOSED", "too close to the off for a real-money pool");
    if (lockMs < race.entriesCloseAt.getTime()) await tx.update(races).set({ entriesCloseAt: new Date(lockMs) }).where(eq(races.id, race.id));
    const [row] = await tx
      .insert(realToteRaces)
      .values({
        raceId: race.id,
        marketKey: input.marketKey,
        fieldLockAt: new Date(lockMs),
        marketCloseAt: new Date(gc.realToteMarketCloseMs(post)),
        betsCloseAt: new Date(gc.realToteBetsCloseMs(post)),
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    await audit(tx, { actor: null, action: "real_tote.enable", entityType: "race", entityId: race.id, data: { marketKey: input.marketKey, fieldLockAt: lockMs } });
    return row!;
  });
}

/** What TotePools.createMarket needs for a flagged race whose field has locked. */
export interface RealToteMarketParams {
  marketKey: string;
  /** unix seconds */
  closeTime: number;
  runnerCount: number;
  placeTerms: number;
  /** 64-hex sha256(serverSeed), the race's published commitment. */
  seedCommitment: string;
  takeoutBps: number;
  maxPool: number;
}

export async function realToteMarketParams(ex: Executor, raceId: string): Promise<RealToteMarketParams> {
  const rt = await getRealToteRace(ex, raceId);
  if (!rt) throw new DomainError("NOT_FOUND", "no real-money pool on this race");
  const [race] = await ex.select().from(races).where(eq(races.id, raceId));
  const field = race?.field as { runners?: unknown[] } | null | undefined;
  if (!race || !field?.runners) throw new DomainError("TOO_EARLY", "the field hasn't locked yet");
  const runnerCount = field.runners.length;
  return {
    marketKey: rt.marketKey,
    closeTime: Math.floor(rt.marketCloseAt.getTime() / 1000),
    runnerCount,
    placeTerms: gc.totePlaces(runnerCount),
    seedCommitment: race.seedCommitment,
    takeoutBps: gc.REAL_TOTE_TAKEOUT_BPS,
    maxPool: gc.REAL_TOTE_MAX_POOL,
  };
}

// ---------------------------------------------------------------------------
// Bet permits
// ---------------------------------------------------------------------------

export interface RealTotePermitGrant {
  /** uint256, decimal */
  nonce: string;
  raceId: string;
  marketKey: string;
  wallet: string;
  /** The runner's index on chain: gate - 1. Signed into the permit. */
  runner: number;
  /** Signed into the permit. */
  pool: TotePoolKind;
  maxAmount: number;
  issuedAt: Date;
  expiresAt: Date;
}

/**
 * The player's own real-money limits ({USDG: {perRace, perDay}} in tote_settings). A raise only
 * counts once the player has confirmed it after its delay (it is then moved into `limits`).
 */
export function realToteOwnLimits(row: Pick<ToteSettingsRow, "limits" | "pendingLimits" | "pendingAt"> | null, _now: Date): gc.TotePlayerLimits | null {
  const v = (row?.limits as Record<string, { perRace?: unknown; perDay?: unknown }> | null)?.USDG;
  return v ? { perRace: typeof v.perRace === "number" ? v.perRace : null, perDay: typeof v.perDay === "number" ? v.perDay : null } : null;
}

/**
 * Stakes that count toward limits: a spent permit at what was staked, a lapsed one (never used,
 * and now unusable) at 0, and every other permit at its maximum, expired or not, until the
 * mirror or a chain check settles it (an unmirrored spent permit must never count as free).
 */
function committedSql() {
  return sql<string>`coalesce(sum(case when ${realTotePermits.usedAmount} is not null then ${realTotePermits.usedAmount} when ${realTotePermits.lapsedAt} is not null then 0 else ${realTotePermits.maxAmount} end), 0)`;
}

/**
 * Signs nothing: runs every check the in-game tote runs (18+, self-exclusion and time-outs, the
 * horse is running, place pool, conflicts of interest incl. linked accounts, the player's own
 * limits, staff) plus the real-money ones (the switch, a live market, the betting close, the
 * account's linked wallet, no linked account on another runner of the same pool, the
 * real-money caps), then records a single-use permit bound to the runner and pool for the caller
 * (apps/web toteChain.ts) to sign. The permit counts toward the limits until it is spent (at the
 * amount staked) or lapses unused.
 */
export async function issueRealTotePermit(
  db: Db,
  input: { accountId: string; raceId: string; horseId: string; pool: TotePoolKind; amount: number; wallet: string; now: Date; env?: Env; staff?: boolean },
): Promise<RealTotePermitGrant> {
  assertRealTote(input.env);
  if (input.pool !== "win" && input.pool !== "place") throw new DomainError("INVALID_INPUT", "pool must be win or place");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new DomainError("INVALID_INPUT", "stake must be a whole positive amount");
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.wallet)) throw new DomainError("INVALID_INPUT", "bad wallet address");
  const out = await runTx(db, async (tx): Promise<RealTotePermitGrant | DomainError> => {
    const [race] = await tx.select().from(races).where(eq(races.id, input.raceId)).for("update");
    if (!race) throw new DomainError("NOT_FOUND", "race not found");
    const rt = await getRealToteRace(tx, race.id);
    if (!rt || rt.status !== "open") throw new DomainError("TOTE_UNAVAILABLE", "no real-money pool is open on this race");
    if (race.status === "cancelled") throw new DomainError("RACE_CLOSED", "this race was called off");
    if (input.now >= rt.betsCloseAt) throw new DomainError("RACE_CLOSED", "real-money betting has closed for this race");

    const [acc] = await tx.select({ wallet: accounts.walletAddress }).from(accounts).where(eq(accounts.id, input.accountId));
    if (!acc?.wallet || acc.wallet.toLowerCase() !== input.wallet.toLowerCase()) throw new DomainError("NOT_ELIGIBLE", "bet from the wallet linked to your stable");

    const checked = await toteBettorChecksTx(tx, { accountId: input.accountId, race, horseId: input.horseId, pool: input.pool, now: input.now, staff: input.staff, fraudData: { stake: input.amount, currency: "USDG" } });
    if (checked instanceof DomainError) return checked;
    const field = race.field as { runners?: { horseId: string; gate: number }[] } | null;
    const gate = field?.runners?.find((r) => r.horseId === input.horseId)?.gate;
    if (!gate) throw new DomainError("TOO_EARLY", "real-money betting opens when the field locks");

    // Linked accounts are one bettor: they may not back different runners of the same pool (a
    // way to move money between accounts through the pool). Fraud event, then refused.
    const others = await tx
      .select({ accountId: realTotePermits.accountId, runner: realTotePermits.runner })
      .from(realTotePermits)
      .where(and(eq(realTotePermits.raceId, race.id), eq(realTotePermits.pool, input.pool), ne(realTotePermits.accountId, input.accountId), isNull(realTotePermits.lapsedAt)));
    for (const o of others) {
      if (o.runner === gate - 1 || !(await areLinked(tx, input.accountId, o.accountId))) continue;
      await tx.insert(fraudEvents).values({ accountId: input.accountId, relatedAccountId: o.accountId, kind: "tote_linked_opposing_bets", severity: 2, data: { raceId: race.id, pool: input.pool, runner: gate - 1, theirs: o.runner, currency: "USDG" } });
      return new DomainError("LINKED_ACCOUNTS", "an account linked to yours has bet on another runner in this pool");
    }

    const dayStart = new Date(gc.realToteDayStartMs(input.now.getTime()));
    const mine = eq(realTotePermits.accountId, input.accountId);
    const [onRace] = await tx.select({ s: committedSql() }).from(realTotePermits).where(and(mine, eq(realTotePermits.raceId, race.id)));
    const [today] = await tx.select({ s: committedSql() }).from(realTotePermits).where(and(mine, gte(realTotePermits.issuedAt, dayStart)));
    const allowance = gc.realToteAllowance({ stakedOnRace: Number(onRace?.s ?? 0), stakedToday: Number(today?.s ?? 0), own: realToteOwnLimits(checked.settings, input.now) });
    if (input.amount < gc.REAL_TOTE_MIN_STAKE) throw new DomainError("TOTE_LIMIT", `the smallest bet is ${gc.formatRealToteUsdg(gc.REAL_TOTE_MIN_STAKE)}`);
    if (input.amount > allowance) throw new DomainError("TOTE_LIMIT", `that's over your limit: ${gc.formatRealToteUsdg(allowance)} left`);

    const nonce = BigInt(`0x${randomBytes(32).toString("hex")}`).toString();
    const expiresAt = new Date(gc.realTotePermitExpiryMs(input.now.getTime(), race.postTime.getTime()));
    await tx.insert(realTotePermits).values({ nonce, raceId: race.id, accountId: input.accountId, wallet: input.wallet, maxAmount: input.amount, issuedAt: input.now, expiresAt, runner: gate - 1, pool: input.pool });
    await audit(tx, { actor: input.accountId, action: "real_tote.permit", entityType: "race", entityId: race.id, data: { nonce, horseId: input.horseId, pool: input.pool, maxAmount: input.amount } });
    return { nonce, raceId: race.id, marketKey: rt.marketKey, wallet: input.wallet, runner: gate - 1, pool: input.pool, maxAmount: input.amount, issuedAt: input.now, expiresAt };
  });
  if (out instanceof DomainError) throw out;
  return out;
}

/**
 * This account's permits that expired at least REAL_TOTE_PERMIT_LAPSE_GRACE_MS ago with no
 * mirrored bet: the caller checks each nonce on chain (TotePools.nonceUsed) and lapses the
 * unused ones (an expired permit can never be used again).
 */
export async function realToteUnsettledPermits(ex: Executor, accountId: string, now: Date): Promise<{ nonce: string; wallet: string }[]> {
  const before = new Date(now.getTime() - gc.REAL_TOTE_PERMIT_LAPSE_GRACE_MS);
  return ex
    .select({ nonce: realTotePermits.nonce, wallet: realTotePermits.wallet })
    .from(realTotePermits)
    .where(and(eq(realTotePermits.accountId, accountId), isNull(realTotePermits.usedAmount), isNull(realTotePermits.lapsedAt), lt(realTotePermits.expiresAt, before)))
    .limit(50);
}

/** Marks permits as never used (they stop counting toward limits). Spent ones are left alone. */
export async function lapseRealTotePermits(ex: Executor, nonces: readonly string[], now: Date): Promise<void> {
  if (!nonces.length) return;
  await ex
    .update(realTotePermits)
    .set({ lapsedAt: now })
    .where(and(inArray(realTotePermits.nonce, [...nonces]), isNull(realTotePermits.usedAmount), isNull(realTotePermits.lapsedAt)));
}

// ---------------------------------------------------------------------------
// The seed a flagged race runs on
// ---------------------------------------------------------------------------

export interface RealToteSeed {
  mode: "final" | "server";
  serverSeed: string;
  entropy: string | null;
  /** The seed the engine runs on. */
  seed: string;
}

/**
 * The seed of a race's simulation: null for every race without a real-money pool (they run on
 * their server seed exactly as before). For a flagged race the choice is made once and stored:
 * "final" = sha256(serverSeed ‖ entropy) when the entropy is recorded; otherwise "server" and the
 * market is marked abandoned (to be cancelled: refunds).
 */
export async function resolveRealToteSeed(db: Db, race: Pick<RaceRow, "id" | "seed">, now: Date): Promise<RealToteSeed | null> {
  const rt = await getRealToteRace(db, race.id);
  if (!rt) return null;
  const decided = rt.seedMode
    ? rt
    : await runTx(db, async (tx) => {
        const [row] = await tx.select().from(realToteRaces).where(eq(realToteRaces.raceId, race.id)).for("update");
        if (row!.seedMode) return row!;
        const mode = row!.entropy ? "final" : "server";
        const status = mode === "server" && !["void", "finalized"].includes(row!.status) ? "abandoned" : row!.status;
        const [next] = await tx.update(realToteRaces).set({ seedMode: mode, status, updatedAt: now }).where(eq(realToteRaces.raceId, race.id)).returning();
        await audit(tx, { actor: null, action: "real_tote.seed_mode", entityType: "race", entityId: race.id, data: { mode } });
        return next!;
      });
  if (decided.seedMode === "final" && decided.entropy) return { mode: "final", serverSeed: race.seed, entropy: decided.entropy, seed: mixSeedEntropy(race.seed, decided.entropy) };
  return { mode: "server", serverSeed: race.seed, entropy: decided.entropy, seed: race.seed };
}

// ---------------------------------------------------------------------------
// Chain mirror
// ---------------------------------------------------------------------------

export type RealToteEventKind =
  | "MarketCreated"
  | "BetPlaced"
  | "EntropyLocked"
  | "BlockEntropyStored"
  | "EntropySealed"
  | "ResultPosted"
  | "ResultAttested"
  | "ResultCorrected"
  | "MarketFinalized"
  | "PoolRefunded"
  | "MarketVoided"
  | "Claimed";

export interface RealToteChainEvent {
  raceId: string;
  kind: RealToteEventKind;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  /** The decoded event args (bigints as decimal strings). */
  data: Record<string, unknown>;
}

const STATUS_AFTER: Partial<Record<RealToteEventKind, RealToteRaceRow["status"]>> = {
  MarketCreated: "open",
  EntropyLocked: "entropy_locked",
  EntropySealed: "sealed",
  ResultPosted: "result_posted",
  MarketFinalized: "finalized",
  MarketVoided: "void",
};

const hex32 = (v: unknown) => String(v ?? "").toLowerCase();
const secondsToDate = (v: unknown) => new Date(Number(v) * 1000);

/**
 * Mirrors one TotePools event (idempotent per tx and log index). Display and bookkeeping only:
 * nothing here moves money. Returns false when the event was already recorded. Events of one
 * market must be recorded in chain order (the sync does): once betting has closed on chain
 * (EntropyLocked) or the market is void, every permit no mirrored bet used has lapsed.
 */
export async function recordRealToteEvent(db: Db, ev: RealToteChainEvent, now: Date): Promise<boolean> {
  return runTx(db, async (tx) => {
    const [ins] = await tx
      .insert(realToteEvents)
      .values({ raceId: ev.raceId, kind: ev.kind, txHash: ev.txHash.toLowerCase(), logIndex: ev.logIndex, blockNumber: ev.blockNumber, data: ev.data, createdAt: now })
      .onConflictDoNothing()
      .returning({ id: realToteEvents.id });
    if (!ins) return false;
    const [rt] = await tx.select().from(realToteRaces).where(eq(realToteRaces.raceId, ev.raceId)).for("update");
    if (!rt) return true;
    const patch: Partial<RealToteRaceRow> = { updatedAt: now };
    const next = STATUS_AFTER[ev.kind];
    // An abandoned market (the race ran on its server seed) stays abandoned until it is voided.
    if (next && !(rt.status === "abandoned" && next !== "void")) patch.status = next;
    if (ev.kind === "EntropyLocked") patch.entropyBlock = Number(ev.data.entropyBlock);
    if (ev.kind === "EntropySealed" && !rt.seedMode) patch.entropy = String(ev.data.entropy).replace(/^0x/, "").toLowerCase();
    if (ev.kind === "MarketVoided") patch.voidReason = String(ev.data.reason ?? "");
    if (ev.kind === "ResultPosted") {
      if (ev.data.challengeEnd != null) patch.challengeEndAt = secondsToDate(ev.data.challengeEnd);
      if (ev.data.resultHash != null) patch.resultHash = hex32(ev.data.resultHash);
      patch.attestedHash = null;
      patch.disputed = false;
    }
    if (ev.kind === "ResultCorrected") {
      if (ev.data.challengeEnd != null) patch.challengeEndAt = secondsToDate(ev.data.challengeEnd);
      if (ev.data.resultHash != null) patch.resultHash = hex32(ev.data.resultHash);
      patch.disputed = false;
    }
    if (ev.kind === "ResultAttested") {
      patch.attestedHash = hex32(ev.data.attestedHash);
      // Sticky on chain: only a guardian correction clears it.
      if (ev.data.matches === false || ev.data.matches === "false") patch.disputed = true;
    }
    if (ev.kind === "BetPlaced") {
      const pools = { ...((rt.pools ?? {}) as Record<string, Record<string, number>>) };
      const key = Number(ev.data.pool) === 1 ? "place" : "win";
      pools[key] = { ...(pools[key] ?? {}), [String(ev.data.runner)]: Number(ev.data.runnerTotal) };
      patch.pools = pools;
      await tx
        .update(realTotePermits)
        .set({ usedAmount: Number(ev.data.amount), betTx: ev.txHash.toLowerCase() })
        .where(and(eq(realTotePermits.nonce, String(ev.data.nonce)), eq(realTotePermits.raceId, ev.raceId)));
    }
    if (ev.kind === "EntropyLocked" || ev.kind === "MarketVoided") {
      await tx
        .update(realTotePermits)
        .set({ lapsedAt: now })
        .where(and(eq(realTotePermits.raceId, ev.raceId), isNull(realTotePermits.usedAmount), isNull(realTotePermits.lapsedAt)));
    }
    if (ev.kind === "MarketFinalized" || ev.kind === "MarketVoided") Object.assign(patch, { keeperAttempts: 0, keeperNextAt: null, keeperError: null });
    await tx.update(realToteRaces).set(patch).where(eq(realToteRaces.raceId, ev.raceId));
    return true;
  });
}

/** Where the event sync resumes: the last block whose logs were mirrored for this market. */
export async function setRealToteSyncedBlock(ex: Executor, raceId: string, block: number, now: Date): Promise<void> {
  await ex
    .update(realToteRaces)
    .set({ syncedBlock: block, updatedAt: now })
    .where(and(eq(realToteRaces.raceId, raceId), or(isNull(realToteRaces.syncedBlock), lt(realToteRaces.syncedBlock, block))));
}

// ---------------------------------------------------------------------------
// Results, odds and the keeper's work list
// ---------------------------------------------------------------------------

export interface RealToteResult {
  marketKey: string;
  /** The server seed, revealed on chain (its sha256 is the market's commitment). */
  serverSeed: string;
  /** Finishing position per runner index (gate - 1); 0 = non-runner. */
  positions: number[];
}

/**
 * What postResult needs, only once the result is public (the broadcast is over: no spoilers,
 * the chain is permanent) and only for a race that ran on the final seed.
 */
export async function realToteResultFor(ex: Executor, raceId: string, now: Date): Promise<RealToteResult> {
  const rt = await getRealToteRace(ex, raceId);
  if (!rt) throw new DomainError("NOT_FOUND", "no real-money pool on this race");
  if (rt.seedMode !== "final") throw new DomainError("TOTE_UNAVAILABLE", "this race didn't run on the sealed entropy: its market is cancelled, not settled");
  const publicAt = await raceResultPublicAt(ex, raceId);
  if (!publicAt || now < publicAt) throw new DomainError("TOO_EARLY", "the result isn't public yet");
  const [race] = await ex.select().from(races).where(eq(races.id, raceId));
  const field = race!.field as { runners: { horseId: string; gate: number }[] };
  const entries = await ex.select({ horseId: raceEntries.horseId, pos: raceEntries.finishPosition }).from(raceEntries).where(and(eq(raceEntries.raceId, raceId), eq(raceEntries.status, "entered")));
  const pos = new Map(entries.map((e) => [e.horseId, e.pos ?? 0]));
  const positions = new Array<number>(field.runners.length).fill(0);
  for (const r of field.runners) positions[r.gate - 1] = pos.get(r.horseId) ?? 0;
  return { marketKey: rt.marketKey, serverSeed: race!.seed, positions };
}

export interface RealToteBoard {
  status: RealToteRaceRow["status"];
  betsCloseAtMs: number;
  takeoutBps: number;
  pools: gc.TotePoolView[];
}

/** Live odds for display, from the mirrored on-chain pool totals and bets (the chain is the truth). */
export async function realToteBoard(ex: Executor, raceId: string): Promise<RealToteBoard | null> {
  const rt = await getRealToteRace(ex, raceId);
  if (!rt) return null;
  const [race] = await ex.select({ field: races.field }).from(races).where(eq(races.id, raceId));
  const runners = ((race?.field as { runners?: { horseId: string; gate: number }[] } | null)?.runners ?? []).slice().sort((a, b) => a.gate - b.gate);
  const ids = runners.map((r) => r.horseId);
  const mirrored = (rt.pools ?? {}) as Record<string, Record<string, number>>;
  // Distinct wallets per pool (the contract's minimum pool counts wallets).
  const bets = await ex.select({ data: realToteEvents.data }).from(realToteEvents).where(and(eq(realToteEvents.raceId, raceId), eq(realToteEvents.kind, "BetPlaced")));
  const wallets: Record<TotePoolKind, Set<string>> = { win: new Set(), place: new Set() };
  for (const b of bets) {
    const d = b.data as { pool?: unknown; bettor?: unknown };
    if (typeof d.bettor === "string" && d.bettor) wallets[Number(d.pool) === 1 ? "place" : "win"].add(d.bettor.toLowerCase());
  }
  const view = (kind: TotePoolKind) => {
    const stakes = new Map(runners.map((r) => [r.horseId, Number(mirrored[kind]?.[String(r.gate - 1)] ?? 0)]));
    return gc.totePoolView(kind, ids, stakes, ids.length, gc.REAL_TOTE_TAKEOUT_BPS / 10, wallets[kind].size);
  };
  return { status: rt.status, betsCloseAtMs: rt.betsCloseAt.getTime(), takeoutBps: gc.REAL_TOTE_TAKEOUT_BPS, pools: [view("win"), ...(gc.totePlaces(ids.length) ? [view("place")] : [])] };
}

/** Why a market needs the guardian multisig (the keeper raises an alert once per market). */
export type RealToteGuardianReason = "abandoned_after_entropy" | "result_disputed" | "attestation_missing" | "result_withheld";

export interface RealToteWork {
  /** Field locked, market not yet on chain. */
  create: string[];
  /** Flagged but betting closed before a market was created: closed locally (no chain step). */
  close: string[];
  /** Market closed: lockEntropy. */
  lock: string[];
  /** Entropy blocks picked: sealEntropy. */
  seal: string[];
  /** Ran on the server seed before any entropy block was picked: the operator's cancelMarket (refunds). */
  cancel: string[];
  /** Result public: postResult. */
  post: string[];
  /** Window over and the result attestor's hash matches: finalize. */
  finalize: string[];
  /** Past TotePools' MAX_SETTLE_DELAY without a settleable result: expireMarket (anyone; refunds). */
  expire: string[];
  /** Needs the guardian: void an abandoned market, resolve a dispute, chase a missing attestation or a withheld result. */
  guardian: { raceId: string; reason: RealToteGuardianReason }[];
}

const ACTIVE: RealToteRaceRow["status"][] = ["pending", "open", "entropy_locked", "sealed", "abandoned", "result_posted"];

/** When a row's next step falls due (its due action, not its age, orders the work list). */
const dueAtSql = sql<Date>`case ${realToteRaces.status}
  when 'pending' then ${realToteRaces.fieldLockAt}
  when 'result_posted' then case when ${realToteRaces.disputed} then ${realToteRaces.marketCloseAt} else coalesce(${realToteRaces.challengeEndAt}, ${realToteRaces.marketCloseAt}) end
  else ${realToteRaces.marketCloseAt} end`;

/**
 * The keeper's to-do list (apps/web toteChain.ts runs it; empty when nothing is flagged). Rows
 * come in order of when their next step fell due, skipping parked rows and rows waiting out a
 * retry backoff, so a stuck market can never hold up the others.
 */
export async function realToteDueWork(ex: Executor, now: Date, limit = 20): Promise<RealToteWork> {
  const rows = await ex
    .select({ rt: realToteRaces, raceStatus: races.status, hasField: sql<boolean>`${races.field} is not null` })
    .from(realToteRaces)
    .innerJoin(races, eq(races.id, realToteRaces.raceId))
    .where(and(inArray(realToteRaces.status, ACTIVE), isNull(realToteRaces.parkedAt), or(isNull(realToteRaces.keeperNextAt), lte(realToteRaces.keeperNextAt, now)), lte(dueAtSql, now)))
    .orderBy(asc(dueAtSql))
    .limit(limit * 4);
  const work: RealToteWork = { create: [], close: [], lock: [], seal: [], cancel: [], post: [], finalize: [], expire: [], guardian: [] };
  const guardian = (raceId: string, reason: RealToteGuardianReason) => work.guardian.push({ raceId, reason });
  const nowMs = now.getTime();
  for (const { rt, raceStatus, hasField } of rows) {
    const settleBy = rt.marketCloseAt.getTime() + gc.REAL_TOTE_MAX_SETTLE_DELAY_MS;
    if (rt.status === "result_posted") {
      const finalizable = !rt.disputed && !!rt.attestedHash && rt.attestedHash === rt.resultHash;
      const end = rt.challengeEndAt?.getTime() ?? null;
      if (finalizable && end !== null && nowMs >= end) work.finalize.push(rt.raceId);
      else if (!finalizable && end !== null && nowMs > end + gc.REAL_TOTE_MAX_SETTLE_DELAY_MS) work.expire.push(rt.raceId);
      else if (rt.disputed) guardian(rt.raceId, "result_disputed");
      else if (!finalizable && end !== null && nowMs >= end) guardian(rt.raceId, "attestation_missing");
      continue;
    }
    if (rt.status !== "pending" && nowMs > settleBy) {
      work.expire.push(rt.raceId);
      continue;
    }
    if (rt.status === "pending") {
      if (nowMs >= rt.betsCloseAt.getTime()) work.close.push(rt.raceId);
      else if (hasField) work.create.push(rt.raceId);
    } else if (rt.status === "abandoned") {
      // Once the entropy blocks are picked the outcome may be knowable: only the guardian voids
      // (or anyone expires it after MAX_SETTLE_DELAY).
      if (rt.entropyBlock === null) work.cancel.push(rt.raceId);
      else guardian(rt.raceId, "abandoned_after_entropy");
    } else if (rt.status === "open" && nowMs >= rt.marketCloseAt.getTime()) work.lock.push(rt.raceId);
    else if (rt.status === "entropy_locked") work.seal.push(rt.raceId);
    else if (rt.status === "sealed" && raceStatus === "settled") {
      const publicAt = await raceResultPublicAt(ex, rt.raceId);
      if (publicAt && nowMs >= publicAt.getTime()) {
        work.post.push(rt.raceId);
        // Withholding a result can only ever end in refunds (expiry), but it is watched.
        if (nowMs >= publicAt.getTime() + gc.REAL_TOTE_RESULT_ALERT_MS) guardian(rt.raceId, "result_withheld");
      }
    }
  }
  for (const k of Object.keys(work) as (keyof RealToteWork)[]) (work[k] as unknown[]).splice(limit);
  return work;
}

/** A flagged race whose betting closed before its market was created: nothing on chain, closed here. */
export async function closeUnopenedRealToteRace(db: Db, raceId: string, now: Date): Promise<void> {
  await runTx(db, async (tx) => {
    const [rt] = await tx.select().from(realToteRaces).where(eq(realToteRaces.raceId, raceId)).for("update");
    if (!rt || rt.status !== "pending" || now < rt.betsCloseAt) return;
    await tx.update(realToteRaces).set({ status: "void", voidReason: "never_opened", updatedAt: now }).where(eq(realToteRaces.raceId, raceId));
    await audit(tx, { actor: null, action: "real_tote.never_opened", entityType: "race", entityId: raceId });
  });
}

export interface RealToteAlert {
  raceId: string;
  kind: RealToteGuardianReason | "keeper_parked" | "result_mismatch" | "attestor_error";
  detail?: string;
}

/**
 * Records an alert for the operators and the guardian (audit log `real_tote.alert.<kind>`). A
 * guardian request is recorded once per market (`guardian_request_at`); returns false when it
 * was already raised.
 */
export async function raiseRealToteAlert(db: Db, alert: RealToteAlert, now: Date): Promise<boolean> {
  return runTx(db, async (tx) => {
    const [rt] = await tx.select().from(realToteRaces).where(eq(realToteRaces.raceId, alert.raceId)).for("update");
    if (!rt) return false;
    const guardianRequest = alert.kind !== "keeper_parked" && alert.kind !== "attestor_error";
    if (guardianRequest && rt.guardianRequestAt) return false;
    if (guardianRequest) await tx.update(realToteRaces).set({ guardianRequestAt: now, updatedAt: now }).where(eq(realToteRaces.raceId, alert.raceId));
    await audit(tx, { actor: null, action: `real_tote.alert.${alert.kind}`, entityType: "race", entityId: alert.raceId, data: { marketKey: rt.marketKey, status: rt.status, detail: alert.detail ?? null } });
    return true;
  });
}

/**
 * Keeper bookkeeping for one market: a success clears the failure count; a failure backs off
 * (gc.realToteKeeperBackoffMs) and, after REAL_TOTE_KEEPER_MAX_ATTEMPTS in a row, parks the
 * market (skipped by the work list until `unparkRealToteRace`) with an alert. Returns true when
 * this failure parked it.
 */
export async function recordRealToteKeeperOutcome(db: Db, raceId: string, outcome: { ok: true } | { ok: false; step: string; error: string }, now: Date): Promise<boolean> {
  if (outcome.ok) {
    await db
      .update(realToteRaces)
      .set({ keeperAttempts: 0, keeperNextAt: null, keeperError: null })
      .where(and(eq(realToteRaces.raceId, raceId), sql`${realToteRaces.keeperAttempts} > 0`));
    return false;
  }
  const parked = await runTx(db, async (tx) => {
    const [rt] = await tx.select().from(realToteRaces).where(eq(realToteRaces.raceId, raceId)).for("update");
    if (!rt) return false;
    const attempts = rt.keeperAttempts + 1;
    const park = attempts >= gc.REAL_TOTE_KEEPER_MAX_ATTEMPTS;
    await tx
      .update(realToteRaces)
      .set({
        keeperAttempts: attempts,
        keeperNextAt: new Date(now.getTime() + gc.realToteKeeperBackoffMs(attempts)),
        keeperError: `${outcome.step}: ${outcome.error}`.slice(0, 500),
        parkedAt: park ? now : rt.parkedAt,
        updatedAt: now,
      })
      .where(eq(realToteRaces.raceId, raceId));
    return park && !rt.parkedAt;
  });
  if (parked) await raiseRealToteAlert(db, { raceId, kind: "keeper_parked", detail: `${outcome.step}: ${outcome.error}`.slice(0, 200) }, now);
  return parked;
}

/** Puts a parked market back on the keeper's list (after someone fixed what blocked it). */
export async function unparkRealToteRace(db: Db, raceId: string, now: Date): Promise<void> {
  await db.update(realToteRaces).set({ parkedAt: null, keeperAttempts: 0, keeperNextAt: null, updatedAt: now }).where(eq(realToteRaces.raceId, raceId));
  await audit(db, { actor: null, action: "real_tote.unpark", entityType: "race", entityId: raceId });
}

/**
 * The result attestor's to-do list (apps/web toteAttestor.ts, a separate service and key): posted
 * results it hasn't matched yet (no attestation, or one made before a correction). Disputed
 * markets wait for the guardian.
 */
export async function realToteAttestWork(ex: Executor, limit = 20): Promise<string[]> {
  const rows = await ex
    .select({ raceId: realToteRaces.raceId })
    .from(realToteRaces)
    .where(and(eq(realToteRaces.status, "result_posted"), eq(realToteRaces.disputed, false), or(isNull(realToteRaces.attestedHash), sql`${realToteRaces.attestedHash} is distinct from ${realToteRaces.resultHash}`)))
    .orderBy(asc(realToteRaces.challengeEndAt))
    .limit(limit);
  return rows.map((r) => r.raceId);
}

/** Checks a revealed server seed against the race's commitment (what the contract checks on chain). */
export function realToteSeedMatches(serverSeed: string, seedCommitment: string): boolean {
  return /^[0-9a-f]{64}$/.test(serverSeed) && commitSeed(serverSeed) === seedCommitment;
}

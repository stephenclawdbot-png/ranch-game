/**
 * The REAL-USDG tote's chain side: a DORMANT scaffold (docs/usdg-tote.md). Server only.
 *
 * OFF by default. Every entry point refuses unless REAL_TOTE_ENABLED=true AND WEB3_ENABLED=true
 * AND TOTE_POOLS_ADDRESS is set, plus the settings below. Switching it on needs legal approval,
 * KYC / age / location checks, an external audit of TotePools, a review of the seed scheme and
 * multisig roles first (the checklist in docs/usdg-tote.md).
 *
 * Non-custodial: players bet from their own wallet straight into TotePools and claim from it.
 * This server never holds player funds. It only:
 *   - signs short-lived, single-use BetPermits (bound to the runner and pool) after the tote's
 *     own checks (conflicts of interest, linked accounts, limits, self-exclusion, 18+, staff)
 *     plus location (allow-list);
 *   - as OPERATOR, creates markets when the field locks, posts results (with the revealed seed)
 *     once the broadcast is over, and cancels a market whose race couldn't use the entropy, but
 *     only before its entropy block is picked;
 *   - as anyone could, locks and seals the entropy, finalizes after the challenge window, and
 *     expires markets that can no longer settle (refunds);
 *   - raises alerts for the guardian multisig (abandoned markets after the entropy block,
 *     disputed or unattested results, withheld results, parked markets);
 *   - mirrors the contract's events into the database (paged log reads filtered by market).
 * The independent result check is NOT here: toteAttestor.ts, with its own key.
 *
 *   REAL_TOTE_ENABLED                 "true" to switch on (default off)
 *   WEB3_ENABLED                      must also be "true"
 *   TOTE_POOLS_ADDRESS                the deployed TotePools (not deployed)
 *   ROBINHOOD_RPC_URL, CHAIN_ID       shared with the other chain features
 *   TOTE_OPERATOR_PRIVATE_KEY         SECRET: OPERATOR_ROLE key (markets, results). It can't move
 *                                     stakes, but it does post the result winners are paid on:
 *                                     a result only pays after the separate RESULT_ATTESTOR key
 *                                     attests the same result, and the GUARDIAN multisig can
 *                                     correct or void it in the challenge window. The operator
 *                                     and attestor keys together could still post a false result
 *                                     the guardian then has to catch: keep them in separate
 *                                     services and secret stores.
 *   TOTE_PERMIT_SIGNER_PRIVATE_KEY    SECRET: PERMIT_SIGNER_ROLE key. Must differ from the operator.
 *   USDG_TOKEN_ADDRESS                the stake asset of the app's markets (defaults to testnet USDG
 *                                     on 46630). TotePools can also run ETH markets (address(0)),
 *                                     but this app only creates USDG ones for now.
 *   REAL_TOTE_ALLOWED_COUNTRIES       ISO codes where real-money betting is allowed (an
 *                                     allow-list: empty = nowhere, so nothing is ever open by default)
 *   CHAIN_LOG_LOOKBACK_BLOCKS         where a market's first event sync starts (default 200000 back)
 *   CHAIN_LOG_PAGE_BLOCKS             blocks per log request (default 10000)
 */
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseEventLogs,
  toBytes,
  toHex,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as gc from "@thoroughbred/game-core";
import {
  closeUnopenedRealToteRace,
  enableRealToteForRace,
  getRealToteRace,
  issueRealTotePermit,
  lapseRealTotePermits,
  raiseRealToteAlert,
  realToteDueWork,
  realToteMarketParams,
  realToteResultFor,
  realToteUnsettledPermits,
  recordRealToteEvent,
  recordRealToteKeeperOutcome,
  setRealToteSyncedBlock,
  type Db,
  type RealToteChainEvent,
  type RealToteEventKind,
  type TotePoolKind,
} from "@thoroughbred/db";
import { betPermitTypes, TOTE_EIP712_NAME, TOTE_EIP712_VERSION, totePoolsAbi } from "@/lib/chain/contracts.generated";
import { viemChain } from "@/lib/chain/chains";
import type { Session } from "../session";
import { ROBINHOOD_TESTNET_USDG } from "./usdgConfig";

type Env = Record<string, string | undefined>;

/** Thrown by every entry point while the real-money tote is off or misconfigured. */
export class RealToteOffError extends Error {
  override name = "RealToteOffError";
  readonly code = "real_tote_off";
  constructor(readonly missing: string[]) {
    super(`Real-money betting is off${missing.length ? ` (missing: ${missing.join(", ")})` : ""}.`);
  }
}

/** Real-money betting isn't allowed where the player is (location allow-list). */
export class RealToteGeoError extends Error {
  override name = "RealToteGeoError";
  readonly code = "geo_blocked";
  constructor() {
    super("Real-money betting isn't available where you are.");
  }
}

export interface RealToteConfig {
  chainId: number;
  rpcUrl: string;
  totePools: Address;
  /** The stake asset of the markets this app creates (USDG). */
  stakeAsset: Address;
  operatorKey: Hex;
  permitSignerKey: Hex;
  allowedCountries: string[];
  logLookbackBlocks: bigint;
  logPageBlocks: bigint;
}

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

/** Cheap check with no database or network: is the real-money tote switched on at all? */
export function realToteOn(env: Env = process.env): boolean {
  return gc.realToteGate(env).enabled;
}

/** The full configuration, or RealToteOffError naming what is missing (never echoing a key). */
export function readRealToteConfig(env: Env = process.env): RealToteConfig {
  const gate = gc.realToteGate(env);
  const missing: string[] = [...gate.missing];
  const pools = env.TOTE_POOLS_ADDRESS?.trim() ?? "";
  if (pools && !isAddress(pools, { strict: false })) missing.push("TOTE_POOLS_ADDRESS (not an address)");
  const rpcUrl = env.ROBINHOOD_RPC_URL?.trim() ?? "";
  if (!rpcUrl) missing.push("ROBINHOOD_RPC_URL");
  const operatorKey = env.TOTE_OPERATOR_PRIVATE_KEY?.trim() ?? "";
  const permitSignerKey = env.TOTE_PERMIT_SIGNER_PRIVATE_KEY?.trim() ?? "";
  if (!KEY_RE.test(operatorKey)) missing.push("TOTE_OPERATOR_PRIVATE_KEY");
  if (!KEY_RE.test(permitSignerKey)) missing.push("TOTE_PERMIT_SIGNER_PRIVATE_KEY");
  if (KEY_RE.test(operatorKey) && operatorKey.toLowerCase() === permitSignerKey.toLowerCase()) missing.push("TOTE_PERMIT_SIGNER_PRIVATE_KEY (must differ from the operator key)");
  const allowedCountries = (env.REAL_TOTE_ALLOWED_COUNTRIES ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  if (!allowedCountries.length) missing.push("REAL_TOTE_ALLOWED_COUNTRIES");
  const chainId = Number(env.CHAIN_ID?.trim() || env.ROBINHOOD_CHAIN_ID?.trim() || 46630);
  if (!Number.isInteger(chainId) || chainId <= 0) missing.push("CHAIN_ID");
  const asset = env.USDG_TOKEN_ADDRESS?.trim() || (chainId === 46630 ? ROBINHOOD_TESTNET_USDG : "");
  if (!asset || !isAddress(asset, { strict: false })) missing.push("USDG_TOKEN_ADDRESS");
  if (missing.length) throw new RealToteOffError(missing);
  return {
    chainId,
    rpcUrl,
    totePools: getAddress(pools),
    stakeAsset: getAddress(asset),
    operatorKey: operatorKey as Hex,
    permitSignerKey: permitSignerKey as Hex,
    allowedCountries,
    logLookbackBlocks: BigInt(env.CHAIN_LOG_LOOKBACK_BLOCKS?.trim() || 200_000),
    logPageBlocks: BigInt(Math.max(100, Number(env.CHAIN_LOG_PAGE_BLOCKS?.trim() || 10_000))),
  };
}

/** The on-chain market id of a race: keccak256("posttime:race:<uuid>") (adapter toteRaceKey). */
export function toteMarketKey(raceId: string): Hex {
  return keccak256(toBytes(`posttime:race:${raceId.toLowerCase()}`));
}

const POOL_INDEX: Record<TotePoolKind, number> = { win: 0, place: 1 };

export interface BetPermitMessage {
  bettor: Address;
  raceId: Hex;
  /** Runner index (gate - 1): the bet must be on this runner ... */
  runner: number;
  /** ... in this pool (0 = WIN, 1 = PLACE). */
  pool: number;
  maxAmount: bigint;
  nonce: bigint;
  /** unix seconds: not valid before (backdated a little for clock skew). */
  issuedAt: bigint;
  /** unix seconds: not valid after; the contract allows at most 10 minutes after issuedAt. */
  expiry: bigint;
}

export function betPermitTypedData(p: BetPermitMessage, chainId: number, totePools: Address) {
  return {
    domain: { name: TOTE_EIP712_NAME, version: TOTE_EIP712_VERSION, chainId, verifyingContract: totePools },
    types: betPermitTypes,
    primaryType: "BetPermit" as const,
    message: p,
  };
}

// ---------------------------------------------------------------------------
// The chain client (EVM, or a fake in tests)
// ---------------------------------------------------------------------------

export interface ToteChainLog {
  kind: RealToteEventKind;
  marketKey: Hex;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  args: Record<string, unknown>;
}

export interface ToteChainClient {
  readonly chainId: number;
  readonly totePools: Address;
  signPermit(p: BetPermitMessage): Promise<Hex>;
  createMarket(p: { marketKey: Hex; asset: Address; closeTime: number; runnerCount: number; placeTerms: number; seedCommitment: Hex; takeoutBps: number; maxPool: bigint }): Promise<Hex>;
  lockEntropy(marketKey: Hex): Promise<Hex>;
  sealEntropy(marketKey: Hex): Promise<Hex>;
  postResult(marketKey: Hex, revealedSeed: Hex, positions: number[]): Promise<Hex>;
  finalize(marketKey: Hex): Promise<Hex>;
  cancelMarket(marketKey: Hex): Promise<Hex>;
  expireMarket(marketKey: Hex): Promise<Hex>;
  runnerStakes(marketKey: Hex, pool: TotePoolKind): Promise<bigint[]>;
  nonceUsed(wallet: Address, nonce: bigint): Promise<boolean>;
  /** This market's mirrored events from `fromBlock` (or the lookback) up to `toBlock`, the head when it was read. */
  logs(marketKey: Hex, fromBlock: bigint | null): Promise<{ logs: ToteChainLog[]; toBlock: bigint }>;
}

const MIRRORED: RealToteEventKind[] = [
  "MarketCreated",
  "BetPlaced",
  "EntropyLocked",
  "BlockEntropyStored",
  "EntropySealed",
  "ResultPosted",
  "ResultAttested",
  "ResultCorrected",
  "MarketFinalized",
  "PoolRefunded",
  "MarketVoided",
  "Claimed",
];

/** Most pages one sync reads (the cursor resumes from there next time). */
const MAX_LOG_PAGES = 50;

/** viem client against TotePools: the operator key sends, the permit key only signs. */
export function evmToteChain(cfg: RealToteConfig): ToteChainClient {
  const chain = viemChain(cfg.chainId, cfg.rpcUrl);
  const pc = createPublicClient({ chain, transport: http(cfg.rpcUrl) }) as PublicClient;
  const operator = privateKeyToAccount(cfg.operatorKey);
  const signer = privateKeyToAccount(cfg.permitSignerKey);
  const wc = createWalletClient({ account: operator, chain, transport: http(cfg.rpcUrl) });
  const address = cfg.totePools;
  const write = (functionName: "createMarket" | "lockEntropy" | "sealEntropy" | "postResult" | "finalize" | "cancelMarket" | "expireMarket", args: readonly unknown[]) =>
    wc.writeContract({ address, abi: totePoolsAbi, functionName, args: args as never, account: operator, chain });
  return {
    chainId: cfg.chainId,
    totePools: address,
    signPermit: (p) => signer.signTypedData(betPermitTypedData(p, cfg.chainId, address)),
    createMarket: (p) => write("createMarket", [p.marketKey, p.asset, BigInt(p.closeTime), p.runnerCount, p.placeTerms, p.seedCommitment, p.takeoutBps, p.maxPool]),
    lockEntropy: (k) => write("lockEntropy", [k]),
    sealEntropy: (k) => write("sealEntropy", [k]),
    postResult: (k, seed, positions) => write("postResult", [k, seed, positions]),
    finalize: (k) => write("finalize", [k]),
    cancelMarket: (k) => write("cancelMarket", [k]),
    expireMarket: (k) => write("expireMarket", [k]),
    runnerStakes: async (k, pool) => [...(await pc.readContract({ address, abi: totePoolsAbi, functionName: "runnerStakes", args: [k, POOL_INDEX[pool]] }))],
    nonceUsed: (wallet, nonce) => pc.readContract({ address, abi: totePoolsAbi, functionName: "nonceUsed", args: [wallet, nonce] }),
    logs: async (k, fromBlock) => {
      const head = await pc.getBlockNumber();
      let from = fromBlock ?? (head > cfg.logLookbackBlocks ? head - cfg.logLookbackBlocks : 0n);
      const out: ToteChainLog[] = [];
      let to = from - 1n;
      // Paged, and filtered by the market id (topic 1 of every mirrored event) at the node.
      for (let page = 0; page < MAX_LOG_PAGES && from <= head; page++) {
        to = from + cfg.logPageBlocks - 1n < head ? from + cfg.logPageBlocks - 1n : head;
        const raw = (await pc.request({ method: "eth_getLogs", params: [{ address, fromBlock: toHex(from), toBlock: toHex(to), topics: [null, k] }] })) as Log[];
        const parsed = parseEventLogs({ abi: totePoolsAbi, logs: raw.map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber ?? 0), logIndex: Number(l.logIndex ?? 0) })) as never });
        for (const l of parsed) {
          if (!MIRRORED.includes(l.eventName as RealToteEventKind) || (l.args as { raceId?: Hex }).raceId?.toLowerCase() !== k.toLowerCase()) continue;
          out.push({ kind: l.eventName as RealToteEventKind, marketKey: k, txHash: l.transactionHash!, logIndex: l.logIndex!, blockNumber: l.blockNumber!, args: l.args as Record<string, unknown> });
        }
        from = to + 1n;
      }
      out.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
      return { logs: out, toBlock: to };
    },
  };
}

// ---------------------------------------------------------------------------
// Entry points (each refuses while off)
// ---------------------------------------------------------------------------

export interface RealToteDeps {
  env?: Env;
  /** Injected in tests; the EVM client otherwise. */
  chain?: ToteChainClient;
}

function setup(deps: RealToteDeps): { cfg: RealToteConfig; chain: ToteChainClient } {
  const cfg = readRealToteConfig(deps.env ?? process.env);
  return { cfg, chain: deps.chain ?? evmToteChain(cfg) };
}

/** Flags a race for a real-money pool (the earlier field lock comes with it). */
export async function flagRaceForRealTote(db: Db, raceId: string, now: Date, deps: RealToteDeps = {}) {
  const env = deps.env ?? process.env;
  readRealToteConfig(env);
  return enableRealToteForRace(db, { raceId, marketKey: toteMarketKey(raceId), now, env });
}

export interface SignedBetPermit {
  chainId: number;
  totePools: Address;
  /** For the wallet call: TotePools.bet(raceId, runner, pool, amount, permit, signature). */
  bet: { raceId: Hex; runner: number; pool: number; amount: string };
  permit: { bettor: Address; raceId: Hex; runner: number; pool: number; maxAmount: string; nonce: string; issuedAt: string; expiry: string };
  signature: Hex;
  /** What the wallet will show: the exact amount leaving it. */
  preview: { amount: string; amountLabel: string; expiresAtMs: number };
}

/**
 * Settles this account's expired permits that no mirrored bet used: one that the chain says was
 * never used (TotePools.nonceUsed, read after it expired) lapses and stops counting toward the
 * limits; a used one keeps counting at its maximum until the mirror records the bet.
 */
async function lapseUnusedPermits(db: Db, chain: ToteChainClient, accountId: string, now: Date): Promise<void> {
  const unused: string[] = [];
  for (const p of await realToteUnsettledPermits(db, accountId, now)) {
    if (!(await chain.nonceUsed(getAddress(p.wallet), BigInt(p.nonce)))) unused.push(p.nonce);
  }
  await lapseRealTotePermits(db, unused, now);
}

/**
 * Runs the checks and signs a single-use BetPermit for exactly `amount` on one runner in one
 * pool (the wallet then sends the bet itself; the stake never passes through this server).
 * `country` comes from the request's edge location header.
 */
export async function requestBetPermit(
  db: Db,
  session: Pick<Session, "accountId">,
  input: { raceId: string; horseId: string; pool: TotePoolKind; amount: number; wallet: string; country: string | null; now: Date; staff?: boolean },
  deps: RealToteDeps = {},
): Promise<SignedBetPermit> {
  const { cfg, chain } = setup(deps);
  if (!input.country || !cfg.allowedCountries.includes(input.country.toUpperCase())) throw new RealToteGeoError();
  await lapseUnusedPermits(db, chain, session.accountId, input.now);
  const grant = await issueRealTotePermit(db, { accountId: session.accountId, raceId: input.raceId, horseId: input.horseId, pool: input.pool, amount: input.amount, wallet: input.wallet, now: input.now, env: deps.env ?? process.env, staff: input.staff });
  const window = { issuedAt: Math.floor((grant.issuedAt.getTime() - gc.REAL_TOTE_PERMIT_CLOCK_SKEW_MS) / 1000), expiry: Math.floor(grant.expiresAt.getTime() / 1000) };
  const permit: BetPermitMessage = {
    bettor: getAddress(grant.wallet),
    raceId: grant.marketKey as Hex,
    runner: grant.runner,
    pool: POOL_INDEX[grant.pool],
    maxAmount: BigInt(grant.maxAmount),
    nonce: BigInt(grant.nonce),
    issuedAt: BigInt(window.issuedAt),
    expiry: BigInt(window.expiry),
  };
  const signature = await chain.signPermit(permit);
  return {
    chainId: chain.chainId,
    totePools: chain.totePools,
    bet: { raceId: permit.raceId, runner: grant.runner, pool: POOL_INDEX[grant.pool], amount: String(grant.maxAmount) },
    permit: {
      bettor: permit.bettor,
      raceId: permit.raceId,
      runner: permit.runner,
      pool: permit.pool,
      maxAmount: String(permit.maxAmount),
      nonce: String(permit.nonce),
      issuedAt: String(permit.issuedAt),
      expiry: String(permit.expiry),
    },
    signature,
    preview: { amount: String(grant.maxAmount), amountLabel: gc.formatRealToteUsdg(grant.maxAmount), expiresAtMs: grant.expiresAt.getTime() },
  };
}

/** Mirrors this market's new events into the database, from the stored cursor, in chain order. */
export async function syncRealToteEvents(db: Db, raceId: string, now: Date, deps: RealToteDeps = {}): Promise<number> {
  const { chain } = setup(deps);
  const rt = await getRealToteRace(db, raceId);
  if (!rt) return 0;
  const { logs, toBlock } = await chain.logs(rt.marketKey as Hex, rt.syncedBlock !== null ? BigInt(rt.syncedBlock) + 1n : null);
  let added = 0;
  for (const l of logs) {
    const data = Object.fromEntries(Object.entries(l.args).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
    const ev: RealToteChainEvent = { raceId, kind: l.kind, txHash: l.txHash, logIndex: l.logIndex, blockNumber: Number(l.blockNumber), data };
    if (await recordRealToteEvent(db, ev, now)) added++;
  }
  if (toBlock >= 0n) await setRealToteSyncedBlock(db, raceId, Number(toBlock), now);
  return added;
}

/** Live odds straight from the chain (the database mirror can lag). */
export async function realToteChainOdds(db: Db, raceId: string, deps: RealToteDeps = {}): Promise<gc.TotePoolView[] | null> {
  const { chain } = setup(deps);
  const params = await realToteMarketParams(db, raceId).catch(() => null);
  if (!params) return null;
  const ids = Array.from({ length: params.runnerCount }, (_, i) => String(i));
  const pools: TotePoolKind[] = params.placeTerms ? ["win", "place"] : ["win"];
  const out: gc.TotePoolView[] = [];
  for (const kind of pools) {
    const stakes = await chain.runnerStakes(params.marketKey as Hex, kind);
    out.push(gc.totePoolView(kind, ids, new Map(stakes.map((s, i) => [String(i), Number(s)])), params.runnerCount, params.takeoutBps / 10));
  }
  return out;
}

/**
 * Before a flagged race is simulated: try to get its entropy locked, sealed and mirrored so the
 * race can run on the final seed. A no-op (no database, no network) while the tote is off or for
 * any race without a real-money pool. Never throws: if the entropy isn't there in time the race
 * runs on its server seed and the market is refunded (cancelled before the entropy block is
 * picked; otherwise voided by the guardian or expired), which no one can bias.
 */
export async function prepareRealToteSeed(db: Db, raceId: string, now: Date, deps: RealToteDeps = {}): Promise<void> {
  if (!realToteOn(deps.env ?? process.env)) return;
  try {
    const rt = await getRealToteRace(db, raceId);
    if (!rt || rt.seedMode || rt.entropy) return;
    const { chain } = setup(deps);
    const k = rt.marketKey as Hex;
    if (rt.status === "open") await chain.lockEntropy(k).catch(() => undefined);
    await chain.sealEntropy(k).catch(() => undefined);
    await syncRealToteEvents(db, raceId, now, deps);
  } catch (err) {
    console.error("[real-tote] entropy before the off", raceId, err);
  }
}

const TICK_MS = 10_000;
const lastTick = new Map<string, number>();

/**
 * Lazy keeper for one race, run from the board's poll (throttled per race and instance): creates
 * the market once the field locks, locks and seals the entropy after the close, and mirrors
 * events. Returns at once while the tote is off.
 */
export async function realToteTick(db: Db, raceId: string, now: Date, deps: RealToteDeps = {}): Promise<void> {
  if (!realToteOn(deps.env ?? process.env)) return;
  const last = lastTick.get(raceId) ?? 0;
  if (now.getTime() - last < TICK_MS) return;
  lastTick.set(raceId, now.getTime());
  if (lastTick.size > 500) lastTick.delete(lastTick.keys().next().value!);
  try {
    const rt = await getRealToteRace(db, raceId);
    if (!rt || ["void", "finalized", "abandoned"].includes(rt.status) || rt.parkedAt) return;
    const { cfg, chain } = setup(deps);
    const k = rt.marketKey as Hex;
    if (rt.status === "pending" && now < rt.betsCloseAt) {
      const p = await realToteMarketParams(db, raceId).catch(() => null);
      if (p) await chain.createMarket({ marketKey: k, asset: cfg.stakeAsset, closeTime: p.closeTime, runnerCount: p.runnerCount, placeTerms: p.placeTerms, seedCommitment: `0x${p.seedCommitment}`, takeoutBps: p.takeoutBps, maxPool: BigInt(p.maxPool) }).catch(() => undefined);
    } else if (rt.status === "open" && now >= rt.marketCloseAt) {
      await chain.lockEntropy(k).catch(() => undefined);
    } else if (rt.status === "entropy_locked") {
      await chain.sealEntropy(k).catch(() => undefined);
    }
    await syncRealToteEvents(db, raceId, now, deps);
  } catch (err) {
    console.error("[real-tote] tick", raceId, err);
  }
}

export interface RealToteBackstopReport {
  skipped?: "off";
  done: Record<string, string[]>;
  errors: { raceId: string; step: string; error: string }[];
  /** Alerts raised this run (also in the audit log as real_tote.alert.<kind>). */
  alerts: { raceId: string; kind: string }[];
}

/**
 * The keeper (cron and lazy calls): creates markets for locked fields, closes flagged races that
 * never opened, locks and seals entropy, cancels markets whose race ran without it (only before
 * the entropy block is picked), posts public results, finalizes attested results after the
 * window, expires markets that can't settle any more, asks the guardian to step in where only it
 * can, and mirrors events. A step that keeps failing backs off and is parked with an alert.
 * Returns at once while the tote is off.
 */
export async function realToteBackstop(db: Db, now: Date, deps: RealToteDeps = {}): Promise<RealToteBackstopReport> {
  if (!realToteOn(deps.env ?? process.env)) return { skipped: "off", done: {}, errors: [], alerts: [] };
  const { cfg, chain } = setup(deps);
  const work = await realToteDueWork(db, now);
  const report: RealToteBackstopReport = { done: {}, errors: [], alerts: [] };
  const step = async (name: string, raceId: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      (report.done[name] ??= []).push(raceId);
      await recordRealToteKeeperOutcome(db, raceId, { ok: true }, now);
    } catch (err) {
      const error = (err as Error).message.slice(0, 200);
      report.errors.push({ raceId, step: name, error });
      if (await recordRealToteKeeperOutcome(db, raceId, { ok: false, step: name, error }, now)) {
        report.alerts.push({ raceId, kind: "keeper_parked" });
        console.error("[real-tote][ALERT] keeper parked a market", raceId, name, error);
      }
    }
  };
  const keyOf = (raceId: string) => toteMarketKey(raceId);
  for (const raceId of work.close) await step("close", raceId, () => closeUnopenedRealToteRace(db, raceId, now));
  for (const raceId of work.create) {
    await step("create", raceId, async () => {
      const p = await realToteMarketParams(db, raceId);
      await chain.createMarket({ marketKey: p.marketKey as Hex, asset: cfg.stakeAsset, closeTime: p.closeTime, runnerCount: p.runnerCount, placeTerms: p.placeTerms, seedCommitment: `0x${p.seedCommitment}`, takeoutBps: p.takeoutBps, maxPool: BigInt(p.maxPool) });
    });
  }
  for (const raceId of work.lock) await step("lock", raceId, () => chain.lockEntropy(keyOf(raceId)));
  for (const raceId of work.seal) await step("seal", raceId, () => chain.sealEntropy(keyOf(raceId)));
  for (const raceId of work.cancel) await step("cancel", raceId, () => chain.cancelMarket(keyOf(raceId)));
  for (const raceId of work.post) {
    await step("post", raceId, async () => {
      // realToteResultFor refuses until the broadcast is over: the chain is public and permanent.
      const r = await realToteResultFor(db, raceId, now);
      await chain.postResult(r.marketKey as Hex, `0x${r.serverSeed}`, r.positions);
    });
  }
  for (const raceId of work.finalize) await step("finalize", raceId, () => chain.finalize(keyOf(raceId)));
  for (const raceId of work.expire) await step("expire", raceId, () => chain.expireMarket(keyOf(raceId)));
  for (const g of work.guardian) {
    if (await raiseRealToteAlert(db, { raceId: g.raceId, kind: g.reason }, now)) {
      report.alerts.push({ raceId: g.raceId, kind: g.reason });
      console.error("[real-tote][ALERT] guardian needed", g.raceId, g.reason);
    }
  }
  const touched = new Set([...Object.values(work).flat().map((x) => (typeof x === "string" ? x : x.raceId))]);
  // Mirroring isn't a keeper step: its success must not reset another step's failure count.
  for (const raceId of touched) {
    try {
      await syncRealToteEvents(db, raceId, now, deps);
      (report.done.sync ??= []).push(raceId);
    } catch (err) {
      report.errors.push({ raceId, step: "sync", error: (err as Error).message.slice(0, 200) });
    }
  }
  return report;
}

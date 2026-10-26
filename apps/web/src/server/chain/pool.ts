/**
 * Prize Pool (closed beta): the public /pool view, a player's allocations with proofs, and
 * the admin epoch flow (compute from league/cup/activity data -> review -> post the root).
 *
 * Rules live in USD (caps, budget) and are converted to wei with the median ETH/USD at
 * computation time; the price used is stored on the epoch and shown in history.
 */
import { getAddress, type Address, type Hex } from "viem";
import {
  DEFAULT_POOL_RULES,
  DomainError,
  allocateUsd,
  allocationsForWallet,
  epochAllocations,
  getEpochRow,
  lastCompletedWeek,
  listPoolEpochs,
  markEpochPosted,
  poolScores,
  saveEpochDraft,
  usdCentsToWei,
  utcWeekStart,
  verifiedWalletOf,
  weekPeriod,
  weiToUsdCents,
  type PoolRules,
  type PoolScoreRow,
} from "@thoroughbred/db";
import { buildPoolEpoch, vestedAmount } from "@/lib/chain/pool";
import type { BetaChain, PoolState } from "./adapter";
import type { CheckoutCtx } from "./checkout";
import type { Session } from "../session";

const DAY_MS = 86_400_000;

async function priceMicros(ctx: CheckoutCtx): Promise<{ micros: number | null; sources: unknown }> {
  try {
    const p = await ctx.price.get();
    return { micros: p.micros, sources: p.sources };
  } catch {
    return { micros: null, sources: null };
  }
}

function budgetWei(st: PoolState, rules: PoolRules): bigint {
  const bps = Math.min(rules.budgetBps, st.maxEpochBps);
  return (st.availableWei * BigInt(bps)) / 10_000n;
}

export interface StandingRow {
  rank: number | null;
  stableName: string | null;
  score: number;
  racePoints: number;
  cupPoints: number;
  activeDays: number;
  eligible: boolean;
  reason: string | null;
  projectedUsdCents: number;
  me: boolean;
}

export async function poolView(ctx: CheckoutCtx, session: Session | null, now: Date) {
  const { db, chain, cfg } = ctx;
  const rules = DEFAULT_POOL_RULES;
  const [st, store, { micros }] = await Promise.all([chain.poolState(), chain.storeState().catch(() => null), priceMicros(ctx)]);
  const weekStart = utcWeekStart(now);
  const period = weekPeriod(weekStart);
  const scores = await poolScores(db, { ...period, rules });
  const budget = budgetWei(st, rules);
  const budgetUsd = micros ? weiToUsdCents(budget, micros) : 0;
  const alloc = new Map(allocateUsd(scores, budgetUsd, rules).map((a) => [a.accountId, a] as const));
  let eligibleRank = 0;
  const standings: StandingRow[] = scores.map((s) => ({
    rank: s.eligible ? ++eligibleRank : null,
    stableName: s.stableName,
    score: s.score,
    racePoints: s.racePoints,
    cupPoints: s.cupPoints,
    activeDays: s.activeDays,
    eligible: s.eligible,
    reason: s.reason,
    projectedUsdCents: alloc.get(s.accountId)?.usdCents ?? 0,
    me: s.accountId === session?.accountId,
  }));
  const history = (await listPoolEpochs(db, { chainId: chain.chainId, poolAddress: chain.pool })).filter((e) => e.status === "posted");
  return {
    enabled: cfg.enabled,
    mock: chain.kind === "mock",
    chainId: chain.chainId,
    pool: chain.pool,
    store: chain.store,
    poolBps: store?.poolBps ?? 1000,
    balanceWei: st.balanceWei.toString(),
    availableWei: st.availableWei.toString(),
    outstandingWei: st.outstandingWei.toString(),
    ethUsdMicros: micros,
    week: { weekStart, endsAtMs: period.to.getTime() },
    budgetWei: budget.toString(),
    rules: {
      budgetBps: Math.min(rules.budgetBps, st.maxEpochBps),
      capUsdCents: rules.capUsdCents,
      minActiveDays: rules.minActiveDays,
      paidRanks: rules.paidRanks,
      vestDays: rules.vestDays,
      claimWindowDays: Math.round(st.claimWindow / 86_400),
      excludePremiumHorses: rules.excludePremiumHorses,
      maxClaimPerEpochWei: st.maxClaimPerEpochWei.toString(),
    },
    standings: standings.slice(0, 50),
    me: standings.find((s) => s.me) ?? null,
    history: history.map((e) => ({
      epochId: e.epochId,
      kind: e.kind,
      weekStart: e.weekStart,
      totalWei: e.totalWei,
      leafCount: e.leafCount,
      ethUsdMicros: e.ethUsdMicros,
      postedAtMs: e.postedAt?.getTime() ?? null,
      txHash: e.txHash,
    })),
    serverNowMs: now.getTime(),
  };
}

export async function myAllocations(ctx: CheckoutCtx, session: Session, now: Date) {
  const { db, chain } = ctx;
  const wallet = await verifiedWalletOf(db, session.accountId);
  if (!wallet) return { wallet: null, allocations: [] };
  const rows = await allocationsForWallet(db, { wallet, chainId: chain.chainId, poolAddress: chain.pool });
  const nowSec = BigInt(Math.floor(now.getTime() / 1000));
  const allocations = [];
  for (const { allocation: a, epoch: e } of rows) {
    const onchain = await chain.claimOf(e.epochId, getAddress(wallet));
    const ep = await chain.epoch(e.epochId);
    const amount = BigInt(a.amountWei);
    const vs = BigInt(Math.floor(e.vestStart.getTime() / 1000));
    const ve = BigInt(Math.floor(e.vestEnd.getTime() / 1000));
    let vested = vestedAmount(amount, vs, ve, nowSec);
    if (onchain.revoked && vested > onchain.cap) vested = onchain.cap;
    const open = !!ep && !ep.closed && Number(nowSec) <= ep.claimDeadline;
    allocations.push({
      epochId: e.epochId,
      weekStart: e.weekStart,
      rank: a.rank,
      usdCents: a.usdCents,
      amountWei: a.amountWei,
      vestStart: vs.toString(),
      vestEnd: ve.toString(),
      proof: a.proof as Hex[],
      claimedWei: onchain.claimed.toString(),
      vestedWei: vested.toString(),
      claimableWei: (open && vested > onchain.claimed ? vested - onchain.claimed : 0n).toString(),
      claimDeadlineMs: ep ? ep.claimDeadline * 1000 : null,
      closed: !ep || ep.closed,
      revoked: onchain.revoked,
    });
  }
  return { wallet, pool: chain.pool, chainId: chain.chainId, allocations };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface ComputeInput {
  kind: "weekly" | "season";
  /** UTC Monday of the scored week (default: the last completed week). */
  weekStart?: string;
  /** Season bonus: the scored period [from, to) (ISO dates). */
  from?: string;
  to?: string;
  /** Override the share of the free pool (season bonus may use more). */
  rules?: Partial<PoolRules>;
  now: Date;
}

export async function computeEpochDraft(ctx: CheckoutCtx, input: ComputeInput) {
  const { db, chain } = ctx;
  const rules: PoolRules = { ...DEFAULT_POOL_RULES, ...(input.rules ?? {}) };
  const weekStart = input.weekStart ?? lastCompletedWeek(input.now);
  const period =
    input.kind === "season" && input.from && input.to ? { from: new Date(`${input.from}T00:00:00.000Z`), to: new Date(`${input.to}T00:00:00.000Z`) } : weekPeriod(weekStart);
  if (!(period.to.getTime() > period.from.getTime())) throw new DomainError("INVALID_INPUT", "bad period");
  if (period.to.getTime() > input.now.getTime() + DAY_MS) throw new DomainError("INVALID_INPUT", "that period hasn't finished yet");
  const price = await ctx.price.get();
  const st = await chain.poolState();
  const epochId = st.lastEpochId + 1;
  const budget = budgetWei(st, rules);
  const budgetUsd = weiToUsdCents(budget, price.micros);
  const scores = await poolScores(db, { ...period, rules });
  const usd = allocateUsd(scores, budgetUsd, rules);
  const vestStart = BigInt(Math.floor(input.now.getTime() / 1000));
  const vestEnd = vestStart + BigInt(rules.vestDays * 86_400);
  const withWei = usd
    .map((a) => {
      let amountWei = usdCentsToWei(a.usdCents, price.micros);
      if (amountWei > st.maxClaimPerEpochWei) amountWei = st.maxClaimPerEpochWei; // on-chain per-account ceiling
      return { ...a, amountWei };
    })
    .filter((a) => a.amountWei > 0n);
  // Never promise more than the budget (rounding is down, but keep the invariant explicit).
  let total = withWei.reduce((s, a) => s + a.amountWei, 0n);
  while (total > budget && withWei.length) {
    const last = withWei.pop()!;
    total -= last.amountWei;
  }
  const tree = withWei.length
    ? buildPoolEpoch(chain.chainId, chain.pool, BigInt(epochId), withWei.map((a) => ({ account: getAddress(a.wallet), amount: a.amountWei, vestStart, vestEnd })))
    : null;
  const byWallet = new Map(tree?.entries.map((e) => [e.account.toLowerCase(), e] as const) ?? []);
  const row = tree
    ? await saveEpochDraft(db, {
        chainId: chain.chainId,
        poolAddress: chain.pool,
        epochId,
        kind: input.kind,
        weekStart: period.from.toISOString().slice(0, 10),
        root: tree.root,
        totalWei: tree.total,
        availableWei: st.availableWei,
        ethUsdMicros: price.micros,
        priceSources: price.sources,
        config: { ...rules, period: { from: period.from.toISOString(), to: period.to.toISOString() }, budgetWei: budget.toString(), budgetUsdCents: budgetUsd },
        vestStart: new Date(Number(vestStart) * 1000),
        vestEnd: new Date(Number(vestEnd) * 1000),
        allocations: withWei.map((a) => {
          const e = byWallet.get(a.wallet.toLowerCase())!;
          return { ...a, leaf: e.leaf, proof: e.proof };
        }),
        now: input.now,
      })
    : null;
  return {
    draftId: row?.id ?? null,
    epochId,
    root: tree?.root ?? null,
    totalWei: (tree?.total ?? 0n).toString(),
    budgetWei: budget.toString(),
    budgetUsdCents: budgetUsd,
    availableWei: st.availableWei.toString(),
    ethUsd: price.usd,
    priceSources: price.sources,
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    allocations: withWei.map((a) => ({ rank: a.rank, stableName: a.stableName, wallet: a.wallet, score: a.score, activeDays: a.activeDays, usdCents: a.usdCents, amountWei: a.amountWei.toString() })),
    scores: scores.slice(0, 100).map((s: PoolScoreRow) => ({ stableName: s.stableName, score: s.score, activeDays: s.activeDays, eligible: s.eligible, reason: s.reason, wallet: s.wallet, flagged: s.flagged })),
    canServerPost: (await chain.storeState().catch(() => null))?.signerCanPost ?? false,
    calldata: tree ? { epochId, root: tree.root, total: tree.total.toString(), leafCount: tree.entries.length, uri: `thoroughbred:epoch:${epochId}` } : null,
  };
}

async function verifyPosted(chain: BetaChain, epochId: number, root: string): Promise<void> {
  const e = await chain.epoch(epochId);
  if (!e) throw new DomainError("NOT_FOUND", `epoch ${epochId} is not on-chain yet`);
  if (e.root.toLowerCase() !== root.toLowerCase()) throw new DomainError("PERMANENT_STATE", `epoch ${epochId} is on-chain with a DIFFERENT root: recompute the draft for the next epoch id`);
}

/** Posts the draft with the server key (POSTER_ROLE + gas) and records it. */
export async function postEpochWithServer(ctx: CheckoutCtx, draftId: string, now: Date) {
  const d = await getEpochRow(ctx.db, draftId);
  if (!d) throw new DomainError("NOT_FOUND", "draft not found");
  if (d.status === "posted") return d;
  const existing = await ctx.chain.epoch(d.epochId);
  let tx: Hex | null = null;
  if (!existing) tx = await ctx.chain.postEpoch({ epochId: d.epochId, root: d.root as Hex, total: BigInt(d.totalWei), leafCount: d.leafCount, uri: `thoroughbred:epoch:${d.epochId}` });
  await verifyPosted(ctx.chain, d.epochId, d.root);
  return markEpochPosted(ctx.db, { id: d.id, txHash: tx, now });
}

/** The owner posted the root from their wallet: check the chain, then record it. */
export async function recordWalletPostedEpoch(ctx: CheckoutCtx, draftId: string, txHash: string, now: Date) {
  const d = await getEpochRow(ctx.db, draftId);
  if (!d) throw new DomainError("NOT_FOUND", "draft not found");
  await verifyPosted(ctx.chain, d.epochId, d.root);
  return markEpochPosted(ctx.db, { id: d.id, txHash: /^0x[0-9a-fA-F]{64}$/.test(txHash) ? txHash : null, now });
}

export async function epochDetail(ctx: CheckoutCtx, draftId: string) {
  const d = await getEpochRow(ctx.db, draftId);
  if (!d) throw new DomainError("NOT_FOUND", "epoch not found");
  return { epoch: d, allocations: await epochAllocations(ctx.db, d.id) };
}

export async function epochHistory(ctx: CheckoutCtx) {
  const rows = await listPoolEpochs(ctx.db, { chainId: ctx.chain.chainId, poolAddress: ctx.chain.pool, limit: 50 });
  return rows.map((e) => ({
    id: e.id,
    epochId: e.epochId,
    kind: e.kind,
    status: e.status,
    weekStart: e.weekStart,
    root: e.root,
    totalWei: e.totalWei,
    leafCount: e.leafCount,
    ethUsdMicros: e.ethUsdMicros,
    txHash: e.txHash,
    postedAtMs: e.postedAt?.getTime() ?? null,
    createdAtMs: e.createdAt.getTime(),
  }));
}

export type { Address };

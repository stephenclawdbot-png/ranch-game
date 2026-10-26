/**
 * Two-level affiliate program (closed beta, docs/web3.md "Affiliates").
 *
 * - Tree: every account gets a personal referral code (an `invite_codes` row of kind
 *   "referral"). Root (admin) codes belong to the OWNER account. An account's inviter is the
 *   owner of the code it signed up with; its upstream is the inviter's inviter. Written once
 *   at signup, never changed: no cycles, max 2 levels.
 * - Money comes ONLY from real purchases: the server puts the eligible referrers' wallets
 *   and bps into the signed ETH quote; PremiumStore pays them from the treasury's share.
 *   Nobody ever needs to buy anything to invite or to earn.
 * - Eligibility when signing (`referralPlan`): referral not revoked, within the commission
 *   window (3 months from the invitee's signup), referrer has a verified wallet different
 *   from the buyer's (and from each other), not linked to the buyer (device, fingerprint,
 *   IP hash or wallet; a hit is flagged as a fraud event), weekly per-inviter USD cap. The
 *   owner is exempt from the weekly cap (separate optional owner cap) and from link checks.
 * - Non-money reward: when an invitee becomes active (>= 5 races and >= 3 play days), the
 *   inviter gets credits through the ledger and a badge, once.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { DomainError } from "../errors";
import { utcWeekStart } from "../crypto";
import {
  accountPlayDays,
  achievements,
  chainOrders,
  economyConfig,
  fraudEvents,
  inviteCodes,
  raceEntries,
  referralEarnings,
  referrals,
  stables,
  testers,
  type ChainOrderRow,
  type ReferralRow,
} from "../schema";
import type { Db, Executor } from "../types";
import { areLinked } from "./accounts";
import { verifiedWalletOf } from "./betaMoney";
import { grantCreditsTx } from "./ledger";
import { normalizeInviteCode } from "./playtest";
import { audit, runTx } from "./tx";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Config and the owner (stored in economy_config)
// ---------------------------------------------------------------------------

export interface AffiliateConfig {
  /** Commission bps signed into quotes (on-chain ceilings: maxRef1Bps / maxRef2Bps; hard caps 1500 / 500). */
  ref1Bps: number;
  ref2Bps: number;
  /** Commissions only for purchases within this many days of the invitee's signup. */
  windowDays: number;
  /** Per-inviter commission cap per UTC week (USD cents), all invitees together. */
  weeklyCapUsdCents: number;
  /** The owner's own weekly cap (null = none). */
  ownerWeeklyCapUsdCents: number | null;
  /** In-game signup reward for the inviter when an invitee becomes active. */
  activeReward: { credits: number; minRaces: number; minPlayDays: number };
}

export const DEFAULT_AFFILIATE_CONFIG: AffiliateConfig = {
  ref1Bps: 1_000,
  ref2Bps: 300,
  windowDays: 90,
  weeklyCapUsdCents: 5_000,
  ownerWeeklyCapUsdCents: null,
  activeReward: { credits: 250, minRaces: 5, minPlayDays: 3 },
};
export const REF1_BPS_CAP = 1_500;
export const REF2_BPS_CAP = 500;

const CONFIG_KEY = "beta.affiliate";
const OWNER_KEY = "beta.owner";

export async function affiliateConfig(ex: Executor): Promise<AffiliateConfig> {
  const [row] = await ex.select().from(economyConfig).where(eq(economyConfig.key, CONFIG_KEY));
  const v = (row?.value ?? {}) as Partial<AffiliateConfig>;
  return { ...DEFAULT_AFFILIATE_CONFIG, ...v, activeReward: { ...DEFAULT_AFFILIATE_CONFIG.activeReward, ...(v.activeReward ?? {}) } };
}

export async function setAffiliateConfig(db: Db, patch: Partial<AffiliateConfig>): Promise<AffiliateConfig> {
  const next = { ...(await affiliateConfig(db)), ...patch };
  if (patch.activeReward) next.activeReward = { ...(await affiliateConfig(db)).activeReward, ...patch.activeReward };
  const okInt = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!okInt(next.ref1Bps, 0, REF1_BPS_CAP) || !okInt(next.ref2Bps, 0, REF2_BPS_CAP)) throw new DomainError("INVALID_INPUT", "commission bps out of range (L1 <= 1500, L2 <= 500)");
  if (!okInt(next.windowDays, 1, 3650) || !okInt(next.weeklyCapUsdCents, 0, 10_000_000)) throw new DomainError("INVALID_INPUT", "bad window or weekly cap");
  if (next.ownerWeeklyCapUsdCents !== null && !okInt(next.ownerWeeklyCapUsdCents, 0, 100_000_000)) throw new DomainError("INVALID_INPUT", "bad owner cap");
  if (!okInt(next.activeReward.credits, 0, 100_000) || !okInt(next.activeReward.minRaces, 0, 1000) || !okInt(next.activeReward.minPlayDays, 0, 365)) throw new DomainError("INVALID_INPUT", "bad activity reward");
  await db
    .insert(economyConfig)
    .values({ key: CONFIG_KEY, value: next, description: "Closed-beta affiliate program (services/affiliates.ts)" })
    .onConflictDoUpdate({ target: economyConfig.key, set: { value: next, updatedAt: new Date() } });
  return next;
}

export async function ownerAccountId(ex: Executor): Promise<string | null> {
  const [row] = await ex.select().from(economyConfig).where(eq(economyConfig.key, OWNER_KEY));
  const v = row?.value as { accountId?: string } | undefined;
  return v?.accountId ?? null;
}

/**
 * Designates the owner account (root of the tree). The admin does this while signed in with
 * their own game account, which must have a SIWE-verified wallet (the owner's affiliate
 * wallet; keep it different from the treasury address).
 */
export async function claimOwner(db: Db, input: { accountId: string; now: Date }): Promise<{ accountId: string; wallet: string }> {
  const wallet = await verifiedWalletOf(db, input.accountId);
  if (!wallet) throw new DomainError("NOT_ELIGIBLE", "Link and verify a wallet on this stable first (it receives the owner's commissions).");
  const value = { accountId: input.accountId, claimedAt: input.now.toISOString() };
  await db
    .insert(economyConfig)
    .values({ key: OWNER_KEY, value, description: "Owner account: root of the affiliate tree" })
    .onConflictDoUpdate({ target: economyConfig.key, set: { value, updatedAt: input.now } });
  await audit(db, { actor: input.accountId, action: "affiliate.claim_owner", entityType: "account", entityId: input.accountId });
  return { accountId: input.accountId, wallet };
}

// ---------------------------------------------------------------------------
// Codes and the tree
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function referralCodeCandidate(): string {
  const b = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[b[i]! % CODE_ALPHABET.length];
  return `R-${out.slice(0, 4)}-${out.slice(4)}`;
}

/** The account's personal referral code (created on first use). */
export async function ensureReferralCode(db: Db, accountId: string): Promise<string> {
  const [mine] = await db.select().from(inviteCodes).where(and(eq(inviteCodes.kind, "referral"), eq(inviteCodes.ownerAccountId, accountId)));
  if (mine) return mine.code;
  for (let i = 0; i < 5; i++) {
    const code = referralCodeCandidate();
    const rows = await db
      .insert(inviteCodes)
      .values({ code, kind: "referral", ownerAccountId: accountId, maxUses: 100_000, note: "personal referral code" })
      .onConflictDoNothing()
      .returning({ code: inviteCodes.code });
    if (rows[0]) return rows[0].code;
    const [again] = await db.select().from(inviteCodes).where(and(eq(inviteCodes.kind, "referral"), eq(inviteCodes.ownerAccountId, accountId)));
    if (again) return again.code;
  }
  throw new Error("could not allocate a referral code");
}

export async function referralOf(ex: Executor, accountId: string): Promise<ReferralRow | null> {
  const [r] = await ex.select().from(referrals).where(eq(referrals.accountId, accountId));
  return r ?? null;
}

/**
 * Records who invited a new account (call right after account creation). Personal code ->
 * its owner; root (admin) code -> the owner account. Self-referral is impossible (a new
 * account has no code yet) and is ignored defensively. Idempotent (first write wins).
 */
export async function recordReferral(db: Db, input: { accountId: string; code: string; now: Date }): Promise<ReferralRow | null> {
  const code = normalizeInviteCode(input.code);
  if (!code) return null;
  const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
  if (!row || row.revokedAt) return null;
  let inviter: string | null = row.kind === "referral" ? row.ownerAccountId : await ownerAccountId(db);
  if (inviter === input.accountId) inviter = null;
  let upstream: string | null = null;
  if (inviter) {
    upstream = (await referralOf(db, inviter))?.inviterAccountId ?? null;
    if (upstream === input.accountId || upstream === inviter) upstream = null;
  }
  await db.insert(referrals).values({ accountId: input.accountId, inviterAccountId: inviter, upstreamAccountId: upstream, viaCode: code, createdAt: input.now }).onConflictDoNothing();
  return referralOf(db, input.accountId);
}

/** Admin: stops future commissions from this invitee (past on-chain payments are final). */
export async function revokeReferral(db: Db, input: { accountId: string; reason: string; now: Date }): Promise<void> {
  const res = await db
    .update(referrals)
    .set({ revokedAt: input.now, revokedReason: input.reason.slice(0, 200) })
    .where(and(eq(referrals.accountId, input.accountId), isNull(referrals.revokedAt)))
    .returning({ id: referrals.accountId });
  if (!res.length) throw new DomainError("NOT_FOUND", "no active referral for that account");
  await audit(db, { actor: null, action: "affiliate.revoke", entityType: "referral", entityId: input.accountId, data: { reason: input.reason } });
}

// ---------------------------------------------------------------------------
// Commission plan for a quote
// ---------------------------------------------------------------------------

export interface ReferrerPlan {
  level: 1 | 2;
  accountId: string;
  wallet: string;
  bps: number;
  usdCents: number;
  owner: boolean;
}

export interface ReferralPlan {
  ref1: ReferrerPlan | null;
  ref2: ReferrerPlan | null;
  /** Why a level got nothing (shown in admin; the share stays with the treasury). */
  dropped: { level: 1 | 2; accountId: string | null; reason: string }[];
}

/** Commission (USD cents) already earned this UTC week + planned in open orders. */
export async function weeklyCommissionUsd(ex: Executor, input: { inviterAccountId: string; now: Date }): Promise<number> {
  const weekStart = new Date(`${utcWeekStart(input.now)}T00:00:00.000Z`);
  const [earned] = await ex
    .select({ c: sql<number>`coalesce(sum(${referralEarnings.usdCents}), 0)::int` })
    .from(referralEarnings)
    .where(and(eq(referralEarnings.inviterAccountId, input.inviterAccountId), gte(referralEarnings.createdAt, weekStart)));
  // Planned: quoted (live) / submitted / paid orders not yet recorded as earnings.
  const [planned] = await ex
    .select({
      c: sql<number>`coalesce(sum(case when ${chainOrders.ref1AccountId} = ${input.inviterAccountId} then ${chainOrders.usdCents} * ${chainOrders.ref1Bps} / 10000 else 0 end + case when ${chainOrders.ref2AccountId} = ${input.inviterAccountId} then ${chainOrders.usdCents} * ${chainOrders.ref2Bps} / 10000 else 0 end), 0)::int`,
    })
    .from(chainOrders)
    .where(
      and(
        gte(chainOrders.createdAt, weekStart),
        sql`(${chainOrders.ref1AccountId} = ${input.inviterAccountId} or ${chainOrders.ref2AccountId} = ${input.inviterAccountId})`,
        sql`(${chainOrders.status} in ('submitted', 'paid') or (${chainOrders.status} = 'quoted' and ${chainOrders.deadline} >= ${input.now}))`,
      ),
    );
  return Number(earned?.c ?? 0) + Number(planned?.c ?? 0);
}

/**
 * Decides which referrers a purchase pays, BEFORE the quote is signed. Ineligible levels are
 * left out (their share stays with the treasury, never the pool). Linked accounts are
 * flagged as fraud events for review.
 */
export async function referralPlan(db: Db, input: { buyerAccountId: string; buyerWallet: string; usdCents: number; now: Date; config?: AffiliateConfig }): Promise<ReferralPlan> {
  const cfg = input.config ?? (await affiliateConfig(db));
  const plan: ReferralPlan = { ref1: null, ref2: null, dropped: [] };
  const ref = await referralOf(db, input.buyerAccountId);
  if (!ref || (!ref.inviterAccountId && !ref.upstreamAccountId)) return plan;
  const owner = await ownerAccountId(db);
  const drop = (level: 1 | 2, accountId: string | null, reason: string) => plan.dropped.push({ level, accountId, reason });
  const levels: [1 | 2, string | null, number][] = [
    [1, ref.inviterAccountId, cfg.ref1Bps],
    [2, ref.upstreamAccountId, cfg.ref2Bps],
  ];
  if (ref.revokedAt) {
    for (const [level, acc] of levels) if (acc) drop(level, acc, "referral revoked");
    return plan;
  }
  if (input.now.getTime() > ref.createdAt.getTime() + cfg.windowDays * DAY_MS) {
    for (const [level, acc] of levels) if (acc) drop(level, acc, `outside the ${cfg.windowDays}-day window`);
    return plan;
  }
  const used = new Set([input.buyerWallet.toLowerCase()]);
  for (const [level, accountId, bps] of levels) {
    if (!accountId) continue;
    if (level === 2 && !plan.ref1) {
      drop(2, accountId, "level 1 not paid");
      continue;
    }
    if (bps <= 0) {
      drop(level, accountId, "commission set to 0");
      continue;
    }
    const isOwner = accountId === owner;
    const wallet = await verifiedWalletOf(db, accountId);
    if (!wallet) {
      drop(level, accountId, "no verified wallet");
      continue;
    }
    if (used.has(wallet.toLowerCase())) {
      drop(level, accountId, "same wallet as the buyer or the other referrer");
      continue;
    }
    if (!isOwner && (await areLinked(db, input.buyerAccountId, accountId))) {
      await db.insert(fraudEvents).values({ accountId: input.buyerAccountId, relatedAccountId: accountId, kind: "referral_linked", severity: 2, data: { level } });
      drop(level, accountId, "linked accounts (flagged for review)");
      continue;
    }
    const usdCents = Math.floor((input.usdCents * bps) / 10_000);
    const cap = isOwner ? cfg.ownerWeeklyCapUsdCents : cfg.weeklyCapUsdCents;
    if (cap !== null && (await weeklyCommissionUsd(db, { inviterAccountId: accountId, now: input.now })) + usdCents > cap) {
      drop(level, accountId, "weekly commission cap reached");
      continue;
    }
    used.add(wallet.toLowerCase());
    const p: ReferrerPlan = { level, accountId, wallet, bps, usdCents, owner: isOwner };
    if (level === 1) plan.ref1 = p;
    else plan.ref2 = p;
  }
  return plan;
}

/** Stores the commissions the chain actually paid (from verified ReferralCommission events). Idempotent. */
export async function recordReferralEarnings(
  db: Db,
  input: { order: ChainOrderRow; txHash: string; commissions: { level: 1 | 2; wallet: string; amountWei: bigint; deferred: boolean }[]; now: Date },
): Promise<void> {
  const o = input.order;
  for (const c of input.commissions) {
    const accountId = c.level === 1 ? o.ref1AccountId : o.ref2AccountId;
    const bps = c.level === 1 ? o.ref1Bps : o.ref2Bps;
    if (!accountId) continue;
    await db
      .insert(referralEarnings)
      .values({
        orderId: o.orderId,
        level: c.level,
        inviterAccountId: accountId,
        inviteeAccountId: o.accountId,
        wallet: c.wallet.toLowerCase(),
        amountWei: c.amountWei.toString(),
        usdCents: Math.floor((o.usdCents * bps) / 10_000),
        deferred: c.deferred,
        txHash: input.txHash.toLowerCase(),
        createdAt: input.now,
      })
      .onConflictDoNothing();
  }
}

// ---------------------------------------------------------------------------
// Activity (non-money signup reward)
// ---------------------------------------------------------------------------

export async function activityOf(ex: Executor, accountIds: string[]): Promise<Map<string, { races: number; playDays: number }>> {
  const out = new Map<string, { races: number; playDays: number }>();
  if (!accountIds.length) return out;
  for (const id of accountIds) out.set(id, { races: 0, playDays: 0 });
  const raceRows = await ex
    .select({ accountId: stables.accountId, n: sql<number>`count(*)::int` })
    .from(raceEntries)
    .innerJoin(stables, eq(stables.id, raceEntries.stableId))
    .where(and(inArray(stables.accountId, accountIds), sql`${raceEntries.finishPosition} is not null`))
    .groupBy(stables.accountId);
  for (const r of raceRows) out.get(r.accountId)!.races = Number(r.n);
  const dayRows = await ex
    .select({ accountId: accountPlayDays.accountId, n: sql<number>`count(*)::int` })
    .from(accountPlayDays)
    .where(inArray(accountPlayDays.accountId, accountIds))
    .groupBy(accountPlayDays.accountId);
  for (const d of dayRows) out.get(d.accountId)!.playDays = Number(d.n);
  return out;
}

/**
 * Grants the inviter's in-game reward (credits through the ledger + the "referrer" badge)
 * for every invitee that became active. Idempotent per invitee. Returns the number granted.
 */
export async function settleReferralActivations(db: Db, input: { now: Date; inviterAccountId?: string; limit?: number }): Promise<number> {
  const cfg = await affiliateConfig(db);
  const pending = await db
    .select()
    .from(referrals)
    .where(
      and(
        isNull(referrals.activatedAt),
        isNull(referrals.revokedAt),
        sql`${referrals.inviterAccountId} is not null`,
        input.inviterAccountId ? eq(referrals.inviterAccountId, input.inviterAccountId) : sql`true`,
      ),
    )
    .limit(input.limit ?? 200);
  if (!pending.length) return 0;
  const act = await activityOf(db, pending.map((p) => p.accountId));
  let granted = 0;
  for (const r of pending) {
    const a = act.get(r.accountId)!;
    if (a.races < cfg.activeReward.minRaces || a.playDays < cfg.activeReward.minPlayDays) continue;
    const ok = await runTx(db, async (tx) => {
      const upd = await tx.update(referrals).set({ activatedAt: input.now }).where(and(eq(referrals.accountId, r.accountId), isNull(referrals.activatedAt))).returning({ id: referrals.accountId });
      if (!upd.length) return false;
      const inviterExists = await tx.select({ id: stables.id }).from(stables).where(eq(stables.accountId, r.inviterAccountId!)).limit(1);
      if (!inviterExists.length) return true; // inviter gone (reset): mark, grant nothing
      if (cfg.activeReward.credits > 0) {
        await grantCreditsTx(tx, { accountId: r.inviterAccountId!, amount: cfg.activeReward.credits, idempotencyKey: `referral:active:${r.accountId}`, kind: "referral_reward", memo: "An invitee became active" });
      }
      await tx.insert(achievements).values({ accountId: r.inviterAccountId!, code: "referrer", data: { firstInvitee: r.accountId }, earnedAt: input.now }).onConflictDoNothing();
      return true;
    });
    if (ok) granted++;
  }
  return granted;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface InviteeView {
  accountId: string;
  stableName: string | null;
  level: 1 | 2;
  joinedAt: Date;
  races: number;
  playDays: number;
  active: boolean;
  activatedAt: Date | null;
  windowEndsAt: Date;
  revoked: boolean;
}

export async function inviteesOf(ex: Executor, accountId: string, cfg: AffiliateConfig): Promise<InviteeView[]> {
  const rows = await ex
    .select()
    .from(referrals)
    .where(sql`${referrals.inviterAccountId} = ${accountId} or ${referrals.upstreamAccountId} = ${accountId}`)
    .orderBy(desc(referrals.createdAt))
    .limit(500);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.accountId);
  const names = new Map((await ex.select({ a: stables.accountId, n: stables.name }).from(stables).where(inArray(stables.accountId, ids))).map((s) => [s.a, s.n] as const));
  const act = await activityOf(ex, ids);
  return rows.map((r) => {
    const a = act.get(r.accountId)!;
    return {
      accountId: r.accountId,
      stableName: names.get(r.accountId) ?? null,
      level: r.inviterAccountId === accountId ? 1 : 2,
      joinedAt: r.createdAt,
      races: a.races,
      playDays: a.playDays,
      active: a.races >= cfg.activeReward.minRaces && a.playDays >= cfg.activeReward.minPlayDays,
      activatedAt: r.activatedAt,
      windowEndsAt: new Date(r.createdAt.getTime() + cfg.windowDays * DAY_MS),
      revoked: !!r.revokedAt,
    };
  });
}

export async function earningsOf(ex: Executor, accountId: string, limit = 100) {
  return ex.select().from(referralEarnings).where(eq(referralEarnings.inviterAccountId, accountId)).orderBy(desc(referralEarnings.createdAt)).limit(limit);
}

export interface AffiliateAdminView {
  ownerAccountId: string | null;
  tree: { accountId: string; stableName: string | null; inviterAccountId: string | null; upstreamAccountId: string | null; viaCode: string; joinedAt: Date; revoked: boolean; activated: boolean }[];
  topInviters: { accountId: string; stableName: string | null; level1: number; level2: number; earnedWei: string; earnedUsdCents: number }[];
  flagged: { accountId: string | null; relatedAccountId: string | null; kind: string; createdAt: Date; data: unknown }[];
  owner: { salesWei: string; orders: number; level1Wei: string; level2Wei: string; treasuryWei: string; poolWei: string; commissionsWei: string };
}

export async function affiliateAdminView(ex: Executor): Promise<AffiliateAdminView> {
  const owner = await ownerAccountId(ex);
  const tree = await ex.select().from(referrals).orderBy(desc(referrals.createdAt)).limit(1000);
  const ids = [...new Set(tree.flatMap((t) => [t.accountId, t.inviterAccountId, t.upstreamAccountId]).filter((x): x is string => !!x))];
  const names = new Map(ids.length ? (await ex.select({ a: stables.accountId, n: stables.name }).from(stables).where(inArray(stables.accountId, ids))).map((s) => [s.a, s.n] as const) : []);
  const testerNames = new Map(ids.length ? (await ex.select({ a: testers.accountId, n: testers.stableName }).from(testers).where(inArray(testers.accountId, ids))).map((s) => [s.a!, s.n] as const) : []);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? testerNames.get(id) ?? null) : null);

  const counts = new Map<string, { l1: number; l2: number }>();
  for (const t of tree) {
    if (t.inviterAccountId) counts.set(t.inviterAccountId, { ...(counts.get(t.inviterAccountId) ?? { l1: 0, l2: 0 }), l1: (counts.get(t.inviterAccountId)?.l1 ?? 0) + 1 });
    if (t.upstreamAccountId) counts.set(t.upstreamAccountId, { ...(counts.get(t.upstreamAccountId) ?? { l1: 0, l2: 0 }), l2: (counts.get(t.upstreamAccountId)?.l2 ?? 0) + 1 });
  }
  const earned = await ex
    .select({ a: referralEarnings.inviterAccountId, wei: sql<string>`sum(${referralEarnings.amountWei})::text`, usd: sql<number>`sum(${referralEarnings.usdCents})::int` })
    .from(referralEarnings)
    .groupBy(referralEarnings.inviterAccountId);
  const earnedOf = new Map(earned.map((e) => [e.a, e] as const));
  const topInviters = [...counts.entries()]
    .map(([accountId, c]) => ({ accountId, stableName: nameOf(accountId), level1: c.l1, level2: c.l2, earnedWei: earnedOf.get(accountId)?.wei ?? "0", earnedUsdCents: Number(earnedOf.get(accountId)?.usd ?? 0) }))
    .sort((a, b) => b.earnedUsdCents - a.earnedUsdCents || b.level1 - a.level1)
    .slice(0, 50);

  const flagged = await ex
    .select({ accountId: fraudEvents.accountId, relatedAccountId: fraudEvents.relatedAccountId, kind: fraudEvents.kind, createdAt: fraudEvents.createdAt, data: fraudEvents.data })
    .from(fraudEvents)
    .where(and(inArray(fraudEvents.kind, ["referral_linked", "account_link"]), isNull(fraudEvents.reviewedAt)))
    .orderBy(desc(fraudEvents.createdAt))
    .limit(100);

  // Whole-tree money: every paid order (the owner is the root of everyone in the tree).
  const [sales] = await ex
    .select({
      salesWei: sql<string>`coalesce(sum(${chainOrders.priceWei}), 0)::text`,
      orders: sql<number>`count(*)::int`,
      treasuryWei: sql<string>`coalesce(sum(${chainOrders.treasuryWei}), 0)::text`,
      poolWei: sql<string>`coalesce(sum(${chainOrders.poolShareWei}), 0)::text`,
    })
    .from(chainOrders)
    .where(inArray(chainOrders.status, ["paid", "fulfilled"]));
  const [comm] = await ex.select({ wei: sql<string>`coalesce(sum(${referralEarnings.amountWei}), 0)::text` }).from(referralEarnings);
  const ownerLevel = async (level: number) =>
    owner
      ? ((
          await ex
            .select({ wei: sql<string>`coalesce(sum(${referralEarnings.amountWei}), 0)::text` })
            .from(referralEarnings)
            .where(and(eq(referralEarnings.inviterAccountId, owner), eq(referralEarnings.level, level)))
        )[0]?.wei ?? "0")
      : "0";
  return {
    ownerAccountId: owner,
    tree: tree.map((t) => ({
      accountId: t.accountId,
      stableName: nameOf(t.accountId),
      inviterAccountId: t.inviterAccountId,
      upstreamAccountId: t.upstreamAccountId,
      viaCode: t.viaCode,
      joinedAt: t.createdAt,
      revoked: !!t.revokedAt,
      activated: !!t.activatedAt,
    })),
    topInviters,
    flagged,
    owner: {
      salesWei: sales?.salesWei ?? "0",
      orders: Number(sales?.orders ?? 0),
      level1Wei: await ownerLevel(1),
      level2Wei: await ownerLevel(2),
      treasuryWei: sales?.treasuryWei ?? "0",
      poolWei: sales?.poolWei ?? "0",
      commissionsWei: comm?.wei ?? "0",
    },
  };
}

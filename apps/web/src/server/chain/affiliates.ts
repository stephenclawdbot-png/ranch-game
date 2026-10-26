/** The /invite page and the Affiliates admin tab (data in packages/db services/affiliates.ts). */
import {
  affiliateAdminView,
  affiliateConfig,
  earningsOf,
  ensureReferralCode,
  inviteesOf,
  ownerAccountId,
  settleReferralActivations,
  verifiedWalletOf,
  type Db,
} from "@thoroughbred/db";
import type { BetaChain } from "./adapter";
import type { Session } from "../session";

export async function inviteView(db: Db, chain: BetaChain, session: Session, input: { origin: string; now: Date }) {
  await settleReferralActivations(db, { now: input.now, inviterAccountId: session.accountId });
  const cfg = await affiliateConfig(db);
  const code = await ensureReferralCode(db, session.accountId);
  const invitees = await inviteesOf(db, session.accountId, cfg);
  const earnings = await earningsOf(db, session.accountId);
  return {
    code,
    link: `${input.origin}/play?invite=${encodeURIComponent(code)}`,
    wallet: await verifiedWalletOf(db, session.accountId),
    isOwner: (await ownerAccountId(db)) === session.accountId,
    chainId: chain.chainId,
    rules: {
      level1Pct: cfg.ref1Bps / 100,
      level2Pct: cfg.ref2Bps / 100,
      windowDays: cfg.windowDays,
      weeklyCapUsdCents: cfg.weeklyCapUsdCents,
      activeReward: cfg.activeReward,
    },
    invitees: invitees.map((i) => ({ ...i, joinedAt: i.joinedAt.getTime(), activatedAt: i.activatedAt?.getTime() ?? null, windowEndsAt: i.windowEndsAt.getTime(), accountId: undefined })),
    earnings: earnings.map((e) => ({ level: e.level, amountWei: e.amountWei, usdCents: e.usdCents, deferred: e.deferred, txHash: e.txHash, createdAtMs: e.createdAt.getTime() })),
    totals: {
      level1: invitees.filter((i) => i.level === 1).length,
      level2: invitees.filter((i) => i.level === 2).length,
      active: invitees.filter((i) => i.active).length,
      earnedWei: earnings.reduce((s, e) => s + BigInt(e.amountWei), 0n).toString(),
      earnedUsdCents: earnings.reduce((s, e) => s + e.usdCents, 0),
    },
  };
}

export async function affiliatesAdmin(db: Db, chain: BetaChain) {
  const view = await affiliateAdminView(db);
  const cfg = await affiliateConfig(db);
  const ownerWallet = view.ownerAccountId ? await verifiedWalletOf(db, view.ownerAccountId) : null;
  const store = await chain.storeState().catch(() => null);
  return {
    ...view,
    config: cfg,
    ownerWallet,
    treasury: store?.treasury ?? null,
    /** Recommend different addresses (treasury income vs. the owner's affiliate earnings). */
    treasuryEqualsOwnerWallet: !!(ownerWallet && store?.treasury && ownerWallet.toLowerCase() === store.treasury.toLowerCase()),
    onchainCeilings: store ? { maxRef1Bps: store.maxRef1Bps, maxRef2Bps: store.maxRef2Bps } : null,
    chainId: chain.chainId,
  };
}

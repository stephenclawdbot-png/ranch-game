/**
 * Affiliate audit: who gets what per sale, the owner's effective take, and whether any wash /
 * self-referral / ring strategy can return more than it costs.
 *
 * Marginal return of $1 of wash buying for a colluding group =
 *   affiliate share captured inside the group
 * + poolBps x (share of pool payouts the group wins) x (share of the pool ever paid out)
 * + leak gain (extra prizes because premium-lineage horses score; from the pool sim).
 * Break-even needs this >= 1. The foal itself has no cash value (credits are never cashed out).
 */
import { AFFILIATE, BETA } from "../lib/constants.ts";
import { type SplitConfig, type Tree, split } from "./money.ts";

export const AFF_CONFIGS: { label: string; c: SplitConfig }[] = [
  { label: "Current: pool 30%, L1 10%, L2 3%, owner earns commissions", c: { poolBps: BETA.poolBps, ref1Bps: AFFILIATE.ref1Bps, ref2Bps: AFFILIATE.ref2Bps, ownerCommission: true } },
  { label: "Single level 10%, owner earns none", c: { poolBps: BETA.poolBps, ref1Bps: 1000, ref2Bps: 0, ownerCommission: false } },
  { label: "Recommended beta: pool 20%, L1 5% (credits-first), no L2", c: { poolBps: 2000, ref1Bps: 500, ref2Bps: 0, ownerCommission: false } },
  { label: "No money affiliates (credits + badge only)", c: { poolBps: 2000, ref1Bps: 0, ref2Bps: 0, ownerCommission: false } },
  { label: "Contract maximum: pool 50%, L1 15%, L2 5%", c: { poolBps: 5000, ref1Bps: 1500, ref2Bps: 500, ownerCommission: true } },
];

export function splitRows(usd: number) {
  const trees: Tree[] = ["none", "owner_direct", "tester_invited", "deep"];
  return AFF_CONFIGS.flatMap(({ label, c }) => trees.map((t) => ({ label, tree: t, ...split(usd, t, c) })));
}

export function ownerTake(c: SplitConfig, mix = { none: 0, owner_direct: 0.7, tester_invited: 0.25, deep: 0.05 }) {
  let owner = 0;
  let tester = 0;
  let pool = 0;
  for (const [t, share] of Object.entries(mix) as [Tree, number][]) {
    const s = split(share, t, c);
    owner += s.ownerTotal;
    tester += s.testerComm;
    pool += s.pool;
  }
  return { owner, tester, pool };
}

export interface WashCase {
  label: string;
  /** Affiliate share per $ of the group's purchases that lands inside the group. */
  affInside: number;
}

export function washCases(c: SplitConfig): WashCase[] {
  const r1 = c.ref1Bps / 10_000;
  const r2 = c.ref2Bps / 10_000;
  return [
    { label: "Solo buyer (no inviter in the group)", affInside: 0 },
    { label: "Self-referral via an undetected alt (alt buys, main is L1)", affInside: r1 },
    { label: "Alt chain main -> alt1 -> alt2 (alt2 buys)", affInside: r1 + r2 },
    { label: "3-friend chain A -> B -> C, all buy equally", affInside: (r1 + r2 + r1) / 3 },
  ];
}

export function marginalReturn(c: SplitConfig, affInside: number, poolCapture: number, paidOutShare: number, leakPerDollar: number): number {
  return affInside + (c.poolBps / 10_000) * poolCapture * paidOutShare + leakPerDollar;
}

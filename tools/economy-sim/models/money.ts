/**
 * Real-money flows: the per-sale split (PremiumStore.purchaseWithEth), gas, and a 12-week
 * revenue/pool model with demand levers (fresh-blood gating, season pass, cosmetics,
 * sponsors, owner top-ups) under purchase-decay curves.
 *
 * The pool payout uses the real rule: budget = budgetBps x (balance - outstanding), split over
 * the top `paidRanks` by linear weights, capped per player, dust < $0.50 dropped; claims at the
 * end of 14-day vesting (90% claim rate), unclaimed returned after the 56-day window.
 */
import { AFFILIATE, BETA, CONTRACT, GAS, POOL_RULES } from "../lib/constants.ts";
import { allocate } from "./pool.ts";

export type Tree = "none" | "owner_direct" | "tester_invited" | "deep";

export interface SplitConfig {
  poolBps: number;
  ref1Bps: number;
  ref2Bps: number;
  ownerCommission: boolean;
}

export const CURRENT_SPLIT: SplitConfig = { poolBps: BETA.poolBps, ref1Bps: AFFILIATE.ref1Bps, ref2Bps: AFFILIATE.ref2Bps, ownerCommission: true };

/** Where one sale's money goes, by the buyer's position in the invite tree. */
export function split(usd: number, tree: Tree, c: SplitConfig) {
  const pool = (usd * c.poolBps) / 10_000;
  const r1 = (usd * c.ref1Bps) / 10_000;
  const r2 = (usd * c.ref2Bps) / 10_000;
  let ownerComm = 0;
  let testerComm = 0;
  if (tree === "owner_direct") ownerComm += c.ownerCommission ? r1 : 0; // L2 = owner's inviter = none
  if (tree === "tester_invited") {
    testerComm += r1;
    ownerComm += c.ownerCommission ? r2 : 0;
  }
  if (tree === "deep") testerComm += r1 + r2;
  const treasury = usd - pool - ownerComm - testerComm;
  return { pool, ownerComm, testerComm, treasury, ownerTotal: treasury + ownerComm };
}

export function gasUsd(ethUsd: number) {
  const l2 = (gas: number) => gas * GAS.gweiL2 * 1e-9 * ethUsd;
  return {
    purchase: l2(GAS.purchaseGas) + GAS.l1DataFeeUsd,
    claim: l2(GAS.claimGas) + GAS.l1DataFeeUsd,
    postEpoch: l2(GAS.postEpochGas) + GAS.l1DataFeeUsd,
    onramp: GAS.onrampUsd,
  };
}

export interface Levers {
  label: string;
  /** Seasonal bloodline drops (weeks 1, 5, 9) reset pack novelty; packs keep breeding value. */
  freshBlood: boolean;
  seasonPass: boolean;
  cosmetics: boolean;
  /** External sponsor money straight into the pool (USD/week from week 3). */
  sponsorPerWeek: number;
  /** Owner marketing top-up into the pool (USD, week 1). */
  ownerTopUp: number;
  /** The pool takes its share of every SKU (current), or of packs only. */
  poolOnAllSkus: boolean;
}

export const LEVER_SETS: Levers[] = [
  { label: "Packs only (current design)", freshBlood: false, seasonPass: false, cosmetics: false, sponsorPerWeek: 0, ownerTopUp: 0, poolOnAllSkus: true },
  { label: "+ fresh-blood season drops", freshBlood: true, seasonPass: false, cosmetics: false, sponsorPerWeek: 0, ownerTopUp: 0, poolOnAllSkus: true },
  { label: "+ season pass", freshBlood: false, seasonPass: true, cosmetics: false, sponsorPerWeek: 0, ownerTopUp: 0, poolOnAllSkus: true },
  { label: "+ cosmetics", freshBlood: false, seasonPass: false, cosmetics: true, sponsorPerWeek: 0, ownerTopUp: 0, poolOnAllSkus: true },
  { label: "All three", freshBlood: true, seasonPass: true, cosmetics: true, sponsorPerWeek: 0, ownerTopUp: 0, poolOnAllSkus: true },
  { label: "All three, pool from packs only + $25/wk sponsor", freshBlood: true, seasonPass: true, cosmetics: true, sponsorPerWeek: 25, ownerTopUp: 0, poolOnAllSkus: false },
];

export interface SeasonAssumptions {
  players: number;
  weeks: number;
  /** Week-1 pack revenue per player (USD), from the tester model. */
  packUsdPerPlayerW1: number;
  seasonPassUsd: number;
  passAdoption: number;
  passLateAdoption: number;
  cosmeticsArpuW1: number;
  /** Share of the previous season drop's peak that the next drop recaptures. */
  dropRecapture: number;
}

export const DEFAULT_SEASON: SeasonAssumptions = {
  players: 50,
  weeks: 12,
  packUsdPerPlayerW1: 6,
  seasonPassUsd: 9.99,
  passAdoption: 0.25,
  passLateAdoption: 0.05,
  cosmeticsArpuW1: 0.4,
  dropRecapture: 0.75,
};

/** Weekly active players: a friends-and-network beta keeps a 35% core. */
export function activeShare(w: number): number {
  return 0.35 + 0.65 * Math.pow(0.8, w - 1);
}

/**
 * Genetic substitution (current design): once bred stock passes the pack ceiling, packs lose
 * their breeding value. game-core's population sim at 50 players: top-1% bred mean potential
 * 614 (season 1), 658 (season 2), 701 (season 3) vs the best Premium foal ~598 (+10/season).
 */
export function geneticValue(w: number, fresh: boolean): number {
  if (fresh) return 0.9;
  return w <= 4 ? 1 : Math.max(0.35, 1 - 0.13 * (w - 4));
}

export interface SeasonWeek {
  week: number;
  active: number;
  packs: number;
  pass: number;
  cosmetics: number;
  revenue: number;
  poolIn: number;
  budget: number;
  paid: number;
  balance: number;
  rank1: number;
  ownerNet: number;
  testerAff: number;
}

export function seasonModel(lev: Levers, decay: number, a: SeasonAssumptions = DEFAULT_SEASON, sc: SplitConfig = CURRENT_SPLIT, tree = { owner_direct: 0.7, tester_invited: 0.25, deep: 0.05 }) {
  const rows: SeasonWeek[] = [];
  let balance = 0;
  const allocs: { week: number; usd: number }[] = [];
  let outstanding = 0;
  const r1 = a.packUsdPerPlayerW1 * a.players;
  for (let w = 1; w <= a.weeks; w++) {
    for (const x of allocs) {
      if (x.week === w - 2) {
        balance -= x.usd * 0.9;
        outstanding -= x.usd * 0.9;
      }
      if (x.week === w - CONTRACT.claimWindowDays / 7) outstanding -= x.usd * 0.1;
    }
    const active = a.players * activeShare(w);
    const seasonIdx = Math.floor((w - 1) / 4);
    const sinceDrop = (w - 1) % 4;
    const novelty = lev.freshBlood ? Math.pow(a.dropRecapture, seasonIdx) * Math.pow(1 - decay, sinceDrop) : Math.pow(1 - decay, w - 1);
    const packs = r1 * novelty * geneticValue(w, lev.freshBlood);
    const pass = lev.seasonPass ? (sinceDrop === 0 ? a.seasonPassUsd * a.passAdoption * active : sinceDrop === 2 ? a.seasonPassUsd * a.passLateAdoption * active : 0) : 0;
    const cosmetics = lev.cosmetics ? a.cosmeticsArpuW1 * active * Math.pow(0.9, sinceDrop) : 0;
    const revenue = packs + pass + cosmetics;
    const poolBase = lev.poolOnAllSkus ? revenue : packs;
    let ownerNet = 0;
    let testerAff = 0;
    for (const [pos, share] of Object.entries(tree) as [Tree, number][]) {
      const s = split(revenue * share, pos, sc);
      ownerNet += s.ownerTotal;
      testerAff += s.testerComm;
    }
    const poolIn = (poolBase * sc.poolBps) / 10_000 + lev.sponsorPerWeek * (w >= 3 ? 1 : 0) + (w === 1 ? lev.ownerTopUp : 0);
    // Pool share taken from non-pool SKUs when the pool is on packs only goes back to the owner.
    if (!lev.poolOnAllSkus) ownerNet += ((revenue - packs) * sc.poolBps) / 10_000;
    ownerNet -= w === 1 ? lev.ownerTopUp : 0;
    balance += poolIn;
    const budget = ((balance - outstanding) * POOL_RULES.budgetBps) / 10_000;
    const fake = Array.from({ length: POOL_RULES.paidRanks }, (_, i) => ({ id: i, score: 100 - i }));
    const out = allocate(fake, budget, POOL_RULES.paidRanks, POOL_RULES.capUsdCents / 100);
    const paid = out.reduce((x, y) => x + y.usd, 0);
    outstanding += paid;
    allocs.push({ week: w, usd: paid });
    rows.push({ week: w, active, packs, pass, cosmetics, revenue, poolIn, budget, paid, balance, rank1: out[0]?.usd ?? 0, ownerNet, testerAff });
  }
  const sum = (k: keyof SeasonWeek) => rows.reduce((x, r) => x + (r[k] as number), 0);
  return {
    lev,
    decay,
    rows,
    revenue: sum("revenue"),
    packs: sum("packs"),
    pass: sum("pass"),
    cosmetics: sum("cosmetics"),
    poolIn: sum("poolIn"),
    paid: sum("paid"),
    endBalance: rows[rows.length - 1]!.balance,
    ownerNet: sum("ownerNet"),
    testerAff: sum("testerAff"),
    lastWeekRevenue: rows[rows.length - 1]!.revenue,
    lastWeekPrizePerActive: rows[rows.length - 1]!.paid / rows[rows.length - 1]!.active,
  };
}

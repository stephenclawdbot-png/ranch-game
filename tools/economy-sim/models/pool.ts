/**
 * Agent-based Prize Pool simulation: heterogeneous testers play, score and buy; the pool fills
 * from sales and pays weekly epochs with the REAL allocation rule (mirror of betaMoney.ts
 * poolScores + allocateUsd and the PrizePool contract limits).
 *
 * Scoring (as implemented): weekly race points = sum over Live runs of
 * START_POINT + RACE_POINTS[pos-1] (+ tier bonus), capped at WEEKLY_RACE_POINTS_CAP, plus
 * uncapped Daily Cup points (max(1, 50 - floor(percentile / 20)) + 10 for beating the house
 * field). Eligible: >= 3 active days, verified wallet, no open linked-account flag. Runs by
 * horses pulled from Premium Packs don't score; their OFFSPRING and anything bought with the
 * credits they sell for DO (the "leak" switch).
 *
 * Live classes are rating-windowed, so a stronger horse mostly moves up a class rather than
 * scoring more; `phi` is the share of an ability edge that still reaches Live points (soft
 * races, quick dashes, tier bonuses). The Daily Cup is one fixed field for everyone, so ability
 * counts fully there.
 */
import { AFFILIATE, BETA, CONTRACT, GAME, POOL_RULES } from "../lib/constants.ts";
import { drawPosition, sigma, winProbability } from "../lib/race.ts";
import { SimRng, gini, mean, rSquared, spearman } from "../lib/rng.ts";
import { type ArchKey, type Tester, makeTesters, packsBought, type PopulationOptions } from "./testers.ts";

export interface PoolSimConfig {
  weeks: number;
  seeds: number;
  decay: number;
  poolBps: number;
  budgetBps: number;
  capUsd: number;
  paidRanks: number;
  ref1Bps: number;
  ref2Bps: number;
  /** Owner earns commissions as an inviter (current: yes). */
  ownerCommission: boolean;
  packUsd: number;
  demandScale: number;
  /** Premium lineage / laundered purchases can score (current rules: true). */
  leak: boolean;
  /** current = capped volume + every Cup day; bestN = best 15 runs + best 5 Cup days;
   * rate = points per run x 15 (full weight from 8 runs) + mean of the best 3 Cup days x 5. */
  scoring: "current" | "bestN" | "rate";
  phi: number;
  claimRate: number;
  /** Live starts per week by archetype and beta week (from the credits model); last value repeats. */
  liveStarts: Record<ArchKey, number[]>;
  /** One human running k accounts of this archetype (k = 1: no sybil). */
  sybil?: { accounts: number; arch: ArchKey; detectPerWeek: number };
  /** External money into the pool per week (owner top-ups, sponsors), USD. */
  topUps?: number[];
  population?: PopulationOptions;
  /** Whales release unwanted foals to the Club (free, instant), so stalls stop limiting pulls. */
  releaseFoals: boolean;
}

/** Premium Packs a tester can host per week: each foal needs a free stall at quote time
 * (credits model: ~2 free stalls at start, then stalls bought with credits). */
export function stallCap(t: Tester, w: number, release: boolean): number {
  if (release && t.segment === "whale") return BETA.maxQtyPerQuote;
  if (t.segment === "whale") return w === 1 ? 5 : 3;
  if (t.segment === "dolphin") return w === 1 ? 3 : 2;
  return 2;
}

export interface WeekLog {
  week: number;
  revenue: number;
  inflow: number;
  budget: number;
  allocated: number;
  balanceEnd: number;
  eligible: number;
  rank1: number;
}

interface Alloc {
  week: number;
  tester: number;
  usd: number;
}

export interface PoolRun {
  testers: Tester[];
  won: number[];
  spend: number[];
  weeks: WeekLog[];
  /** Score by tester by week (for persistence). */
  scores: number[][];
  noiseShare: number;
  affiliateToTesters: number;
  affiliateToOwner: number;
  treasury: number;
  gasUsd: number;
  claimed: number;
  sybilHumanWon: number;
  sybilBase: number | null;
  /** Per tester-week: score, Live runs, active days, ability, skill (for the variance decomposition). */
  obs: { score: number; live: number; days: number; ability: number; skill: number }[];
}

function applyLeak(t: Tester, week: number, leak: boolean): number {
  if (!leak || t.premiumPulled === 0) return 0;
  const intensity = Math.min(1, t.premiumPulled / 20);
  // From week 3: sell premium foals for credits (7-day / 20-race seller rule), buy the best scoring horses.
  // From week 6: offspring of premium horses reach racing age (19 care days + 24 h + 19 care days).
  return (week >= 3 ? 15 : 0) * intensity + (week >= 6 ? 45 : 0) * intensity;
}

/** Mirror of betaMoney.allocateUsd (USD instead of cents). */
export function allocate(eligibleScores: { id: number; score: number }[], budget: number, paidRanks: number, cap: number, dust = POOL_RULES.minPayoutUsdCents / 100): { id: number; usd: number }[] {
  const paid = eligibleScores.slice(0, paidRanks);
  const n = paid.length;
  if (!n || budget <= 0) return [];
  const tw = (n * (n + 1)) / 2;
  const out: { id: number; usd: number }[] = [];
  paid.forEach((s, i) => {
    const share = Math.min(cap, Math.floor(((budget * (n - i)) / tw) * 100) / 100);
    if (share >= dust) out.push({ id: s.id, usd: share });
  });
  return out;
}

function weekScore(rng: SimRng, t: Tester, cfg: PoolSimConfig, week: number, ability: number, actives: boolean[], live: number, noiseOnly = false): { race: number; runs: number } {
  const edge = t.skill + cfg.phi * (ability - 425);
  const pts: number[] = [];
  for (let i = 0; i < live; i++) {
    const pos = drawPosition(rng, edge, 10);
    pts.push(GAME.startPoint + (GAME.racePoints[pos - 1] ?? 0));
  }
  void noiseOnly;
  void week;
  void actives;
  if (cfg.scoring === "bestN") {
    pts.sort((a, b) => b - a);
    return { race: pts.slice(0, 15).reduce((a, b) => a + b, 0), runs: live };
  }
  if (cfg.scoring === "rate") {
    if (!pts.length) return { race: 0, runs: 0 };
    const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
    return { race: avg * 15 * Math.min(1, pts.length / 8), runs: live };
  }
  return { race: Math.min(GAME.weeklyRacePointsCap, pts.reduce((a, b) => a + b, 0)), runs: live };
}

function cupPoints(perfs: { id: number; perf: number }[], beatHouse: Set<number>, mode: PoolSimConfig["scoring"]): Map<number, number> {
  const sorted = [...perfs].sort((a, b) => b.perf - a.perf);
  const n = sorted.length;
  const out = new Map<number, number>();
  sorted.forEach((e, i) => {
    const percentile = n <= 1 ? 0 : Math.floor((i * 1000) / (n - 1));
    const pts = Math.max(1, 50 - Math.floor(percentile / 20)) + (beatHouse.has(e.id) ? 10 : 0);
    out.set(e.id, pts);
  });
  void mode;
  return out;
}

export function runPool(cfg: PoolSimConfig, seed: string): PoolRun {
  const rng = new SimRng(`pool|${seed}`);
  const testers = makeTesters(rng, seed, cfg.population);
  let sybilIds: number[] = [];
  if (cfg.sybil) {
    // The human behind the first tester of the sybil archetype adds k - 1 extra accounts.
    const base = testers.find((t) => t.arch === cfg.sybil!.arch) ?? testers[0]!;
    sybilIds = [base.id];
    for (let k = 1; k < cfg.sybil.accounts; k++) {
      const id = testers.length;
      testers.push({ ...base, id, segment: "none", wallet: true, premiumPulled: 0, starterAbility: base.starterAbility - 5 + 10 * rng.float(), ownerHuman: base.id });
      sybilIds.push(id);
    }
  }
  const n = testers.length;
  const won = new Array<number>(n).fill(0);
  const spend = new Array<number>(n).fill(0);
  const flagged = new Array<boolean>(n).fill(false);
  const scores: number[][] = testers.map(() => []);
  const weeks: WeekLog[] = [];
  let balance = 0;
  let outstanding = 0;
  let claimed = 0;
  const allocs: Alloc[] = [];
  let affT = 0;
  let affO = 0;
  let treasury = 0;
  let gas = 0;
  let noiseNum = 0;
  let noiseDen: number[] = [];
  const obs: PoolRun["obs"] = [];
  const gasPerTx = 0.01;

  for (let w = 1; w <= cfg.weeks; w++) {
    // Claims of epochs that finished vesting (2 epochs back), unclaimed returns after 8 weeks.
    for (const a of allocs) {
      if (a.week === w - 2) {
        const c = a.usd * cfg.claimRate;
        balance -= c;
        claimed += c;
        outstanding -= c;
        gas += gasPerTx;
      }
      if (a.week === w - CONTRACT.claimWindowDays / 7) outstanding -= a.usd * (1 - cfg.claimRate);
    }
    // Purchases.
    let revenue = 0;
    for (const t of testers) {
      if (sybilIds.includes(t.id) && t.id !== sybilIds[0]) continue;
      const q = Math.min(stallCap(t, w, cfg.releaseFoals), packsBought(rng, t, w, cfg.decay, cfg.demandScale));
      if (!q) continue;
      const usd = q * cfg.packUsd;
      revenue += usd;
      spend[t.id]! += usd;
      gas += gasPerTx;
      const toPool = (usd * cfg.poolBps) / 10_000;
      const l1 = t.tree === "owner_direct" ? (cfg.ownerCommission ? (usd * cfg.ref1Bps) / 10_000 : 0) : t.tree === "tester_invited" || t.tree === "deep" ? (usd * cfg.ref1Bps) / 10_000 : 0;
      const l2 = t.tree === "tester_invited" ? (cfg.ownerCommission ? (usd * cfg.ref2Bps) / 10_000 : 0) : t.tree === "deep" ? (usd * cfg.ref2Bps) / 10_000 : 0;
      if (t.tree === "owner_direct") affO += l1;
      else affT += l1;
      if (t.tree === "tester_invited") affO += l2;
      else affT += l2;
      treasury += usd - toPool - l1 - l2;
      balance += toPool;
    }
    const inflow = (revenue * cfg.poolBps) / 10_000 + (cfg.topUps?.[w - 1] ?? 0);
    balance += cfg.topUps?.[w - 1] ?? 0;

    // Play.
    const abil = testers.map((t) => t.starterAbility + t.growth * (w - 1) + applyLeak(t, w, cfg.leak));
    const active: boolean[][] = testers.map((t) => Array.from({ length: 7 }, () => rng.chance(t.pPlay)));
    const activeDays = active.map((a) => a.filter(Boolean).length);
    const liveFor = (t: Tester, i: number) => {
      const arr = cfg.liveStarts[t.arch];
      const m = arr[Math.min(arr.length - 1, w - 1)]!;
      return rng.poisson((m * activeDays[i]!) / Math.max(1, 7 * t.pPlay));
    };
    const race = testers.map((t, i) => {
      const live = liveFor(t, i);
      const a = weekScore(rng, t, cfg, w, abil[i]!, active[i]!, live);
      // Same activity, fresh noise: the within-pair variance estimates the share of luck.
      const b = weekScore(rng, t, cfg, w, abil[i]!, active[i]!, live);
      return { a, b };
    });
    const cupA = new Array<number>(n).fill(0);
    const cupB = new Array<number>(n).fill(0);
    const s = sigma();
    const cupDays: { a: number[]; b: number[] }[] = testers.map(() => ({ a: [], b: [] }));
    for (let d = 0; d < 7; d++) {
      const entrants = testers.filter((t, i) => active[i]![d] && rng.chance(t.cupRate));
      for (const pass of ["a", "b"] as const) {
        const perfs = entrants.map((t) => ({ id: t.id, perf: abil[t.id]! + s * rng.normal() }));
        const beat = new Set(entrants.filter((t) => rng.chance(winProbability(Math.round(abil[t.id]! - 470), GAME.cupFieldSize + 1))).map((t) => t.id));
        const pts = cupPoints(perfs, beat, cfg.scoring);
        for (const [id, p] of pts) cupDays[id]![pass].push(p);
      }
    }
    for (let i = 0; i < n; i++) {
      const take = (xs: number[]) => {
        if (cfg.scoring === "rate") {
          const top = [...xs].sort((x, y) => y - x).slice(0, 3);
          return top.length < 3 ? 0 : (top.reduce((x, y) => x + y, 0) / 3) * 5;
        }
        return (cfg.scoring === "bestN" ? [...xs].sort((x, y) => y - x).slice(0, 5) : xs).reduce((x, y) => x + y, 0);
      };
      cupA[i] = take(cupDays[i]!.a);
      cupB[i] = take(cupDays[i]!.b);
    }
    const total = testers.map((_, i) => race[i]!.a.race + cupA[i]!);
    const totalB = testers.map((_, i) => race[i]!.b.race + cupB[i]!);
    for (let i = 0; i < n; i++) {
      noiseNum += ((total[i]! - totalB[i]!) * (total[i]! - totalB[i]!)) / 2;
      scores[i]!.push(total[i]!);
      obs.push({ score: total[i]!, live: race[i]!.a.runs, days: activeDays[i]!, ability: abil[i]!, skill: testers[i]!.skill });
    }
    noiseDen = noiseDen.concat(total);

    // Sybil detection (linked-account flags): once flagged, held back for review.
    if (cfg.sybil) for (const id of sybilIds.slice(1)) if (!flagged[id] && rng.chance(cfg.sybil.detectPerWeek)) flagged[id] = true;

    const eligible = testers
      .map((t, i) => ({ id: t.id, score: total[i]!, ok: total[i]! > 0 && activeDays[i]! >= POOL_RULES.minActiveDays && t.wallet && !flagged[i], tie: rng.float() }))
      .filter((x) => x.ok)
      .sort((a, b) => b.score - a.score || a.tie - b.tie);
    const available = balance - outstanding;
    const budget = (available * Math.min(cfg.budgetBps, CONTRACT.maxEpochBpsDefault)) / 10_000;
    const out = allocate(eligible, budget, cfg.paidRanks, cfg.capUsd);
    let allocated = 0;
    for (const a of out) {
      won[a.id]! += a.usd;
      allocated += a.usd;
      allocs.push({ week: w, tester: a.id, usd: a.usd });
    }
    outstanding += allocated;
    if (allocated > 0) gas += 0.02;
    weeks.push({ week: w, revenue, inflow, budget, allocated, balanceEnd: balance, eligible: eligible.length, rank1: out[0]?.usd ?? 0 });
  }
  const m = mean(noiseDen);
  const totVar = noiseDen.reduce((x, v) => x + (v - m) * (v - m), 0) / Math.max(1, noiseDen.length - 1);
  const noiseShare = totVar > 0 ? noiseNum / noiseDen.length / totVar : 0;
  const sybilHumanWon = sybilIds.reduce((x, id) => x + won[id]!, 0);
  return { testers, won, spend, weeks, scores, noiseShare, affiliateToTesters: affT, affiliateToOwner: affO, treasury, gasUsd: gas, claimed, sybilHumanWon, sybilBase: sybilIds[0] ?? null, obs };
}

export interface PoolSummary {
  cfg: PoolSimConfig;
  runs: PoolRun[];
  revenue: number;
  inflow: number;
  allocated: number;
  claimed: number;
  endBalance: number;
  strandedShare: number;
  /** Share of the inflow never allocated to anyone by the end. */
  unallocatedShare: number;
  affiliateToTesters: number;
  affiliateToOwner: number;
  treasury: number;
  ownerTotal: number;
  gasUsd: number;
  noiseShare: number;
  r2Activity: number;
  r2ActivityAbility: number;
  spendWinCorrWithinArch: number;
  persistence: number;
  spendWinCorr: number;
  distinctWinners: number;
  top3Share: number;
  giniWon: number;
  byArch: Record<string, { n: number; wonPerWeek: number; pPaidOnce: number; spend: number; net: number }>;
  bySegment: Record<string, { n: number; popShare: number; prizeShare: number; spend: number; won: number }>;
  weeks: WeekLog[];
  sybilHumanWon: number;
  honestRefWon: number;
}

export function summarisePool(cfg: PoolSimConfig): PoolSummary {
  const runs = Array.from({ length: cfg.seeds }, (_, i) => runPool(cfg, `s${i}`));
  const m = (f: (r: PoolRun) => number) => mean(runs.map(f));
  const revenue = m((r) => r.weeks.reduce((a, w) => a + w.revenue, 0));
  const inflow = m((r) => r.weeks.reduce((a, w) => a + w.inflow, 0));
  const allocated = m((r) => r.weeks.reduce((a, w) => a + w.allocated, 0));
  const endBalance = m((r) => r.weeks[r.weeks.length - 1]!.balanceEnd);
  const byArch: PoolSummary["byArch"] = {};
  const bySegment: PoolSummary["bySegment"] = {};
  const archs = [...new Set(runs[0]!.testers.map((t) => t.arch))];
  for (const a of archs) {
    const rows = runs.flatMap((r) => r.testers.map((t, i) => ({ t, won: r.won[i]!, spend: r.spend[i]!, paidWeeks: 0 })).filter((x) => x.t.arch === a && x.t.ownerHuman === x.t.id));
    byArch[a] = { n: rows.length / runs.length, wonPerWeek: mean(rows.map((x) => x.won)) / cfg.weeks, pPaidOnce: 0, spend: mean(rows.map((x) => x.spend)), net: mean(rows.map((x) => x.won - x.spend)) };
  }
  // Share of testers of the archetype paid at least once over the period.
  for (const a of archs) {
    const flags = runs.flatMap((r) => r.testers.map((t, i) => ({ t, w: r.won[i]! })).filter((x) => x.t.arch === a && x.t.ownerHuman === x.t.id));
    byArch[a]!.pPaidOnce = mean(flags.map((x) => (x.w > 0 ? 1 : 0)));
  }
  const segs = ["none", "minnow", "dolphin", "whale"];
  for (const sname of segs) {
    const rows = runs.flatMap((r) => r.testers.map((t, i) => ({ t, won: r.won[i]!, spend: r.spend[i]! })).filter((x) => x.t.segment === sname && x.t.ownerHuman === x.t.id));
    const totalWon = runs.reduce((a, r) => a + r.won.reduce((x, y) => x + y, 0), 0);
    const nAll = runs.reduce((a, r) => a + r.testers.length, 0);
    bySegment[sname] = { n: rows.length / runs.length, popShare: rows.length / nAll, prizeShare: totalWon > 0 ? rows.reduce((a, x) => a + x.won, 0) / totalWon : 0, spend: mean(rows.map((x) => x.spend)), won: mean(rows.map((x) => x.won)) };
  }
  const persistence = mean(runs.map((r) => (r.scores[0]!.length >= 2 ? spearman(r.scores.map((s) => s[0]!), r.scores.map((s) => s[1]!)) : 0)));
  const spendWinCorr = mean(runs.map((r) => spearman(r.spend, r.won)));
  const distinctWinners = m((r) => r.won.filter((x) => x > 0).length);
  const top3Share = m((r) => {
    const s = [...r.won].sort((a, b) => b - a);
    const t = s.reduce((a, b) => a + b, 0);
    return t > 0 ? (s[0]! + s[1]! + s[2]!) / t : 0;
  });
  const giniWon = m((r) => gini(r.won));
  const weeks = runs[0]!.weeks.map((_, wi) => {
    const pick = (k: keyof WeekLog) => mean(runs.map((r) => r.weeks[wi]![k] as number));
    return { week: wi + 1, revenue: pick("revenue"), inflow: pick("inflow"), budget: pick("budget"), allocated: pick("allocated"), balanceEnd: pick("balanceEnd"), eligible: pick("eligible"), rank1: pick("rank1") };
  });
  const affT = m((r) => r.affiliateToTesters);
  const affO = m((r) => r.affiliateToOwner);
  const treasury = m((r) => r.treasury);
  const honestRef = cfg.sybil
    ? mean(runs.flatMap((r) => r.testers.map((t, i) => ({ t, w: r.won[i]! })).filter((x) => x.t.arch === cfg.sybil!.arch && x.t.ownerHuman === x.t.id && x.t.id !== r.sybilBase).map((x) => x.w)))
    : 0;
  return {
    cfg,
    runs,
    revenue,
    inflow,
    allocated,
    claimed: m((r) => r.claimed),
    endBalance,
    strandedShare: inflow > 0 ? endBalance / inflow : 0,
    unallocatedShare: inflow > 0 ? (inflow - allocated) / inflow : 0,
    affiliateToTesters: affT,
    affiliateToOwner: affO,
    treasury,
    ownerTotal: treasury + affO,
    gasUsd: m((r) => r.gasUsd),
    noiseShare: mean(runs.map((r) => r.noiseShare)),
    r2Activity: mean(runs.map((r) => rSquared(r.obs.map((o) => o.score), [r.obs.map((o) => o.live), r.obs.map((o) => o.days)]))),
    r2ActivityAbility: mean(runs.map((r) => rSquared(r.obs.map((o) => o.score), [r.obs.map((o) => o.live), r.obs.map((o) => o.days), r.obs.map((o) => o.ability), r.obs.map((o) => o.skill)]))),
    spendWinCorrWithinArch: mean(
      runs.flatMap((r) =>
        [...new Set(r.testers.map((t) => t.arch))].map((a) => {
          const idx = r.testers.map((t, i) => (t.arch === a && t.ownerHuman === t.id ? i : -1)).filter((i) => i >= 0);
          const sp = idx.map((i) => r.spend[i]!);
          const wn = idx.map((i) => r.won[i]!);
          return sp.some((x) => x > 0) && wn.some((x) => x > 0) ? spearman(sp, wn) : 0;
        }),
      ),
    ),
    persistence,
    spendWinCorr,
    distinctWinners,
    top3Share,
    giniWon,
    byArch,
    bySegment,
    weeks,
    sybilHumanWon: m((r) => r.sybilHumanWon),
    honestRefWon: honestRef,
  };
}

export function defaultPoolConfig(liveStarts: Record<ArchKey, number[]>, over: Partial<PoolSimConfig> = {}): PoolSimConfig {
  return {
    weeks: 2,
    seeds: 200,
    decay: 0.45,
    poolBps: BETA.poolBps,
    budgetBps: POOL_RULES.budgetBps,
    capUsd: POOL_RULES.capUsdCents / 100,
    paidRanks: POOL_RULES.paidRanks,
    ref1Bps: AFFILIATE.ref1Bps,
    ref2Bps: AFFILIATE.ref2Bps,
    ownerCommission: true,
    packUsd: BETA.premiumUsdCents / 100,
    demandScale: 1,
    leak: true,
    scoring: "current",
    phi: 0.5,
    claimRate: 0.9,
    releaseFoals: false,
    liveStarts,
    ...over,
  };
}

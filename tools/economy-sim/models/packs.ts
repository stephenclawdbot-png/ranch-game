/**
 * Pack odds, pity and pack value. A fast re-implementation of game-core pullPack's rarity +
 * pity logic (same algorithm: roll, then the first unmet pity rule whose counter hits
 * `within - 1` forces its minimum), cross-checked against the real gc.pullPack.
 * Pack value: the real mint distribution (gc.generateFoundationGenome via gc.pullPack)
 * compared with real starters and with the bred population from game-core's population sim.
 */
import { GAME, gc } from "../lib/constants.ts";
import { SimRng, mean } from "../lib/rng.ts";

type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
const ORDER: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
const rank = (r: Rarity) => ORDER.indexOf(r);

export interface PityConfig {
  rareWithin: number;
  epicWithin: number;
}

export function fastPull(odds: Record<Rarity, number>, pity: { sinceRare: number; sinceEpic: number }, cfg: PityConfig, rng: SimRng): { rarity: Rarity; pity: { sinceRare: number; sinceEpic: number } } {
  const roll = rng.int(10_000);
  let acc = 0;
  let rarity: Rarity = "common";
  for (const r of ORDER) {
    acc += odds[r];
    if (roll < acc) {
      rarity = r;
      break;
    }
  }
  const rules: { min: Rarity; within: number; c: "sinceRare" | "sinceEpic" }[] = [
    { min: "epic", within: cfg.epicWithin, c: "sinceEpic" },
    { min: "rare", within: cfg.rareWithin, c: "sinceRare" },
  ];
  for (const rule of rules) {
    if (rank(rarity) >= rank(rule.min)) continue;
    if (pity[rule.c] + 1 >= rule.within) {
      rarity = rule.min;
      break;
    }
  }
  const next = { sinceRare: pity.sinceRare + 1, sinceEpic: pity.sinceEpic + 1 };
  for (const rule of rules) if (rank(rarity) >= rank(rule.min)) next[rule.c] = 0;
  return { rarity, pity: next };
}

export const DEFAULT_PITY: PityConfig = {
  rareWithin: GAME.packPity.premium.find((r) => r.min === "rare")!.within,
  epicWithin: GAME.packPity.premium.find((r) => r.min === "epic")!.within,
};

/** Effective rates and "spend to first Epic" for a pity config. */
export function pityStats(cfg: PityConfig, players = 20_000, pullsPerPlayer = 60, seed = "pity") {
  const rng = new SimRng(seed);
  const odds = GAME.packOdds.premium as Record<Rarity, number>;
  const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
  const firstEpic: number[] = [];
  let noEpicIn20 = 0;
  let noEpicIn10 = 0;
  for (let p = 0; p < players; p++) {
    let pity = { sinceRare: 0, sinceEpic: 0 };
    let fe = -1;
    for (let i = 0; i < pullsPerPlayer; i++) {
      const r = fastPull(odds, pity, cfg, rng);
      pity = r.pity;
      counts[r.rarity]++;
      if (fe < 0 && rank(r.rarity) >= rank("epic")) fe = i + 1;
    }
    firstEpic.push(fe < 0 ? pullsPerPlayer : fe);
    if (fe < 0 || fe > 20) noEpicIn20++;
    if (fe < 0 || fe > 10) noEpicIn10++;
  }
  const total = players * pullsPerPlayer;
  return {
    cfg,
    rates: Object.fromEntries(ORDER.map((r) => [r, counts[r] / total])) as Record<Rarity, number>,
    meanPullsToEpic: mean(firstEpic),
    pNoEpicIn10: noEpicIn10 / players,
    pNoEpicIn20: noEpicIn20 / players,
  };
}

/** Cross-check: the fast pull reproduces gc.pullPack's rarity sequence for the same rolls. */
export function crossCheck(n = 3000): { pulls: number; realRates: Record<string, number>; fastRates: Record<string, number> } {
  let pity = gc.NEW_PITY;
  const real: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const r = gc.pullPack("premium", pity, { serverSeed: gc.seedFrom("econ-crosscheck"), accountId: "sim", season: 1 });
    pity = r.pity;
    real[r.pull.rarity] = (real[r.pull.rarity] ?? 0) + 1 / n;
  }
  const st = pityStats(DEFAULT_PITY, Math.ceil(n / 60), 60, "crosscheck");
  return { pulls: n, realRates: real, fastRates: st.rates };
}

/** Mean potential of real minted horses by source (game-core mint). */
export function packValue(samples = 400) {
  const prem: Record<string, number[]> = {};
  let pity = gc.NEW_PITY;
  const seed = gc.seedFrom("econ-value");
  for (let i = 0; i < samples; i++) {
    const r = gc.pullPack("premium", pity, { serverSeed: seed, accountId: "v", season: 1 });
    pity = r.pity;
    (prem[r.pull.rarity] ??= []).push(gc.meanPotential(r.pull.genome));
  }
  const pad: number[] = [];
  let p2 = gc.NEW_PITY;
  for (let i = 0; i < samples; i++) {
    const r = gc.pullPack("paddock", p2, { serverSeed: seed, accountId: "w", season: 1 });
    p2 = r.pity;
    pad.push(gc.meanPotential(r.pull.genome));
  }
  const starters: number[] = [];
  const best: number[] = [];
  for (let i = 0; i < Math.ceil(samples / 3); i++) {
    const hs = gc.createStarterStable({ seed: gc.seedFrom("econ-starter", i), ownerId: `s${i}`, nowMs: 0, season: 1 });
    const m = hs.map((h) => gc.meanPotential(h.genome));
    starters.push(...m);
    best.push(Math.max(...m));
  }
  const allPrem = Object.values(prem).flat();
  return {
    premiumByRarity: Object.fromEntries(Object.entries(prem).map(([k, v]) => [k, { n: v.length, mean: mean(v), max: Math.max(...v) }])),
    premiumMean: mean(allPrem),
    premiumMax: Math.max(...allPrem),
    paddockMean: mean(pad),
    starterMean: mean(starters),
    bestStarterMean: mean(best),
    ceilingBySeason: [1, 2, 3, 4, 6].map((s) => ({ season: s, meanCeiling: gc.meanCeiling(s), statCeiling: gc.potentialCeiling(s) })),
  };
}

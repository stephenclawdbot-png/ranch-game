/**
 * The closed-beta population: ~50 testers from the owner's network. Every behavioural number
 * here is an ASSUMPTION (there is no telemetry yet); each one is listed in docs/economy/AUDIT.md
 * and swept in the sensitivity report. Game numbers come from game-core via the credits model.
 */
import { BETA, gc } from "../lib/constants.ts";
import { SimRng } from "../lib/rng.ts";

export type ArchKey = "casual" | "engaged" | "grinder" | "breeder" | "whale" | "story_skipper";
export type Segment = "none" | "minnow" | "dolphin" | "whale";
/** Position in the invite tree: owner-direct (L1 = owner), tester-invited (L1 tester, L2 owner), deep (L1, L2 testers), none. */
export type TreePos = "owner_direct" | "tester_invited" | "deep" | "none";

export const ARCH_MIX: Record<ArchKey, number> = { casual: 15, engaged: 15, grinder: 5, breeder: 5, whale: 3, story_skipper: 7 };

/** Weekly Live starts by archetype and beta week, from the credits model (career starts bind). */
export interface Tester {
  id: number;
  arch: ArchKey;
  segment: Segment;
  tree: TreePos;
  wallet: boolean;
  /** Best starter's current rating (real game-core starters). */
  starterAbility: number;
  /** Race-selection skill (rating points). */
  skill: number;
  pPlay: number;
  cupRate: number;
  /** Ability growth per week from training + breeding (rating points). */
  growth: number;
  /** Sybil: owned by the same human as another account. */
  ownerHuman: number;
  premiumPulled: number;
}

const ARCH_PARAMS: Record<ArchKey, { pPlay: number; cupRate: number; skill: [number, number]; growth: number }> = {
  casual: { pPlay: 0.6, cupRate: 0.7, skill: [0, 15], growth: 1 },
  engaged: { pPlay: 0.9, cupRate: 0.95, skill: [10, 30], growth: 3 },
  grinder: { pPlay: 1, cupRate: 1, skill: [5, 20], growth: 3 },
  breeder: { pPlay: 0.95, cupRate: 0.95, skill: [10, 25], growth: 5 },
  whale: { pPlay: 0.95, cupRate: 0.95, skill: [5, 25], growth: 3 },
  story_skipper: { pPlay: 0.8, cupRate: 0.9, skill: [0, 10], growth: 0.5 },
};

export function starterAbility(i: number, salt: string): number {
  const hs = gc.createStarterStable({ seed: gc.seedFrom("econ-tester", salt, i), ownerId: `t${i}`, nowMs: 0, season: 1 });
  return Math.max(
    ...hs.map((h) => {
      const s = gc.currentStats(h);
      return (s.speed + s.stamina + s.burst + s.durability + s.adaptability + s.temperament) / 6;
    }),
  );
}

export interface PopulationOptions {
  n?: number;
  /** Probability a non-paying tester links a wallet (payers always do). */
  walletRate?: number;
  /** Payer shares (of all testers): minnow / dolphin; whales are the whale archetype. */
  minnowShare?: number;
  dolphinShare?: number;
  treeMix?: Record<Exclude<TreePos, "none">, number>;
}

export function makeTesters(rng: SimRng, salt: string, opt: PopulationOptions = {}): Tester[] {
  const n = opt.n ?? 50;
  const archs: ArchKey[] = [];
  const total = Object.values(ARCH_MIX).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(ARCH_MIX) as [ArchKey, number][]) for (let i = 0; i < Math.round((v * n) / total); i++) archs.push(k);
  while (archs.length < n) archs.push("casual");
  archs.length = n;
  const tree = opt.treeMix ?? { owner_direct: 0.7, tester_invited: 0.25, deep: 0.05 };
  const out: Tester[] = archs.map((arch, id) => {
    const p = ARCH_PARAMS[arch];
    const u = rng.float();
    const pos: TreePos = u < tree.owner_direct ? "owner_direct" : u < tree.owner_direct + tree.tester_invited ? "tester_invited" : "deep";
    return {
      id,
      arch,
      segment: arch === "whale" ? "whale" : "none",
      tree: pos,
      wallet: false,
      starterAbility: starterAbility(id, salt),
      skill: p.skill[0] + rng.float() * (p.skill[1] - p.skill[0]),
      pPlay: p.pPlay,
      cupRate: p.cupRate,
      growth: p.growth,
      ownerHuman: id,
      premiumPulled: 0,
    };
  });
  // Payers: dolphins mostly among the engaged; minnows anywhere.
  const dolphins = Math.round((opt.dolphinShare ?? 0.15) * n);
  const minnows = Math.round((opt.minnowShare ?? 0.3) * n);
  const order = [...out].filter((t) => t.segment === "none").sort((a, b) => {
    const w = (t: Tester) => (t.arch === "engaged" || t.arch === "breeder" || t.arch === "grinder" ? 0 : 1) + rng.float() * 1.2;
    return w(a) - w(b);
  });
  order.slice(0, dolphins).forEach((t) => (t.segment = "dolphin"));
  const rest = order.slice(dolphins).sort(() => rng.float() - 0.5);
  rest.slice(0, minnows).forEach((t) => (t.segment = "minnow"));
  for (const t of out) t.wallet = t.segment !== "none" || rng.chance(opt.walletRate ?? 0.7);
  return out;
}

/** Premium Packs a tester buys in week w (1-based) under weekly purchase decay d. */
export function packsBought(rng: SimRng, t: Tester, w: number, d: number, demandScale = 1): number {
  const k = Math.pow(1 - d, w - 1) * demandScale;
  let q = 0;
  if (t.segment === "minnow") q = Math.min(6 - t.premiumPulled, rng.poisson(1.2 * k));
  else if (t.segment === "dolphin") q = rng.poisson(4 * k);
  else if (t.segment === "whale") q = Math.round(10 * k + rng.normal() * 1.5 * k);
  q = Math.max(0, Math.min(BETA.maxQtyPerQuote, q));
  t.premiumPulled += q;
  return q;
}

/**
 * Inheritance, mutation, pedigree kinship and the coefficient of inbreeding (COI).
 *
 * inherit(): one allele from each parent at every diploid locus (Mendelian segregation),
 * then a rare, bounded, seeded mutation (±1..30) on stat alleles. High COI raises the
 * mutation rate and skews mutations negative; it also costs durability/temperament
 * potential via inbreeding depression (genome.potentialOf).
 */
import { GENOME_VERSION, STAT_KEYS, MORPH_KEYS, QUIRK_KEYS, type AllelePair, type Genome, type PedigreeIndex } from "./types";
import { blendBreeds } from "./genome";
import { Rng, clampInt } from "./rng";

/** Mutation chance per stat allele, permille (before COI). */
export const MUTATION_PERMILLE = 60;
/** Max mutation step on a stat allele. */
export const MUTATION_MAX = 30;
/** Extra mutation chance per 100 permille COI. */
export const MUTATION_COI_RATE_PER_100 = 30;
/** Share of mutations that are negative at COI 0 (permille); rises with COI. */
export const MUTATION_NEG_BASE = 500;
export const MUTATION_NEG_PER_100_COI = 120;
/** Chance per categorical allele of a small variant / white / morph drift. */
export const DRIFT_PERMILLE = 30;

function pick<T>(rng: Rng, pair: readonly [T, T]): T {
  return rng.chance(500) ? pair[0] : pair[1];
}

function pair<T>(rng: Rng, sire: readonly [T, T], dam: readonly [T, T]): [T, T] {
  return [pick(rng, sire), pick(rng, dam)];
}

export interface InheritOptions {
  /** COI of the foal (permille), from coiOf(sireId, damId, pedigree). */
  coi?: number;
  /** The foal's grandparents' genomes (up to 4; missing = foundation stock). */
  family?: readonly Genome[];
}

// ---------------------------------------------------------------------------
// Family bounds: the lineage sets how far a foal can land above or below its parents
// ---------------------------------------------------------------------------

/** Best parent allele + this, at most (balance.md "over-parent bound"). */
export const FAMILY_HEADROOM = 40;
/** A one-generation spike (parents far above their own parents) keeps only this much. */
export const FAMILY_HEADROOM_MIN = 10;
/** Weakest parent allele − this, at least; inbreeding widens it by COI / 10. */
export const FAMILY_FLOOR_DROP = 40;
/**
 * A strong family protects the floor: a mutation can't take an allele below the family
 * centre − this (the floor never rises above the weakest parent allele, so inheritance stays
 * Mendelian). Inbreeding then lowers it by COI / 10.
 */
export const FAMILY_FLOOR_SPREAD = 60;
/** Mutations lean back toward the family centre: + this permille negative per 100 above it. */
export const FAMILY_PULL_PER_100 = 60;

export interface FamilyRange {
  /** Lowest / highest allele a foal can carry at this stat. */
  floor: number;
  ceiling: number;
  /** Where the line sits: parents 2/3, grandparents 1/3 (parents only without records). */
  centre: number;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Per-stat allele range for a foal of this pairing, from its parents and grandparents. */
export function familyRange(sire: Genome, dam: Genome, family: readonly Genome[] = [], coi = 0): Record<(typeof STAT_KEYS)[number], FamilyRange> {
  const out = {} as Record<(typeof STAT_KEYS)[number], FamilyRange>;
  for (const k of STAT_KEYS) {
    const parents = [...sire.stats[k], ...dam.stats[k]];
    const grand = family.flatMap((g) => g.stats[k]);
    const pMean = mean(parents);
    const gMean = grand.length ? mean(grand) : pMean;
    // a line that rose in one generation has less headroom than a line that has been there a while
    const spike = Math.max(0, pMean - gMean);
    const headroom = clampInt(Math.round(FAMILY_HEADROOM - spike / 5), FAMILY_HEADROOM_MIN, FAMILY_HEADROOM);
    const weakest = Math.min(...parents);
    const inbred = Math.floor(clampInt(coi, 0, 1000) / 10);
    const centre = Math.round((pMean * 2 + gMean) / 3);
    out[k] = {
      // inbreeding widens the downside whatever the family's strength
      floor: clampInt(Math.min(weakest, Math.max(weakest - FAMILY_FLOOR_DROP, centre - FAMILY_FLOOR_SPREAD)) - inbred, 0, 1000),
      ceiling: clampInt(Math.max(...parents) + headroom, 0, 1000),
      centre,
    };
  }
  return out;
}

/** Mutation's negative share for an allele: COI base, leaning back toward the family centre. */
function leanNeg(neg: number, v: number, centre: number): number {
  return clampInt(neg + Math.round(((v - centre) * FAMILY_PULL_PER_100) / 100), 50, 950);
}

/** Mutation parameters for a given COI (exported for the breeding preview). */
export function mutationParams(coi: number): { ratePermille: number; negPermille: number } {
  const c = Math.max(0, Math.min(1000, coi));
  return {
    ratePermille: Math.min(400, MUTATION_PERMILLE + Math.floor((c * MUTATION_COI_RATE_PER_100) / 100)),
    negPermille: Math.min(950, MUTATION_NEG_BASE + Math.floor((c * MUTATION_NEG_PER_100_COI) / 100)),
  };
}

function mutate(rng: Rng, v: number, rate: number, neg: number): number {
  if (!rng.chance(rate)) return v;
  const step = rng.range(1, MUTATION_MAX);
  return clampInt(rng.chance(neg) ? v - step : v + step, 0, 1000);
}

/** Vigour mutations are smaller (±1..10): the class locus moves every stat at once. */
export const VIGOUR_MUTATION_MAX = 10;

function mutateVigour(rng: Rng, v: number, rate: number, neg: number): number {
  if (!rng.chance(rate)) return v;
  const step = rng.range(1, VIGOUR_MUTATION_MAX);
  return clampInt(rng.chance(neg) ? v - step : v + step, -150, 150);
}

/** Produce a foal genome from two parents. Deterministic in (sire, dam, seed, coi). */
export function inherit(sire: Genome, dam: Genome, seed: string, opts: InheritOptions = {}): Genome {
  const rng = new Rng(`${seed}|inherit`);
  const coi = clampInt(opts.coi ?? 0, 0, 1000);
  const { ratePermille, negPermille } = mutationParams(coi);

  const range = familyRange(sire, dam, opts.family ?? [], coi);
  const stats = {} as Genome["stats"];
  for (const k of STAT_KEYS) {
    const p = pair(rng, sire.stats[k], dam.stats[k]);
    const b = range[k];
    const one = (v: number) => clampInt(mutate(rng, v, ratePermille, leanNeg(negPermille, v, b.centre)), b.floor, b.ceiling);
    stats[k] = [one(p[0]), one(p[1])] as AllelePair;
  }

  const vp = pair(rng, sire.vigour, dam.vigour);
  const vigour: [number, number] = [mutateVigour(rng, vp[0], ratePermille, negPermille), mutateVigour(rng, vp[1], ratePermille, negPermille)];

  const drift = (v: number, lo: number, hi: number, amp: number) => (rng.chance(DRIFT_PERMILLE) ? clampInt(v + rng.range(-amp, amp), lo, hi) : v);

  const morph = {} as Genome["morph"];
  for (const k of MORPH_KEYS) {
    const p = pair(rng, sire.morph[k], dam.morph[k]);
    // Polygenic segregation: a small Gaussian-ish term on every morph allele.
    morph[k] = [clampInt(p[0] + rng.normal() * 60, -1000, 1000), clampInt(p[1] + rng.normal() * 60, -1000, 1000)];
  }

  const quirks = {} as Genome["quirks"];
  for (const q of QUIRK_KEYS) quirks[q] = pair(rng, sire.quirks[q], dam.quirks[q]);

  const variants = {} as Genome["variants"];
  for (const k of ["head", "mane", "tail", "build"] as const) {
    const p = pair(rng, sire.variants[k], dam.variants[k]);
    variants[k] = [drift(p[0], 0, 7, 1), drift(p[1], 0, 7, 1)];
  }

  const white = pair(rng, sire.white, dam.white);
  const distanceMod = pair(rng, sire.distanceMod, dam.distanceMod);

  return {
    version: GENOME_VERSION,
    stats,
    vigour,
    distance: pair(rng, sire.distance, dam.distance),
    distanceMod: [drift(distanceMod[0], -150, 150, 25), drift(distanceMod[1], -150, 150, 25)],
    surface: pair(rng, sire.surface, dam.surface),
    style: pair(rng, sire.style, dam.style),
    maturity: pair(rng, sire.maturity, dam.maturity),
    coat: {
      extension: pair(rng, sire.coat.extension, dam.coat.extension),
      agouti: pair(rng, sire.coat.agouti, dam.coat.agouti),
      cream: pair(rng, sire.coat.cream, dam.coat.cream),
      grey: pair(rng, sire.coat.grey, dam.coat.grey),
      roan: pair(rng, sire.coat.roan, dam.coat.roan),
      dun: pair(rng, sire.coat.dun, dam.coat.dun),
      liver: pair(rng, sire.coat.liver, dam.coat.liver),
      sabino: pair(rng, sire.coat.sabino, dam.coat.sabino),
    },
    white: [drift(white[0], 0, 100, 6), drift(white[1], 0, 100, 6)],
    morph,
    variants,
    quirks,
    breed: blendBreeds(sire.breed, dam.breed),
    coi,
    markingSeed: rng.nextU32(),
  };
}

// ---------------------------------------------------------------------------
// Pedigree: kinship and COI (Wright, via the recursive kinship coefficient)
// ---------------------------------------------------------------------------

/** Generations of pedigree considered for COI. */
export const COI_MAX_DEPTH = 10;

/**
 * Kinship coefficient f(a, b) in [0, 1] (probability that alleles drawn at random from a and b
 * are identical by descent). Ancestors always have a lower generation number than descendants,
 * so expanding the younger individual terminates. Unknown horses are unrelated founders.
 */
export function kinship(a: string | null, b: string | null, ped: PedigreeIndex, maxDepth = COI_MAX_DEPTH): number {
  const memo = new Map<string, number>();
  const gen = (id: string) => ped[id]?.generation ?? 0;

  const f = (x: string | null, y: string | null, depth: number): number => {
    if (x === null || y === null || depth > maxDepth * 2) return 0;
    const key = x < y ? `${x}|${y}` : `${y}|${x}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let r: number;
    if (x === y) {
      const e = ped[x];
      r = 0.5 * (1 + (e ? f(e.sireId, e.damId, depth + 1) : 0));
    } else {
      // Expand the younger one (higher generation); ties: expand y.
      const [old, young] = gen(x) > gen(y) ? [y, x] : [x, y];
      const e = ped[young];
      r = e ? 0.5 * (f(old, e.sireId, depth + 1) + f(old, e.damId, depth + 1)) : 0;
    }
    memo.set(key, r);
    return r;
  };
  return f(a, b, 0);
}

/** COI of a prospective foal = kinship of its parents, permille (rounded). */
export function coiOf(sireId: string, damId: string, ped: PedigreeIndex): number {
  return Math.round(kinship(sireId, damId, ped) * 1000);
}

export type KinBlock = "self" | "parent_child" | "full_siblings";

/** Hard breeding blocks: self, parent-child, full siblings. */
export function kinBlock(sireId: string, damId: string, ped: PedigreeIndex): KinBlock | null {
  if (sireId === damId) return "self";
  const s = ped[sireId];
  const d = ped[damId];
  if (s && (s.sireId === damId || s.damId === damId)) return "parent_child";
  if (d && (d.sireId === sireId || d.damId === sireId)) return "parent_child";
  if (s && d && s.sireId !== null && s.damId !== null && s.sireId === d.sireId && s.damId === d.damId) return "full_siblings";
  return null;
}

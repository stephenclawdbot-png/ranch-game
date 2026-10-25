/**
 * Genome: stat potentials, aptitudes, grades, rarity, ceilings and foundation horses.
 *
 * Stat loci are diploid (two alleles 0..1000). The higher allele is partially dominant:
 *
 *   potential = lo + h * (hi - lo),  h = DOMINANCE_PERMILLE / 1000   (mean + 0.1 * |a - b|)
 *
 * so a horse can carry a hidden high allele that it does not fully show. That is the engine
 * of the breeding game: two moderate horses that each carry a "gem" allele can throw a foal
 * that is homozygous for it and better than either parent.
 */
import type { RunningStyle, Surface } from "@thoroughbred/shared";
import { Rng, clampInt } from "./rng";
import {
  BREEDS,
  GENOME_VERSION,
  STAT_KEYS,
  type AllelePair,
  type Breed,
  type BreedShares,
  type CoatGenes,
  type DistanceAllele,
  type Genome,
  type Grade,
  type MaturityAllele,
  type MaturityType,
  type MorphGenes,
  type QuirkGenes,
  type QuirkKey,
  type Rarity,
  type StatKey,
  type StatRecord,
  type SurfaceAllele,
} from "./types";

// ---------------------------------------------------------------------------
// Constants (tuned by src/sim; see README)
// ---------------------------------------------------------------------------

/** Dominance of the higher allele, permille (500 = additive, 1000 = complete dominance). */
export const DOMINANCE_PERMILLE = 600;
/** Inbreeding depression on durability and temperament: potential x (1 - k * COI). */
export const INBREEDING_DEPRESSION_PERMILLE = 800;
export const INBREEDING_AFFECTED: readonly StatKey[] = ["durability", "temperament"];

/**
 * Launch ceilings for minted horses (packs, starters, gifts, Club runners), per docs/balance.md:
 * mean potential ≤ 600 (C grade) and no single stat above 700. Each competition season raises
 * both by 10 so late joiners are not stuck, up to +80. Bred horses are never capped below 1000.
 */
export const LAUNCH_MEAN_CEILING = 600;
export const LAUNCH_STAT_CEILING = 700;
export const CEILING_STEP_PER_SEASON = 10;
export const CEILING_MAX_STEPS = 8;
/** Kept for readability in docs: the launch mean ceiling. */
export const LAUNCH_CEILING = LAUNCH_MEAN_CEILING;
/**
 * Minted alleles may exceed the per-stat ceiling by this much (hidden breeding value). Speed gets
 * less headroom: it is the most valuable stat in the engine (balance.md), so the breeding
 * frontier should not run away on speed alone.
 */
export const ALLELE_HEADROOM: StatRecord<number> = { speed: 100, stamina: 150, burst: 150, durability: 150, adaptability: 150, temperament: 150 };
/** Chance per minted stat locus (permille) that one allele is a hidden "gem" above what it shows. */
export const GEM_LOCUS_PERMILLE = 80;

function seasonSteps(season: number): number {
  return Math.min(CEILING_MAX_STEPS, Math.max(0, Math.floor(season) - 1));
}

/** Mint ceiling on the MEAN potential for a competition season. */
export function meanCeiling(season: number): number {
  return LAUNCH_MEAN_CEILING + CEILING_STEP_PER_SEASON * seasonSteps(season);
}

/** Mint ceiling on any single stat potential for a competition season. */
export function potentialCeiling(season: number): number {
  return LAUNCH_STAT_CEILING + CEILING_STEP_PER_SEASON * seasonSteps(season);
}

/** Highest allele a minted horse may carry for a stat in a season. */
export function alleleCap(season: number, stat: StatKey = "stamina"): number {
  return Math.min(1000, potentialCeiling(season) + ALLELE_HEADROOM[stat]);
}

/**
 * Weights of the overall potential (the horse's headline grade). Equal weights = the plain mean
 * of the six stats, as in docs/balance.md: a balanced horse is the breeding goal, which
 * counters speed's dominance in the engine.
 */
export const OVERALL_WEIGHTS: StatRecord<number> = { speed: 1, stamina: 1, burst: 1, durability: 1, adaptability: 1, temperament: 1 };
const OVERALL_DEN = 6;

// ---------------------------------------------------------------------------
// Potentials and grades
// ---------------------------------------------------------------------------

/** Expressed value of an allele pair (no inbreeding depression). */
export function locusValue(pair: AllelePair): number {
  const lo = Math.min(pair[0], pair[1]);
  const hi = Math.max(pair[0], pair[1]);
  return lo + Math.floor(((hi - lo) * DOMINANCE_PERMILLE + 500) / 1000);
}

/** Genetic potential of one stat, 0..1000. */
export function potentialOf(genome: Genome, stat: StatKey): number {
  const v = locusValue(genome.stats[stat]);
  if (genome.coi > 0 && INBREEDING_AFFECTED.includes(stat)) {
    return Math.max(0, v - Math.floor((v * genome.coi * INBREEDING_DEPRESSION_PERMILLE) / 1_000_000));
  }
  return v;
}

export function potentials(genome: Genome): StatRecord<number> {
  const out = {} as StatRecord<number>;
  for (const k of STAT_KEYS) out[k] = potentialOf(genome, k);
  return out;
}

/** Weighted overall of a stat record (the headline number on a horse card). */
export function overallOf(stats: StatRecord<number>): number {
  let s = 0;
  for (const k of STAT_KEYS) s += stats[k] * OVERALL_WEIGHTS[k];
  return Math.round(s / OVERALL_DEN);
}

export function overallPotential(genome: Genome): number {
  return overallOf(potentials(genome));
}

export function meanPotential(genome: Genome): number {
  const p = potentials(genome);
  let s = 0;
  for (const k of STAT_KEYS) s += p[k];
  return Math.round(s / STAT_KEYS.length);
}

/** Potential grade scale: launch ceiling (600) = C, first bred A-grades (800+) around gen 4-6. */
export const GRADE_FLOORS: readonly [Grade, number][] = [
  ["S", 900],
  ["A", 800],
  ["B", 700],
  ["C", 600],
  ["D", 500],
  ["E", 0],
];

export function gradeOf(value: number): Grade {
  for (const [g, floor] of GRADE_FLOORS) if (value >= floor) return g;
  return "E";
}

export function gradeFloor(g: Grade): number {
  return GRADE_FLOORS.find(([x]) => x === g)![1];
}

// ---------------------------------------------------------------------------
// Rarity (derived from genetics: mean stat potential)
// ---------------------------------------------------------------------------

/** Lower bound of mean potential per rarity tier. */
export const RARITY_FLOORS: Record<Rarity, number> = { common: 0, uncommon: 510, rare: 540, epic: 565, legendary: 585 };
/** Upper bound used when minting a tier (exclusive), before the season ceiling. */
export const RARITY_MINT_BANDS: Record<Rarity, [number, number]> = {
  common: [470, 510],
  uncommon: [510, 540],
  rare: [540, 565],
  epic: [565, 585],
  legendary: [585, 1001],
};

export function rarityOf(genome: Genome): Rarity {
  const m = meanPotential(genome);
  if (m >= RARITY_FLOORS.legendary) return "legendary";
  if (m >= RARITY_FLOORS.epic) return "epic";
  if (m >= RARITY_FLOORS.rare) return "rare";
  if (m >= RARITY_FLOORS.uncommon) return "uncommon";
  return "common";
}

// ---------------------------------------------------------------------------
// Aptitudes
// ---------------------------------------------------------------------------

export const DISTANCE_CENTER_M: Record<DistanceAllele, number> = { sprint: 1100, mile: 1500, middle: 2000, staying: 2600 };

export function preferredDistanceM(genome: Genome): number {
  const [a, b] = genome.distance;
  const raw = (DISTANCE_CENTER_M[a] + DISTANCE_CENTER_M[b]) / 2 + (genome.distanceMod[0] + genome.distanceMod[1]) / 2;
  return clampInt(Math.round(raw / 50) * 50, 1000, 3200);
}

export function distanceBand(m: number): DistanceAllele {
  if (m < 1300) return "sprint";
  if (m < 1750) return "mile";
  if (m < 2300) return "middle";
  return "staying";
}

/** TT -> turf, DD -> dirt, TD -> synthetic (versatile all-weather type). */
export function preferredSurface(genome: Genome): Surface {
  const t = (genome.surface[0] === "T" ? 1 : 0) + (genome.surface[1] === "T" ? 1 : 0);
  return t === 2 ? "turf" : t === 0 ? "dirt" : "synthetic";
}

/** Heterozygous surface types are versatile: a small adaptability bonus in the phenotype. */
export const SURFACE_HET_ADAPT_BONUS = 20;

/** front+closer -> stalker, front+stalker -> front, stalker+closer -> closer. */
export function runningStyle(genome: Genome): RunningStyle {
  const [a, b] = genome.style;
  if (a === b) return a;
  const s = new Set([a, b]);
  if (s.has("front") && s.has("closer")) return "stalker";
  if (s.has("front")) return "front";
  return "closer";
}

const MATURITY_NUM: Record<MaturityAllele, number> = { early: -1, normal: 0, late: 1 };
export function maturityType(genome: Genome): MaturityType {
  const s = MATURITY_NUM[genome.maturity[0]] + MATURITY_NUM[genome.maturity[1]];
  return s < 0 ? "early" : s > 0 ? "late" : "normal";
}

/** Recessive quirks need two copies, dominant ones one. */
export const QUIRK_DOMINANT: Record<QuirkKey, boolean> = { mudlark: false, gateShy: true, lateKick: false, crowdShy: true };

export function expressedQuirks(genome: Genome): QuirkKey[] {
  const out: QuirkKey[] = [];
  for (const q of Object.keys(QUIRK_DOMINANT) as QuirkKey[]) {
    const n = genome.quirks[q][0] + genome.quirks[q][1];
    if (n >= (QUIRK_DOMINANT[q] ? 1 : 2)) out.push(q);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Breeds
// ---------------------------------------------------------------------------

export interface BreedProfile {
  /** Mean allele per stat for a minted horse of this breed. */
  statMean: StatRecord<number>;
  distance: Record<DistanceAllele, number>;
  /** Permille chance of a T (turf) surface allele. */
  turf: number;
  style: Record<RunningStyle, number>;
  maturity: Record<MaturityAllele, number>;
  /** Permille allele frequencies of the non-wild coat alleles. */
  coat: { E: number; A: number; At: number; Cr: number; G: number; Rn: number; D: number; l: number; Sb1: number };
  /** Mean white tendency per allele (0..100). */
  white: number;
  /** Morph offsets in rig units (added to 1.0), weighted by breed share. */
  morph: Record<keyof MorphGenes, number>;
  /** Mint weight among foundation horses (permille). */
  mintWeight: number;
}

export const BREED_PROFILES: Record<Breed, BreedProfile> = {
  thoroughbred: {
    statMean: { speed: 470, stamina: 430, burst: 440, durability: 400, adaptability: 400, temperament: 410 },
    distance: { sprint: 150, mile: 400, middle: 350, staying: 100 },
    turf: 700,
    style: { front: 300, stalker: 400, closer: 300 },
    maturity: { early: 300, normal: 450, late: 250 },
    coat: { E: 600, A: 560, At: 150, Cr: 10, G: 40, Rn: 5, D: 0, l: 200, Sb1: 20 },
    white: 28,
    morph: { legLength: 0.04, neckLength: 0.03, girth: -0.02, height: 0.03, headSize: 0 },
    mintWeight: 500,
  },
  arabian: {
    statMean: { speed: 400, stamina: 500, burst: 380, durability: 470, adaptability: 430, temperament: 400 },
    distance: { sprint: 0, mile: 150, middle: 350, staying: 500 },
    turf: 450,
    style: { front: 200, stalker: 350, closer: 450 },
    maturity: { early: 150, normal: 400, late: 450 },
    coat: { E: 550, A: 600, At: 50, Cr: 0, G: 220, Rn: 0, D: 0, l: 250, Sb1: 40 },
    white: 34,
    morph: { legLength: 0, neckLength: -0.02, girth: -0.01, height: -0.05, headSize: -0.05 },
    mintWeight: 200,
  },
  quarterHorse: {
    statMean: { speed: 480, stamina: 330, burst: 500, durability: 440, adaptability: 400, temperament: 470 },
    distance: { sprint: 800, mile: 200, middle: 0, staying: 0 },
    turf: 200,
    style: { front: 550, stalker: 350, closer: 100 },
    maturity: { early: 550, normal: 350, late: 100 },
    coat: { E: 500, A: 500, At: 100, Cr: 80, G: 30, Rn: 40, D: 40, l: 300, Sb1: 20 },
    white: 22,
    morph: { legLength: -0.06, neckLength: -0.04, girth: 0.08, height: -0.02, headSize: 0.03 },
    mintWeight: 180,
  },
  akhalTeke: {
    statMean: { speed: 440, stamina: 480, burst: 400, durability: 430, adaptability: 470, temperament: 360 },
    distance: { sprint: 0, mile: 200, middle: 400, staying: 400 },
    turf: 450,
    style: { front: 350, stalker: 400, closer: 250 },
    maturity: { early: 200, normal: 450, late: 350 },
    coat: { E: 600, A: 550, At: 150, Cr: 150, G: 30, Rn: 0, D: 20, l: 200, Sb1: 10 },
    white: 18,
    morph: { legLength: 0.07, neckLength: 0.08, girth: -0.06, height: 0.02, headSize: -0.01 },
    mintWeight: 120,
  },
};

/** Breed-share-weighted mean of a numeric breed trait. */
export function breedBlend(shares: BreedShares, f: (p: BreedProfile) => number): number {
  let s = 0;
  for (const b of BREEDS) s += shares[b] * f(BREED_PROFILES[b]);
  return s / 1000;
}

export function mainBreed(shares: BreedShares): Breed {
  let best: Breed = "thoroughbred";
  for (const b of BREEDS) if (shares[b] > shares[best]) best = b;
  return best;
}

/** Average of two parents' breed shares, rounded so the result still sums to exactly 1000. */
export function blendBreeds(a: BreedShares, b: BreedShares): BreedShares {
  const raw = BREEDS.map((k) => (a[k] + b[k]) / 2);
  const floors = raw.map((v) => Math.floor(v));
  let rem = 1000 - floors.reduce((x, y) => x + y, 0);
  const order = raw.map((v, i) => [v - floors[i]!, i] as const).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (const [, i] of order) {
    if (rem <= 0) break;
    floors[i]! += 1;
    rem--;
  }
  return { thoroughbred: floors[0]!, arabian: floors[1]!, quarterHorse: floors[2]!, akhalTeke: floors[3]! };
}

// ---------------------------------------------------------------------------
// Minting foundation horses
// ---------------------------------------------------------------------------

function pickWeighted<K extends string>(rng: Rng, table: Record<K, number>): K {
  const keys = Object.keys(table) as K[];
  return keys[rng.weighted(keys.map((k) => table[k]))]!;
}

function pickBlended<K extends string>(rng: Rng, shares: BreedShares, f: (p: BreedProfile) => Record<K, number>): K {
  const main = mainBreed(shares);
  // Each allele comes from one ancestral breed, picked by share.
  const breed = BREEDS[rng.weighted(BREEDS.map((b) => shares[b]))] ?? main;
  return pickWeighted(rng, f(BREED_PROFILES[breed]));
}

function allele<A extends string, W extends string>(rng: Rng, freqPermille: number, alt: A, wild: W): A | W {
  return rng.chance(freqPermille) ? alt : wild;
}

export interface MintOptions {
  season: number;
  /** Target rarity tier; default: drawn from a common-heavy natural distribution. */
  rarity?: Rarity;
  /** Force a main breed. */
  breed?: Breed;
}

/** Random breed shares: 700-1000 of a main breed, remainder from one other breed. */
function mintBreedShares(rng: Rng, forced?: Breed): BreedShares {
  const main = forced ?? BREEDS[rng.weighted(BREEDS.map((b) => BREED_PROFILES[b].mintWeight))]!;
  const shares: BreedShares = { thoroughbred: 0, arabian: 0, quarterHorse: 0, akhalTeke: 0 };
  const pure = rng.chance(450);
  if (pure) {
    shares[main] = 1000;
  } else {
    const others = BREEDS.filter((b) => b !== main);
    const second = rng.pick(others);
    const mainShare = rng.range(14, 19) * 50; // 700..950
    shares[main] = mainShare;
    shares[second] = 1000 - mainShare;
  }
  return shares;
}

function mintCoat(rng: Rng, shares: BreedShares): CoatGenes {
  const f = (k: keyof BreedProfile["coat"]) => Math.round(breedBlend(shares, (p) => p.coat[k]));
  const agouti = (): "A" | "At" | "a" => {
    const r = rng.int(1000);
    if (r < f("A")) return "A";
    if (r < f("A") + f("At")) return "At";
    return "a";
  };
  return {
    extension: [allele(rng, f("E"), "E", "e"), allele(rng, f("E"), "E", "e")],
    agouti: [agouti(), agouti()],
    cream: [allele(rng, f("Cr"), "Cr", "n"), allele(rng, f("Cr"), "Cr", "n")],
    grey: [allele(rng, f("G"), "G", "n"), allele(rng, f("G"), "G", "n")],
    roan: [allele(rng, f("Rn"), "Rn", "n"), allele(rng, f("Rn"), "Rn", "n")],
    dun: [allele(rng, f("D"), "D", "n"), allele(rng, f("D"), "D", "n")],
    liver: [allele(rng, f("l"), "l", "L"), allele(rng, f("l"), "l", "L")],
    sabino: [allele(rng, f("Sb1"), "Sb1", "n"), allele(rng, f("Sb1"), "Sb1", "n")],
  };
}

/** Quirk allele frequencies (permille) in minted horses. */
export const QUIRK_FREQ: Record<QuirkKey, number> = { mudlark: 200, gateShy: 50, lateKick: 250, crowdShy: 40 };

function mintQuirks(rng: Rng): QuirkGenes {
  const b = (q: QuirkKey): 0 | 1 => (rng.chance(QUIRK_FREQ[q]) ? 1 : 0);
  return {
    mudlark: [b("mudlark"), b("mudlark")],
    gateShy: [b("gateShy"), b("gateShy")],
    lateKick: [b("lateKick"), b("lateKick")],
    crowdShy: [b("crowdShy"), b("crowdShy")],
  };
}

/** Typical gap (sd of |hi − p|) between a minted locus's high allele and its expressed value. */
export const MINT_HET_SD = 100;

/** Lowest minted stat potential. */
export const MINT_STAT_FLOOR = 150;

/** Natural (pre-tier) rarity distribution for minted horses with no target tier. */
export const NATURAL_RARITY_WEIGHTS: Record<Rarity, number> = { common: 600, uncommon: 280, rare: 90, epic: 25, legendary: 5 };

/**
 * Build the allele pair for a target expressed value `p` (before inbreeding).
 * hi = p + a, lo = p - a*h/(1-h) keeps lo + h*(hi-lo) == p. A gem puts `hi` above the
 * ceiling (hidden), balanced by a lower `lo`.
 */
function allelesFor(rng: Rng, p: number, cap: number, gem: boolean): AllelePair {
  const h = DOMINANCE_PERMILLE;
  let a: number;
  // The low allele must stay >= 60, which bounds how far above p the high allele can sit.
  const maxA = Math.max(0, Math.min(cap - p, Math.floor(((p - 60) * (1000 - h)) / h)));
  if (gem && maxA > 60) {
    a = rng.range(Math.floor(maxA / 2), maxA);
  } else {
    a = Math.min(maxA, Math.round(Math.abs(rng.normal()) * MINT_HET_SD));
  }
  let hiA = Math.min(cap, p + a);
  a = hiA - p;
  let loA = p - Math.round((a * h) / (1000 - h));
  if (loA < 0) {
    loA = 0;
    hiA = p;
  }
  // Fix rounding so the expressed value is exactly p.
  let pair: AllelePair = rng.chance(500) ? [hiA, loA] : [loA, hiA];
  for (let i = 0; i < 4 && locusValue(pair) !== p; i++) {
    const d = p - locusValue(pair);
    pair = pair[0] <= pair[1] ? [clampInt(pair[0] + d, 0, cap), pair[1]] : [pair[0], clampInt(pair[1] + d, 0, cap)];
  }
  if (locusValue(pair) !== p) pair = [p, p];
  return pair;
}

/**
 * Mint a foundation horse genome (starters, packs, gifts, AI fields).
 *
 * Guarantees: every stat potential <= potentialCeiling(season) (700 at launch); mean potential
 * <= meanCeiling(season) (600 at launch); every allele <= alleleCap(season, stat);
 * rarityOf(result) === target rarity; deterministic in `seed`.
 */
export function generateFoundationGenome(seed: string, opts: MintOptions): Genome {
  const rng = new Rng(`${seed}|mint`);
  const ceiling = potentialCeiling(opts.season);
  const meanCap = meanCeiling(opts.season);
  const rarity = opts.rarity ?? pickWeighted(rng, NATURAL_RARITY_WEIGHTS);
  const breed = mintBreedShares(rng, opts.breed);

  // Target mean potential inside the tier band (and under the mean ceiling).
  const [bandLo, bandHiRaw] = RARITY_MINT_BANDS[rarity];
  const bandHi = Math.min(bandHiRaw, meanCap + 1);
  const target = bandLo + 1 + rng.int(Math.max(1, bandHi - bandLo - 2));

  // Breed-shaped stat profile around the target: a niche, not a flat line.
  const means = {} as StatRecord<number>;
  let meanOfMeans = 0;
  for (const k of STAT_KEYS) {
    means[k] = breedBlend(breed, (p) => p.statMean[k]);
    meanOfMeans += means[k] / STAT_KEYS.length;
  }
  const p = {} as StatRecord<number>;
  for (const k of STAT_KEYS) {
    const dev = (means[k] - meanOfMeans) * 1.2 + rng.normal() * 45;
    p[k] = clampInt(target + Math.max(-140, Math.min(140, dev)), MINT_STAT_FLOOR, ceiling);
  }
  // Re-centre so the mean hits the target exactly (respecting [floor, ceiling]).
  for (let iter = 0; iter < 20; iter++) {
    let diff = target * STAT_KEYS.length - STAT_KEYS.reduce((sum, k) => sum + p[k], 0);
    if (diff === 0) break;
    for (const k of STAT_KEYS) {
      if (diff === 0) break;
      const room = diff > 0 ? ceiling - p[k] : MINT_STAT_FLOOR - p[k];
      const want = diff > 0 ? Math.ceil(diff / 3) : Math.floor(diff / 3);
      const step = diff > 0 ? Math.min(room, want) : Math.max(room, want);
      p[k] += step;
      diff -= step;
    }
  }

  const stats = {} as Genome["stats"];
  for (const k of STAT_KEYS) stats[k] = allelesFor(rng, p[k], alleleCap(opts.season, k), rng.chance(GEM_LOCUS_PERMILLE));

  const distance: [DistanceAllele, DistanceAllele] = [pickBlended(rng, breed, (q) => q.distance), pickBlended(rng, breed, (q) => q.distance)];
  const turf = Math.round(breedBlend(breed, (q) => q.turf));
  const surface: [SurfaceAllele, SurfaceAllele] = [rng.chance(turf) ? "T" : "D", rng.chance(turf) ? "T" : "D"];
  const style: [RunningStyle, RunningStyle] = [pickBlended(rng, breed, (q) => q.style), pickBlended(rng, breed, (q) => q.style)];
  const maturity: [MaturityAllele, MaturityAllele] = [pickBlended(rng, breed, (q) => q.maturity), pickBlended(rng, breed, (q) => q.maturity)];
  const whiteMean = breedBlend(breed, (q) => q.white);
  const w = () => clampInt(whiteMean + rng.normal() * 18, 0, 100);
  const m = () => clampInt(rng.normal() * 350, -1000, 1000);
  const v = () => (rng.chance(700) ? 0 : rng.range(1, 3));

  return {
    version: GENOME_VERSION,
    stats,
    distance,
    distanceMod: [rng.range(-100, 100), rng.range(-100, 100)],
    surface,
    style,
    maturity,
    coat: mintCoat(rng, breed),
    white: [w(), w()],
    morph: {
      legLength: [m(), m()],
      neckLength: [m(), m()],
      girth: [m(), m()],
      height: [m(), m()],
      headSize: [m(), m()],
    },
    variants: { head: [v(), v()], mane: [v(), v()], tail: [v(), v()], build: [v(), v()] },
    quirks: mintQuirks(rng),
    breed,
    coi: 0,
    markingSeed: rng.nextU32(),
  };
}

/** Highest allele per stat (true breeding value ceiling, never shown directly). */
export function bestAlleles(genome: Genome): StatRecord<number> {
  const out = {} as StatRecord<number>;
  for (const k of STAT_KEYS) out[k] = Math.max(genome.stats[k][0], genome.stats[k][1]);
  return out;
}

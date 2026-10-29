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
  GENES2_KEYS,
  GENOME_VERSION,
  STAT_KEYS,
  type AllelePair,
  type Breed,
  type BreedShares,
  type CoatGenes,
  type DistanceAllele,
  type Genes2,
  type Genes2Key,
  type Genome,
  type GenomeV1,
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
  upgradeV1Genome,
} from "./types";
import { GenomeSchema, GenomeV1Schema } from "./types";

// ---------------------------------------------------------------------------
// Constants (tuned by src/sim; see README)
// ---------------------------------------------------------------------------

/** Dominance of the higher allele, permille (500 = additive, 1000 = complete dominance). */
export const DOMINANCE_PERMILLE = 550;
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
export const ALLELE_HEADROOM: StatRecord<number> = { speed: 200, stamina: 250, burst: 250, durability: 250, adaptability: 250, temperament: 250 };
/** Chance per minted stat locus (permille) that one allele is a hidden "gem" above what it shows. */
export const GEM_LOCUS_PERMILLE = 150;

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
export function locusValue(pair: readonly [number, number]): number {
  const lo = Math.min(pair[0], pair[1]);
  const hi = Math.max(pair[0], pair[1]);
  return lo + Math.floor(((hi - lo) * DOMINANCE_PERMILLE + 500) / 1000);
}

export const VIGOUR_MIN = -150;
export const VIGOUR_MAX = 150;

/** Expressed vigour (class) effect, added to every stat. Same partial dominance as stat loci. */
export function vigourValue(pair: readonly [number, number]): number {
  return locusValue([pair[0], pair[1]]);
}

/** Expressed stat from its locus value, the vigour effect and inbreeding depression. */
export function expressStat(locus: number, vigour: number, stat: StatKey, coi: number): number {
  const v = Math.max(0, Math.min(1000, locus + vigour));
  if (coi > 0 && INBREEDING_AFFECTED.includes(stat)) return Math.max(0, v - Math.floor((v * coi * INBREEDING_DEPRESSION_PERMILLE) / 1_000_000));
  return v;
}

/** Fragile legs cost this much durability potential. */
export const FRAGILE_DURABILITY_PENALTY = 100;

/** Fragile legs show with one copy. */
export function isFragile(genome: Pick<Genome, "fragile">): boolean {
  return !!genome.fragile && genome.fragile[0] + genome.fragile[1] >= 1;
}

// ---------------------------------------------------------------------------
// Genetics v2 phenotype: size, the speed gene (MSTN) and big heart (docs/genetics-v2.md)
// ---------------------------------------------------------------------------

/** Height per Ht (LCORL) copy, permille of an average Thoroughbred's height (+3 %). */
export const SIZE_PER_HT_PERMILLE = 30;
/** Polygenic height: a mean `morph.height` allele of ±1000 moves size by this, permille. */
export const SIZE_POLYGENIC_PERMILLE = 30;
/** Size is clamped to 0.88–1.12 of an average Thoroughbred. */
export const SIZE_MIN_PERMILLE = -120;
export const SIZE_MAX_PERMILLE = 120;
/**
 * Stat points per whole 1 % of size above 1.00 (below 1.00 the reverse). Sums to 0: size
 * changes a horse's shape, never its strength.
 */
export const SIZE_STAT_PER_PCT: StatRecord<number> = { speed: 2, stamina: 1, burst: -2, durability: -1, adaptability: 0, temperament: 0 };
/** MSTN C/C (sprinter) moves this much stamina into burst; T/T (stayer) the reverse. Zero-sum. */
export const MSTN_STAT_SHIFT = 15;
/** MSTN C/C shortens the best trip by this (metres); T/T lengthens it. */
export const MSTN_TRIP_M = 200;
/** Big heart (bh/bh, recessive): + this stamina potential. The one v2 gene that adds strength. */
export const BIG_HEART_STAMINA = 25;

const copies = <T extends string>(pair: readonly [T, T], v: T) => (pair[0] === v ? 1 : 0) + (pair[1] === v ? 1 : 0);

/** Breed size offset (permille of an average Thoroughbred), weighted by share. */
export function breedSizePermille(shares: BreedShares): number {
  return Math.round(breedBlend(shares, (p) => Math.round(p.morph.height * 1000)));
}

/** Polygenic height part of size (permille) from a mean `morph.height` allele sum. */
export function polygenicSizePermille(heightAlleleSum: number): number {
  return Math.trunc((heightAlleleSum * SIZE_POLYGENIC_PERMILLE) / 2000);
}

/**
 * Body size offset in permille of an average Thoroughbred (0 = 1.00): the breed's size, the
 * polygenic height locus and +3 % per Ht copy, clamped to ±12 %.
 */
export function sizePermille(genome: Pick<Genome, "breed" | "morph" | "genes2">): number {
  const poly = polygenicSizePermille(genome.morph.height[0] + genome.morph.height[1]);
  return clampInt(breedSizePermille(genome.breed) + poly + SIZE_PER_HT_PERMILLE * copies(genome.genes2.height, "Ht"), SIZE_MIN_PERMILLE, SIZE_MAX_PERMILLE);
}

/** Stat change from a size offset: whole percent × SIZE_STAT_PER_PCT (sums to 0). */
export function sizeStatDelta(sizeOffPermille: number): StatRecord<number> {
  const pct = Math.trunc(sizeOffPermille / 10);
  const out = {} as StatRecord<number>;
  for (const k of STAT_KEYS) out[k] = pct * SIZE_STAT_PER_PCT[k];
  return out;
}

export type MstnType = "sprinter" | "miler" | "stayer";
/** C/C sprinter, C/T miler, T/T stayer. */
export function mstnType(genome: Pick<Genome, "genes2">): MstnType {
  const c = copies(genome.genes2.mstn, "C");
  return c === 2 ? "sprinter" : c === 1 ? "miler" : "stayer";
}

/** MSTN's stat shift (zero-sum) for a type. */
export function mstnStatDelta(type: MstnType): StatRecord<number> {
  const out: StatRecord<number> = { speed: 0, stamina: 0, burst: 0, durability: 0, adaptability: 0, temperament: 0 };
  if (type === "sprinter") {
    out.burst = MSTN_STAT_SHIFT;
    out.stamina = -MSTN_STAT_SHIFT;
  } else if (type === "stayer") {
    out.stamina = MSTN_STAT_SHIFT;
    out.burst = -MSTN_STAT_SHIFT;
  }
  return out;
}

/** Big heart shows with two copies (recessive). */
export function hasBigHeart(genome: Pick<Genome, "genes2">): boolean {
  return copies(genome.genes2.bigHeart, "bh") === 2;
}

/** Iron legs (IL, dominant) multiply the injury risk by this, permille (−20 %). */
export const IRON_LEGS_RISK = 800;

/** Iron legs shows with one copy (dominant): injury risk × IRON_LEGS_RISK (condition.injuryRisk). */
export function hasIronLegs(genome: Pick<Genome, "genes2">): boolean {
  return copies(genome.genes2.ironLegs, "IL") > 0;
}

/** Combine the v2 parts of a stat change (size, MSTN, big heart). */
export function combineDelta(size: number, mstn: MstnType, bigHeart: boolean, upgraded = false): StatRecord<number> {
  const s = sizeStatDelta(upgraded ? 0 : size);
  const m = mstnStatDelta(mstn);
  const out = {} as StatRecord<number>;
  for (const k of STAT_KEYS) out[k] = s[k] + m[k] + (bigHeart && k === "stamina" ? BIG_HEART_STAMINA : 0);
  return out;
}

/**
 * What the v2 body and performance genes add to each stat potential: size (zero-sum), MSTN
 * (zero-sum) and big heart. A genome upgraded from v1 (`upgradedFrom`) gets no size effect, so
 * every horse from before genetics v2 races exactly as it did (its MSTN is the neutral C/T).
 */
export function phenotypeDelta(genome: Pick<Genome, "breed" | "morph" | "genes2" | "upgradedFrom">): StatRecord<number> {
  return combineDelta(sizePermille(genome), mstnType(genome), hasBigHeart(genome), !!genome.upgradedFrom);
}

/** Potential from an expressed allele value, the v2 delta and fragile legs. */
export function finishPotential(expressed: number, delta: number, stat: StatKey, fragile: boolean): number {
  const v = clampInt(expressed + delta, 0, 1000);
  return stat === "durability" && fragile ? Math.max(0, v - FRAGILE_DURABILITY_PENALTY) : v;
}

/** Genetic potential of one stat, 0..1000. */
export function potentialOf(genome: Genome, stat: StatKey): number {
  return potentials(genome)[stat];
}

/** Every stat potential: alleles, vigour and inbreeding, then the v2 delta, then fragile legs. */
export function potentials(genome: Genome): StatRecord<number> {
  const delta = phenotypeDelta(genome);
  const vig = vigourValue(genome.vigour);
  const fragile = isFragile(genome);
  const out = {} as StatRecord<number>;
  for (const k of STAT_KEYS) out[k] = finishPotential(expressStat(locusValue(genome.stats[k]), vig, k, genome.coi), delta[k], k, fragile);
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

/** MSTN's shift of the best trip, metres (C/C −200, C/T 0, T/T +200). */
export function mstnTripM(type: MstnType): number {
  return type === "sprinter" ? -MSTN_TRIP_M : type === "stayer" ? MSTN_TRIP_M : 0;
}

/** Best trip: the distance alleles, their polygenic shift and MSTN. */
export function preferredDistanceM(genome: Pick<Genome, "distance" | "distanceMod" | "genes2">): number {
  const [a, b] = genome.distance;
  const raw = (DISTANCE_CENTER_M[a] + DISTANCE_CENTER_M[b]) / 2 + (genome.distanceMod[0] + genome.distanceMod[1]) / 2 + mstnTripM(mstnType(genome));
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
  /** Permille frequencies of the v2 non-wild alleles (MSTN: C; feather: fe). */
  genes2: { Ch: number; Z: number; prl: number; TO: number; LP: number; PATN1: number; SW: number; Ht: number; fe: number; C: number; bh: number; IL: number; Ce: number; Dh: number };
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
    genes2: { Ch: 0, Z: 0, prl: 0, TO: 0, LP: 0, PATN1: 0, SW: 0, Ht: 600, fe: 0, C: 450, bh: 60, IL: 50, Ce: 0, Dh: 0 },
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
    genes2: { Ch: 0, Z: 0, prl: 0, TO: 0, LP: 0, PATN1: 0, SW: 0, Ht: 150, fe: 0, C: 150, bh: 40, IL: 150, Ce: 0, Dh: 850 },
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
    genes2: { Ch: 20, Z: 5, prl: 0, TO: 10, LP: 0, PATN1: 0, SW: 30, Ht: 300, fe: 0, C: 800, bh: 0, IL: 100, Ce: 0, Dh: 0 },
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
    genes2: { Ch: 0, Z: 0, prl: 0, TO: 0, LP: 0, PATN1: 0, SW: 0, Ht: 500, fe: 0, C: 250, bh: 80, IL: 120, Ce: 0, Dh: 0 },
    white: 18,
    morph: { legLength: 0.07, neckLength: 0.08, girth: -0.06, height: 0.02, headSize: -0.01 },
    mintWeight: 120,
  },
  standardbred: {
    statMean: { speed: 430, stamina: 470, burst: 380, durability: 470, adaptability: 400, temperament: 450 },
    distance: { sprint: 50, mile: 450, middle: 400, staying: 100 },
    turf: 250,
    style: { front: 400, stalker: 450, closer: 150 },
    maturity: { early: 250, normal: 500, late: 250 },
    coat: { E: 650, A: 600, At: 250, Cr: 0, G: 10, Rn: 0, D: 0, l: 100, Sb1: 5 },
    genes2: { Ch: 0, Z: 0, prl: 0, TO: 0, LP: 0, PATN1: 0, SW: 0, Ht: 450, fe: 0, C: 300, bh: 0, IL: 200, Ce: 0, Dh: 0 },
    white: 15,
    // Steady, sound and calm; the same fine head family as the Thoroughbred.
    morph: { legLength: 0.01, neckLength: 0, girth: 0, height: 0, headSize: 0 },
    mintWeight: 60,
  },
  appaloosa: {
    statMean: { speed: 430, stamina: 420, burst: 430, durability: 450, adaptability: 460, temperament: 410 },
    distance: { sprint: 250, mile: 450, middle: 250, staying: 50 },
    turf: 450,
    style: { front: 350, stalker: 400, closer: 250 },
    maturity: { early: 300, normal: 450, late: 250 },
    coat: { E: 550, A: 500, At: 100, Cr: 50, G: 30, Rn: 60, D: 40, l: 200, Sb1: 20 },
    genes2: { Ch: 0, Z: 0, prl: 0, TO: 0, LP: 600, PATN1: 400, SW: 0, Ht: 350, fe: 0, C: 450, bh: 0, IL: 150, Ce: 0, Dh: 0 },
    white: 25,
    // Stock type: short-coupled, deep-bodied, broad-jawed.
    morph: { legLength: -0.03, neckLength: -0.03, girth: 0.05, height: -0.01, headSize: 0.03 },
    mintWeight: 60,
  },
  paintHorse: {
    statMean: { speed: 470, stamina: 340, burst: 490, durability: 440, adaptability: 410, temperament: 450 },
    distance: { sprint: 700, mile: 250, middle: 50, staying: 0 },
    turf: 250,
    style: { front: 500, stalker: 350, closer: 150 },
    maturity: { early: 500, normal: 400, late: 100 },
    coat: { E: 500, A: 500, At: 100, Cr: 100, G: 20, Rn: 50, D: 50, l: 300, Sb1: 60 },
    genes2: { Ch: 20, Z: 0, prl: 0, TO: 550, LP: 0, PATN1: 0, SW: 80, Ht: 300, fe: 0, C: 750, bh: 0, IL: 100, Ce: 0, Dh: 0 },
    white: 45,
    morph: { legLength: -0.05, neckLength: -0.03, girth: 0.06, height: -0.02, headSize: 0.03 },
    mintWeight: 60,
  },
  mustang: {
    statMean: { speed: 410, stamina: 480, burst: 400, durability: 500, adaptability: 480, temperament: 330 },
    distance: { sprint: 100, mile: 300, middle: 350, staying: 250 },
    turf: 400,
    style: { front: 250, stalker: 400, closer: 350 },
    maturity: { early: 200, normal: 450, late: 350 },
    coat: { E: 550, A: 550, At: 100, Cr: 60, G: 40, Rn: 80, D: 250, l: 200, Sb1: 20 },
    genes2: { Ch: 10, Z: 60, prl: 0, TO: 80, LP: 30, PATN1: 0, SW: 0, Ht: 100, fe: 0, C: 300, bh: 0, IL: 300, Ce: 0, Dh: 0 },
    white: 20,
    // Small, tough and stocky.
    morph: { legLength: -0.04, neckLength: -0.03, girth: 0.03, height: -0.06, headSize: 0.03 },
    mintWeight: 60,
  },
  andalusian: {
    statMean: { speed: 400, stamina: 420, burst: 470, durability: 430, adaptability: 420, temperament: 460 },
    distance: { sprint: 150, mile: 450, middle: 350, staying: 50 },
    turf: 750,
    style: { front: 250, stalker: 400, closer: 350 },
    maturity: { early: 200, normal: 450, late: 350 },
    coat: { E: 600, A: 450, At: 100, Cr: 30, G: 450, Rn: 0, D: 0, l: 200, Sb1: 10 },
    genes2: { Ch: 0, Z: 0, prl: 120, TO: 0, LP: 0, PATN1: 0, SW: 0, Ht: 350, fe: 0, C: 350, bh: 0, IL: 100, Ce: 0, Dh: 0 },
    white: 15,
    // Baroque: arched, heavy-necked and round.
    morph: { legLength: 0, neckLength: -0.02, girth: 0.05, height: 0, headSize: 0.02 },
    mintWeight: 60,
  },
  friesian: {
    statMean: { speed: 360, stamina: 470, burst: 400, durability: 470, adaptability: 430, temperament: 470 },
    distance: { sprint: 0, mile: 200, middle: 450, staying: 350 },
    turf: 650,
    style: { front: 200, stalker: 450, closer: 350 },
    maturity: { early: 100, normal: 400, late: 500 },
    coat: { E: 950, A: 30, At: 0, Cr: 0, G: 0, Rn: 0, D: 0, l: 100, Sb1: 0 },
    genes2: { Ch: 0, Z: 0, prl: 0, TO: 0, LP: 0, PATN1: 0, SW: 0, Ht: 750, fe: 1000, C: 150, bh: 0, IL: 100, Ce: 0, Dh: 0 },
    white: 3,
    // Baroque and tall; about 1 in 10 carries hidden red (e), the classic recessive surprise.
    morph: { legLength: 0.02, neckLength: 0, girth: 0.05, height: 0.05, headSize: 0.02 },
    mintWeight: 60,
  },
  warmblood: {
    statMean: { speed: 420, stamina: 470, burst: 420, durability: 450, adaptability: 440, temperament: 400 },
    distance: { sprint: 50, mile: 300, middle: 450, staying: 200 },
    turf: 800,
    style: { front: 250, stalker: 400, closer: 350 },
    maturity: { early: 150, normal: 450, late: 400 },
    coat: { E: 600, A: 600, At: 200, Cr: 10, G: 80, Rn: 5, D: 0, l: 200, Sb1: 40 },
    genes2: { Ch: 0, Z: 0, prl: 0, TO: 0, LP: 0, PATN1: 0, SW: 0, Ht: 850, fe: 50, C: 250, bh: 0, IL: 150, Ce: 0, Dh: 0 },
    white: 35,
    // Big, scopey and plain-headed.
    morph: { legLength: 0.03, neckLength: 0.02, girth: 0.02, height: 0.06, headSize: 0.03 },
    mintWeight: 60,
  },
  marwari: {
    statMean: { speed: 420, stamina: 480, burst: 410, durability: 470, adaptability: 450, temperament: 370 },
    distance: { sprint: 50, mile: 250, middle: 400, staying: 300 },
    turf: 300,
    style: { front: 300, stalker: 350, closer: 350 },
    maturity: { early: 200, normal: 450, late: 350 },
    coat: { E: 550, A: 550, At: 100, Cr: 20, G: 150, Rn: 20, D: 10, l: 200, Sb1: 80 },
    genes2: { Ch: 0, Z: 0, prl: 0, TO: 0, LP: 0, PATN1: 0, SW: 0, Ht: 400, fe: 0, C: 250, bh: 0, IL: 200, Ce: 950, Dh: 200 },
    white: 40,
    // Fine head; the curled ears are the Ce layer, not the shape.
    morph: { legLength: 0, neckLength: -0.01, girth: 0, height: 0, headSize: -0.02 },
    mintWeight: 60,
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
  const out = {} as BreedShares;
  BREEDS.forEach((k, i) => (out[k] = floors[i]!));
  return out;
}

// ---------------------------------------------------------------------------
// v1 → v2 upgrade (stored rows are never rewritten; this runs on every read)
// ---------------------------------------------------------------------------

// WILD_GENES2 and upgradeV1Genome live in types.ts (no import cycle), so the schemas can
// upgrade v1 genomes in place at their parse points (StoredGenomeSchema).

/**
 * Parse any stored genome: v2 passes through, v1 is upgraded on read (new breed shares 0,
 * every new locus wild type, MSTN C/T — so no existing horse changes). Null when `raw` is
 * not a genome at all.
 */
export function upgradeGenome(raw: unknown): Genome | null {
  const v2 = GenomeSchema.safeParse(raw);
  if (v2.success) return v2.data;
  const v1 = GenomeV1Schema.safeParse(raw);
  if (!v1.success) return null;
  return upgradeV1Genome(v1.data);
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
  /** Even mint weights across all 12 breeds (Club runners in Live fields, so fields look varied). */
  evenBreeds?: boolean;
}

/** The four breeds of genetics v1 (the only ones a v1 mint can draw). */
export const BREEDS_V1 = ["thoroughbred", "arabian", "quarterHorse", "akhalTeke"] as const satisfies readonly Breed[];

/** Random breed shares: 700-1000 of a main breed, remainder from one other breed of `pool`. */
function mintBreedShares(rng: Rng, pool: readonly Breed[], forced?: Breed, evenBreeds = false): BreedShares {
  const main = forced ?? pool[rng.weighted(pool.map((b) => (evenBreeds ? 1 : BREED_PROFILES[b].mintWeight)))]!;
  const shares = {} as BreedShares;
  for (const b of BREEDS) shares[b] = 0;
  const pure = rng.chance(450);
  if (pure) {
    shares[main] = 1000;
  } else {
    const others = pool.filter((b) => b !== main);
    const second = rng.pick(others);
    const mainShare = rng.range(14, 19) * 50; // 700..950
    shares[main] = mainShare;
    shares[second] = 1000 - mainShare;
  }
  return shares;
}

/** [locus, profile frequency key, non-wild allele, wild allele] for minting the v2 loci. */
export const G2_LOCI: readonly [Genes2Key, keyof BreedProfile["genes2"], string, string][] = [
  ["champagne", "Ch", "Ch", "n"],
  ["silver", "Z", "Z", "n"],
  ["pearl", "prl", "prl", "n"],
  ["tobiano", "TO", "TO", "n"],
  ["leopard", "LP", "LP", "n"],
  ["patn1", "PATN1", "PATN1", "n"],
  ["splash", "SW", "SW", "n"],
  ["height", "Ht", "Ht", "n"],
  ["feather", "fe", "fe", "Fe"],
  ["mstn", "C", "C", "T"],
  ["bigHeart", "bh", "bh", "n"],
  ["ironLegs", "IL", "IL", "n"],
  ["curledEars", "Ce", "Ce", "n"],
  ["dish", "Dh", "Dh", "n"],
];

/** Mint the v2 loci: each allele drawn from one ancestral breed, picked by share (like pickBlended). */
function mintGenes2(rng: Rng, shares: BreedShares): Genes2 {
  const main = mainBreed(shares);
  const breedOf = () => BREEDS[rng.weighted(BREEDS.map((b) => shares[b]))] ?? main;
  const out: Record<string, [string, string]> = {};
  for (const [locus, freq, alt, wild] of G2_LOCI) {
    const draw = () => (rng.chance(BREED_PROFILES[breedOf()].genes2[freq]) ? alt : wild);
    out[locus] = [draw(), draw()];
  }
  return out as Genes2;
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

/** Minted vigour alleles: mean, spread and the chance of one hidden high (70..150) allele. */
export const MINT_VIGOUR_MEAN = -10;
export const MINT_VIGOUR_SD = 45;
export const MINT_VIGOUR_GEM_PERMILLE = 100;

/** Typical gap (sd of |hi − p|) between a minted locus's high allele and its expressed value. */
export const MINT_HET_SD = 150;

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
  return mintGenome(seed, opts, false);
}

/**
 * The genetics-v1 mint, byte for byte: four breeds, no v2 loci. Only for re-deriving what a
 * seed produced before genetics v2 (pack-pull proofs of pulls whose stored genome is version 1).
 * `opts.breed` must be one of the four v1 breeds.
 */
export function generateFoundationGenomeV1(seed: string, opts: Omit<MintOptions, "evenBreeds">): GenomeV1 {
  const g = mintGenome(seed, opts, true);
  const { genes2: _g2, upgradedFrom: _u, breed, ...rest } = g;
  const v1Breed = { thoroughbred: breed.thoroughbred, arabian: breed.arabian, quarterHorse: breed.quarterHorse, akhalTeke: breed.akhalTeke };
  // Same key order as the v1 mint wrote (breed sat between quirks and coi).
  const { coi, markingSeed, ...head } = rest;
  return { ...head, version: 1, breed: v1Breed, coi, markingSeed };
}

/**
 * The genome a mint seed produces under its genome version: v1 for proofs of pulls made before
 * genetics v2, v2 otherwise. Pack-pull verification compares the stored genome with this.
 */
export function mintForVersion(seed: string, opts: MintOptions, version: 1 | 2): Genome | GenomeV1 {
  return version === 1 ? generateFoundationGenomeV1(seed, opts) : generateFoundationGenome(seed, opts);
}

/**
 * Move a locus by −d (keeping its expressed value exact, every allele inside [0, cap]): the
 * mint aims the alleles so that alleles + the v2 delta land on the planned potential.
 */
function shiftLocus(pair: AllelePair, d: number, cap: number): AllelePair {
  if (d === 0) return pair;
  const want = clampInt(locusValue(pair) - d, 0, cap);
  let out: AllelePair = [clampInt(pair[0] - d, 0, cap), clampInt(pair[1] - d, 0, cap)];
  for (let i = 0; i < 4 && locusValue(out) !== want; i++) {
    const e = want - locusValue(out);
    out = out[0] <= out[1] ? [clampInt(out[0] + e, 0, cap), out[1]] : [out[0], clampInt(out[1] + e, 0, cap)];
  }
  return locusValue(out) === want ? out : [want, want];
}

function mintGenome(seed: string, opts: MintOptions, legacyV1: boolean): Genome {
  const rng = new Rng(`${seed}|mint`);
  const ceiling = potentialCeiling(opts.season);
  const meanCap = meanCeiling(opts.season);
  const rarity = opts.rarity ?? pickWeighted(rng, NATURAL_RARITY_WEIGHTS);
  const breed = mintBreedShares(rng, legacyV1 ? BREEDS_V1 : BREEDS, opts.breed, !legacyV1 && (opts.evenBreeds ?? false));

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

  // Vigour (class) locus: mostly modest, occasionally a hidden high allele.
  const vig = (): number => clampInt(Math.round(rng.normal() * MINT_VIGOUR_SD) + MINT_VIGOUR_MEAN, VIGOUR_MIN, VIGOUR_MAX);
  const vigour: [number, number] = rng.chance(MINT_VIGOUR_GEM_PERMILLE) ? [rng.range(70, VIGOUR_MAX), vig()] : [vig(), vig()];
  if (rng.chance(500)) vigour.reverse();
  const vEff = vigourValue(vigour);

  const stats = {} as Genome["stats"];
  for (const k of STAT_KEYS) stats[k] = allelesFor(rng, clampInt(p[k] - vEff, 0, 1000), alleleCap(opts.season, k), rng.chance(GEM_LOCUS_PERMILLE));

  const distance: [DistanceAllele, DistanceAllele] = [pickBlended(rng, breed, (q) => q.distance), pickBlended(rng, breed, (q) => q.distance)];
  const turf = Math.round(breedBlend(breed, (q) => q.turf));
  const surface: [SurfaceAllele, SurfaceAllele] = [rng.chance(turf) ? "T" : "D", rng.chance(turf) ? "T" : "D"];
  const style: [RunningStyle, RunningStyle] = [pickBlended(rng, breed, (q) => q.style), pickBlended(rng, breed, (q) => q.style)];
  const maturity: [MaturityAllele, MaturityAllele] = [pickBlended(rng, breed, (q) => q.maturity), pickBlended(rng, breed, (q) => q.maturity)];
  const whiteMean = breedBlend(breed, (q) => q.white);
  const w = () => clampInt(whiteMean + rng.normal() * 18, 0, 100);
  const m = () => clampInt(rng.normal() * 350, -1000, 1000);
  const v = () => (rng.chance(700) ? 0 : rng.range(1, 3));

  // Every v1 draw above and below comes from the main stream in the v1 order; the v2 loci have
  // their own stream, so they never shift a v1 draw.
  const genes2 = mintGenes2(new Rng(`${seed}|mint-g2`), breed);
  const g: Genome = {
    version: GENOME_VERSION,
    stats,
    vigour,
    distance,
    distanceMod: [rng.range(-100, 100), rng.range(-100, 100)],
    surface,
    style,
    maturity,
    coat: mintCoat(rng, breed),
    genes2,
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
  if (legacyV1) return g;
  // The planned potentials already carry the breed's shape; size, MSTN and big heart are part
  // of that shape, so the alleles absorb them (rarity, ceilings and the stat mean band hold).
  const delta = phenotypeDelta(g);
  for (const k of STAT_KEYS) g.stats[k] = shiftLocus(g.stats[k], delta[k], alleleCap(opts.season, k));
  return g;
}

/** Highest allele per stat (true breeding value ceiling, never shown directly). */
export function bestAlleles(genome: Genome): StatRecord<number> {
  const out = {} as StatRecord<number>;
  for (const k of STAT_KEYS) out[k] = Math.max(genome.stats[k][0], genome.stats[k][1]);
  return out;
}

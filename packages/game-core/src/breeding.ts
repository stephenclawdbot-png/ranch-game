/**
 * Breeding: rules, fees, covering, foaling and the exact pairing odds (internal; the player's
 * preview is breedingOutlook.ts).
 *
 * Rules (§7, §4a): 4 breedings per horse for life; a mare at most 1 per competition season;
 * a stallion up to 4 per season within his lifetime 4. No self, parent–child or full-sibling
 * pairings. Both horses must be breeding-eligible: racing age reached and racing-retired or
 * at least 25 starts, not pastured, not a gelding, mare not already in foal.
 */
import type { Breed, CoatGenes, Genome, HorseState, PedigreeIndex, StatKey, StatRecord, Binding, DistanceAllele, MaturityType } from "./types";
import { BREEDS, STAT_KEYS } from "./types";
import type { RunningStyle, Surface } from "@thoroughbred/shared";
import { BREEDINGS_LIFETIME, BREED_FROM_STARTS, PREGNANCY_MS, createHorseState, isFemale, isMale, isRacingAge, normaliseLocation, stageOf } from "./lifecycle";
import { MORPH_SEGREGATION_MAX, MUTATION_MAX, VIGOUR_MUTATION_MAX, coiOf, familyRange, fragileChance, inherit, kinBlock, mutationParams, type KinBlock } from "./genetics";
import {
  BIG_HEART_STAMINA,
  FRAGILE_DURABILITY_PENALTY,
  OVERALL_WEIGHTS,
  SIZE_MAX_PERMILLE,
  SIZE_MIN_PERMILLE,
  SIZE_PER_HT_PERMILLE,
  VIGOUR_MAX,
  VIGOUR_MIN,
  blendBreeds,
  breedSizePermille,
  combineDelta,
  mstnStatDelta,
  polygenicSizePermille,
  sizeStatDelta,
  type MstnType,
  expressStat,
  vigourValue,
  distanceBand,
  gradeOf,
  locusValue,
  maturityType,
  overallPotential,
  preferredDistanceM,
  preferredSurface,
  runningStyle,
} from "./genome";
import { BREED_LABEL, breedLabel } from "./geneticsSummary";
import { adultCoatName } from "./coat";
import { Rng, clampInt, seedFrom } from "./rng";
import type { Grade } from "./types";

export const MARE_PER_SEASON = 1;
export const STALLION_PER_SEASON = 4;
/** Platform base fee per covering (burned sink). */
export const BREEDING_BASE_FEE = 1500;
/** Share of the stud fee burned by the platform, permille. */
export const STUD_FEE_BURN_PERMILLE = 100;
/** COI (permille) from which the preview warns "closely related" (in words). */
export const COI_WARN = 62; // ~ half-sibling level 125/2

export type BreedBlock =
  | KinBlock
  | "sire_not_male"
  | "dam_not_female"
  | "gelding"
  | "not_racing_age"
  | "not_breeding_eligible"
  | "pastured"
  | "lifetime_limit"
  | "season_limit"
  | "dam_in_foal";

export function usedInSeason(state: Pick<HorseState, "breeding">, season: number): number {
  return state.breeding.bySeason.find((b) => b.season === season)?.count ?? 0;
}

/** Can this horse breed at all right now (ignoring the partner)? */
export function breedingEligibility(state: HorseState, season: number): BreedBlock | null {
  if (state.sex === "gelding") return "gelding";
  if (!isRacingAge(state)) return "not_racing_age";
  if (stageOf(state) === "pasture") return state.breeding.used >= BREEDINGS_LIFETIME ? "lifetime_limit" : "pastured";
  if (state.breeding.used >= BREEDINGS_LIFETIME) return "lifetime_limit";
  if (state.career.racingRetired === null && state.career.starts < BREED_FROM_STARTS) return "not_breeding_eligible";
  const cap = isFemale(state.sex) ? MARE_PER_SEASON : STALLION_PER_SEASON;
  if (usedInSeason(state, season) >= cap) return "season_limit";
  if (isFemale(state.sex) && state.pregnancy) return "dam_in_foal";
  return null;
}

/** Full check of a pairing. Returns the first block, or null when the covering is allowed. */
export function pairingBlock(sire: HorseState, dam: HorseState, ped: PedigreeIndex, season: number): BreedBlock | null {
  const kin = kinBlock(sire.id, dam.id, ped);
  if (kin) return kin;
  if (!isMale(sire.sex)) return "sire_not_male";
  if (!isFemale(dam.sex)) return "dam_not_female";
  return breedingEligibility(sire, season) ?? breedingEligibility(dam, season);
}

export interface BreedingFees {
  baseFee: number;
  studFee: number;
  /** Paid to the stallion owner (stud fee minus the burn). */
  toStallionOwner: number;
  burned: number;
  totalPaidByMareOwner: number;
}

/** Fees for a covering. Own stallion: no stud fee. */
export function breedingFees(studFee: number, sameOwner: boolean): BreedingFees {
  const fee = sameOwner ? 0 : Math.max(0, Math.floor(studFee));
  const burnStud = Math.floor((fee * STUD_FEE_BURN_PERMILLE) / 1000);
  return {
    baseFee: BREEDING_BASE_FEE,
    studFee: fee,
    toStallionOwner: fee - burnStud,
    burned: BREEDING_BASE_FEE + burnStud,
    totalPaidByMareOwner: BREEDING_BASE_FEE + fee,
  };
}

function markUsed(state: HorseState, season: number): HorseState {
  const bySeason = state.breeding.bySeason.some((b) => b.season === season)
    ? state.breeding.bySeason.map((b) => (b.season === season ? { ...b, count: b.count + 1 } : b))
    : [...state.breeding.bySeason, { season, count: 1 }];
  return { ...state, breeding: { used: state.breeding.used + 1, bySeason } };
}

export interface CoverResult {
  sire: HorseState;
  dam: HorseState;
  coi: number;
}

/**
 * Cover a mare. Throws when the pairing is blocked (callers check pairingBlock first).
 * `serverSeed` is the committed breeding seed; the foal seed is derived from it so the foal
 * genome is fixed (and verifiable) at the moment of covering.
 */
export function cover(sire: HorseState, dam: HorseState, ped: PedigreeIndex, season: number, nowMs: number, serverSeed: string): CoverResult {
  const block = pairingBlock(sire, dam, ped, season);
  if (block) throw new Error(`breeding blocked: ${block}`);
  const coi = coiOf(sire.id, dam.id, ped);
  const foalSeed = seedFrom("foal", serverSeed, sire.id, dam.id, nowMs);
  const newSire = normaliseLocation(markUsed(sire, season));
  const newDam = normaliseLocation({
    ...markUsed(dam, season),
    pregnancy: { sireId: sire.id, coveredAtMs: nowMs, dueAtMs: nowMs + PREGNANCY_MS, coi, foalSeed },
  });
  return { sire: newSire, dam: newDam, coi };
}

export interface FoalInput {
  foalId: string;
  name: string;
  nowMs: number;
  season: number;
  /** True when the owner has a free stall; otherwise the foal goes to the nursery overflow. */
  stallFree: boolean;
  /** The foal's grandparents' genomes (family bounds; missing = foundation stock). */
  family?: readonly Genome[];
}

/** Foal binding: offspring of a Club-bred parent is tradeable only after 5 starts. */
export function foalBinding(sire: Pick<HorseState, "binding">, dam: Pick<HorseState, "binding">): Binding {
  return sire.binding === "club_bred" || dam.binding === "club_bred" ? "until_5_starts" : "free";
}

/** Parents whose racing career ended in an injury (each may pass on fragile legs). */
export function injuredParents(sire: Pick<HorseState, "career">, dam: Pick<HorseState, "career">): { sire: boolean; dam: boolean } {
  return { sire: sire.career.racingRetired?.reason === "injury", dam: dam.career.racingRetired?.reason === "injury" };
}

/** Deliver the foal of a due pregnancy. Never fails for lack of space (nursery overflow). */
export function deliverFoal(dam: HorseState, sire: HorseState, input: FoalInput): { dam: HorseState; foal: HorseState } {
  const preg = dam.pregnancy;
  if (!preg) throw new Error("deliverFoal: mare is not in foal");
  if (preg.sireId !== sire.id) throw new Error("deliverFoal: wrong sire");
  if (input.nowMs < preg.dueAtMs) throw new Error("deliverFoal: not due yet");
  const genome = inherit(sire.genome, dam.genome, preg.foalSeed, { coi: preg.coi, family: input.family, injured: injuredParents(sire, dam) });
  const sex = new Rng(`${preg.foalSeed}|sex`).chance(500) ? "colt" : "filly";
  const foal = createHorseState({
    id: input.foalId,
    name: input.name,
    sex,
    ownerId: dam.ownerId,
    sireId: sire.id,
    damId: dam.id,
    generation: Math.max(sire.generation, dam.generation) + 1,
    genome,
    bornAtMs: preg.dueAtMs,
    bornSeason: input.season,
    location: input.stallFree ? "stable" : "nursery",
    binding: foalBinding(sire, dam),
  });
  return { dam: normaliseLocation({ ...dam, pregnancy: null }), foal };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

type Dist<T> = Map<T, number>;

function addTo<T>(d: Dist<T>, k: T, p: number) {
  d.set(k, (d.get(k) ?? 0) + p);
}

/** The four equally likely allele combinations at a locus. */
function combos<T>(a: readonly [T, T], b: readonly [T, T]): [T, T][] {
  return [
    [a[0], b[0]],
    [a[0], b[1]],
    [a[1], b[0]],
    [a[1], b[1]],
  ];
}

export interface StatPreview {
  min: number;
  max: number;
  expected: number;
  /** Chance per grade (permille). */
  grades: Partial<Record<Grade, number>>;
}

export interface BreedingPreview {
  coi: number;
  coiWarning: boolean;
  blocked: BreedBlock | null;
  stats: StatRecord<StatPreview>;
  /** beatsBothParents / belowBothParents: permille of foals above the better / below the weaker parent. */
  overall: { p10: number; p50: number; p90: number; grades: Partial<Record<Grade, number>>; beatsBothParents: number; belowBothParents: number };
  /** Coat colour probabilities (permille), by display name. */
  coats: { name: string; permille: number }[];
  /** Genetics-v2 trait odds (permille), by display name: patterns, colours, body and performance genes. */
  traits: { name: string; permille: number }[];
  /** MSTN speed-gene type odds (permille). */
  mstn: Partial<Record<MstnType, number>>;
  /** The foal's body size, whole % against an average Thoroughbred (before polygenic drift). */
  size: { min: number; max: number; likely: number };
  /** Hidden-carrier warnings, e.g. "Both carry pearl: 25% pearl foal". */
  hidden: string[];
  /** The foal's exact breed (average of the parents) and its named-cross label. */
  breed: { label: string; shares: { key: Breed; label: string; share: number }[] };
  distance: Partial<Record<DistanceAllele, number>>;
  surface: Partial<Record<Surface, number>>;
  style: Partial<Record<RunningStyle, number>>;
  maturity: Partial<Record<MaturityType, number>>;
  /** Mutation odds shown to the player (permille per allele, share negative). */
  mutation: { ratePermille: number; negPermille: number; maxStep: number };
  nick: { score: number; label: "Excellent" | "Good" | "Fair" | "Poor" };
  /**
   * The family's limits: the lowest and highest a foal of this pairing can possibly be (with
   * every mutation), set by the parents and grandparents. Per stat and overall potential.
   */
  limits: { stats: StatRecord<{ floor: number; ceiling: number }>; overall: { floor: number; ceiling: number }; lineage: "deep" | "rising" | "foundation" };
  /** Chance (permille) the foal has fragile legs, and whether a parent's career-ending injury is why. */
  fragile: { permille: number; fromInjury: boolean };
}

function toPermille<T extends string>(d: Dist<T>): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const [k, p] of d) out[k] = Math.round(p * 1000);
  return out;
}

/** Expressed values for one stat over (vigour combo × locus combo), each with probability 1/16. */
function statOutcomes(sire: Genome, dam: Genome, k: StatKey, vig: number, coi: number): number[] {
  return combos(sire.stats[k], dam.stats[k]).map((pair) => expressStat(locusValue(pair), vig, k, coi));
}

// ---------------------------------------------------------------------------
// Genetics-v2 preview: exact Mendelian odds per locus
// ---------------------------------------------------------------------------

const alleleCount = <T extends string>(pair: readonly [T, T], v: T): number => (pair[0] === v ? 1 : 0) + (pair[1] === v ? 1 : 0);

/** Distribution of the foal's copy count (0, 1, 2) of `alt`, from one random allele per parent. */
function copyDist(sire: readonly [string, string], dam: readonly [string, string], alt: string): [number, number, number] {
  const ps = alleleCount(sire, alt) / 2;
  const pd = alleleCount(dam, alt) / 2;
  return [(1 - ps) * (1 - pd), ps * (1 - pd) + (1 - ps) * pd, ps * pd];
}

const MSTN_BY_C: readonly MstnType[] = ["stayer", "miler", "sprinter"];

interface DeltaOutcome {
  p: number;
  /** Whole % of size against an average Thoroughbred. */
  sizePct: number;
  delta: StatRecord<number>;
}

/**
 * The foal's genetics-v2 stat changes with their odds: size (the foal's breed, one polygenic
 * height allele from each parent, Ht copies), MSTN type and big heart. The small polygenic
 * drift on the height alleles is left out, like mutation (the limits below include it).
 */
function deltaOutcomes(sg: Genome, dg: Genome): DeltaOutcome[] {
  const breedSize = breedSizePermille(blendBreeds(sg.breed, dg.breed));
  const ht = copyDist(sg.genes2.height, dg.genes2.height, "Ht");
  const mstn = copyDist(sg.genes2.mstn, dg.genes2.mstn, "C");
  const heart = copyDist(sg.genes2.bigHeart, dg.genes2.bigHeart, "bh")[2];
  const merged = new Map<string, DeltaOutcome>();
  for (const [a, b] of combos(sg.morph.height, dg.morph.height))
    for (let c = 0; c < 3; c++) {
      if (ht[c] === 0) continue;
      const size = clampInt(breedSize + polygenicSizePermille(a + b) + SIZE_PER_HT_PERMILLE * c, SIZE_MIN_PERMILLE, SIZE_MAX_PERMILLE);
      for (let m = 0; m < 3; m++) {
        if (mstn[m] === 0) continue;
        for (const bh of [false, true]) {
          const ph = bh ? heart : 1 - heart;
          if (ph === 0) continue;
          const delta = combineDelta(size, MSTN_BY_C[m]!, bh);
          const sizePct = Math.trunc(size / 10);
          const key = `${sizePct}|${STAT_KEYS.map((k) => delta[k]).join(",")}`;
          const prev = merged.get(key);
          merged.set(key, { p: (prev?.p ?? 0) + 0.25 * ht[c]! * mstn[m]! * ph, sizePct, delta });
        }
      }
    }
  return [...merged.values()];
}

/** Lowest and highest v2 stat change a foal can get, drift included (for the family limits). */
function deltaBounds(sg: Genome, dg: Genome): { lo: StatRecord<number>; hi: StatRecord<number> } {
  const breedSize = breedSizePermille(blendBreeds(sg.breed, dg.breed));
  const ht = copyDist(sg.genes2.height, dg.genes2.height, "Ht");
  const htMin = ht.findIndex((p) => p > 0);
  const htMax = 2 - [...ht].reverse().findIndex((p) => p > 0);
  const allele = (v: number) => clampInt(v, -1000, 1000);
  const polyLo = allele(Math.min(...sg.morph.height) - MORPH_SEGREGATION_MAX) + allele(Math.min(...dg.morph.height) - MORPH_SEGREGATION_MAX);
  const polyHi = allele(Math.max(...sg.morph.height) + MORPH_SEGREGATION_MAX) + allele(Math.max(...dg.morph.height) + MORPH_SEGREGATION_MAX);
  const size = (poly: number, c: number) => clampInt(breedSize + polygenicSizePermille(poly) + SIZE_PER_HT_PERMILLE * c, SIZE_MIN_PERMILLE, SIZE_MAX_PERMILLE);
  const small = sizeStatDelta(size(polyLo, htMin));
  const tall = sizeStatDelta(size(polyHi, htMax));
  const mstn = copyDist(sg.genes2.mstn, dg.genes2.mstn, "C");
  const types = MSTN_BY_C.filter((_, i) => mstn[i]! > 0).map(mstnStatDelta);
  const heart = copyDist(sg.genes2.bigHeart, dg.genes2.bigHeart, "bh")[2];
  const lo = {} as StatRecord<number>;
  const hi = {} as StatRecord<number>;
  for (const k of STAT_KEYS) {
    const hb = k === "stamina" ? BIG_HEART_STAMINA : 0;
    lo[k] = Math.min(small[k], tall[k]) + Math.min(...types.map((t) => t[k])) + (heart === 1 ? hb : 0);
    hi[k] = Math.max(small[k], tall[k]) + Math.max(...types.map((t) => t[k])) + (heart > 0 ? hb : 0);
  }
  return { lo, hi };
}

/**
 * The nick rating's weights: a base, plus the share of foals that beat both parents (upside),
 * plus how sure the foal's best trip band and surface are (coherence: the share of the most
 * likely one), minus the inbreeding coefficient (COI, permille) over a divisor. Clamped to
 * 0..100. The player's preview feeds it public inputs only (`pairingOutlook`: the public
 * outlook's chance to beat both, whether the parents' published trips and surfaces agree) and
 * shows the label as a word, never the score. The wiki prints these weights.
 */
export const NICK_WEIGHTS = { base: 25, beatsBoth: 60, tripCertainty: 15, surfaceCertainty: 10, coiDivisor: 4 } as const;
/** Nick labels by minimum score, best first ("Poor" below the last). */
export const NICK_LABELS: readonly { min: number; label: "Excellent" | "Good" | "Fair" }[] = [
  { min: 70, label: "Excellent" },
  { min: 55, label: "Good" },
  { min: 40, label: "Fair" },
];

/**
 * Nick rating from its parts: `beats` = share (0..1) of foals that beat both parents, `topBand`
 * and `topSurface` = share (0..1) of the most likely trip band and surface, `coi` in permille.
 */
export function nickRating(beats: number, topBand: number, topSurface: number, coi: number): { score: number; label: "Excellent" | "Good" | "Fair" | "Poor" } {
  const w = NICK_WEIGHTS;
  const score = clampInt(w.base + w.beatsBoth * beats + w.tripCertainty * topBand + w.surfaceCertainty * topSurface - coi / w.coiDivisor, 0, 100);
  return { score, label: NICK_LABELS.find((l) => score >= l.min)?.label ?? "Poor" };
}

/**
 * Exact odds of a pairing (before mutation), from the TRUE genotypes. Internal only: the wiki's
 * worked examples (fixed example genomes) and tests use it. Players never see it for a real
 * horse, because previewing a horse against known partners would give its hidden alleles away;
 * the player's preview is `pairingOutlook` + `possibleLooks` (breedingOutlook.ts), built from
 * public facts only.
 */
export function previewBreeding(sire: HorseState, dam: HorseState, ped: PedigreeIndex, season: number, family: readonly Genome[] = []): BreedingPreview {
  const coi = coiOf(sire.id, dam.id, ped);
  const blocked = pairingBlock(sire, dam, ped, season);
  const sg = sire.genome;
  const dg = dam.genome;
  const vigours = combos(sg.vigour, dg.vigour).map((p) => vigourValue(p));
  const outcomes = deltaOutcomes(sg, dg);

  // Per stat: vigour combo × locus combo × the foal's v2 change (size, MSTN, big heart).
  const stats = {} as StatRecord<StatPreview>;
  for (const k of STAT_KEYS) {
    const grades = new Map<Grade, number>();
    let min = Infinity;
    let max = -Infinity;
    let expected = 0;
    for (const vig of vigours)
      for (const base of statOutcomes(sg, dg, k, vig, coi))
        for (const o of outcomes) {
          const v = clampInt(base + o.delta[k], 0, 1000);
          const p = o.p / (vigours.length * 4);
          addTo(grades, gradeOf(v), p);
          min = Math.min(min, v);
          max = Math.max(max, v);
          expected += v * p;
        }
    stats[k] = { min, max, expected: Math.round(expected), grades: toPermille(grades) };
  }

  // Exact overall distribution: for each vigour combo, convolve the 6 stats' 4 outcomes each.
  // Size and MSTN only move points between stats (zero-sum), so the overall moves only with big
  // heart (stamina + BIG_HEART_STAMINA).
  const heart = copyDist(sg.genes2.bigHeart, dg.genes2.bigHeart, "bh")[2];
  const total = new Map<number, number>();
  const den = STAT_KEYS.reduce((a, k) => a + OVERALL_WEIGHTS[k], 0);
  for (const vig of vigours) {
    let sums: Map<number, number> = new Map([[0, 0.25]]);
    for (const k of STAT_KEYS) {
      const next = new Map<number, number>();
      const outs = statOutcomes(sg, dg, k, vig, coi);
      for (const [s, p] of sums) for (const v of outs) addTo(next, s + v * OVERALL_WEIGHTS[k], p * 0.25);
      sums = next;
    }
    for (const [s, p] of sums) {
      if (heart < 1) addTo(total, Math.round(s / den), p * (1 - heart));
      if (heart > 0) addTo(total, Math.round((s + BIG_HEART_STAMINA * OVERALL_WEIGHTS.stamina) / den), p * heart);
    }
  }
  const overallList = [...total.entries()].sort((a, b) => a[0] - b[0]);
  const pct = (q: number) => {
    let c = 0;
    for (const [v, p] of overallList) {
      c += p;
      if (c >= q - 1e-12) return v;
    }
    return overallList[overallList.length - 1]![0];
  };
  const og = new Map<Grade, number>();
  const parentBest = Math.max(overallPotential(sg), overallPotential(dg));
  const parentWorst = Math.min(overallPotential(sg), overallPotential(dg));
  let beats = 0;
  let below = 0;
  for (const [v, p] of overallList) {
    addTo(og, gradeOf(v), p);
    if (v > parentBest) beats += p;
    if (v < parentWorst) below += p;
  }

  // Coat colours: enumerate coat loci genotypes.
  const coatKeys = ["extension", "agouti", "cream", "grey", "roan", "dun", "liver"] as const;
  let partial: [Partial<CoatGenes>, number][] = [[{}, 1]];
  for (const key of coatKeys) {
    const next: [Partial<CoatGenes>, number][] = [];
    const merged = new Map<string, [readonly [string, string], number]>();
    for (const c of combos<string>(sg.coat[key], dg.coat[key])) {
      const norm = [...c].sort() as unknown as readonly [string, string];
      const id = norm.join("/");
      const prev = merged.get(id);
      merged.set(id, [norm, (prev?.[1] ?? 0) + 0.25]);
    }
    for (const [g, p] of partial) for (const [, [pair, q]] of merged) next.push([{ ...g, [key]: pair }, p * q]);
    partial = next;
  }
  const coatNames = new Map<string, number>();
  for (const [g, p] of partial) addTo(coatNames, adultCoatName({ ...(g as CoatGenes), sabino: ["n", "n"] }), p);
  const coats = [...coatNames.entries()]
    .map(([name, p]) => ({ name, permille: Math.round(p * 1000) }))
    .filter((c) => c.permille > 0)
    .sort((a, b) => b.permille - a.permille || a.name.localeCompare(b.name));

  // Genetics-v2 traits: the loci are independent, so their probabilities multiply. Silver
  // shows only on black pigment (hidden on e/e); leopard spots need both LP and PATN1; pearl
  // shows with two copies, or one copy next to a cream allele.
  const g2s = sg.genes2;
  const g2d = dg.genes2;
  const atLeastOne = (d: [number, number, number]) => d[1] + d[2];
  const dist = <K extends keyof Genome["genes2"]>(k: K, alt: string) => copyDist(g2s[k], g2d[k], alt);
  const red = copyDist(sg.coat.extension, dg.coat.extension, "e")[2]; // P(e/e): no black pigment
  const cream = atLeastOne(copyDist(sg.coat.cream, dg.coat.cream, "Cr"));
  const pearl = dist("pearl", "prl");
  const silver = dist("silver", "Z");
  const lp = dist("leopard", "LP");
  const patn1 = dist("patn1", "PATN1");
  const mstnDist = dist("mstn", "C");
  const feathered = dist("feather", "fe");
  const bigHeart = dist("bigHeart", "bh");
  const dish = dist("dish", "Dh");
  const traitOdds: [string, number][] = [
    ["Champagne", atLeastOne(dist("champagne", "Ch"))],
    ["Silver", atLeastOne(silver) * (1 - red)],
    ["Pearl", pearl[2] + pearl[1] * cream],
    ["Tobiano", atLeastOne(dist("tobiano", "TO"))],
    ["Leopard spots", lp[1] * atLeastOne(patn1)],
    ["Varnish roan", lp[1] * patn1[0]],
    ["Few-spot", lp[2]],
    ["Splash white", atLeastOne(dist("splash", "SW"))],
    ["Feathered legs", feathered[2]],
    ["Curled ears", atLeastOne(dist("curledEars", "Ce"))],
    ["Slight dish", dish[1]],
    ["Classic dish", dish[2]],
    ["Iron legs", atLeastOne(dist("ironLegs", "IL"))],
    ["Big heart", bigHeart[2]],
  ];
  const traits = traitOdds
    .map(([name, p]) => ({ name, permille: Math.round(p * 1000) }))
    .filter((t) => t.permille > 0)
    .sort((a, b) => b.permille - a.permille || a.name.localeCompare(b.name));
  const mstn = {
    sprinter: Math.round(mstnDist[2] * 1000),
    miler: Math.round(mstnDist[1] * 1000),
    stayer: Math.round(mstnDist[0] * 1000),
  };
  const sizeOdds = new Map<number, number>();
  for (const o of outcomes) addTo(sizeOdds, o.sizePct, o.p);
  const sizeList = [...sizeOdds.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const size = { min: Math.min(...sizeOdds.keys()), max: Math.max(...sizeOdds.keys()), likely: sizeList[0]![0] };

  // Hidden carriers: a recessive or masked allele the foal could get from parents who don't
  // show it. One line per gene, with the odds.
  const pctTxt = (p: number) => `${Math.round(p * 1000) / 10}%`;
  const carries = (pair: readonly [string, string], alt: string) => alleleCount(pair, alt) > 0;
  const showsPearl = (g: Genome) => alleleCount(g.genes2.pearl, "prl") === 2 || (alleleCount(g.genes2.pearl, "prl") === 1 && alleleCount(g.coat.cream, "Cr") > 0);
  const hidden: string[] = [];
  const bothCarry = (k: keyof Genome["genes2"], alt: string) => carries(g2s[k], alt) && carries(g2d[k], alt) && alleleCount(g2s[k], alt) < 2 && alleleCount(g2d[k], alt) < 2;
  if (bothCarry("pearl", "prl") && !showsPearl(sg) && !showsPearl(dg)) hidden.push(`Both carry pearl: ${pctTxt(pearl[2])} pearl foal`);
  if (atLeastOne(silver) * red > 0) hidden.push(`Silver is invisible on a red (chestnut) foal: ${pctTxt(atLeastOne(silver) * red)} would carry it unseen`);
  if (atLeastOne(patn1) * lp[0] > 0) hidden.push(`Pattern-1 needs leopard complex to show: ${pctTxt(atLeastOne(patn1) * lp[0])} of foals would carry it unseen`);
  if (bothCarry("feather", "fe")) hidden.push(`Both carry feathering: ${pctTxt(feathered[2])} feathered foal`);
  if (bothCarry("bigHeart", "bh")) hidden.push(`Both carry big heart: ${pctTxt(bigHeart[2])} big-heart foal (+${BIG_HEART_STAMINA} stamina)`);

  // The foal's breed: the exact average of the parents.
  const foalBreed = blendBreeds(sg.breed, dg.breed);
  const breedShares = BREEDS.map((k) => ({ key: k, label: BREED_LABEL[k], share: foalBreed[k] }))
    .filter((s) => s.share > 0)
    .sort((a, b) => b.share - a.share || a.key.localeCompare(b.key));

  // Aptitudes (the best trip includes the MSTN shift).
  const distance = new Map<DistanceAllele, number>();
  for (const d of combos(sg.distance, dg.distance))
    for (const m of combos(sg.distanceMod, dg.distanceMod))
      for (const x of combos(g2s.mstn, g2d.mstn)) addTo(distance, distanceBand(preferredDistanceM({ distance: d, distanceMod: m, genes2: { ...g2s, mstn: x } })), 1 / 64);

  const surface = new Map<Surface, number>();
  for (const s of combos(sg.surface, dg.surface)) addTo(surface, preferredSurface({ ...sg, surface: s } as Genome), 0.25);
  const style = new Map<RunningStyle, number>();
  for (const s of combos(sg.style, dg.style)) addTo(style, runningStyle({ ...sg, style: s } as Genome), 0.25);
  const maturity = new Map<MaturityType, number>();
  for (const m of combos(sg.maturity, dg.maturity)) addTo(maturity, maturityType({ ...sg, maturity: m } as Genome), 0.25);

  // Nick rating: upside (beat both parents), aptitude coherence, minus COI.
  const topBand = Math.max(...distance.values());
  const topSurface = Math.max(...surface.values());
  const { score, label } = nickRating(beats, topBand, topSurface, coi);
  const mp = mutationParams(coi);

  // Family limits in potential terms: the allele range at both loci, with the vigour range a
  // mutation can reach.
  // Reachable extremes: one allele from each parent, each moved at most one mutation step and
  // kept inside the family range; the vigour locus likewise.
  const range = familyRange(sg, dg, family, coi);
  const step = MUTATION_MAX;
  const vclamp = (v: number) => clampInt(v, VIGOUR_MIN, VIGOUR_MAX);
  const vigLo = vigourValue([vclamp(Math.min(...sg.vigour) - VIGOUR_MUTATION_MAX), vclamp(Math.min(...dg.vigour) - VIGOUR_MUTATION_MAX)]);
  const vigHi = vigourValue([vclamp(Math.max(...sg.vigour) + VIGOUR_MUTATION_MAX), vclamp(Math.max(...dg.vigour) + VIGOUR_MUTATION_MAX)]);
  // Then the v2 change at its extremes (size with drift, MSTN, big heart) and fragile legs.
  const bounds = deltaBounds(sg, dg);
  const inj = injuredParents(sire, dam);
  const fragile = { permille: fragileChance(sg, dg, inj), fromInjury: inj.sire || inj.dam };
  const limStats = {} as StatRecord<{ floor: number; ceiling: number }>;
  for (const k of STAT_KEYS) {
    const r = range[k];
    const fit = (v: number) => clampInt(v, r.floor, r.ceiling);
    const lo = locusValue([fit(Math.min(...sg.stats[k]) - step), fit(Math.min(...dg.stats[k]) - step)]);
    const hi = locusValue([fit(Math.max(...sg.stats[k]) + step), fit(Math.max(...dg.stats[k]) + step)]);
    const legs = k === "durability" && fragile.permille > 0 ? FRAGILE_DURABILITY_PENALTY : 0;
    limStats[k] = {
      floor: clampInt(expressStat(lo, vigLo, k, coi) + bounds.lo[k] - legs, 0, 1000),
      ceiling: clampInt(expressStat(hi, vigHi, k, coi) + bounds.hi[k], 0, 1000),
    };
  }
  const limMean = (f: "floor" | "ceiling") => Math.round(STAT_KEYS.reduce((a, k) => a + limStats[k][f] * OVERALL_WEIGHTS[k], 0) / den);
  const spikes = STAT_KEYS.map((k) => {
    const p = [...sg.stats[k], ...dg.stats[k]];
    return p.reduce((a, b) => a + b, 0) / 4 - range[k].centre;
  });
  const lineage = family.length === 0 ? "foundation" : spikes.reduce((a, b) => a + b, 0) / spikes.length > 20 ? "rising" : "deep";

  return {
    coi,
    coiWarning: coi >= COI_WARN,
    blocked,
    stats,
    overall: { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), grades: toPermille(og), beatsBothParents: Math.round(beats * 1000), belowBothParents: Math.round(below * 1000) },
    coats,
    traits,
    mstn,
    size,
    hidden,
    breed: { label: breedLabel(foalBreed), shares: breedShares },
    distance: toPermille(distance),
    surface: toPermille(surface),
    style: toPermille(style),
    maturity: toPermille(maturity),
    mutation: { ratePermille: mp.ratePermille, negPermille: mp.negPermille, maxStep: 30 },
    nick: { score, label },
    limits: { stats: limStats, overall: { floor: limMean("floor"), ceiling: limMean("ceiling") }, lineage },
    fragile,
  };
}

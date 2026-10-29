/**
 * Breeding: rules, fees, covering, foaling and the breeding preview (the depth engine).
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
import { coiOf, inherit, kinBlock, mutationParams, type KinBlock } from "./genetics";
import {
  OVERALL_WEIGHTS,
  blendBreeds,
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
import { breedLabel } from "./geneticsSummary";
import { adultCoatName } from "./coat";
import { Rng, clampInt, seedFrom } from "./rng";
import type { Grade } from "./types";

export const MARE_PER_SEASON = 1;
export const STALLION_PER_SEASON = 4;
/** Platform base fee per covering (burned sink). */
export const BREEDING_BASE_FEE = 1500;
/** Share of the stud fee burned by the platform, permille. */
export const STUD_FEE_BURN_PERMILLE = 100;
/** COI (permille) above which the preview shows an inbreeding warning. */
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
}

/** Foal binding: offspring of a Club-bred parent is tradeable only after 5 starts. */
export function foalBinding(sire: Pick<HorseState, "binding">, dam: Pick<HorseState, "binding">): Binding {
  return sire.binding === "club_bred" || dam.binding === "club_bred" ? "until_5_starts" : "free";
}

/** Deliver the foal of a due pregnancy. Never fails for lack of space (nursery overflow). */
export function deliverFoal(dam: HorseState, sire: HorseState, input: FoalInput): { dam: HorseState; foal: HorseState } {
  const preg = dam.pregnancy;
  if (!preg) throw new Error("deliverFoal: mare is not in foal");
  if (preg.sireId !== sire.id) throw new Error("deliverFoal: wrong sire");
  if (input.nowMs < preg.dueAtMs) throw new Error("deliverFoal: not due yet");
  const genome = inherit(sire.genome, dam.genome, preg.foalSeed, { coi: preg.coi });
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
  overall: { p10: number; p50: number; p90: number; grades: Partial<Record<Grade, number>>; beatsBothParents: number };
  /** Coat colour probabilities (permille), by display name. */
  coats: { name: string; permille: number }[];
  /** Visible genetics-v2 trait odds (permille), by display name. */
  traits: { name: string; permille: number }[];
  /** MSTN speed-gene type odds (permille). */
  mstn: Partial<Record<"sprinter" | "miler" | "stayer", number>>;
  /** Hidden-carrier warnings, e.g. "Both carry pearl: 25% pearl foal". */
  hidden: string[];
  /** The foal's exact breed (average of the parents) and its named-cross label. */
  breed: { label: string; shares: { key: Breed; share: number }[] };
  distance: Partial<Record<DistanceAllele, number>>;
  surface: Partial<Record<Surface, number>>;
  style: Partial<Record<RunningStyle, number>>;
  maturity: Partial<Record<MaturityType, number>>;
  /** Mutation odds shown to the player (permille per allele, share negative). */
  mutation: { ratePermille: number; negPermille: number; maxStep: number };
  nick: { score: number; label: "Excellent" | "Good" | "Fair" | "Poor" };
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

/**
 * Exact preview of a pairing (before mutation, which the preview shows separately). Uses the
 * true genotypes: the odds are what they are, published before the player commits.
 */
export function previewBreeding(sire: HorseState, dam: HorseState, ped: PedigreeIndex, season: number): BreedingPreview {
  const coi = coiOf(sire.id, dam.id, ped);
  const blocked = pairingBlock(sire, dam, ped, season);
  const sg = sire.genome;
  const dg = dam.genome;
  const vigours = combos(sg.vigour, dg.vigour).map((p) => vigourValue(p));

  const stats = {} as StatRecord<StatPreview>;
  for (const k of STAT_KEYS) {
    const vals = vigours.flatMap((v) => statOutcomes(sg, dg, k, v, coi));
    const grades = new Map<Grade, number>();
    for (const v of vals) addTo(grades, gradeOf(v), 1 / vals.length);
    stats[k] = { min: Math.min(...vals), max: Math.max(...vals), expected: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), grades: toPermille(grades) };
  }

  // Exact overall distribution: for each vigour combo, convolve the 6 stats' 4 outcomes each.
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
    for (const [s, p] of sums) addTo(total, Math.round(s / den), p);
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
  let beats = 0;
  for (const [v, p] of overallList) {
    addTo(og, gradeOf(v), p);
    if (v > parentBest) beats += p;
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
  const red = copyDist(sg.coat.extension, dg.coat.extension, "e")[2]; // P(e/e): no black pigment
  const cream = atLeastOne(copyDist(sg.coat.cream, dg.coat.cream, "Cr"));
  const pearl = copyDist(g2s.pearl, g2d.pearl, "prl");
  const silver = copyDist(g2s.silver, g2d.silver, "Z");
  const lp = copyDist(g2s.leopard, g2d.leopard, "LP");
  const patn1 = copyDist(g2s.patn1, g2d.patn1, "PATN1");
  const mstnDist = copyDist(g2s.mstn, g2d.mstn, "C");
  const traitOdds: [string, number][] = [
    ["Champagne", atLeastOne(copyDist(g2s.champagne, g2d.champagne, "Ch"))],
    ["Silver (black coats)", atLeastOne(silver) * (1 - red)],
    ["Pearl", pearl[2] + pearl[1] * cream],
    ["Tobiano", atLeastOne(copyDist(g2s.tobiano, g2d.tobiano, "TO"))],
    ["Leopard spots", atLeastOne(lp) * atLeastOne(patn1)],
    ["Splash white", atLeastOne(copyDist(g2s.splash, g2d.splash, "SW"))],
    ["Feathered legs", copyDist(g2s.feather, g2d.feather, "fe")[2]],
    ["Curled ears", atLeastOne(copyDist(g2s.curledEars, g2d.curledEars, "Ce"))],
    ["Dished face", atLeastOne(copyDist(g2s.dish, g2d.dish, "Dh"))],
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

  // Hidden carriers: a recessive or masked allele both parents could pass on unseen.
  const pctTxt = (p: number) => `${Math.round(p * 1000) / 10}%`;
  const carries = (pair: readonly [string, string], alt: string) => alleleCount(pair, alt) > 0;
  const showsPearl = (genes: Genome) => alleleCount(genes.genes2.pearl, "prl") === 2 || (alleleCount(genes.genes2.pearl, "prl") === 1 && alleleCount(genes.coat.cream, "Cr") > 0);
  const hidden: string[] = [];
  if (carries(g2s.pearl, "prl") && carries(g2d.pearl, "prl") && !showsPearl(sg) && !showsPearl(dg)) hidden.push(`Both carry pearl: ${pctTxt(pearl[2])} pearl foal`);
  if (atLeastOne(silver) > 0 && red > 0) hidden.push(`Silver is invisible on chestnut foals: ${pctTxt(atLeastOne(silver) * red)} would carry it unseen`);
  if (atLeastOne(patn1) > 0 && lp[0] > 0) hidden.push(`PATN1 needs leopard complex to show: ${pctTxt(atLeastOne(patn1) * lp[0])} of foals carry it hidden`);
  const feathered = copyDist(g2s.feather, g2d.feather, "fe");
  if (carries(g2s.feather, "fe") && carries(g2d.feather, "fe") && alleleCount(g2s.feather, "fe") < 2 && alleleCount(g2d.feather, "fe") < 2)
    hidden.push(`Both carry feathering: ${pctTxt(feathered[2])} feathered foal`);
  const bigHeart = copyDist(g2s.bigHeart, g2d.bigHeart, "bh");
  if (carries(g2s.bigHeart, "bh") && carries(g2d.bigHeart, "bh") && alleleCount(g2s.bigHeart, "bh") < 2 && alleleCount(g2d.bigHeart, "bh") < 2)
    hidden.push(`Both carry big heart: ${pctTxt(bigHeart[2])} double-copy foal (+25 stamina, hidden until checked)`);

  // The foal's breed: the exact average of the parents.
  const foalBreed = blendBreeds(sg.breed, dg.breed);
  const breedShares = BREEDS.map((k) => ({ key: k, share: foalBreed[k] }))
    .filter((s) => s.share > 0)
    .sort((a, b) => b.share - a.share);

  // Aptitudes.
  const distance = new Map<DistanceAllele, number>();
  for (const d of combos(sg.distance, dg.distance))
    for (const m of combos(sg.distanceMod, dg.distanceMod)) {
      const g = { ...sg, distance: d, distanceMod: m } as Genome;
      addTo(distance, distanceBand(preferredDistanceM(g)), 1 / 16);
    }
  const surface = new Map<Surface, number>();
  for (const s of combos(sg.surface, dg.surface)) addTo(surface, preferredSurface({ ...sg, surface: s } as Genome), 0.25);
  const style = new Map<RunningStyle, number>();
  for (const s of combos(sg.style, dg.style)) addTo(style, runningStyle({ ...sg, style: s } as Genome), 0.25);
  const maturity = new Map<MaturityType, number>();
  for (const m of combos(sg.maturity, dg.maturity)) addTo(maturity, maturityType({ ...sg, maturity: m } as Genome), 0.25);

  // Nick rating: upside (beat both parents), aptitude coherence, minus COI.
  const topBand = Math.max(...distance.values());
  const topSurface = Math.max(...surface.values());
  const score = clampInt(25 + 60 * beats + 15 * topBand + 10 * topSurface - coi / 4, 0, 100);
  const label = score >= 70 ? "Excellent" : score >= 55 ? "Good" : score >= 40 ? "Fair" : "Poor";
  const mp = mutationParams(coi);

  return {
    coi,
    coiWarning: coi >= COI_WARN,
    blocked,
    stats,
    overall: { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), grades: toPermille(og), beatsBothParents: Math.round(beats * 1000) },
    coats,
    traits,
    mstn,
    hidden,
    breed: { label: breedLabel(foalBreed), shares: breedShares },
    distance: toPermille(distance),
    surface: toPermille(surface),
    style: toPermille(style),
    maturity: toPermille(maturity),
    mutation: { ratePermille: mp.ratePermille, negPermille: mp.negPermille, maxStep: 30 },
    nick: { score, label },
  };
}

/**
 * Coat colour genetics, white markings and conformation → the shared `HorseAppearance`
 * coat/markings and the pixel-rig look knobs (variants / morph / seed / sabino).
 *
 * Real equine genetics, simplified:
 *   Extension E/e  x  Agouti A/At/a   -> bay / dark bay (seal brown) / black / chestnut
 *   Liver l/l on chestnut             -> liver chestnut
 *   Cream Cr (one copy)               -> palomino / buckskin / smoky black
 *   Cream Cr/Cr                       -> cremello / perlino / smoky cream
 *   Dun D                             -> red dun / bay dun / grullo (+ dunskin etc. with cream)
 *   Roan Rn                           -> strawberry / bay / blue roan
 *   Grey G                            -> born coloured, dapples while racing, grey by veteran age
 *   Sabino-1 + polygenic white        -> face and leg markings, sabino patches
 *
 * The rig only knows the ten `Coat` values, so rarer phenotypes render as the nearest coat
 * (plus a mane colour override) while `coatName` keeps the real name for display.
 */
import type { Coat, FaceMarking, HorseAppearance, HorseColour, LegMarking, Silks } from "@thoroughbred/shared";
import { BREEDS, MORPH_KEYS, type CoatGenes, type Genome, type MorphKey, type RigLook } from "./types";
import { BREED_PROFILES } from "./genome";
import { Rng, clamp } from "./rng";

export type BaseColour = "chestnut" | "liver_chestnut" | "bay" | "dark_bay" | "black";

export interface CoatPhenotype {
  /** Nearest coat the renderer supports. */
  coat: Coat;
  /** Genetically accurate display name, e.g. "Grullo", "Perlino", "Strawberry Roan". */
  coatName: string;
  /** The coat under any grey (what the foal was born). */
  base: BaseColour;
  maneColor?: string;
  /** True when the phenotype is rarer than the ten render coats can show exactly. */
  special: boolean;
}

const count = <T extends string>(pair: readonly [T, T], v: T) => (pair[0] === v ? 1 : 0) + (pair[1] === v ? 1 : 0);

export function baseColour(c: CoatGenes): BaseColour {
  if (count(c.extension, "E") === 0) return count(c.liver, "l") === 2 ? "liver_chestnut" : "chestnut";
  if (count(c.agouti, "A") > 0) return "bay";
  if (count(c.agouti, "At") > 0) return "dark_bay";
  return "black";
}

const NAME: Record<BaseColour, string> = {
  chestnut: "Chestnut",
  liver_chestnut: "Liver Chestnut",
  bay: "Bay",
  dark_bay: "Seal Brown",
  black: "Black",
};

/** Coloured coat (before grey). */
function colouredCoat(c: CoatGenes): CoatPhenotype {
  const base = baseColour(c);
  const cr = count(c.cream, "Cr");
  const dun = count(c.dun, "D") > 0;
  const roan = count(c.roan, "Rn") > 0;
  const red = base === "chestnut" || base === "liver_chestnut";
  const blackish = base === "black";
  let coat: Coat = base;
  let name = NAME[base];
  let maneColor: string | undefined;
  let special = false;

  if (cr === 2) {
    special = true;
    if (red) {
      name = "Cremello";
      coat = "palomino";
      maneColor = "#f4eedf";
    } else if (blackish) {
      name = "Smoky Cream";
      coat = "palomino";
      maneColor = "#e9dccb";
    } else {
      name = "Perlino";
      coat = "palomino";
      maneColor = "#d9b98f";
    }
  } else if (cr === 1) {
    if (red) {
      name = "Palomino";
      coat = "palomino";
    } else if (blackish) {
      name = "Smoky Black";
      coat = "black";
      special = true;
    } else {
      name = base === "dark_bay" ? "Smoky Brown" : "Buckskin";
      coat = "buckskin";
      special = base === "dark_bay";
    }
  }

  if (dun) {
    special = true;
    if (cr > 0) {
      name = red ? "Dunalino" : blackish ? "Smoky Grullo" : "Dunskin";
    } else if (red) {
      name = "Red Dun";
      coat = "chestnut";
      maneColor = "#7a3f22";
    } else if (blackish) {
      name = "Grullo";
      coat = "grey";
      maneColor = "#262321";
    } else {
      name = "Bay Dun";
      coat = "buckskin";
    }
  }

  if (roan) {
    const roanName = red ? "Strawberry Roan" : blackish ? "Blue Roan" : "Bay Roan";
    name = cr > 0 || dun ? `${name} Roan` : roanName;
    coat = "roan";
    special = special || cr > 0 || dun;
  }
  return { coat, coatName: name, base, maneColor, special };
}

/** Career starts at which a grey horse is fully white (dapples from racing age until then). */
export const GREY_WHITE_AT_STARTS = 24;

/** Grey stage of the coat by career progress (never calendar time). */
export function greyStage(genes: CoatGenes, progress: { racingAge: boolean; starts: number; retired: boolean }): HorseColour["grey"] {
  if (count(genes.grey, "G") === 0) return "none";
  if (!progress.racingAge) return "greying";
  return progress.retired || progress.starts >= GREY_WHITE_AT_STARTS ? "white" : "dapple";
}

/** Base colour in the shared `HorseColour` vocabulary (dark_bay -> seal_brown, liver_chestnut -> liver). */
export function colourBase(c: CoatGenes): HorseColour["base"] {
  const b = baseColour(c);
  return b === "liver_chestnut" ? "liver" : b === "dark_bay" ? "seal_brown" : b;
}

/** Layered coat genetics (coat v2) straight from the genome; renderers resolve it to a palette. */
export function horseColour(genome: Genome, progress: { racingAge: boolean; starts: number; retired: boolean }): HorseColour {
  const c = genome.coat;
  const out: HorseColour = {
    base: colourBase(c),
    cream: count(c.cream, "Cr") as HorseColour["cream"],
    dun: count(c.dun, "D") > 0,
    roan: count(c.roan, "Rn") > 0,
    grey: greyStage(c, progress),
    sabino: count(c.sabino, "Sb1") as HorseColour["sabino"],
  };
  // Genetics v2 colour/pattern genes, only when they show (same rules as visibleTraits), so
  // a horse without them keeps the exact same appearance object as before.
  const g2 = genome.genes2;
  if (!g2) return out;
  const red = out.base === "chestnut" || out.base === "liver";
  if (count(g2.champagne, "Ch") > 0) out.champagne = true;
  if (count(g2.silver, "Z") > 0 && !red) out.silver = true;
  const prl = count(g2.pearl, "prl");
  if (prl === 2 || (prl === 1 && out.cream > 0)) out.pearl = true;
  const to = count(g2.tobiano, "TO");
  if (to > 0) out.tobiano = to as 1 | 2;
  const lp = count(g2.leopard, "LP");
  if (lp === 2) out.leopard = "fewspot";
  else if (lp === 1) out.leopard = count(g2.patn1, "PATN1") > 0 ? "leopard" : "varnish";
  const sw = count(g2.splash, "SW");
  if (sw > 0) out.splash = sw as 1 | 2;
  return out;
}

/**
 * Resolve the coat. Grey depends on career progress, never on calendar time: foals are born
 * coloured, racing greys are dappled, and they go grey by `GREY_WHITE_AT_STARTS` starts or on
 * racing retirement.
 */
export function resolveCoat(genome: Genome, progress: { racingAge: boolean; starts: number; retired: boolean }): CoatPhenotype {
  const c = colouredCoat(genome.coat);
  if (count(genome.coat.grey, "G") === 0) return c;
  if (!progress.racingAge) return { ...c, coatName: `${c.coatName} (greying)` };
  const white = progress.retired || progress.starts >= GREY_WHITE_AT_STARTS;
  return { coat: white ? "grey" : "dapple_grey", coatName: white ? "Grey" : "Dapple Grey", base: c.base, special: c.special };
}

// ---------------------------------------------------------------------------
// White markings
// ---------------------------------------------------------------------------

/** 0..300: polygenic white plus 50 per Sabino-1 copy. */
export function whiteScore(genome: Genome): number {
  return genome.white[0] + genome.white[1] + 50 * count(genome.coat.sabino, "Sb1");
}

/** Face marking by white score (plus a per-horse jitter of ±15): the floor of each band. */
export const FACE_STEPS: [FaceMarking, number][] = [
  ["none", 0],
  ["star", 45],
  ["snip", 70],
  ["stripe", 95],
  ["blaze", 125],
  ["bald", 175],
];
const LEG_STEPS: [LegMarking, number][] = [
  ["none", 0],
  ["coronet", 80],
  ["sock", 110],
  ["stocking", 150],
];

function step<T>(steps: [T, number][], score: number): T {
  let out = steps[0]![0];
  for (const [v, t] of steps) if (score >= t) out = v;
  return out;
}

export interface Markings {
  face: FaceMarking;
  legs: [LegMarking, LegMarking, LegMarking, LegMarking];
  sabino: number;
}

/** Face and leg markings: polygenic score plus fixed per-horse jitter (hind legs carry more white). */
export function resolveMarkings(genome: Genome): Markings {
  const rng = new Rng(`marks|${genome.markingSeed}`);
  const score = whiteScore(genome);
  const face = step(FACE_STEPS, score + rng.range(-15, 15));
  const legs = [0, 1, 2, 3].map((i) => step(LEG_STEPS, score + (i >= 2 ? 20 : 0) + rng.range(-30, 30))) as Markings["legs"];
  const sb = count(genome.coat.sabino, "Sb1");
  const sabino = clamp(sb * 0.3 + (score > 160 ? (score - 160) / 300 : 0), 0, 1);
  return { face, legs, sabino: Math.round(sabino * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Conformation → rig look
// ---------------------------------------------------------------------------

/** Mirrors @thoroughbred/pixel-rig MORPH_RANGE (kept local: game-core does not depend on the rig). */
export const RIG_MORPH_RANGE: Record<MorphKey, [number, number]> = {
  legLength: [0.85, 1.15],
  neckLength: [0.85, 1.2],
  girth: [0.88, 1.15],
  height: [0.9, 1.08],
  headSize: [0.9, 1.12],
};

/** Morph knob = 1 + breed offset + mean allele scaled to 60% of the half-range, quantised to 1/32. */
export function resolveMorph(genome: Genome): RigLook["morph"] {
  const out = {} as RigLook["morph"];
  for (const k of MORPH_KEYS) {
    const [lo, hi] = RIG_MORPH_RANGE[k];
    const half = (hi - lo) / 2;
    let breedOff = 0;
    for (const b of BREEDS) breedOff += (genome.breed[b] * BREED_PROFILES[b].morph[k]) / 1000;
    const mean = (genome.morph[k][0] + genome.morph[k][1]) / 2000;
    const v = 1 + breedOff + mean * half * 0.6;
    out[k] = clamp(Math.round(v * 32) / 32, lo, hi);
  }
  return out;
}

/** Lower variant index is dominant. */
export function resolveVariants(genome: Genome): RigLook["variants"] {
  const d = (p: readonly [number, number]) => Math.min(p[0], p[1]);
  return { head: d(genome.variants.head), mane: d(genome.variants.mane), tail: d(genome.variants.tail), build: d(genome.variants.build) };
}

/** Everything the pixel rig needs beyond `HorseAppearance`: `factory.create(appearance, rigLook(genome))`. */
export function rigLook(genome: Genome): RigLook {
  return { variants: resolveVariants(genome), morph: resolveMorph(genome), seed: genome.markingSeed >>> 0, sabino: resolveMarkings(genome).sabino };
}

/** Shared `HorseAppearance` from genes + career progress + stable silks. */
export function appearanceOf(genome: Genome, progress: { racingAge: boolean; starts: number; retired: boolean }, silks: Silks): HorseAppearance {
  const coat = resolveCoat(genome, progress);
  const m = resolveMarkings(genome);
  const out: HorseAppearance = { coat: coat.coat, face: m.face, legs: m.legs, silks, colour: horseColour(genome, progress) };
  // maneColor stays unset: `colour` carries the exact layered palette now (renderers that
  // predate coat v2, and legacy replays, keep using coat + maneColor as before).
  // Dun primitive markings (dorsal stripe, leg barring) ride with the D allele; a coat that
  // is greying out hides them once the grey shows (foals born to grey still show them).
  const greyShown = count(genome.coat.grey, "G") > 0 && progress.racingAge;
  if (count(genome.coat.dun, "D") > 0 && !greyShown) out.dun = true;
  return out;
}

/** Adult coat name for a coat genotype (greys shown as "Grey"), used by the breeding preview. */
export function adultCoatName(c: CoatGenes): string {
  if (count(c.grey, "G") > 0) return "Grey";
  return colouredCoat(c).coatName;
}

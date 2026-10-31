/**
 * The breeding preview players see (owner decision 2026-10-31: "just what maybe it looks like
 * but its still a chance, no geeky genes or numbers"): possible looks, an outlook in words and
 * warnings in words. The exact odds (`previewBreeding`) stay in game-core for the wiki's
 * worked examples and for tests; they are never sent to a player, because they come from the
 * parents' TRUE genotypes and previewing one horse against known partners would let a careful
 * player read its hidden alleles.
 *
 * Everything here works from a `PublicParent`: what the game has already made public about a
 * horse, and nothing else.
 *
 *   - Stud-book DNA: the coat genotype and the genetics-v2 loci (public on every horse page,
 *     geneticsSummary.ts), with big heart blanked: it is unknown until a horse races or is
 *     scanned, and it doesn't show in a foal's looks anyway.
 *   - Breed shares, the visible face marking, fragile legs (dominant: it shows when present),
 *     whether a parent's racing ended in an injury, and the horse's published best trip band
 *     and surface.
 *   - The revealed potential ranges (phenotype.ts `revealedRanges`): the window the game has
 *     narrowed through racing and scans. The true value sits at a secret position inside it.
 *
 * Hidden things the preview never reads: stat and vigour alleles, aptitude alleles, quirks,
 * body-shape and marking alleles, big heart and the marking seed. Two horses that differ only
 * in those give identical previews (breedingOutlook.test.ts).
 *
 * Breeding outcomes do not change: the real foal is still drawn from the true genotypes at the
 * cover (`cover` / `deliverFoal`). Only the preview changed.
 */
import type { FaceMarking, HorseAppearance, Silks, Surface } from "@thoroughbred/shared";
import { COI_WARN, nickRating } from "./breeding";
import { adultCoatName, appearanceOf, resolveMarkings } from "./coat";
import { inherit } from "./genetics";
import { breedLabel, visibleTraits } from "./geneticsSummary";
import { INBREEDING_AFFECTED, INBREEDING_DEPRESSION_PERMILLE, OVERALL_WEIGHTS, blendBreeds, distanceBand, isFragile, preferredDistanceM, preferredSurface } from "./genome";
import { revealedRanges } from "./phenotype";
import { clampInt, seedFrom } from "./rng";
import { STAT_KEYS, type BreedShares, type CoatGenes, type DistanceAllele, type Genes2, type Genome, type HorseState, type StatRecord } from "./types";

// ---------------------------------------------------------------------------
// What is public about a parent
// ---------------------------------------------------------------------------

export interface PublicParent {
  id: string;
  /** Stud-book coat genotype (public on the horse page). */
  coat: CoatGenes;
  /** Stud-book genetics-v2 loci, big heart blanked (unknown until raced or scanned). */
  genes2: Genes2;
  breed: BreedShares;
  /** The face marking everyone can see. */
  face: FaceMarking;
  /** Revealed potential ranges (racing and scans narrow them). */
  ranges: StatRecord<{ lo: number; hi: number }>;
  /** The horse's published best trip band and surface. */
  tripBand: DistanceAllele;
  surface: Surface;
  /** Fragile legs show with one copy, so this is the whole public fact. */
  fragile: boolean;
  /** The horse's racing career ended in an injury (public record). */
  injured: boolean;
}

/** The public facts about a horse, and nothing hidden. */
export function publicParentOf(state: HorseState): PublicParent {
  const r = revealedRanges(state);
  const ranges = {} as PublicParent["ranges"];
  for (const k of STAT_KEYS) ranges[k] = { lo: r[k].lo, hi: r[k].hi };
  const g = state.genome;
  return {
    id: state.id,
    coat: g.coat,
    genes2: { ...g.genes2, bigHeart: ["n", "n"] },
    breed: g.breed,
    face: resolveMarkings(g).face, // the marking everyone sees on the horse
    ranges,
    tripBand: distanceBand(preferredDistanceM(g)),
    surface: preferredSurface(g),
    fragile: isFragile(g),
    injured: state.career.racingRetired?.reason === "injury",
  };
}

// ---------------------------------------------------------------------------
// Possible looks
// ---------------------------------------------------------------------------

/** How many sample foals the single preview shows (the stallion finder shows one per stallion). */
export const POSSIBLE_LOOKS = 4;

/** The fixed label above the looks strip. */
export const LOOKS_NOTE = "Foals from this pairing could look like this. It's still a chance.";

/**
 * White-spotting score a visible face marking stands for (the middle of its band in
 * coat.ts FACE_STEPS). A parent's hidden white alleles are replaced by this, so the sample
 * foals' markings follow what the parents visibly show.
 */
export const FACE_WHITE_SCORE: Record<FaceMarking, number> = { none: 20, star: 57, snip: 82, stripe: 110, blaze: 150, bald: 200 };

/**
 * A genome holding only the public facts about a parent (coat, v2 loci, breed, visible white);
 * every hidden locus is a fixed neutral value, so the samples can't depend on it.
 */
function lookGenome(p: PublicParent): Genome {
  const sabino = (p.coat.sabino[0] === "Sb1" ? 1 : 0) + (p.coat.sabino[1] === "Sb1" ? 1 : 0);
  const white = clampInt(FACE_WHITE_SCORE[p.face] - 50 * sabino, 0, 200);
  const flat: [number, number] = [0, 0];
  return {
    version: 2,
    stats: { speed: [500, 500], stamina: [500, 500], burst: [500, 500], durability: [500, 500], adaptability: [500, 500], temperament: [500, 500] },
    vigour: [0, 0],
    distance: ["mile", "mile"],
    distanceMod: [0, 0],
    surface: ["T", "D"],
    style: ["stalker", "stalker"],
    maturity: ["normal", "normal"],
    coat: p.coat,
    genes2: p.genes2,
    white: [clampInt(Math.floor(white / 2), 0, 100), clampInt(white - Math.floor(white / 2), 0, 100)],
    morph: { legLength: flat, neckLength: flat, girth: flat, height: flat, headSize: flat },
    variants: { head: [0, 0], mane: [0, 0], tail: [0, 0], build: [0, 0] },
    quirks: { mudlark: [0, 0], gateShy: [0, 0], lateKick: [0, 0], crowdShy: [0, 0] },
    fragile: [0, 0],
    breed: p.breed,
    coi: 0,
    markingSeed: 0,
  };
}

const FACE_WORD: Record<FaceMarking, string | null> = { none: null, star: "star", snip: "snip", stripe: "stripe", blaze: "blaze", bald: "bald face" };

export interface PossibleLook {
  /** What the portrait renderer draws (coat, layered colour, markings). */
  appearance: HorseAppearance;
  /** A few words, e.g. "Bay · blaze · Tobiano". */
  caption: string;
}

/**
 * Sample foals of a pairing, drawn from the public facts only (`lookGenome`) with the same
 * inheritance rules as a real foal. Seeded by the two horses and the UTC day number, so the
 * preview shows the same samples all day (repeating it can't farm statistics), and new ones
 * the next day. Drawn as young racehorses (a grey is already dappling).
 */
export function possibleLooks(sire: PublicParent, dam: PublicParent, day: number, silks: Silks, count: number = POSSIBLE_LOOKS): PossibleLook[] {
  const sg = lookGenome(sire);
  const dg = lookGenome(dam);
  const out: PossibleLook[] = [];
  for (let i = 0; i < count; i++) {
    const g = inherit(sg, dg, seedFrom("breeding-look", sire.id, dam.id, day, i));
    const appearance = appearanceOf(g, { racingAge: true, starts: 0, retired: false }, silks);
    const face = FACE_WORD[appearance.face];
    const caption = [adultCoatName(g.coat), ...(face ? [face] : []), ...visibleTraits(g)].join(" · ");
    out.push({ appearance, caption });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The outlook (internal numbers, public words)
// ---------------------------------------------------------------------------

/**
 * Half-width of the foal's overall around the parents' midpoint (a triangular spread). Fitted
 * to the real inheritance: foundation pairings put 80% of foals in a band about 155 wide
 * (`previewBreeding` p10..p90), which a triangle of half-width 140 matches.
 */
export const OUTLOOK_SEGREGATION = 140;
/** The spread grows by the parents' revealed-range widths (overall) summed, divided by this: less known, wider. */
export const OUTLOOK_UNCERTAINTY_DIV = 8;
/**
 * A rising line (parents above their own parents' public level) falls back by this share of
 * the gap, permille: the family pull and headroom in genetics.ts, seen from public data.
 */
export const OUTLOOK_FAMILY_PULL_PERMILLE = 250;
/** Parents this far (overall) above their parents' public level are a "rising line". */
export const OUTLOOK_RISING_GAP = 20;
/** A parent whose revealed ranges are this wide or less is "well known" (scanned or raced a lot). */
export const OUTLOOK_CLEAR_WIDTH = 64;

/**
 * The outlook bands, permille of foals (internal only, never sent):
 *   - `risk`: below both parents >= riskBelow AND at least riskMargin above the chance to
 *     beat both (inbreeding or a rising line pulls the foal down);
 *   - `upside`: beats both parents >= realChance;
 *   - `level`: beats both >= level;
 *   - `longshot`: anything less (the parents are far apart: the foal will most likely land
 *     between them).
 */
export const OUTLOOK_BANDS = { riskBelow: 350, riskMargin: 50, realChance: 350, level: 120 } as const;

export type OutlookKey = "upside" | "level" | "longshot" | "risk";
/** The fixed vocabulary of the outlook (the only thing a player sees of the numbers). */
export const OUTLOOK_PHRASES: Record<OutlookKey, string> = {
  upside: "A real chance to beat both parents",
  level: "Likely around the parents' level",
  longshot: "A long shot to beat both parents",
  risk: "Risk of falling below both parents",
};

export type CertaintyKey = "clear" | "hazy";
export const CERTAINTY_PHRASES: Record<CertaintyKey, string> = {
  clear: "Both parents are well known, so this is a fair guess. The foal is still a surprise.",
  hazy: "Not much is known yet about one parent's ability, so expect surprises either way.",
};

export type NickWord = "Excellent nick" | "Good nick" | "Fair nick" | "Poor nick";

export interface OutlookWarning {
  key: "inbreeding" | "related" | "fragile" | "injury" | "rising" | "foundation" | "established";
  tone: "warn" | "note";
  text: string;
}

/** What the player sees: words only. */
export interface PairingOutlook {
  outlook: { key: OutlookKey; phrase: string };
  certainty: { key: CertaintyKey; phrase: string };
  /** How well the lines combine, from public facts (outlook, trips, surfaces, kinship). */
  nick: NickWord;
  warnings: OutlookWarning[];
  /** The foal's breed by name, e.g. "Anglo-Arab" (the exact average of the parents, public). */
  breed: string;
}

/** The numbers behind the words. Server-side only: rank with them, never send them. */
export interface OutlookNumbers {
  /** Expected foal overall (public basis). */
  centre: number;
  /** Half-width of the spread. */
  spread: number;
  /** Permille of foals above the better / below the weaker parent's public level. */
  beats: number;
  below: number;
  /** The stallion finder's ranking score (higher is better). */
  score: number;
  lineage: "foundation" | "rising" | "established";
  clear: boolean;
}

const OVERALL_DEN = STAT_KEYS.reduce((a, k) => a + OVERALL_WEIGHTS[k], 0);
/** Public level of a horse: the overall of its revealed-range midpoints. */
export function publicLevel(p: Pick<PublicParent, "ranges">): number {
  return Math.round(STAT_KEYS.reduce((a, k) => a + ((p.ranges[k].lo + p.ranges[k].hi) / 2) * OVERALL_WEIGHTS[k], 0) / OVERALL_DEN);
}
function publicWidth(p: Pick<PublicParent, "ranges">): number {
  return Math.round(STAT_KEYS.reduce((a, k) => a + (p.ranges[k].hi - p.ranges[k].lo) * OVERALL_WEIGHTS[k], 0) / OVERALL_DEN);
}

/** Permille of a triangular spread (centre 0, half-width r) above `g`. */
function tailAbove(g: number, r: number): number {
  if (g >= r) return 0;
  if (g <= -r) return 1000;
  if (g >= 0) return Math.round(((r - g) * (r - g) * 500) / (r * r));
  return 1000 - Math.round(((r + g) * (r + g) * 500) / (r * r));
}

/** The band for a pair of permilles (OUTLOOK_BANDS). */
export function outlookBand(beats: number, below: number): OutlookKey {
  const b = OUTLOOK_BANDS;
  if (below >= b.riskBelow && below >= beats + b.riskMargin) return "risk";
  if (beats >= b.realChance) return "upside";
  if (beats >= b.level) return "level";
  return "longshot";
}

export interface OutlookOptions {
  /** COI of the foal, permille (public: it comes from the pedigree). */
  coi: number;
  /** The parents' own parents (public facts), as many as are on record. */
  grandparents?: readonly Pick<PublicParent, "ranges">[];
}

/** The internal numbers (public basis only). */
export function outlookNumbers(sire: PublicParent, dam: PublicParent, opts: OutlookOptions): OutlookNumbers {
  const ls = publicLevel(sire);
  const ld = publicLevel(dam);
  const mid = (ls + ld) / 2;
  // Inbreeding depression on the affected stats, as genome.expressStat applies it.
  const drag = (mid * clampInt(opts.coi, 0, 1000) * INBREEDING_DEPRESSION_PERMILLE * INBREEDING_AFFECTED.length) / (1_000_000 * STAT_KEYS.length);
  const gps = opts.grandparents ?? [];
  let lineage: OutlookNumbers["lineage"] = "foundation";
  let pull = 0;
  if (gps.length) {
    const gl = gps.reduce((a, g) => a + publicLevel(g), 0) / gps.length;
    lineage = mid - gl > OUTLOOK_RISING_GAP ? "rising" : "established";
    if (mid > gl) pull = ((mid - gl) * OUTLOOK_FAMILY_PULL_PERMILLE) / 1000;
  }
  const centre = Math.round(mid - drag - pull);
  const ws = publicWidth(sire);
  const wd = publicWidth(dam);
  const spread = OUTLOOK_SEGREGATION + Math.floor((ws + wd) / OUTLOOK_UNCERTAINTY_DIV);
  const beats = tailAbove(Math.max(ls, ld) - centre, spread);
  const below = 1000 - tailAbove(Math.min(ls, ld) - centre, spread);
  return { centre, spread, beats, below, score: centre * 1000 + beats, lineage, clear: ws <= OUTLOOK_CLEAR_WIDTH && wd <= OUTLOOK_CLEAR_WIDTH };
}

/**
 * The preview in words, from the public facts only. Nick uses the same weights as the old
 * numeric rating (`nickRating`), fed public inputs: the outlook's chance to beat both, whether
 * the parents' best trips and surfaces agree, and the kinship.
 */
export function pairingOutlook(sire: PublicParent, dam: PublicParent, opts: OutlookOptions): PairingOutlook {
  const n = outlookNumbers(sire, dam, opts);
  const key = outlookBand(n.beats, n.below);
  const nick = nickRating(n.beats / 1000, sire.tripBand === dam.tripBand ? 1 : 0.5, sire.surface === dam.surface ? 1 : 0.5, opts.coi).label;
  const warnings: OutlookWarning[] = [];
  if (opts.coi >= COI_WARN) warnings.push({ key: "inbreeding", tone: "warn", text: "Closely related: higher risk of weakness (less durability and temperament, more bad mutations)." });
  else if (opts.coi > 0) warnings.push({ key: "related", tone: "note", text: "Distantly related: a little shared ancestry, nothing to worry about." });
  if (sire.fragile || dam.fragile) warnings.push({ key: "fragile", tone: "warn", text: "Fragile legs in the family: the foal may inherit them (more injuries, less durability)." });
  else if (sire.injured || dam.injured) warnings.push({ key: "injury", tone: "warn", text: "A parent's racing ended in an injury: the foal may inherit fragile legs." });
  if (n.lineage === "rising") warnings.push({ key: "rising", tone: "note", text: "Rising line: these parents are well above their own parents, so the foal has less room to climb and tends to fall back a little." });
  else if (n.lineage === "foundation") warnings.push({ key: "foundation", tone: "note", text: "Foundation stock: no grandparents on record, so only the parents set the family limits." });
  else warnings.push({ key: "established", tone: "note", text: "Established line: the family sets how far above its best a foal can land." });
  return {
    outlook: { key, phrase: OUTLOOK_PHRASES[key] },
    certainty: { key: n.clear ? "clear" : "hazy", phrase: CERTAINTY_PHRASES[n.clear ? "clear" : "hazy"] },
    nick: `${nick} nick` as NickWord,
    warnings,
    breed: breedLabel(blendBreeds(sire.breed, dam.breed)),
  };
}

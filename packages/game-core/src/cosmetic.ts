/**
 * Cosmetic colour genes (coat audit, 2026-11): shade modifiers and rare colours.
 *
 * Purely visual. They live in their own genome field (`genome.cosmetic`), draw from their own
 * random streams (minting `seed|mint-g3`, breeding `seed|g3`), and no stat, potential, injury,
 * trip or breeding rule reads them (cosmetic.test.ts guards it).
 *
 * Shade modifiers (polygenic, every breed): sooty (a darker, dappled top line), flaxen (pale mane
 * and tail on a chestnut), pangaré (pale muzzle, flanks and belly). Each allele is 0..100; the
 * pair's sum against a threshold decides whether it shows.
 *
 * Rare colours (owner decision, 2026-11): they start as "duds" and enter the game ONLY through
 * (a) some of the Club's replacement house stallions at stud (one rare gene each, on a weak
 * genome) and (b) a tiny natural chance in pack foals at population frequency (no special odds,
 * no price premium). Never in Club sale lots, Club runners or Club leases. Their foals are
 * player-bred and tradeable everywhere: rarity comes from inheritance.
 *   - Mushroom (mu, recessive): mu/mu on a chestnut, a soft grey-brown body.
 *   - Rabicano (Rb, dominant): white ticking on the flanks, a skunk tail.
 *   - Brindle (BR1, X-linked dominant): a mare passes one of her two X to every foal, so a
 *     BR1/n mare gives it to about half her foals; a stallion has one X (slot 0) and gives it to
 *     every daughter and to no son.
 *   - Dominant white (W, dominant): white from birth, dark eyes. Not lethal in this game.
 *   - Bend Or spots (BO, dominant): dark smudges on a red coat (chestnut, palomino).
 *   - Birdcatcher spots (Bc, dominant): small white freckles.
 * No lethal colour genes (no lethal white overo, no lavender).
 */
import { BREEDS, type Breed, type BreedShares, type CosmeticGenes, type Genome } from "./types";
import { Rng, clampInt } from "./rng";

export const RARE_COLOURS = ["mushroom", "rabicano", "brindle", "dominantWhite", "bendOr", "birdcatcher"] as const;
export type RareColour = (typeof RARE_COLOURS)[number];

/** The non-wild allele of each rare colour gene. */
export const RARE_ALLELE = { mushroom: "mu", rabicano: "Rb", brindle: "BR1", dominantWhite: "W", bendOr: "BO", birdcatcher: "Bc" } as const satisfies Record<RareColour, string>;

/** Natural (population) frequency of each rare allele in pack foals, permille per allele draw. */
export const NATURAL_RARE_PERMILLE: Record<RareColour, number> = { mushroom: 6, rabicano: 4, brindle: 2, dominantWhite: 2, bendOr: 5, birdcatcher: 4 };

export const SHADE_KEYS = ["sooty", "flaxen", "pangare"] as const;
export type ShadeKey = (typeof SHADE_KEYS)[number];

/** Pair sum at which a shade modifier shows (sooty: light, heavy). */
export const SOOTY_LIGHT = 130;
export const SOOTY_HEAVY = 165;
export const FLAXEN_SHOWS = 110;
export const PANGARE_SHOWS = 130;

/** Mean shade allele per breed (sd 22). */
const SHADE_MEAN_DEFAULT: Record<ShadeKey, number> = { sooty: 45, flaxen: 42, pangare: 38 };
const SHADE_MEAN: Partial<Record<Breed, Partial<Record<ShadeKey, number>>>> = {
  quarterHorse: { sooty: 54 },
  paintHorse: { sooty: 50 },
  mustang: { sooty: 52, pangare: 58 },
  arabian: { flaxen: 52 },
  warmblood: { flaxen: 50 },
  marwari: { pangare: 46 },
  friesian: { pangare: 30 },
};
export const SHADE_SD = 22;

/** Wild type: what every horse from before these genes reads as (no shade, no rare colour). */
export const WILD_COSMETIC: CosmeticGenes = {
  sooty: [0, 0],
  flaxen: [0, 0],
  pangare: [0, 0],
  mushroom: ["n", "n"],
  rabicano: ["n", "n"],
  brindle: ["n", "n"],
  dominantWhite: ["n", "n"],
  bendOr: ["n", "n"],
  birdcatcher: ["n", "n"],
};

/** The genome's cosmetic genes, wild type when it has none. */
export function cosmeticOf(genome: Pick<Genome, "cosmetic">): CosmeticGenes {
  return genome.cosmetic ?? WILD_COSMETIC;
}

const has = (pair: readonly [string, string], allele: string) => pair[0] === allele || pair[1] === allele;
const both = (pair: readonly [string, string], allele: string) => pair[0] === allele && pair[1] === allele;

/** Which rare colours a genome carries at all (one copy is enough; mushroom carriers included). */
export function carriedRareColours(genome: Pick<Genome, "cosmetic">): RareColour[] {
  const c = cosmeticOf(genome);
  return RARE_COLOURS.filter((k) => has(c[k], RARE_ALLELE[k]));
}

/** Mushroom shows only as mu/mu (recessive); every other rare colour with one copy. */
export function rareShows(genome: Pick<Genome, "cosmetic">, k: RareColour): boolean {
  const c = cosmeticOf(genome);
  return k === "mushroom" ? both(c.mushroom, "mu") : has(c[k], RARE_ALLELE[k]);
}

export const shadeSum = (genome: Pick<Genome, "cosmetic">, k: ShadeKey) => {
  const p = cosmeticOf(genome)[k];
  return p[0] + p[1];
};

/** Rare-colour policy of a mint: none (default), natural frequency (packs), or one forced gene. */
export type RareMint = "none" | "natural" | RareColour;

/**
 * Mint the cosmetic genes from their own stream. Shade alleles follow the breeds (each allele
 * from one ancestral breed by share); rare alleles only when `rare` allows them.
 */
export function mintCosmetic(seed: string, shares: BreedShares, rare: RareMint = "none"): CosmeticGenes {
  const rng = new Rng(`${seed}|mint-g3`);
  const breedOf = (): Breed => BREEDS[rng.weighted(BREEDS.map((b) => shares[b]))] ?? "thoroughbred";
  const shade = (k: ShadeKey): [number, number] => {
    const draw = () => clampInt((SHADE_MEAN[breedOf()]?.[k] ?? SHADE_MEAN_DEFAULT[k]) + rng.normal() * SHADE_SD, 0, 100);
    return [draw(), draw()];
  };
  const out: CosmeticGenes = { ...WILD_COSMETIC, sooty: shade("sooty"), flaxen: shade("flaxen"), pangare: shade("pangare") };
  // the rare draws always happen (fixed stream positions), whatever the policy
  for (const k of RARE_COLOURS) {
    const a = rng.chance(NATURAL_RARE_PERMILLE[k]);
    const b = rng.chance(NATURAL_RARE_PERMILLE[k]);
    if (rare !== "natural") continue;
    const allele = RARE_ALLELE[k];
    // brindle is X-linked: a mint draws one X (slot 0), so a colt never carries it in slot 1
    (out as unknown as Record<string, [string, string]>)[k] = k === "brindle" ? [a ? allele : "n", "n"] : [a ? allele : "n", b ? allele : "n"];
  }
  if (rare !== "none" && rare !== "natural") (out as unknown as Record<string, [string, string]>)[rare] = rare === "mushroom" ? ["mu", "mu"] : [RARE_ALLELE[rare], "n"];
  return out;
}

/** Foal sex from the foal seed, exactly as deliverFoal draws it. */
export function foalSexOf(foalSeed: string): "colt" | "filly" {
  return new Rng(`${foalSeed}|sex`).chance(500) ? "colt" : "filly";
}

/** Small polygenic drift of a shade allele (like the white tendency). */
const DRIFT_PERMILLE = 150;

/**
 * The foal's cosmetic genes, from their own stream. Null when neither parent has any (a line from
 * before these genes stays as it was). Autosomal genes: one allele from each parent. Brindle
 * (X-linked): a filly gets her sire's X (slot 0) and one of her dam's two; a colt gets one of his
 * dam's X and nothing from his sire.
 */
export function inheritCosmetic(sire: Pick<Genome, "cosmetic">, dam: Pick<Genome, "cosmetic">, foalSeed: string): CosmeticGenes | null {
  if (!sire.cosmetic && !dam.cosmetic) return null;
  const s = cosmeticOf(sire);
  const d = cosmeticOf(dam);
  const rng = new Rng(`${foalSeed}|g3`);
  const pick = <T>(p: readonly [T, T]): T => p[rng.int(2)]!;
  const shade = (k: ShadeKey): [number, number] => {
    const one = (v: number) => (rng.chance(DRIFT_PERMILLE) ? clampInt(v + rng.range(-6, 6), 0, 100) : v);
    return [one(pick(s[k])), one(pick(d[k]))];
  };
  const out = { sooty: shade("sooty"), flaxen: shade("flaxen"), pangare: shade("pangare") } as CosmeticGenes;
  const rec = out as unknown as Record<string, [string, string]>;
  for (const k of ["mushroom", "rabicano", "dominantWhite", "bendOr", "birdcatcher"] as const) rec[k] = [pick(s[k]), pick(d[k])];
  const damX = pick(d.brindle);
  out.brindle = foalSexOf(foalSeed) === "filly" ? [s.brindle[0], damX] : [damX, "n"];
  return out;
}

/**
 * A house stallion standing for a rare colour shows it: grey removed (it would whiten the coat
 * out), and a red base for the colours that only show on red (mushroom, Bend Or spots).
 */
export function showRareColour(genome: Genome, k: RareColour): Genome {
  const coat = { ...genome.coat, grey: ["n", "n"] as Genome["coat"]["grey"] };
  if (k === "mushroom" || k === "bendOr") {
    coat.extension = ["e", "e"];
    coat.cream = ["n", "n"];
  }
  return { ...genome, coat };
}

/**
 * Club house stallions (owner decision): every third replacement stallion (serials from
 * `firstReplacement` on: 0, 3, 6...) stands for one rare colour, in turn, on a weak genome.
 * The first roster and every other stallion carry none.
 */
export function houseStudRareColour(serial: number, firstReplacement: number): RareColour | null {
  const k = serial - firstReplacement;
  if (k < 0 || k % 3 !== 0) return null;
  return RARE_COLOURS[(k / 3) % RARE_COLOURS.length]!;
}

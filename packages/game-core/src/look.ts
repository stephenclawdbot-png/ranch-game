/**
 * Body build and mane/tail style (visual research 2026-11-01, V-04 and V-05): how a horse's
 * existing genes show on its body. Pure reads of the genome: nothing here writes a gene, and no
 * rule (racing, breeding, training, sales) reads the result, so a horse's performance never
 * depends on it (a test guards both). Every view draws the same horse from these numbers.
 *
 * Build: five small steps, -2..+2 (0 = the painted horse):
 *   - leg, neck, girth, head: the morph alleles (legLength, neckLength, girth, headSize) plus the
 *     breed's offset, scaled like the pixel rig's morph knobs (coat.ts resolveMorph), one step per
 *     quarter of the knob's half-range;
 *   - height: the horse's size (genome.ts sizePermille: breed size, the polygenic height alleles
 *     and the Ht gene), one step per 35 permille around +20.
 * Hair: mane 0 (pulled, as painted) .. 3 (long), tail 0 (as painted) .. 2 (long), thick or fine,
 * straight or wavy, from the breed's own tendency, the mane and tail variant alleles and the
 * horse's marking seed (so two horses of one breed still differ). Feathered horses (fe/fe) always
 * carry a long mane and tail.
 */
import type { HorseAppearance } from "@thoroughbred/shared";
import { BREEDS, type Breed, type Genome, type MorphKey } from "./types";
import { BREED_PROFILES, sizePermille } from "./genome";
import { RIG_MORPH_RANGE, resolveVariants } from "./coat";

export type BodyBuild = NonNullable<HorseAppearance["build"]>;
export type HairStyle = NonNullable<HorseAppearance["hair"]>;

const step = (v: number) => Math.max(-2, Math.min(2, Math.round(v)));

/** One morph key's score in quarter steps of its knob half-range (breed offset + 60 % of the mean allele). */
function morphScore(genome: Pick<Genome, "breed" | "morph">, k: MorphKey): number {
  const [lo, hi] = RIG_MORPH_RANGE[k];
  const half = (hi - lo) / 2;
  let breedOff = 0;
  for (const b of BREEDS) breedOff += ((genome.breed[b] ?? 0) * BREED_PROFILES[b].morph[k]) / 1000;
  const mean = (genome.morph[k][0] + genome.morph[k][1]) / 2000;
  return (breedOff / half + mean * 0.6) * 4;
}

/** Size (permille) of the 0 height step and permille per step. */
export const BUILD_HEIGHT_ZERO = 20;
export const BUILD_HEIGHT_STEP = 35;

/** The horse's body build (see the module comment). Same genome, same build, always. */
export function buildOf(genome: Pick<Genome, "breed" | "morph" | "genes2">): BodyBuild {
  return {
    height: step((sizePermille(genome) - BUILD_HEIGHT_ZERO) / BUILD_HEIGHT_STEP),
    leg: step(morphScore(genome, "legLength")),
    neck: step(morphScore(genome, "neckLength")),
    girth: step(morphScore(genome, "girth")),
    head: step(morphScore(genome, "headSize")),
  };
}

/**
 * Each breed's mane and tail: base mane (0..3) and tail (0..2) length, and how often the hair is
 * thick and wavy (permille). Real tendencies: Thoroughbreds race with a pulled mane, Akhal-Tekes
 * and Appaloosas have fine, sparse manes and tails, Andalusians and Friesians long, thick, wavy
 * ones, Mustangs grow theirs out.
 */
export const BREED_HAIR: Record<Breed, { mane: number; tail: number; thick: number; wave: number }> = {
  thoroughbred: { mane: 0, tail: 1, thick: 300, wave: 100 },
  arabian: { mane: 1, tail: 1, thick: 200, wave: 150 },
  quarterHorse: { mane: 0, tail: 1, thick: 600, wave: 100 },
  akhalTeke: { mane: 0, tail: 0, thick: 0, wave: 50 },
  standardbred: { mane: 1, tail: 1, thick: 500, wave: 100 },
  appaloosa: { mane: 0, tail: 0, thick: 50, wave: 100 },
  paintHorse: { mane: 1, tail: 1, thick: 600, wave: 200 },
  mustang: { mane: 2, tail: 2, thick: 700, wave: 500 },
  andalusian: { mane: 3, tail: 2, thick: 900, wave: 800 },
  friesian: { mane: 3, tail: 2, thick: 1000, wave: 700 },
  warmblood: { mane: 1, tail: 1, thick: 600, wave: 200 },
  marwari: { mane: 1, tail: 1, thick: 400, wave: 300 },
};

/** Variant allele (dominant, 0..7) -> mane / tail length nudge. */
const VARIANT_NUDGE = [0, 1, 1, -1, 1, -1, 2, -1] as const;

/** A per-horse jitter from the marking seed: -1, 0 or +1 (one in five each way), and 0..999. */
const seedBits = (seed: number, salt: number) => {
  let h = Math.imul((seed >>> 0) ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

/** The horse's mane and tail (see the module comment). Same genome, same hair, always. */
export function hairOf(genome: Pick<Genome, "breed" | "variants" | "markingSeed" | "genes2">): HairStyle {
  let mane = 0;
  let tail = 0;
  let thick = 0;
  let wave = 0;
  for (const b of BREEDS) {
    const s = genome.breed[b] ?? 0;
    const p = BREED_HAIR[b];
    mane += s * p.mane;
    tail += s * p.tail;
    thick += s * p.thick;
    wave += s * p.wave;
  }
  const v = resolveVariants(genome as Genome);
  const seed = genome.markingSeed >>> 0;
  const jit = (salt: number) => {
    const r = seedBits(seed, salt) % 5;
    return r === 0 ? -1 : r === 1 ? 1 : 0;
  };
  const maneN = Math.round(mane / 1000) + VARIANT_NUDGE[v.mane % 8]! + jit(1);
  const tailN = Math.round(tail / 1000) + (VARIANT_NUDGE[v.tail % 8]! > 0 ? 1 : 0) + jit(2);
  const fe = genome.genes2 ? genome.genes2.feather[0] === "fe" && genome.genes2.feather[1] === "fe" : false;
  return {
    mane: fe ? 3 : Math.max(0, Math.min(3, maneN)),
    tail: fe ? 2 : Math.max(0, Math.min(2, tailN)),
    thick: seedBits(seed, 3) % 1000 < (thick / 1000) * 0.8 + 100,
    wave: (seedBits(seed, 4) % 1000) < wave / 1000,
  };
}

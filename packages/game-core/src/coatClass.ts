/**
 * Coat class (visual research V-07): a small, factual tag beside a coat's name, from the look
 * (phenotype) and the breeds' own allele frequencies. The Jockey Club's colour guide (Principal
 * Rules and Requirements of The American Stud Book, Section IV) recognises bay, dark bay or
 * brown, black, chestnut, gray/roan, palomino and white for Thoroughbreds; white markings are
 * normal, body-spotting patterns are not recognised by mainstream Thoroughbred registries.
 *   - "Thoroughbred colour": bay, seal brown, black, chestnut, liver chestnut, grey (any stage),
 *     with sooty or flaxen shading and face or leg markings;
 *   - "rare in Thoroughbreds": registry colours or patterns that are uncommon in the breed:
 *     roan, palomino, sabino-type white, dominant white, rabicano, Bend Or and Birdcatcher spots,
 *     pangaré, brindle;
 *   - "a <breed> colour": colours that belong to other breeds in the game (buckskin and the
 *     other creams, dun, champagne, silver, pearl, tobiano, leopard, splash, feathering), named
 *     after the horse's own breed when it carries the gene, else the breed that carries it most;
 *   - "not a Thoroughbred colour": the rest (mushroom).
 * Looks only: it reads the coat a horse shows, never its hidden genes, and no rule reads it.
 */
import type { HorseAppearance } from "@thoroughbred/shared";
import { BREED_PROFILES, type BreedProfile } from "./genome";
import { BREED_LABEL } from "./geneticsSummary";
import { BREEDS, type Breed } from "./types";

export type CoatClassKind = "thoroughbred" | "rareInThoroughbreds" | "breed" | "notThoroughbred";

export interface CoatClass {
  kind: CoatClassKind;
  /** The tag as shown: "Thoroughbred colour", "rare in Thoroughbreds", "an Appaloosa colour"... */
  tag: string;
  /** The breed a "breed colour" belongs to. */
  breed?: Breed;
  /** What made it so, in words ("tobiano", "buckskin"...). */
  because?: string;
}

type Look = Pick<HorseAppearance, "coat" | "colour" | "feather" | "dun" | "head">;
type AlleleKey = { coat: keyof BreedProfile["coat"] } | { genes2: keyof BreedProfile["genes2"] };

const freqOf = (b: Breed, k: AlleleKey) => ("coat" in k ? BREED_PROFILES[b].coat[k.coat] : BREED_PROFILES[b].genes2[k.genes2]);

/** The breed a gene's colour belongs to: the horse's own breed when it carries it (at least half the top frequency), else the breed that carries it most. */
export function breedOfColour(k: AlleleKey, own?: string | null): Breed {
  let best: Breed = BREEDS[0];
  let top = -1;
  for (const b of BREEDS) {
    if (b === "thoroughbred") continue;
    const f = freqOf(b, k);
    if (f > top) {
      top = f;
      best = b;
    }
  }
  const mine = own && (BREEDS as readonly string[]).includes(own) && own !== "thoroughbred" ? (own as Breed) : null;
  return mine && freqOf(mine, k) > 0 && freqOf(mine, k) * 2 >= top ? mine : best;
}

const article = (w: string) => (/^[AEIOU]/i.test(w) ? "an" : "a");

/** The coat class of a look (see the module comment). */
export function coatClassOf(look: Look): CoatClass {
  const c = look.colour;
  const own = look.head ?? null;
  const breedColour = (k: AlleleKey, because: string): CoatClass => {
    const breed = breedOfColour(k, own);
    const label = BREED_LABEL[breed];
    return { kind: "breed", tag: `${article(label)} ${label} colour`, breed, because };
  };
  if (c) {
    const red = c.base === "chestnut" || c.base === "liver";
    if (c.leopard) return breedColour({ genes2: "LP" }, c.leopard === "varnish" ? "varnish roan" : "leopard spots");
    if (c.tobiano) return breedColour({ genes2: "TO" }, "tobiano");
    if (c.splash) return breedColour({ genes2: "SW" }, "splashed white");
    if (c.champagne) return breedColour({ genes2: "Ch" }, "champagne");
    if (c.silver) return breedColour({ genes2: "Z" }, "silver");
    if (c.pearl) return breedColour({ genes2: "prl" }, "pearl");
    if (c.dun || look.dun) return breedColour({ coat: "D" }, "dun");
    if (c.cream === 2 || (c.cream === 1 && !red)) return breedColour({ coat: "Cr" }, c.cream === 2 ? "double cream" : c.base === "black" ? "smoky black" : "buckskin");
    if (look.feather) return breedColour({ genes2: "fe" }, "feathering");
    if (c.mushroom) return { kind: "notThoroughbred", tag: "not a Thoroughbred colour", because: "mushroom" };
    const rare = c.roan ? "roan" : c.cream === 1 ? "palomino" : c.dominantWhite ? "dominant white" : c.sabino ? "sabino white" : c.rabicano ? "rabicano" : c.brindle ? "brindle" : c.bendOr ? "Bend Or spots" : c.birdcatcher ? "Birdcatcher spots" : c.pangare ? "pangaré" : null;
    if (rare) return { kind: "rareInThoroughbreds", tag: "rare in Thoroughbreds", because: rare };
    return { kind: "thoroughbred", tag: "Thoroughbred colour" };
  }
  // older looks (no layered colour): the painted coat names
  if (look.feather) return breedColour({ genes2: "fe" }, "feathering");
  if (look.coat === "buckskin") return breedColour({ coat: "Cr" }, "buckskin");
  if (look.coat === "roan" || look.coat === "palomino") return { kind: "rareInThoroughbreds", tag: "rare in Thoroughbreds", because: look.coat };
  return { kind: "thoroughbred", tag: "Thoroughbred colour" };
}

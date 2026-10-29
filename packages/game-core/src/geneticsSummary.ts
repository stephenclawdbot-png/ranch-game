/**
 * Genetics for display: coat genotype, white markings, breed mix, build, inbreeding and
 * revealed quirks as one plain-JSON object, safe to send to any browser.
 *
 * Coat genetics are public stud-book information, so any viewer may see them. Everything
 * about ability is NOT here: stat alleles, vigour, distance/surface/style/maturity alleles
 * and potentials stay hidden (ranges only, narrowed by the Pedigree Scan), and quirks are
 * only listed when they have been revealed through racing.
 *
 * The genetics-v2 genes (docs/genetics-v2.md) are stud-book DNA tests: public like the coat,
 * with one exception. Big heart stays unknown until the horse races or is scanned.
 */
import type { FaceMarking, HorseAppearance, LegMarking } from "@thoroughbred/shared";
import { adultCoatName } from "./coat";
import { BIG_HEART_STAMINA, IRON_LEGS_RISK, MSTN_STAT_SHIFT, MSTN_TRIP_M, SIZE_PER_HT_PERMILLE, isFragile, mstnType, sizePermille, sizeStatDelta } from "./genome";
import { BREEDS, QUIRK_KEYS, STAT_KEYS, type Breed, type BreedShares, type Genome, type QuirkKey } from "./types";

/** One coat locus in standard notation (dominant allele first) with its plain meaning. */
export interface GeneLine {
  locus: string;
  alleles: string;
  meaning: string;
  /** True when the genotype hides something the coat doesn't show (rendered muted). */
  carried: boolean;
}

export interface GeneticsSummary {
  /** Phenotype, plus the colour a grey was born as (null for non-greys). */
  coat: { name: string; bornAs: string | null; loci: GeneLine[] };
  /** The 14 genetics-v2 loci (colour/pattern, body and performance genes). */
  genes2: GeneLine[];
  /** Visible v2 traits by name (champagne, tobiano, leopard...). Not drawn by any renderer yet. */
  traits: string[];
  /** Body size against an average Thoroughbred and what it does to the stats (zero-sum). */
  size: { pct: number; text: string; effect: string };
  white: { face: string; legs: string; sabino: "n/n" | "n/Sb1" | "Sb1/Sb1"; tendency: "low" | "medium" | "high" };
  /** Non-zero breed shares in %, largest first. */
  breed: { key: Breed; label: string; share: number }[];
  /** Named-cross label, e.g. "Purebred Arabian", "Anglo-Arab" or "Crossbred (TB × QH)". */
  breedLabel: string;
  /** Breed label plus the breed mix as one line. */
  breedLine: string;
  /** 2–3 descriptive words, e.g. "long-legged, deep-girthed, tall". */
  build: string;
  /** COI: percent with one decimal, "None" when 0. */
  inbreeding: { permille: number; text: string };
  quirks: { key: QuirkKey; label: string }[];
  /** Fragile legs (inherited): public stud-book information, like the coat. */
  fragile: boolean;
}

const count = <T extends string>(pair: readonly [T, T], v: T) => (pair[0] === v ? 1 : 0) + (pair[1] === v ? 1 : 0);
/** Standard notation: the more dominant allele first. */
const join = <T extends string>(pair: readonly [T, T], order: readonly T[]) => [...pair].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join("/");

const FACE_LABEL: Record<FaceMarking, string> = { none: "Plain face", star: "Star", snip: "Snip", stripe: "Stripe", blaze: "Blaze", bald: "Bald face" };
const LEG_LABEL: Record<LegMarking, string> = { none: "", coronet: "coronet", sock: "sock", stocking: "stocking" };
const LEG_NAMES = ["near fore", "off fore", "near hind", "off hind"];

export const BREED_LABEL: Record<Breed, string> = {
  thoroughbred: "Thoroughbred",
  arabian: "Arabian",
  quarterHorse: "Quarter Horse",
  akhalTeke: "Akhal-Teke",
  standardbred: "Standardbred",
  appaloosa: "Appaloosa",
  paintHorse: "Paint Horse",
  mustang: "Mustang",
  andalusian: "Andalusian",
  friesian: "Friesian",
  warmblood: "Warmblood",
  marwari: "Marwari",
};
const BREED_SHORT: Record<Breed, string> = {
  thoroughbred: "TB",
  arabian: "Arabian",
  quarterHorse: "QH",
  akhalTeke: "Akhal-Teke",
  standardbred: "Standardbred",
  appaloosa: "Appaloosa",
  paintHorse: "Paint",
  mustang: "Mustang",
  andalusian: "Andalusian",
  friesian: "Friesian",
  warmblood: "Warmblood",
  marwari: "Marwari",
};

/** A horse is a purebred when one breed has at least this share (permille; the 7/8 rule). */
export const PUREBRED_PERMILLE = 875;
/** A named cross needs both breeds at this share or more, and together at PUREBRED_PERMILLE. */
export const NAMED_CROSS_MIN_PERMILLE = 250;
/** The classic named crosses: [breed a, breed b, name]. */
export const NAMED_CROSSES: readonly [Breed, Breed, string][] = [
  ["thoroughbred", "arabian", "Anglo-Arab"],
  ["quarterHorse", "thoroughbred", "Appendix Quarter Horse"],
  ["andalusian", "arabian", "Hispano-Arabe"],
];

/**
 * Named crosses and purebreds (docs/genetics-v2.md): one breed at 7/8 or more is a purebred;
 * the classic two-breed crosses keep their traditional names; everything else is the top two.
 */
export function breedLabel(shares: BreedShares): string {
  const top = [...BREEDS].sort((a, b) => shares[b] - shares[a] || a.localeCompare(b));
  const first = top[0]!;
  if (shares[first] >= PUREBRED_PERMILLE) return `Purebred ${BREED_LABEL[first]}`;
  for (const [a, b, name] of NAMED_CROSSES) {
    if (shares[a] >= NAMED_CROSS_MIN_PERMILLE && shares[b] >= NAMED_CROSS_MIN_PERMILLE && shares[a] + shares[b] >= PUREBRED_PERMILLE) return name;
  }
  return `Crossbred (${BREED_SHORT[first]} × ${BREED_SHORT[top[1]!]})`;
}

export const QUIRK_LABEL: Record<QuirkKey, string> = { mudlark: "Mudlark", gateShy: "Gate-shy", lateKick: "Late kick", crowdShy: "Crowd-shy" };

/** Morph allele means -> descriptive words (no numbers: the exact knobs stay with the rig). */
const BUILD_WORDS: Record<string, [string, string]> = {
  // [high, low]
  legLength: ["long-legged", "short-legged"],
  neckLength: ["long-necked", "short-necked"],
  girth: ["deep-girthed", "narrow-bodied"],
  height: ["tall", "compact"],
  headSize: ["strong-headed", "fine-headed"],
};

function coatLoci(g: Genome): GeneLine[] {
  const c = g.coat;
  const e = count(c.extension, "E");
  const red = e === 0; // red base: agouti and liver can't show
  const agoutiA = count(c.agouti, "A");
  const agoutiAt = count(c.agouti, "At");
  const sabino = count(c.sabino, "Sb1");
  const lines: GeneLine[] = [
    {
      locus: "Extension",
      alleles: join(c.extension, ["E", "e"]),
      meaning: e === 2 ? "black pigment (no red carried)" : e === 1 ? "black pigment (carries red)" : "red factor: chestnut coats",
      carried: e === 1,
    },
    {
      locus: "Agouti",
      alleles: join(c.agouti, ["A", "At", "a"]),
      meaning: red
        ? "no effect on red coats"
        : agoutiA
          ? `bay: black kept to the points${agoutiA === 1 ? (agoutiAt ? " (carries seal brown)" : " (carries black)") : ""}`
          : agoutiAt
            ? `seal brown / dark bay${agoutiAt === 1 ? " (carries black)" : ""}`
            : "solid black (no agouti)",
      // Carried = a copy this horse doesn't show but can pass on: all of agouti on a red base,
      // or the weaker allele of a mixed pair on a black base.
      carried: red || c.agouti[0] !== c.agouti[1],
    },
    {
      locus: "Cream",
      alleles: join(c.cream, ["Cr", "n"]),
      meaning: count(c.cream, "Cr") === 0 ? "no cream dilution" : count(c.cream, "Cr") === 1 ? "one dose: partial dilution (palomino, buckskin, smoky black)" : "double dose: cremello, perlino or smoky cream",
      carried: false, // one or two doses both show (palomino/buckskin/smoky black, cremello/perlino)
    },
    {
      locus: "Grey",
      alleles: join(c.grey, ["G", "n"]),
      meaning: count(c.grey, "G") === 0 ? "won't grey out" : "born coloured, greys out with career",
      carried: false,
    },
    {
      locus: "Roan",
      alleles: join(c.roan, ["Rn", "n"]),
      meaning: count(c.roan, "Rn") === 0 ? "no roan" : "white hairs through the body coat",
      carried: false,
    },
    {
      locus: "Dun",
      alleles: join(c.dun, ["D", "n"]),
      meaning: count(c.dun, "D") === 0 ? "no dun" : "dun dilution with primitive markings",
      carried: false,
    },
    {
      locus: "Liver",
      alleles: join(c.liver, ["L", "l"]),
      meaning: count(c.liver, "l") === 2 ? (red ? "darkens chestnut to liver" : "no effect on non-chestnut coats") : count(c.liver, "l") === 1 ? "carries liver (needs two to show)" : "no liver modifier",
      carried: count(c.liver, "l") === 2 ? !red : count(c.liver, "l") === 1,
    },
    {
      locus: "Sabino",
      alleles: join(c.sabino, ["Sb1", "n"]),
      meaning: sabino === 0 ? "no sabino pattern" : sabino === 1 ? "one copy: white face and leg markings" : "two copies: loud white pattern",
      carried: false,
    },
  ];
  return lines;
}

/** One line per genetics-v2 locus: standard notation, plain meaning, `carried` for hidden copies. */
function genes2Loci(g: Genome, heartKnown: boolean): GeneLine[] {
  const g2 = g.genes2;
  const red = count(g.coat.extension, "E") === 0; // silver is invisible on red coats
  const cream = count(g.coat.cream, "Cr") > 0; // one prl shows next to a Cr
  const lp = count(g2.leopard, "LP");
  const patn = count(g2.patn1, "PATN1") > 0;
  const ht = count(g2.height, "Ht");
  const n = <T extends string>(pair: readonly [T, T], order: readonly T[]) => join(pair, order);
  const mstn = mstnType(g);
  const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  return [
    {
      locus: "Champagne",
      alleles: n(g2.champagne, ["Ch", "n"]),
      meaning: count(g2.champagne, "Ch") === 0 ? "no champagne" : `${count(g2.champagne, "Ch") === 1 ? "one copy" : "two copies"}: gold, amber or sable body, pink freckled skin, amber eyes`,
      carried: false,
    },
    {
      locus: "Silver",
      alleles: n(g2.silver, ["Z", "n"]),
      meaning: count(g2.silver, "Z") === 0 ? "no silver" : red ? "carries silver: invisible on a red (e/e) coat, can show in foals" : "black pigment turns chocolate, flaxen or silver mane",
      carried: count(g2.silver, "Z") > 0 && red,
    },
    {
      locus: "Pearl",
      alleles: n(g2.pearl, ["prl", "n"]),
      meaning:
        count(g2.pearl, "prl") === 0
          ? "no pearl"
          : count(g2.pearl, "prl") === 1
            ? cream
              ? "one copy with cream: pale coat, green or blue eyes"
              : "carries pearl (shows with two copies, or one plus cream)"
            : "pearl: pale apricot coat",
      carried: count(g2.pearl, "prl") === 1 && !cream,
    },
    {
      locus: "Tobiano",
      alleles: n(g2.tobiano, ["TO", "n"]),
      meaning: count(g2.tobiano, "TO") === 0 ? "no tobiano" : count(g2.tobiano, "TO") === 1 ? "white patches crossing the back, white legs, dark head" : "two copies: tobiano with small ink spots",
      carried: false,
    },
    {
      locus: "Leopard complex",
      alleles: n(g2.leopard, ["LP", "n"]),
      meaning: lp === 0 ? "no leopard complex" : lp === 1 ? (patn ? "one copy with PATN1: leopard or blanket spots" : "one copy: varnish roan, mottled skin") : "two copies: few-spot, nearly white",
      carried: false,
    },
    {
      locus: "Pattern-1",
      alleles: n(g2.patn1, ["PATN1", "n"]),
      meaning: !patn ? "no PATN1" : lp > 0 ? "turns leopard complex into a full leopard or blanket" : "carries PATN1: no effect without leopard complex",
      carried: patn && lp === 0,
    },
    {
      locus: "Splash white",
      alleles: n(g2.splash, ["SW", "n"]),
      meaning: count(g2.splash, "SW") === 0 ? "no splash" : count(g2.splash, "SW") === 1 ? "big blaze, white legs, blue eyes" : "two copies: bald face, white belly",
      carried: false,
    },
    {
      locus: "Height (LCORL)",
      alleles: n(g2.height, ["Ht", "n"]),
      meaning: ht === 0 ? "no extra height" : `+${SIZE_PER_HT_PERMILLE * ht / 10}% height (taller: more speed and stamina, less burst and durability)`,
      carried: false,
    },
    {
      locus: "Feathering",
      alleles: n(g2.feather, ["Fe", "fe"]),
      meaning: count(g2.feather, "fe") === 2 ? "long hair on the lower legs" : count(g2.feather, "fe") === 1 ? "carries feathering (shows with two copies)" : "no feathering",
      carried: count(g2.feather, "fe") === 1,
    },
    {
      locus: "Speed gene (MSTN)",
      alleles: n(g2.mstn, ["C", "T"]),
      meaning:
        mstn === "sprinter"
          ? `sprinter: best trip ${MSTN_TRIP_M} m shorter, burst ${signed(MSTN_STAT_SHIFT)}, stamina ${signed(-MSTN_STAT_SHIFT)}`
          : mstn === "stayer"
            ? `stayer: best trip ${MSTN_TRIP_M} m longer, stamina ${signed(MSTN_STAT_SHIFT)}, burst ${signed(-MSTN_STAT_SHIFT)}`
            : "miler: no shift",
      carried: false,
    },
    heartKnown
      ? {
          locus: "Big heart",
          alleles: n(g2.bigHeart, ["n", "bh"]),
          meaning: count(g2.bigHeart, "bh") === 0 ? "no big heart" : count(g2.bigHeart, "bh") === 1 ? "carries big heart (shows with two copies)" : `big heart: +${BIG_HEART_STAMINA} stamina potential`,
          carried: count(g2.bigHeart, "bh") === 1,
        }
      : { locus: "Big heart", alleles: "?/?", meaning: "unknown until the horse races or has a Pedigree Scan", carried: false },
    {
      locus: "Iron legs",
      alleles: n(g2.ironLegs, ["IL", "n"]),
      meaning: count(g2.ironLegs, "IL") === 0 ? "no iron legs" : `sound legs: injury risk ×${(IRON_LEGS_RISK / 1000).toFixed(2)}`,
      carried: false,
    },
    {
      locus: "Curled ears",
      alleles: n(g2.curledEars, ["Ce", "n"]),
      meaning: count(g2.curledEars, "Ce") === 0 ? "straight ears" : "inward-curling ear tips",
      carried: false,
    },
    {
      locus: "Dished face",
      alleles: n(g2.dish, ["Dh", "n"]),
      meaning: count(g2.dish, "Dh") === 0 ? "straight profile" : count(g2.dish, "Dh") === 1 ? "slight dish to the face" : "classic deep dish (Arabian type)",
      carried: false,
    },
  ];
}

/**
 * The visible genetics-v2 traits by name (empty for a horse from before genetics v2). No
 * renderer draws these yet (docs/genetics-v2.md "Portrait coverage"), so the horse page and the
 * cards list them as text.
 */
export function visibleTraits(g: Genome): string[] {
  const g2 = g.genes2;
  const red = count(g.coat.extension, "E") === 0;
  const lp = count(g2.leopard, "LP");
  const out: string[] = [];
  if (count(g2.champagne, "Ch") > 0) out.push("Champagne");
  if (count(g2.silver, "Z") > 0 && !red) out.push("Silver");
  if (count(g2.pearl, "prl") === 2 || (count(g2.pearl, "prl") === 1 && count(g.coat.cream, "Cr") > 0)) out.push("Pearl");
  if (count(g2.tobiano, "TO") > 0) out.push("Tobiano");
  if (lp === 2) out.push("Few-spot");
  else if (lp === 1) out.push(count(g2.patn1, "PATN1") > 0 ? "Leopard" : "Varnish roan");
  if (count(g2.splash, "SW") > 0) out.push("Splash white");
  if (count(g2.feather, "fe") === 2) out.push("Feathered legs");
  if (count(g2.curledEars, "Ce") > 0) out.push("Curled ears");
  if (count(g2.dish, "Dh") === 2) out.push("Dished face");
  return out;
}

/** Body size for display, e.g. { pct: 6, text: "Tall (+6%)", effect: "speed +12 · stamina +6 · burst −12 · durability −6" }. */
export function sizeSummary(g: Genome): { pct: number; text: string; effect: string } {
  const pct = Math.trunc(sizePermille(g) / 10);
  const word = pct >= 6 ? "Tall" : pct >= 2 ? "Above average" : pct <= -6 ? "Small" : pct <= -2 ? "Below average" : "Average";
  const text = pct === 0 ? word : `${word} (${pct > 0 ? "+" : ""}${pct}%)`;
  if (g.upgradedFrom) return { pct, text, effect: "no effect on stats (horse from before genetics v2)" };
  const d = sizeStatDelta(sizePermille(g));
  const parts = STAT_KEYS.filter((k) => d[k] !== 0).map((k) => `${k} ${d[k] > 0 ? "+" : "−"}${Math.abs(d[k])}`);
  return { pct, text, effect: parts.length ? parts.join(" · ") : "no effect on stats" };
}

/** Face and leg markings as display text, straight from the shared appearance. */
function markingsText(a: Pick<HorseAppearance, "face" | "legs">): { face: string; legs: string } {
  const marked = a.legs.map((l, i) => (l === "none" ? null : `${LEG_LABEL[l]} (${LEG_NAMES[i]})`)).filter(Boolean);
  return { face: FACE_LABEL[a.face], legs: marked.length ? marked.join(", ") : "No leg markings" };
}

export interface GeneticsSummaryOptions {
  /** Big heart is known once the horse has raced or had a Pedigree Scan (default: unknown). */
  heartKnown?: boolean;
}

export function geneticsSummary(genome: Genome, appearance: Pick<HorseAppearance, "face" | "legs">, revealedQuirks: string[], opts: GeneticsSummaryOptions = {}): GeneticsSummary {
  const grey = count(genome.coat.grey, "G") > 0;
  const sabino = count(genome.coat.sabino, "Sb1");
  const white = genome.white[0] + genome.white[1];
  const marks = markingsText(appearance);
  const revealed = new Set(revealedQuirks);
  const breed = BREEDS.map((k) => ({ key: k, label: BREED_LABEL[k], share: Math.floor(genome.breed[k] / 10) }))
    .filter((b) => b.share > 0)
    .sort((a, b) => b.share - a.share || a.key.localeCompare(b.key));
  const label = breedLabel(genome.breed);
  return {
    coat: {
      name: adultCoatName(genome.coat),
      bornAs: grey ? adultCoatName({ ...genome.coat, grey: ["n", "n"] }) : null,
      loci: coatLoci(genome),
    },
    genes2: genes2Loci(genome, !!opts.heartKnown),
    traits: visibleTraits(genome),
    size: sizeSummary(genome),
    white: {
      ...marks,
      sabino: sabino === 2 ? "Sb1/Sb1" : sabino === 1 ? "n/Sb1" : "n/n",
      tendency: white < 50 ? "low" : white <= 120 ? "medium" : "high",
    },
    breed,
    breedLabel: label,
    breedLine: `${label} — ${breed.map((b) => `${b.share}% ${BREED_LABEL[b.key]}`).join(" · ")}`,
    build: buildOf(genome),
    inbreeding: { permille: genome.coi, text: genome.coi === 0 ? "None" : genome.coi % 10 === 0 ? `${Math.floor(genome.coi / 10)}%` : `${Math.floor(genome.coi / 10)}.${genome.coi % 10}%` },
    quirks: QUIRK_KEYS.filter((q) => revealed.has(q)).map((q) => ({ key: q, label: QUIRK_LABEL[q] })),
    fragile: isFragile(genome),
  };
}

/** The 2–3 strongest morph tendencies as words, always at least two. */
function buildOf(genome: Genome): string {
  const scored = Object.keys(BUILD_WORDS).map((k) => {
    const mean = (genome.morph[k as keyof Genome["morph"]][0] + genome.morph[k as keyof Genome["morph"]][1]) / 2000; // -1..1
    return { k, mag: Math.abs(mean), word: BUILD_WORDS[k]![mean >= 0 ? 0 : 1] };
  });
  scored.sort((a, b) => b.mag - a.mag || a.k.localeCompare(b.k));
  const strong = scored.filter((s) => s.mag >= 0.25);
  return (strong.length >= 2 ? strong.slice(0, 3) : scored.slice(0, 2)).map((s) => s.word).join(", ");
}

/** Compact one-liner for cards, e.g. "bay roan · sabino · 88% TB". */
export function geneticsLine(genome: Genome): string {
  const parts = [adultCoatName(genome.coat).toLowerCase()];
  if (count(genome.coat.sabino, "Sb1") > 0) parts.push("Sabino");
  parts.push(...visibleTraits(genome));
  const breed = BREEDS.map((k) => ({ k, share: Math.floor(genome.breed[k] / 10) }))
    .filter((b) => b.share > 0)
    .sort((a, b) => b.share - a.share || a.k.localeCompare(b.k))
    .map((b) => `${b.share}% ${BREED_SHORT[b.k]}`);
  if (breed.length) parts.push(breed.join(" · "));
  return parts.join(" · ");
}
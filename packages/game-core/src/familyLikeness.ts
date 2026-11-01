/**
 * Family likeness (visual research V-06): which of a foal's looks it shares with its dam and its
 * sire, read from the three looks only (the shared appearance: coat, markings, build, hair). No
 * genotype, no odds: just what the eye can check on the three horses, as the foal reveal and the
 * horse page say it ("a blaze from her dam").
 */
import type { HorseAppearance } from "@thoroughbred/shared";

export type LikenessFrom = "dam" | "sire" | "both";
export type LikenessKind = "coat" | "markings" | "body";

export interface LikenessLine {
  kind: LikenessKind;
  /** What the foal shows, in words ("chestnut coat", "blaze", "long legs"). */
  trait: string;
  from: LikenessFrom;
}

type Look = Pick<HorseAppearance, "coat" | "colour" | "face" | "legs" | "build" | "hair" | "feather" | "dun" | "head">;

interface Trait {
  kind: LikenessKind;
  /** Higher = more telling (a rare colour before a common one). */
  rank: number;
  trait: string;
  /** Whether a parent's look shows it. */
  shows: (p: Look) => boolean;
}

const BASE_WORDS: Record<string, string> = { bay: "bay coat", seal_brown: "dark brown coat", black: "black coat", chestnut: "chestnut coat", liver: "liver chestnut coat" };
const FACE_WORDS: Record<string, string> = { star: "star", snip: "snip", stripe: "stripe", blaze: "blaze", bald: "bald face" };
const whiteLegs = (l: Look) => (l.legs ?? []).filter((m) => m !== "none").length;
const grey = (l: Look) => (l.colour ? l.colour.grey !== "none" : l.coat === "grey" || l.coat === "dapple_grey");
const creams = (l: Look) => l.colour?.cream ?? 0;

/** Every look of the foal that a parent could have passed on, most telling first. */
function foalTraits(f: Look): Trait[] {
  const c = f.colour;
  const out: Trait[] = [];
  const flag = (key: keyof NonNullable<Look["colour"]>, trait: string, rank = 90) => {
    if (c?.[key]) out.push({ kind: "coat", rank, trait, shows: (p) => !!p.colour?.[key] });
  };
  // rare colours and white patterns first, then grey and dilutions, then the base colour
  flag("dominantWhite", "white coat", 99);
  flag("brindle", "brindle stripes", 98);
  flag("mushroom", "mushroom coat", 97);
  flag("bendOr", "Bend Or spots", 96);
  flag("birdcatcher", "Birdcatcher spots", 96);
  flag("rabicano", "rabicano ticking", 95);
  if (c?.leopard) out.push({ kind: "coat", rank: 94, trait: c.leopard === "varnish" ? "varnish roan" : "spotted coat", shows: (p) => !!p.colour?.leopard });
  if (c?.tobiano) out.push({ kind: "coat", rank: 93, trait: "tobiano patches", shows: (p) => !!p.colour?.tobiano });
  if (c?.splash) out.push({ kind: "coat", rank: 93, trait: "splashed white", shows: (p) => !!p.colour?.splash });
  if (c?.sabino) out.push({ kind: "coat", rank: 92, trait: "sabino white", shows: (p) => !!p.colour?.sabino });
  if (c?.roan) out.push({ kind: "coat", rank: 91, trait: "roan coat", shows: (p) => !!p.colour?.roan });
  flag("champagne", "champagne gold", 90);
  flag("silver", "silver mane", 90);
  flag("pearl", "pearl sheen", 90);
  if (grey(f)) out.push({ kind: "coat", rank: 89, trait: "grey coat", shows: grey });
  if (c?.dun || f.dun) out.push({ kind: "coat", rank: 88, trait: "dun stripe", shows: (p) => !!(p.colour?.dun || p.dun) });
  if (creams(f) > 0) out.push({ kind: "coat", rank: 87, trait: creams(f) === 2 ? "cream coat" : "golden coat", shows: (p) => creams(p) > 0 });
  flag("flaxen", "flaxen mane", 70);
  flag("sooty", "sooty dapples", 60);
  flag("pangare", "mealy muzzle", 60);
  if (c) out.push({ kind: "coat", rank: 50, trait: BASE_WORDS[c.base] ?? "coat colour", shows: (p) => p.colour?.base === c.base });
  // markings
  if (f.face && f.face !== "none") out.push({ kind: "markings", rank: 80, trait: FACE_WORDS[f.face] ?? f.face, shows: (p) => p.face === f.face });
  const legs = whiteLegs(f);
  if (legs) out.push({ kind: "markings", rank: legs >= 3 ? 70 : 60, trait: legs === 1 ? "white sock" : "white socks", shows: (p) => whiteLegs(p) > 0 && Math.abs(whiteLegs(p) - legs) <= 1 });
  // body: build and hair
  const b = f.build;
  if (b) {
    const dims: [keyof NonNullable<Look["build"]>, string, string][] = [
      ["leg", "long legs", "short legs"],
      ["neck", "long neck", "short neck"],
      ["girth", "deep girth", "slim build"],
      ["height", "size", "small size"],
      ["head", "big head", "fine head"],
    ];
    for (const [k, plus, minus] of dims) {
      const v = b[k];
      if (Math.abs(v) < 1) continue;
      out.push({ kind: "body", rank: 40 + Math.abs(v) * 5, trait: v > 0 ? plus : minus, shows: (p) => !!p.build && Math.sign(p.build[k]) === Math.sign(v) && Math.abs(p.build[k]) >= 1 });
    }
  }
  if (f.feather) out.push({ kind: "body", rank: 85, trait: "feathered legs", shows: (p) => !!p.feather });
  const h = f.hair;
  if (h && !f.feather) {
    if (h.mane >= 2) out.push({ kind: "body", rank: 52 + h.mane * 2, trait: h.mane === 3 ? "long mane" : "flowing mane", shows: (p) => (p.hair?.mane ?? 0) >= 2 || !!p.feather });
    if (h.wave) out.push({ kind: "body", rank: 44, trait: "wavy mane", shows: (p) => !!p.hair?.wave });
  }
  return out.sort((a, b2) => b2.rank - a.rank);
}

/**
 * The foal's family likeness: up to `max` lines, at most one per kind (coat, markings, body),
 * each a look the foal shows that its dam, its sire or both show too. A parent that is unknown
 * (null) is left out. Deterministic.
 */
export function familyLikeness(foal: Look, dam: Look | null, sire: Look | null, max = 3): LikenessLine[] {
  const lines: LikenessLine[] = [];
  const used = new Set<LikenessKind>();
  for (const t of foalTraits(foal)) {
    if (used.has(t.kind)) continue;
    const d = !!dam && t.shows(dam);
    const s = !!sire && t.shows(sire);
    if (!d && !s) continue;
    lines.push({ kind: t.kind, trait: t.trait, from: d && s ? "both" : d ? "dam" : "sire" });
    used.add(t.kind);
    if (lines.length >= max) break;
  }
  const order: LikenessKind[] = ["coat", "markings", "body"];
  return lines.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/** One likeness line in words: "Blaze from her dam, Fair Wind" / "Chestnut coat like both parents". */
export function likenessText(l: LikenessLine, pronoun: "his" | "her" | "its", names: { dam?: string | null; sire?: string | null }): string {
  const t = l.trait.charAt(0).toUpperCase() + l.trait.slice(1);
  if (l.from === "both") return `${t}, like both parents`;
  const name = l.from === "dam" ? names.dam : names.sire;
  return `${t} from ${pronoun} ${l.from}${name ? `, ${name}` : ""}`;
}

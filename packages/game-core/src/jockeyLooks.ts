/**
 * Jockey looks (docs/art-direction.md "Jockey cast"): every jockey is drawn from layers, not one
 * picture. A base face (a PixelLab bust, keyed for skin, lips and hair), a skin tone, a hair
 * colour and optional accessories (freckles, spectacles, a moustache), plus the stable's silks.
 * The look is chosen once, when the jockey is created, stored on the jockey and never changes.
 *
 * Assignment is least-used first: the face nobody active is wearing (for that career stage and
 * the presentation the first name implies), so faces don't repeat while unused ones exist; once
 * every face of a pool is taken, the same face comes back in the skin / hair / accessory
 * combination furthest from the looks already wearing it, so no two active jockeys share a full
 * look while any combination is free (thousands per pool). Pure and deterministic: the same
 * inputs (seed, the active looks) always give the same look.
 *
 * The face catalogue (jockeyFaces.json) is data written by art-src/process_jockeys.py; the art
 * can grow with the player base (art-src/grow-jockey-faces.mjs) without code changes.
 */
import CATALOGUE from "./jockeyFaces.json";
import type { JockeyStage } from "./jockeys";

export type JockeyPresents = "f" | "m";

/** Skin tones, light to deep: shade, base, highlight (the bust's 8 skin levels and the rider's 4 are resampled from these). */
export const JOCKEY_SKINS = {
  porcelain: ["#9c6a5c", "#ecc5b2", "#fff1e6"],
  fair: ["#93604d", "#e2b096", "#f8dac8"],
  rose: ["#86513f", "#d39a80", "#efc3aa"],
  olive: ["#77502f", "#c39466", "#e4be92"],
  tan: ["#653c22", "#a8724a", "#d3a175"],
  bronze: ["#4f2f1a", "#8c5a36", "#bd8a5c"],
  brown: ["#3b2216", "#6c4228", "#9e6c48"],
  deep: ["#22130b", "#46291b", "#764e36"],
} as const satisfies Record<string, readonly [string, string, string]>;
export type JockeySkin = keyof typeof JOCKEY_SKINS;
export const JOCKEY_SKIN_IDS = Object.keys(JOCKEY_SKINS) as JockeySkin[];

/** Hair colours: shade, base, highlight. */
export const JOCKEY_HAIRS = {
  black: ["#0b0809", "#211b1d", "#463c40"],
  "dark-brown": ["#1c110b", "#3d2618", "#66432c"],
  brown: ["#332012", "#674126", "#9a6c45"],
  auburn: ["#3e150c", "#7a301c", "#b05a36"],
  ginger: ["#5e240c", "#ad521c", "#e4904a"],
  blonde: ["#7a5c28", "#c4a052", "#f2dc94"],
  grey: ["#3f3f42", "#848487", "#c6c6c6"],
  white: ["#8a8782", "#d4d1ca", "#fafaf5"],
} as const satisfies Record<string, readonly [string, string, string]>;
export type JockeyHair = keyof typeof JOCKEY_HAIRS;
export const JOCKEY_HAIR_IDS = Object.keys(JOCKEY_HAIRS) as JockeyHair[];

export const JOCKEY_ACCESSORIES = ["freckles", "glasses", "moustache"] as const;
export type JockeyAccessory = (typeof JOCKEY_ACCESSORIES)[number];

export interface JockeyFace {
  id: string;
  stage: JockeyStage;
  presents: JockeyPresents;
  /** The skin and hair the face was painted with (its native look). */
  skin: JockeySkin;
  hair: JockeyHair;
  /** Long hair (a plait, ponytail or bun) that shows under the cap: the rider sprite shows it too. */
  long: boolean;
  /** Painted with a beard or moustache / spectacles (those accessories are never added on top). */
  beard: boolean;
  glasses: boolean;
  /** Anchors for accessory layers were found (eyes for spectacles, mouth for a moustache). */
  eyes: boolean;
  mouth: boolean;
}

export interface JockeyLook {
  face: string;
  skin: JockeySkin;
  hair: JockeyHair;
  acc: JockeyAccessory[];
}

export const JOCKEY_FACES: readonly JockeyFace[] = (CATALOGUE as { faces: JockeyFace[] }).faces;
const FACE_BY_ID = new Map(JOCKEY_FACES.map((f) => [f.id, f]));
export const jockeyFace = (id: string): JockeyFace | undefined => FACE_BY_ID.get(id);

/** First names (jockeyName's pool) by the presentation they imply; the rest fit either. */
const WOMEN = new Set([
  "Amy", "Lucy", "Ellie", "Grace", "Hannah", "Megan", "Chloe", "Isla", "Freya", "Molly",
  "Rosie", "Daisy", "Bethan", "Siobhan", "Niamh", "Kirsty", "Fern", "Harriet", "Jess", "Poppy",
]);
const MEN = new Set([
  "Tom", "Harry", "Jack", "Oliver", "George", "Alfie", "Freddie", "Archie", "Theo", "Ollie",
  "Joe", "Ben", "Callum", "Rory", "Finn", "Ewan", "Lewis", "Hamish", "Dougie", "Conor",
  "Niall", "Rhys", "Owen", "Gareth", "Dylan", "Ned",
]);
const EITHER = new Set(["Alex", "Kit", "Sam", "Charlie"]);
export const JOCKEY_KNOWN_FIRST_NAMES: ReadonlySet<string> = new Set([...WOMEN, ...MEN, ...EITHER]);

/** A jockey's gender: one stored value (jockeys.gender), set with the name at creation. */
export type JockeyGender = JockeyPresents;

/**
 * The gender of the first names that fit either (the name pool has four). Fixed, so a name always
 * means one gender: the jockey's stored gender, bust, rider sprite and name always agree.
 */
export const AMBIGUOUS_NAME_GENDER: Readonly<Record<string, JockeyGender>> = { Alex: "m", Kit: "f", Sam: "f", Charlie: "m" };

/** "f", "m" or null (a name that fits either, or an unknown one) from a jockey's first name. */
export function presentsAs(name: string): JockeyPresents | null {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (WOMEN.has(first)) return "f";
  if (MEN.has(first)) return "m";
  return null;
}

/** The gender a jockey's name gives (stored at creation; the backfill reads old rows the same way). */
export function jockeyGender(name: string): JockeyGender {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return presentsAs(name) ?? AMBIGUOUS_NAME_GENDER[first] ?? "m";
}

/** A stored gender, or the name's when the row has none (older rows before the backfill). */
export function genderOf(j: { name: string; gender?: unknown }): JockeyGender {
  return j.gender === "f" || j.gender === "m" ? j.gender : jockeyGender(j.name);
}

/** Hair colours a jockey of this stage may be given (grey and white only with age). */
export function hairsFor(stage: JockeyStage): JockeyHair[] {
  return stage === "veteran" ? ["black", "dark-brown", "brown", "auburn", "grey", "white"] : ["black", "dark-brown", "brown", "auburn", "ginger", "blonde"];
}

/** Accessory sets a face can take on top of its painting. */
export function accessorySetsFor(face: JockeyFace): JockeyAccessory[][] {
  const extra: JockeyAccessory[] = ["freckles"];
  if (face.eyes && !face.glasses) extra.push("glasses");
  if (face.mouth && !face.beard && face.presents === "m" && face.stage !== "apprentice") extra.push("moustache");
  const sets: JockeyAccessory[][] = [[]];
  for (const a of extra) for (const s of [...sets]) sets.push([...s, a]);
  return sets;
}

export const jockeyLookKey = (l: JockeyLook): string => `${l.face}|${l.skin}|${l.hair}|${[...l.acc].sort().join("+")}`;

/** FNV-1a, 32-bit. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Faces a jockey of this stage and gender may wear (women only ever get women's faces, and vice versa). */
export function facePool(stage: JockeyStage, gender: JockeyGender, faces: readonly JockeyFace[] = JOCKEY_FACES): JockeyFace[] {
  const pool = faces.filter((f) => f.stage === stage && f.presents === gender);
  return pool.length ? pool : faces.filter((f) => f.presents === gender);
}

/** How far two looks of the same face are apart (skin steps, hair and accessories). */
function lookDistance(a: JockeyLook, b: JockeyLook): number {
  const skin = Math.abs(JOCKEY_SKIN_IDS.indexOf(a.skin) - JOCKEY_SKIN_IDS.indexOf(b.skin));
  const hair = a.hair === b.hair ? 0 : 2;
  const acc = JOCKEY_ACCESSORIES.filter((x) => a.acc.includes(x) !== b.acc.includes(x)).length;
  return skin + hair + acc;
}

/**
 * The look for a new jockey: the least-worn face of its pool (ties broken by the seed), in its
 * native colours when nobody active wears it; otherwise the free combination furthest from the
 * looks already on that face. `active` = the looks of jockeys not yet retired.
 */
export function pickJockeyLook(input: { seed: string; stage: JockeyStage; gender: JockeyGender }, active: readonly JockeyLook[], faces: readonly JockeyFace[] = JOCKEY_FACES): JockeyLook {
  const pool = facePool(input.stage, input.gender, faces);
  if (!pool.length) throw new Error("no jockey faces");
  const worn = new Map<string, JockeyLook[]>();
  for (const l of active) {
    const list = worn.get(l.face);
    if (list) list.push(l);
    else worn.set(l.face, [l]);
  }
  const face = [...pool].sort((a, b) => (worn.get(a.id)?.length ?? 0) - (worn.get(b.id)?.length ?? 0) || hash32(`${input.seed}|${a.id}`) - hash32(`${input.seed}|${b.id}`) || (a.id < b.id ? -1 : 1))[0]!;
  const onFace = worn.get(face.id) ?? [];
  const native: JockeyLook = { face: face.id, skin: face.skin, hair: face.hair, acc: [] };
  const taken = new Map<string, number>();
  for (const l of onFace) taken.set(jockeyLookKey(l), (taken.get(jockeyLookKey(l)) ?? 0) + 1);
  if (!taken.has(jockeyLookKey(native))) return native;
  const hairs = hairsFor(face.stage);
  if (!hairs.includes(face.hair)) hairs.push(face.hair);
  let best: JockeyLook = native;
  let bestScore = -Infinity;
  for (const skin of JOCKEY_SKIN_IDS) {
    for (const hair of hairs) {
      for (const acc of accessorySetsFor(face)) {
        const look: JockeyLook = { face: face.id, skin, hair, acc };
        const uses = taken.get(jockeyLookKey(look)) ?? 0;
        const spread = Math.min(...onFace.map((o) => lookDistance(look, o)));
        // free combinations first; among them the furthest from the faces already worn; a
        // gentle pull towards the painting's own colours; the seed breaks ties
        const score = -uses * 1e6 + spread * 1e3 - lookDistance(look, native) * 10 - (hash32(`${input.seed}|${jockeyLookKey(look)}`) % 10);
        if (score > bestScore) {
          bestScore = score;
          best = look;
        }
      }
    }
  }
  return best;
}

/** Parse a stored look (jsonb); null for a missing or malformed one. */
export function parseJockeyLook(v: unknown): JockeyLook | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.face !== "string" || typeof o.skin !== "string" || typeof o.hair !== "string") return null;
  if (!(o.skin in JOCKEY_SKINS) || !(o.hair in JOCKEY_HAIRS)) return null;
  const acc = Array.isArray(o.acc) ? o.acc.filter((a): a is JockeyAccessory => (JOCKEY_ACCESSORIES as readonly string[]).includes(a as string)) : [];
  return { face: o.face, skin: o.skin as JockeySkin, hair: o.hair as JockeyHair, acc };
}

/**
 * The look of a jockey stored before looks existed (or a face the art no longer has): the face
 * picked from the id within the stage and name's pool, in its native colours. Display only.
 */
export function fallbackJockeyLook(j: { id: string; name: string; stage: string; gender?: unknown }): JockeyLook {
  const stage = (["apprentice", "prime", "veteran"].includes(j.stage) ? j.stage : "prime") as JockeyStage;
  const pool = facePool(stage, genderOf(j));
  const face = pool[hash32(j.id) % pool.length]!;
  return { face: face.id, skin: face.skin, hair: face.hair, acc: [] };
}

/** The look to draw: the stored one when its face exists (and fits the jockey's gender), else the fallback. */
export function resolveJockeyLook(j: { id: string; name: string; stage: string; gender?: unknown; look?: unknown }): JockeyLook {
  const l = parseJockeyLook(j.look);
  return l && FACE_BY_ID.get(l.face)?.presents === genderOf(j) ? l : fallbackJockeyLook(j);
}

/** What the rider sprites need from a look: skin and hair ramps (shade, base, highlight) and the hair cue. */
export interface RiderLook {
  skin: readonly [string, string, string];
  hair: readonly [string, string, string];
  /** Long hair shows under the cap (women always show a ponytail, bun or plait on the rider sprite). */
  long: boolean;
  /** Which rider sprite: the women's variant (slimmer, hair under the cap) or the men's. */
  gender: JockeyGender;
}

export function riderLookOf(look: JockeyLook): RiderLook {
  const face = FACE_BY_ID.get(look.face);
  const gender = face?.presents ?? "m";
  return { skin: JOCKEY_SKINS[look.skin], hair: JOCKEY_HAIRS[look.hair], long: gender === "f" || !!face?.long, gender };
}

/**
 * The people and pictures of the game, so no two things share one image (docs/reports
 * "2026-10-31 graphics audit"): jockey busts, rival trainers, news and moment vignettes, and a
 * scene per section. Pure and deterministic (assignment by id), client-safe.
 */
import CAST from "../../public/art/portraits/jockeys/index.json";

export type JockeyStageName = "apprentice" | "prime" | "veteran";

interface CastEntry {
  stage: JockeyStageName;
  presents: "f" | "m";
  face: number[];
}
const ENTRIES = Object.entries(CAST.cast as Record<string, CastEntry>);

/** Native size of a jockey bust and of its head crop (art px). */
export const JOCKEY_BUST = CAST.size;
export const JOCKEY_FACE = CAST.faceSize;

/**
 * First names in the jockey name pool (game-core jockeyName) that are women's names. Names that
 * fit either (Alex, Kit, Sam, Charlie) and unknown names draw from the whole stage.
 */
const WOMEN = new Set([
  "Amy", "Lucy", "Ellie", "Grace", "Hannah", "Megan", "Chloe", "Isla", "Freya", "Molly",
  "Rosie", "Daisy", "Bethan", "Siobhan", "Niamh", "Kirsty", "Fern", "Harriet", "Jess", "Poppy",
]);
const EITHER = new Set(["Alex", "Kit", "Sam", "Charlie"]);
/** Men's first names in the pool (the rest of game-core's list). */
const MEN = new Set([
  "Tom", "Harry", "Jack", "Oliver", "George", "Alfie", "Freddie", "Archie", "Theo", "Ollie",
  "Joe", "Ben", "Callum", "Rory", "Finn", "Ewan", "Lewis", "Hamish", "Dougie", "Conor",
  "Niall", "Rhys", "Owen", "Gareth", "Dylan", "Ned",
]);

/** "f", "m" or null (either / unknown) from a jockey's first name. */
export function presentsAs(name: string): "f" | "m" | null {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (EITHER.has(first)) return null;
  if (WOMEN.has(first)) return "f";
  if (MEN.has(first)) return "m";
  return null;
}

/** Known first names (tests check every generated jockey name is covered). */
export const KNOWN_FIRST_NAMES: ReadonlySet<string> = new Set([...WOMEN, ...MEN, ...EITHER]);

/** FNV-1a, 32-bit: a stable spread of ids over the cast. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface JockeyPortraitArt {
  id: string;
  src: string;
  /** Top-left of the head crop (JOCKEY_FACE square) inside the bust. */
  face: [number, number];
}

/**
 * The bust for a jockey: same stage (apprentices young, veterans older), same presentation as
 * the name when it says, then picked by the jockey's id. The same jockey always gets the same
 * face; they move to an older face as their career moves on.
 */
export function jockeyPortrait(j: { id: string; name: string; stage: string }): JockeyPortraitArt {
  const stage = (["apprentice", "prime", "veteran"].includes(j.stage) ? j.stage : "prime") as JockeyStageName;
  const who = presentsAs(j.name);
  const byStage = ENTRIES.filter(([, e]) => e.stage === stage);
  const pool = who ? byStage.filter(([, e]) => e.presents === who) : byStage;
  const list = pool.length ? pool : byStage.length ? byStage : ENTRIES;
  const [id, e] = list[hash32(j.id) % list.length]!;
  return { id, src: `/art/portraits/jockeys/${id}.png`, face: [e.face[0]!, e.face[1]!] };
}

/** Story rival trainers (game-core RIVAL_STABLES ids) with their own busts (128 px). */
const TRAINERS = new Set(["house-harrowgate", "house-larkspur", "house-vicarage", "house-saltmarsh", "house-kestrel", "house-bellmont", "house-copperfield", "house-ashcombe"]);
export const trainerPortrait = (rivalId: string): string | null => (TRAINERS.has(rivalId) ? `/art/portraits/trainers/${rivalId}.png` : null);

/** One 64 px vignette per kind of news or moment (art/vignettes). */
export type VignetteName =
  | "win" | "first-win" | "photo-finish" | "purse" | "champion" | "jockey-signed" | "jockey-retires" | "jockey-claim"
  | "sale" | "claim" | "hall-of-fame" | "memorial" | "retired" | "foal" | "vet" | "week" | "improver" | "quirk"
  | "unlock" | "scan" | "exact" | "legacy" | "stable-steps";

export const NEWS_VIGNETTE: Record<string, VignetteName> = {
  feature_win: "win",
  first_big_win: "first-win",
  photo_finish: "photo-finish",
  record_purse: "purse",
  season_champion: "champion",
  league_champion: "champion",
  jockey_claim_out: "jockey-claim",
  jockey_retirement_announced: "jockey-retires",
  jockey_retired: "jockey-retires",
  jockey_signed: "jockey-signed",
  sale: "sale",
  claim: "claim",
  hall_of_fame: "hall-of-fame",
};

export const MOMENT_VIGNETTE: Record<string, VignetteName> = {
  quirk: "quirk",
  improver: "improver",
  exact: "exact",
  scan: "scan",
  first_win: "first-win",
  first_feature: "win",
  retired: "retired",
  legacy: "legacy",
  memorial: "memorial",
  week_recap: "week",
  unlock: "unlock",
  stable_steps: "stable-steps",
};

export const vignetteSrc = (v: VignetteName) => `/art/vignettes/${v}.png`;
export const VIGNETTE_SIZE = 64;

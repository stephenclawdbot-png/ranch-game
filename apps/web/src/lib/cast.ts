/**
 * The people and pictures of the game, so no two things share one image (docs/reports
 * "2026-10-31 graphics audit"): jockey busts, rival trainers, news and moment vignettes, and a
 * scene per section. Pure and deterministic (assignment by id), client-safe.
 */
import * as gc from "@thoroughbred/game-core";
import { BUST_INDEX, type BustAnchors } from "./jockeyBust";

export type JockeyStageName = "apprentice" | "prime" | "veteran";

/** Native size of a jockey bust and of its head crop (art px). */
export const JOCKEY_BUST = BUST_INDEX.size;
export const JOCKEY_FACE = BUST_INDEX.faceSize;

/** "f", "m" or null (either / unknown) from a jockey's first name (game-core jockeyLooks). */
export const presentsAs = gc.presentsAs;

/** Known first names (tests check every generated jockey name is covered). */
export const KNOWN_FIRST_NAMES: ReadonlySet<string> = gc.JOCKEY_KNOWN_FIRST_NAMES;

/** FNV-1a, 32-bit: a stable spread of ids. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface JockeyPortraitArt {
  /** The base face's id. */
  id: string;
  src: string;
  /** Top-left of the head crop (JOCKEY_FACE square) inside the bust. */
  face: [number, number];
  /** The jockey's look (stored at creation; a fallback from the id for very old rows). */
  look: gc.JockeyLook;
  anchors: BustAnchors | null;
}

/**
 * The bust for a jockey: the base face of its stored look (game-core JockeyLook, assigned once
 * at creation, least-used first), painted with that look's skin, hair and accessories by
 * JockeyPortrait. Jockeys stored before looks fall back to a face picked from the id.
 */
export function jockeyPortrait(j: { id: string; name: string; stage: string; look?: unknown }): JockeyPortraitArt {
  const look = gc.resolveJockeyLook(j);
  const anchors = BUST_INDEX.faces[look.face] ?? null;
  return { id: look.face, src: `/art/portraits/jockeys/${look.face}.png`, face: anchors ? [anchors.face[0], anchors.face[1]] : [36, 24], look, anchors };
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

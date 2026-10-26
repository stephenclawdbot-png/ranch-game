/**
 * Horse names and registration numbers, the way a racing registry does it.
 *
 *  - A new name is 2-18 characters (spaces count), letters with single spaces, apostrophes,
 *    hyphens and full stops; it starts with a letter. (The database allows 1-32 so older
 *    names stay valid.)
 *  - Names are compared case-insensitively after trimming and collapsing spaces
 *    (`nameKey`). Uniqueness among active horses and retired Hall of Fame names is enforced
 *    by the database layer, which knows who is using what.
 *  - A small local word list keeps obvious profanity out (`isProfane`). It is a courtesy
 *    filter, not moderation.
 *  - The public registration number is `G<generation>-<sequence, 5+ digits>`, e.g. G2-04571.
 *
 * Pure and deterministic (no clocks, no Math.random): system names come from `Rng`.
 */
import { Rng } from "./rng";

export const HORSE_NAME_MIN = 2;
export const HORSE_NAME_MAX = 18;

export type HorseNameProblem = "EMPTY" | "TOO_SHORT" | "TOO_LONG" | "BAD_CHARS" | "PROFANE";

export type HorseNameCheck = { ok: true; name: string } | { ok: false; problem: HorseNameProblem; message: string };

/** Trims and collapses runs of whitespace to one space. */
export function normalizeHorseName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** The comparison key: normalised and lower-cased. */
export function nameKey(raw: string): string {
  return normalizeHorseName(raw).toLowerCase();
}

// Letters (any script), single spaces, apostrophes (straight or curly), hyphens and full stops.
const NAME_CHARS = /^\p{L}[\p{L}'’.\- ]*$/u;

/**
 * Strong words that are blocked anywhere inside a name (letters only, so spacing or
 * punctuation tricks don't help). Kept short on purpose: substrings that also occur in
 * ordinary words (e.g. "rape" in "Grape") live in WORDS instead.
 */
const SUBSTRINGS = ["fuck", "fuk", "shit", "cunt", "nigger", "nigga", "faggot", "motherf", "whore", "bitch", "bastard", "wanker", "jizz", "dildo", "porn", "hitler", "retard", "slut", "twat", "pussy", "penis", "vagina", "piss"];
/** Words blocked only as whole words. */
const WORDS = ["ass", "arse", "asshole", "arsehole", "rape", "rapist", "tit", "tits", "fag", "fags", "dick", "dicks", "cock", "cocks", "prick", "wank", "kkk", "isis", "sex", "sexy", "nude", "nudes", "anal", "orgy", "turd", "milf", "hoe", "hoes", "nazi", "nazis", "pedo", "cum", "spic", "spics", "chink", "kike", "boner"];
/** Words that contain a blocked substring but are fine ("cum" in "Cumberland", "spic" in "Spice"). */
const ALLOWED = ["cumberland", "cumbria", "cumulus", "cucumber", "scum", "circum", "document", "spice", "spicy", "auspic", "conspic", "hospice", "pisces", "therapist", "piston", "titan", "title", "titanic", "assassin", "classic", "cassidy", "brass", "bass", "glass", "grass", "pass", "mass", "lass", "sassy", "ambassador", "hello", "shell", "michelle", "dickens", "hancock", "peacock", "cocktail", "shuttlecock", "weathercock", "scunthorpe", "penistone", "sextant", "sussex", "essex", "middlesex", "wessex", "sexton"];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

function lettersOnly(s: string): string {
  return s
    .toLowerCase()
    .replace(/[0-9@$!]/g, (c) => LEET[c] ?? c)
    .normalize("NFKD")
    .replace(/[^a-z]/g, "");
}

/** True when the name contains a blocked word (see the lists above). */
export function isProfane(raw: string): boolean {
  const words = raw
    .toLowerCase()
    .normalize("NFKD")
    .split(/[\s'’.\-]+/)
    .map(lettersOnly)
    .filter(Boolean);
  if (words.some((w) => WORDS.includes(w))) return true;
  // Each word on its own (allowed words removed first, so "Cumberland Gap" passes), then
  // runs of one- or two-letter pieces joined up, which catches "F U C K" and "Sh-it".
  const hit = (w: string) => {
    let s = w;
    for (const a of ALLOWED) s = s.split(a).join("");
    return SUBSTRINGS.some((x) => s.includes(x)) || WORDS.includes(s);
  };
  if (words.some(hit)) return true;
  let run = "";
  for (const w of [...words, "--end--"]) {
    if (w.length <= 2) run += w;
    else {
      if (run.length >= 3 && hit(run)) return true;
      run = "";
    }
  }
  return false;
}

/** Validates a player-chosen name. Messages are written for the player. */
export function validateHorseName(raw: string): HorseNameCheck {
  const name = normalizeHorseName(raw ?? "");
  if (!name) return { ok: false, problem: "EMPTY", message: "Give your horse a name." };
  const len = [...name].length;
  if (len < HORSE_NAME_MIN) return { ok: false, problem: "TOO_SHORT", message: `Names need at least ${HORSE_NAME_MIN} letters.` };
  if (len > HORSE_NAME_MAX) return { ok: false, problem: "TOO_LONG", message: `Racing names are ${HORSE_NAME_MAX} characters at most (spaces count). That one is ${len}.` };
  if (!NAME_CHARS.test(name)) return { ok: false, problem: "BAD_CHARS", message: "Use letters and spaces (apostrophes, hyphens and full stops are fine). Start with a letter." };
  if (isProfane(name)) return { ok: false, problem: "PROFANE", message: "The registry won't accept that name. Try another." };
  return { ok: true, name };
}

/** Public registration number, e.g. registrationNumber(2, 4571) = "G2-04571". */
export function registrationNumber(generation: number, sequence: number): string {
  const g = Math.max(0, Math.trunc(generation));
  const n = Math.max(0, Math.trunc(sequence));
  return `G${g}-${String(n).padStart(5, "0")}`;
}

// A wider pool than the Club runner names: 48 x 48 = 2,304 two-word names, all <= 18 chars.
const POOL_A = [
  "Silver", "Morning", "Copper", "River", "Velvet", "Northern", "Golden", "Quiet", "Midnight", "Lucky", "Harbour", "Autumn",
  "Iron", "Paper", "Summer", "Wild", "Amber", "Honey", "Scarlet", "Winter", "Western", "Bold", "Gentle", "Hidden",
  "Rolling", "Distant", "Royal", "Little", "Brave", "Lantern", "Kestrel", "Saffron", "Hazel", "Cobalt", "Misty", "Restless",
  "Starlit", "Highland", "Dancing", "Merry", "Sable", "Crimson", "Bright", "Clover", "Tawny", "Painted", "Swift", "Willow",
];
const POOL_B = [
  "Lark", "Ember", "Comet", "Willow", "Echo", "Arrow", "Meadow", "Banner", "Rumour", "Spark", "Harmony", "Tide",
  "Promise", "Sonnet", "Gale", "Crown", "Ballad", "Lantern", "Bramble", "Thistle", "Sparrow", "Falcon", "Orchard", "Compass",
  "Pennant", "Ribbon", "Rosette", "Furlong", "Horizon", "Legend", "Whisper", "Harvest", "Shadow", "Quarry", "Feather", "Riddle",
  "Summit", "Fable", "Charm", "Voyage", "Signal", "Galleon", "Minstrel", "Heron", "Beacon", "Tempest", "Cadence", "Trinket",
];
const NUMERALS = ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/**
 * Deterministic alternatives for a system-chosen name that is already taken: first a few
 * fresh two-word names from the wider pool (seeded), then the original with a numeral
 * ("Silver Lark II"), trimmed to fit 18 characters. Never includes `base` itself.
 */
export function alternativeNames(base: string, seed: string, count = 24): string[] {
  const rng = new Rng(`${seed}|alt-name`);
  const out: string[] = [];
  const seen = new Set([nameKey(base)]);
  const push = (n: string) => {
    const k = nameKey(n);
    if (!seen.has(k) && [...n].length <= HORSE_NAME_MAX) {
      seen.add(k);
      out.push(n);
    }
  };
  for (let i = 0; i < count * 2 && out.length < count - NUMERALS.length; i++) push(`${POOL_A[rng.int(POOL_A.length)]} ${POOL_B[rng.int(POOL_B.length)]}`);
  const stem = normalizeHorseName(base).slice(0, HORSE_NAME_MAX - 5).trim() || "Kestrel";
  for (const r of NUMERALS) push(`${stem} ${r}`);
  return out.slice(0, count);
}

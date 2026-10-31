/**
 * The racing news (experience review item 5): short items written from facts, in British racing
 * English, never in the language of betting. The database decides *when* an item exists (at
 * settlement, a sale, maintenance) and makes it idempotent by its dedupe key; this file decides
 * what it says. Several templates per kind; the one used is picked from the dedupe key, so the
 * same item always reads the same.
 */
import { hash32 } from "./rng";

export type NewsKind =
  | "feature_win"
  | "first_big_win"
  | "photo_finish"
  | "record_purse"
  | "season_champion"
  | "league_champion"
  | "jockey_claim_out"
  | "jockey_retirement_announced"
  | "jockey_retired"
  | "sale"
  | "claim"
  | "hall_of_fame";

export const NEWS_KINDS: readonly NewsKind[] = [
  "feature_win",
  "first_big_win",
  "photo_finish",
  "record_purse",
  "season_champion",
  "league_champion",
  "jockey_claim_out",
  "jockey_retirement_announced",
  "jockey_retired",
  "sale",
  "claim",
  "hall_of_fame",
];

/** The facts a template may use; each kind uses its own subset. */
export interface NewsFacts {
  horse?: string;
  stable?: string;
  /** A second horse / stable (the runner-up, the seller). */
  other?: string;
  otherStable?: string;
  race?: string;
  /** Racecourse name ("Saltmarsh"). */
  track?: string;
  /** Margin label ("a nose", "a short head", "half a length"). */
  margin?: string;
  /** Credits. */
  amount?: number;
  jockey?: string;
  wins?: number;
  rides?: number;
  tier?: string;
  season?: number;
  points?: number;
  /** Hall of Fame reason title ("Champion"). */
  honour?: string;
  /** Race class label ("Listed", "Group 1"). */
  level?: string;
}

type Template = (f: NewsFacts) => string;

const cr = (n?: number) => `${String(Math.trunc(n ?? 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} cr`;
const at = (f: NewsFacts) => (f.track ? ` at ${f.track}` : "");

/** Templates by kind (at least three each). */
export const NEWS_TEMPLATES: Record<NewsKind, readonly Template[]> = {
  feature_win: [
    (f) => `${f.horse} lands the ${f.race} for ${f.stable}`,
    (f) => `${f.stable}'s ${f.horse} takes the ${f.race}`,
    (f) => `${f.race}: ${f.horse} comes home in front for ${f.stable}`,
  ],
  first_big_win: [
    (f) => `${f.horse} breaks through at ${f.level} level in the ${f.race}`,
    (f) => `A first ${f.level} win for ${f.horse} (${f.stable})${at(f)}`,
    (f) => `${f.stable}'s ${f.horse} steps up and wins the ${f.race}`,
  ],
  photo_finish: [
    (f) => `Photo-finish${at(f)}: ${f.horse} by ${f.margin}`,
    (f) => `${f.horse} holds ${f.other} by ${f.margin} in the ${f.race}`,
    (f) => `Nothing in it${at(f)}: ${f.horse} edges ${f.other} by ${f.margin}`,
  ],
  record_purse: [
    (f) => `Record purse: ${f.horse} collects ${cr(f.amount)} in the ${f.race}`,
    (f) => `${f.stable} bank the richest prize yet, ${cr(f.amount)}, with ${f.horse}`,
    (f) => `The biggest pot so far, ${cr(f.amount)}, goes to ${f.horse} in the ${f.race}`,
  ],
  season_champion: [
    (f) => `${f.stable} are Season ${f.season} champions with ${f.points} points`,
    (f) => `Season ${f.season} title to ${f.stable} (${f.points} points)`,
    (f) => `${f.stable} top the Season ${f.season} standings on ${f.points} points`,
  ],
  league_champion: [
    (f) => `${f.stable} finish the season top of the ${f.tier} League`,
    (f) => `${f.tier} League champions for Season ${f.season}: ${f.stable}`,
    (f) => `${f.stable} win the ${f.tier} League on the season's last week`,
  ],
  jockey_claim_out: [
    (f) => `${f.jockey} rides out the claim with a ${ordinal(f.wins ?? 0)} winner`,
    (f) => `No more allowance for ${f.jockey}: ${f.wins} winners and the claim is gone`,
    (f) => `${f.jockey} loses the apprentice's claim after ${f.wins} winners`,
  ],
  jockey_retirement_announced: [
    (f) => `${f.jockey} announces retirement at the end of the season`,
    (f) => `${f.jockey} to hang up the boots after ${f.wins} winners`,
    (f) => `Last weeks in the saddle for ${f.jockey}`,
  ],
  jockey_retired: [
    (f) => `${f.jockey} retires after ${f.rides} rides and ${f.wins} winners`,
    (f) => `Farewell to ${f.jockey}: ${f.wins} winners from ${f.rides} rides`,
    (f) => `${f.jockey} rides into retirement`,
  ],
  sale: [
    (f) => `${f.horse} changes hands for ${cr(f.amount)}: ${f.otherStable} to ${f.stable}`,
    (f) => `${f.stable} buy ${f.horse} for ${cr(f.amount)}`,
    (f) => `Sold: ${f.horse} goes to ${f.stable} for ${cr(f.amount)}`,
  ],
  claim: [
    (f) => `${f.horse} claimed out of the ${f.race} by ${f.stable} for ${cr(f.amount)}`,
    (f) => `${f.stable} claim ${f.horse} for ${cr(f.amount)} after the ${f.race}`,
    (f) => `A new yard for ${f.horse}: claimed for ${cr(f.amount)} by ${f.stable}`,
  ],
  hall_of_fame: [
    (f) => `${f.horse} enters the Hall of Fame: ${f.honour}`,
    (f) => `Hall of Fame: ${f.horse} (${f.stable}), ${f.honour}`,
    (f) => `${f.stable}'s ${f.horse} takes a place in the Hall of Fame (${f.honour})`,
  ],
};

/** The headline for an item: the template is picked from the dedupe key, so it never changes. */
export function newsHeadline(kind: NewsKind, facts: NewsFacts, dedupeKey: string): string {
  const ts = NEWS_TEMPLATES[kind];
  return ts[hash32(`${kind}|${dedupeKey}`) % ts.length]!(facts);
}

/** Race classes that count as "Listed or above". */
export function isListedOrAbove(raceClass: string): boolean {
  return raceClass === "listed" || raceClass === "graded";
}

/** "Listed" / "Group" for a race class. */
export function levelLabel(raceClass: string): string {
  return raceClass === "graded" ? "Group" : "Listed";
}

/** Margin labels from the engine ("nose", "short head", "1/2") as news English ("a nose", "half a length"). */
export function marginWords(label: string): string {
  const words: Record<string, string> = { nose: "a nose", "short head": "a short head", head: "a head", neck: "a neck", "1/2": "half a length", "3/4": "three-quarters of a length", "1": "a length" };
  return words[label] ?? (/^\d/.test(label) ? `${label} lengths` : label);
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

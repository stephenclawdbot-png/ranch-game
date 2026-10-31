/**
 * Discoveries as moments (experience review item 7): when something hidden about a horse becomes
 * known, or a career milestone happens, the owner gets one inbox item that says what it means
 * and where to look, plus a one-time highlight on the horse page.
 *
 * Pure: the database decides *when* (settlement, a scan, a retirement) and makes each moment
 * idempotent by its `dedupeKey`; this file decides *whether* a change is a moment and what it
 * says. Nothing here reveals more than the rules already do at that moment: a quirk only once
 * it is revealed, an improver only once the step-up shows on the horse page, ranges only as
 * narrow as revealWidth allows.
 */
import { BIG_HEART_STAMINA, QUIRK_DOMINANT } from "./genome";
import { QUIRK_LABEL } from "./geneticsSummary";
import { CROWD_SHY_FIELD, QUIRK_EFFECT, QUIRK_REVEAL_PERMILLE, progressionGainOr, progressionOf, revealWidth, revealedRanges } from "./phenotype";
import { QUIRK_KEYS, STAT_KEYS, type HorseState, type QuirkKey, type RetireReason, type StatKey } from "./types";

export type MomentKind = "quirk" | "improver" | "exact" | "scan" | "first_win" | "first_feature" | "retired" | "legacy" | "memorial";

/** What a retired horse did on the racecourse: the tribute card. */
export interface Tribute {
  starts: number;
  wins: number;
  places: number;
  shows: number;
  earnings: number;
  peakOr: number;
  /** The richest race the horse won (its replay is one tap away), or null without a win. */
  bestWin: { raceId: string; raceName: string; purse: number; atMs: number } | null;
}

export interface MomentDraft {
  kind: MomentKind;
  /** Unique per account (inbox dedupe key): the same moment is never sent twice. */
  dedupeKey: string;
  horseId: string;
  title: string;
  /** "What this means", one or two plain sentences. */
  body: string;
  /** Where to look: the horse page, the replay, the Legacy Farm. */
  href: string;
  /** The race the moment came from: the moment stays hidden until its result has been seen. */
  raceId?: string;
  tribute?: Tribute;
}

const STAT_WORD: Record<StatKey, string> = {
  speed: "speed",
  stamina: "stamina",
  burst: "burst",
  durability: "durability",
  adaptability: "adaptability",
  temperament: "temperament",
};
const STAT_TITLE: Record<StatKey, string> = {
  speed: "Speed",
  stamina: "Stamina",
  burst: "Burst",
  durability: "Durability",
  adaptability: "Adaptability",
  temperament: "Temperament",
};

/** Pronouns for a horse's sex ("filly" / "mare" are she). */
export function pronounsOf(sex: string): { she: string; her: string; She: string; Her: string } {
  const f = sex === "filly" || sex === "mare" || sex === "female";
  return f ? { she: "she", her: "her", She: "She", Her: "Her" } : { she: "he", her: "his", She: "He", Her: "His" };
}

// ---------------------------------------------------------------------------
// The quirk catalogue (also printed by the wiki)
// ---------------------------------------------------------------------------

/** When each quirk shows itself in a race (game-core quirkTriggered, in words). */
export const QUIRK_TRIGGER_TEXT: Record<QuirkKey, string> = {
  mudlark: "on soft or heavy going",
  gateShy: "in every race, from the stalls",
  lateKick: "in every race, at the finish",
  crowdShy: `on big days (Features, Season Finals, Group races) and in any field of ${CROWD_SHY_FIELD} or more`,
};

/** "Sea Lavender is a mudlark" */
const QUIRK_PHRASE: Record<QuirkKey, string> = { mudlark: "is a mudlark", gateShy: "is gate-shy", lateKick: "has a late kick", crowdShy: "is crowd-shy" };

/** What an owner may do about each quirk (never a promise). */
export const QUIRK_ADVICE: Record<QuirkKey, string> = {
  mudlark: "Wet ground is the day to look for: soft or heavy going may suit.",
  gateShy: "Nothing to fix, it is in the genes; worth knowing before you breed.",
  lateKick: "A finishing burst may suit a stalker or closer plan.",
  crowdShy: "Smaller fields may suit better than the big days.",
};

/** "+150 adaptability, +15 speed" from QUIRK_EFFECT. */
export function quirkEffectText(q: QuirkKey): string {
  return (Object.entries(QUIRK_EFFECT[q]) as [StatKey, number][]).map(([k, d]) => `${d > 0 ? "+" : "−"}${Math.abs(d)} ${STAT_WORD[k]}`).join(", ");
}

/** "one copy is enough" / "needs two copies" from QUIRK_DOMINANT. */
export function quirkInheritanceText(q: QuirkKey): string {
  return QUIRK_DOMINANT[q] ? "dominant: one copy shows" : "recessive: shows only with two copies, so carriers pass it on unseen";
}

export interface QuirkCatalogueEntry {
  key: QuirkKey;
  label: string;
  when: string;
  effect: string;
  inheritance: string;
  advice: string;
}

/** Every quirk, what it does, when it shows and how it is inherited (numbers from the rules). */
export function quirkCatalogue(): QuirkCatalogueEntry[] {
  return QUIRK_KEYS.map((key) => ({
    key,
    label: QUIRK_LABEL[key],
    when: QUIRK_TRIGGER_TEXT[key],
    effect: quirkEffectText(key),
    inheritance: quirkInheritanceText(key),
    advice: QUIRK_ADVICE[key],
  }));
}

/** Chance a quirk that showed itself in a race is noticed afterwards (and revealed for good), percent. */
export const QUIRK_REVEAL_PCT = QUIRK_REVEAL_PERMILLE / 10;

// ---------------------------------------------------------------------------
// Moments
// ---------------------------------------------------------------------------

export const momentKey = (kind: MomentKind, horseId: string, extra?: string): string => `moment:${kind}:${horseId}${extra ? `:${extra}` : ""}`;

export function quirkMoment(h: { id: string; name: string; sex: string }, q: QuirkKey, race: { id: string; name: string }): MomentDraft {
  const p = pronounsOf(h.sex);
  return {
    kind: "quirk",
    dedupeKey: momentKey("quirk", h.id, q),
    horseId: h.id,
    title: `Quirk found: ${h.name} ${QUIRK_PHRASE[q]}`,
    body: `Noticed in the ${race.name}. ${quirkEffectSentence(q, p.she)} ${QUIRK_ADVICE[q]}`,
    href: `/horse/${h.id}`,
    raceId: race.id,
  };
}

function quirkEffectSentence(q: QuirkKey, she: string): string {
  return `${she[0]!.toUpperCase()}${she.slice(1)} races with ${quirkEffectText(q)} ${QUIRK_TRIGGER_TEXT[q]}.`;
}

/** The improver step-up, once it shows on the horse page (progressionOf + a real gain). */
export function improverShows(state: HorseState): boolean {
  return progressionOf(state).status !== null && progressionGainOr(state) > 0;
}

export function improverMoment(state: HorseState, race: { id: string; name: string }): MomentDraft {
  const p = pronounsOf(state.sex);
  const gain = progressionGainOr(state);
  return {
    kind: "improver",
    dedupeKey: momentKey("improver", state.id),
    horseId: state.id,
    title: `${state.name} is improving`,
    body: `${p.She} has stepped up about ${gain} lb, more than age alone explains, and keeps it for the rest of ${p.her} career. A class higher may now be worth trying.`,
    href: `/horse/${state.id}/career`,
    raceId: race.id,
  };
}

function gradesLine(state: HorseState): string {
  const r = revealedRanges(state);
  return STAT_KEYS.map((k) => (r[k].exact || r[k].loGrade === r[k].hiGrade ? `${STAT_TITLE[k]} ${r[k].loGrade}` : `${STAT_TITLE[k]} ${r[k].loGrade}–${r[k].hiGrade}`)).join(" · ");
}

/** The potential ranges have closed: the true grades are known. */
export function exactMoment(state: HorseState, race: { id: string; name: string } | null): MomentDraft {
  const p = pronounsOf(state.sex);
  return {
    kind: "exact",
    dedupeKey: momentKey("exact", state.id),
    horseId: state.id,
    title: `${state.name}'s potential is fully known`,
    body: `The ranges have closed: ${gradesLine(state)}. These are ${p.her} true ceilings; training decides how close ${p.she} gets.`,
    href: `/horse/${state.id}`,
    ...(race ? { raceId: race.id } : {}),
  };
}

/** A Pedigree Scan's result: the narrowed ranges, and big heart when the scan is what revealed it. */
export function scanMoment(before: HorseState, after: HorseState): MomentDraft {
  const exact = revealWidth(after) === 0;
  const heartNew = before.career.starts === 0;
  const bh = after.genome.genes2.bigHeart.filter((a) => a === "bh").length;
  const heart = !heartNew ? "" : bh === 2 ? ` Big heart: yes, +${BIG_HEART_STAMINA} stamina potential.` : bh === 1 ? " Big heart: carries one copy (shows only with two; can pass it on)." : " Big heart: none.";
  return {
    kind: "scan",
    dedupeKey: momentKey("scan", after.id),
    horseId: after.id,
    title: `Pedigree Scan: ${after.name}`,
    body: `${exact ? "The ranges are now exact" : `Ranges narrowed from ${revealWidth(before)} to ${revealWidth(after)} points`}: ${gradesLine(after)}.${heart}`,
    href: `/horse/${after.id}`,
  };
}

export function firstWinMoment(h: { id: string; name: string; sex: string }, race: { id: string; name: string }, starts: number): MomentDraft {
  const p = pronounsOf(h.sex);
  return {
    kind: "first_win",
    dedupeKey: momentKey("first_win", h.id),
    horseId: h.id,
    title: `First win: ${h.name}`,
    body: `${p.Her} first win, in the ${race.name}, at start ${starts}. The replay is there whenever you want it again.`,
    href: `/race/${race.id}`,
    raceId: race.id,
  };
}

export function firstFeatureMoment(h: { id: string; name: string; sex: string }, race: { id: string; name: string }, position: number, fieldSize: number): MomentDraft {
  const p = pronounsOf(h.sex);
  return {
    kind: "first_feature",
    dedupeKey: momentKey("first_feature", h.id),
    horseId: h.id,
    title: `${h.name}'s first Feature`,
    body: `${p.She} ran in the ${race.name}, ${p.her} first Feature: ${ordinalOf(position)} of ${fieldSize}. Big days mean a bigger crowd, a bigger purse and more League points.`,
    href: `/race/${race.id}`,
    raceId: race.id,
  };
}



function recordLine(t: Tribute): string {
  const best = t.bestWin ? ` Best win: the ${t.bestWin.raceName}.` : "";
  return `${t.starts} ${t.starts === 1 ? "start" : "starts"}, ${t.wins} ${t.wins === 1 ? "win" : "wins"}, ${t.places} second${t.places === 1 ? "" : "s"}, ${t.shows} third${t.shows === 1 ? "" : "s"}, ${thousands(t.earnings)} cr${t.peakOr > 0 ? `, peak OR ${t.peakOr}` : ""}.${best}`;
}

/** Retired from racing (to stud or the broodmare band): a tribute card. */
export function retiredMoment(h: { id: string; name: string; sex: string }, reason: RetireReason, tribute: Tribute, raceId?: string): MomentDraft {
  const p = pronounsOf(h.sex);
  const why = reason === "max_starts" ? "after a full career" : reason === "injury" ? "after an injury" : "";
  const next = p.she === "she" ? "She can join your broodmares." : "He can stand at stud.";
  return {
    kind: "retired",
    dedupeKey: momentKey("retired", h.id),
    horseId: h.id,
    title: `${h.name} retires${why ? ` ${why}` : ""}`,
    body: `${recordLine(tribute)} ${next}`,
    href: `/horse/${h.id}`,
    tribute,
    ...(raceId ? { raceId } : {}),
  };
}

/** Moved to the Legacy Farm for good: a tribute card. */
export function legacyMoment(h: { id: string; name: string; sex: string }, tribute: Tribute): MomentDraft {
  const p = pronounsOf(h.sex);
  return {
    kind: "legacy",
    dedupeKey: momentKey("legacy", h.id),
    horseId: h.id,
    title: `${h.name} goes to the Legacy Farm`,
    body: `${recordLine(tribute)} ${p.She} stays in your records and the Hall, with no upkeep, ever.`,
    href: `/legacy#h-${h.id}`,
    tribute,
  };
}

/** A fatal race injury: a quiet memorial, no celebration. */
export function memorialMoment(h: { id: string; name: string; sex: string }, race: { id: string; name: string }, tribute: Tribute): MomentDraft {
  const p = pronounsOf(h.sex);
  return {
    kind: "memorial",
    dedupeKey: momentKey("memorial", h.id),
    horseId: h.id,
    title: `In memoriam: ${h.name}`,
    body: `${h.name} was fatally injured in the ${race.name}. ${p.She} ran ${tribute.starts} ${tribute.starts === 1 ? "time" : "times"} and won ${tribute.wins}. ${p.Her} record stays in your books and the Hall, and any foals carry the line on.`,
    href: `/legacy#h-${h.id}`,
    raceId: race.id,
    tribute,
  };
}

export interface SettlementMomentInput {
  horse: { id: string; name: string; sex: string };
  race: { id: string; name: string; feature: boolean; rated: boolean };
  position: number;
  fieldSize: number;
  /** Game-core state before and after the run; null for a horse without a real genome. */
  before: HorseState | null;
  after: HorseState | null;
  /** Quirks revealed by this run (stored list after minus before). */
  newQuirks: readonly QuirkKey[];
  winsBefore: number;
  startsAfter: number;
  /** No earlier Feature run on the horse's record. */
  firstFeature: boolean;
  retired: RetireReason | null;
  fatal: boolean;
  /** The career summary after this run (for retirement and memorial cards). */
  tribute: Tribute | null;
}

/**
 * Every moment one run produces, best story first. A fatal injury replaces everything else
 * with the memorial: no "first Feature" next to a death.
 */
export function settlementMoments(i: SettlementMomentInput): MomentDraft[] {
  if (i.fatal) return i.tribute ? [memorialMoment(i.horse, i.race, i.tribute)] : [];
  const out: MomentDraft[] = [];
  if (i.race.rated && i.position === 1 && i.winsBefore === 0) out.push(firstWinMoment(i.horse, i.race, i.startsAfter));
  if (i.race.feature && i.firstFeature) out.push(firstFeatureMoment(i.horse, i.race, i.position, i.fieldSize));
  for (const q of i.newQuirks) out.push(quirkMoment(i.horse, q, i.race));
  if (i.before && i.after) {
    if (!improverShows(i.before) && improverShows(i.after)) out.push(improverMoment(i.after, i.race));
    if (revealWidth(i.before) > 0 && revealWidth(i.after) === 0) out.push(exactMoment(i.after, i.race));
  }
  if (i.retired && i.tribute) out.push(retiredMoment(i.horse, i.retired, i.tribute, i.race.id));
  return out;
}

function ordinalOf(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

/** 12345 -> "12,345" (no locale APIs in game-core). */
function thousands(n: number): string {
  const s = String(Math.abs(Math.trunc(n)));
  let out = "";
  for (let i = 0; i < s.length; i++) out += (i > 0 && (s.length - i) % 3 === 0 ? "," : "") + s[i];
  return n < 0 ? `-${out}` : out;
}

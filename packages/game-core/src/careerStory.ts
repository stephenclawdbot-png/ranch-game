/**
 * The career story: one short, specific line for each noteworthy thing a horse did, built from
 * what the game already records (results and margins, ratings before and after, injuries and
 * quirks from races, the Hall of Fame, retirement, and its foals' wins).
 *
 * Pure: the database supplies only races whose result is public (never before the broadcast
 * is over) and nothing private (no finances, no training, no vet bills). This file decides what
 * is worth a line and how it reads.
 *
 * Rules:
 *   - One line per race at most: everything one race meant (first win, a photo, an upset, a
 *     career-high rating, a quirk it showed, an injury) is folded into that race's line.
 *     Ordinary races (nothing below happened) get no line: no filler.
 *   - Chronological, oldest first. A story reads from the debut to the foals' wins; the
 *     newest-first view of the same events is the horse's log.
 *   - Every entry has a weight; the best STORY_HIGHLIGHTS are the `highlight`s shown before
 *     "show full career". The order stays chronological either way.
 *   - Upsets use the only pre-race standing the game records for every runner: the official
 *     rating at entry (race_entries.rating_before). Nothing is invented.
 */
import { injuryNameOf } from "./injuries";
import { QUIRK_PHRASE, pronounsOf } from "./moments";
import { QUIRK_KEYS, type QuirkKey } from "./types";

/** Lines shown before "show full career". */
export const STORY_HIGHLIGHTS = 12;
/** Meetings with one horse before it counts as the rival. */
export const STORY_RIVAL_MIN_MEETINGS = 3;
/** Runners needed for a win to count as an upset. */
export const STORY_UPSET_MIN_FIELD = 5;
/** A finish this close (the result's margin label) or the result's photo flag is a photo. */
export const STORY_PHOTO_LABELS: readonly string[] = ["nose", "short head", "head"];

export type StoryKind =
  | "debut"
  | "first_win"
  | "biggest_win"
  | "big_win"
  | "upset"
  | "photo_win"
  | "photo_loss"
  | "rating_peak"
  | "quirk"
  | "injury"
  | "comeback"
  | "rival"
  | "hall_of_fame"
  | "retired"
  | "legacy"
  | "memorial"
  | "foal_first_win"
  | "foal_big_win";

/** How much each kind matters when the story is cut to its highlights. */
export const STORY_WEIGHT: Record<StoryKind, number> = {
  memorial: 100,
  hall_of_fame: 92,
  retired: 90,
  biggest_win: 88,
  first_win: 86,
  debut: 84,
  legacy: 80,
  big_win: 75,
  foal_big_win: 70,
  upset: 66,
  photo_win: 64,
  comeback: 62,
  rival: 60,
  injury: 58,
  photo_loss: 55,
  rating_peak: 52,
  quirk: 48,
  foal_first_win: 44,
};

export interface StoryRunner {
  horseId: string;
  name: string;
  /** "male" / "female" (or a racing sex word: "filly", "colt"...). */
  sex: string;
  /** The stable that ran it; null for a Club runner. */
  stableId: string | null;
  position: number;
  /** Official rating at entry: the field's pre-race standing. */
  ratingBefore: number;
}

/** One settled, public race the horse ran in (Story races excluded: they are not its career). */
export interface StoryRun {
  raceId: string;
  raceName: string;
  atMs: number;
  /** races.kind: scheduled, feature, final, daily_cup, trial. */
  kind: string;
  /** races.race_class: maiden, novice, handicap, listed, graded. */
  raceClass: string;
  purse: number;
  /** The result's photo-finish flag (the second within PHOTO_FINISH_MM). */
  photoFinish: boolean;
  /** What the winner won by: the second's margin label ("nose", "neck", "2 1/2"). */
  wonBy: string | null;
  /** This horse's rating after the race. */
  ratingAfter: number | null;
  /** Every finisher, this horse included. */
  runners: StoryRunner[];
}

/** An injury picked up in one of the runs (horse_log). */
export interface StoryInjury {
  raceId: string;
  atMs: number;
  severity: string;
  /** Catalogue key (injuries.ts), when known. */
  kind: string | null;
}

/** Quirks one run revealed (horse_log). */
export interface StoryQuirk {
  raceId: string;
  atMs: number;
  quirks: string[];
}

export interface StoryHonour {
  key: string;
  atMs: number;
  /** "Champion", "Great racehorse"... */
  honour: string;
}

/** A win by one of the horse's foals (settled, public). */
export interface StoryFoalWin {
  foalId: string;
  foalName: string;
  foalSex: string;
  raceId: string;
  raceName: string;
  atMs: number;
  kind: string;
  raceClass: string;
  purse: number;
}

export interface CareerStoryInput {
  horse: {
    id: string;
    name: string;
    sex: string;
    gelded: boolean;
    careerStatus: string;
    retirementReason: string | null;
    retiredAtMs: number | null;
    pasturedAtMs: number | null;
    /** Set for a horse lost to a race injury. */
    diedAtMs: number | null;
    diedAtRaceId: string | null;
  };
  runs: readonly StoryRun[];
  injuries?: readonly StoryInjury[];
  quirks?: readonly StoryQuirk[];
  honours?: readonly StoryHonour[];
  foalWins?: readonly StoryFoalWin[];
}

export interface StoryEntry {
  /** Unique within the story. */
  key: string;
  /** The main thing the line is about. */
  kind: StoryKind;
  /** Everything the line covers (a race line can be a first win, a photo and an upset at once). */
  tags: StoryKind[];
  atMs: number;
  text: string;
  /** The race to replay, when there is one. */
  raceId: string | null;
  /** Another horse the line is about (a foal, the rival). */
  horseId: string | null;
  weight: number;
  /** One of the best STORY_HIGHLIGHTS lines (shown before "show full career"). */
  highlight: boolean;
}

const DAY_MS = 86_400_000;

/** Race standing for "biggest win": the big days first, then class. */
export function storyClassRank(kind: string, raceClass: string): number {
  if (kind === "final") return 6;
  if (kind === "feature") return 5;
  return raceClass === "graded" ? 4 : raceClass === "listed" ? 3 : raceClass === "handicap" ? 2 : raceClass === "novice" ? 1 : 0;
}

/** A Feature, a Season Final, a Listed or a Group race: a cup for the Trophy Room. */
export function isBigRace(kind: string, raceClass: string): boolean {
  return storyClassRank(kind, raceClass) >= 3;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

const NTH = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const nth = (n: number): string => NTH[n] ?? ordinal(n);
const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number, one: string, many: string): string => `${NUM[n] ?? n} ${n === 1 ? one : many}`;
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** "nose" -> "a nose", "1/2" -> "half a length", "2 1/2" -> "2 1/2 lengths". */
export function marginPhrase(label: string): string {
  if (label === "nose" || label === "short head" || label === "head" || label === "neck") return `a ${label}`;
  if (label === "dist") return "a distance";
  if (label === "1") return "a length";
  if (label === "1/2") return "half a length";
  if (label === "3/4") return "three-quarters of a length";
  return `${label} lengths`;
}

const isPhoto = (r: StoryRun): boolean => r.photoFinish || (r.wonBy !== null && STORY_PHOTO_LABELS.includes(r.wonBy));
const isQuirk = (q: string): q is QuirkKey => (QUIRK_KEYS as readonly string[]).includes(q);
const offspring = (sex: string): string => (pronounsOf(sex).she === "she" ? "daughter" : "son");
const injuryWord = (i: StoryInjury): string | null => {
  const name = injuryNameOf(i.severity, i.kind);
  // a bare severity label ("Minor injury") says nothing a "came home injured" doesn't
  return i.kind && name !== injuryNameOf(i.severity) ? name.toLowerCase() : null;
};

interface RaceFacts {
  run: StoryRun;
  me: StoryRunner;
  start: number;
  tags: Set<StoryKind>;
  opponent?: StoryRunner;
  meeting?: number;
  upsetRank?: number;
  ratedField?: number;
  peak?: number;
  quirks?: QuirkKey[];
  injury?: { inj: StoryInjury; layoffDays: number | null; ending: boolean; fatal: boolean };
  comeback?: { inj: StoryInjury; injRaceName: string; firstBack: boolean; days: number };
  wins: number;
  starts: number;
}

/**
 * The horse's career story, oldest first, every line it earns, with the best
 * STORY_HIGHLIGHTS marked `highlight`. Empty for an unraced horse with no foals or honours.
 */
export function careerStory(input: CareerStoryInput, opts: { highlights?: number } = {}): StoryEntry[] {
  const h = input.horse;
  const p = pronounsOf(h.sex);
  // one run per race, oldest first
  const seen = new Set<string>();
  const runs = [...input.runs]
    .filter((r) => r.runners.some((x) => x.horseId === h.id))
    .sort((a, b) => a.atMs - b.atMs || (a.raceId < b.raceId ? -1 : 1))
    .filter((r) => (seen.has(r.raceId) ? false : (seen.add(r.raceId), true)));
  const runIndex = new Map(runs.map((r, i) => [r.raceId, i]));
  const wins = runs.filter((r) => meOf(r, h.id).position === 1).length;

  // --- The rival: the owned horse from another stable met most often -------------------------
  const meet = new Map<string, { horse: StoryRunner; meetings: number; ahead: number; lastMs: number; lastRaceId: string; order: string[] }>();
  for (const r of runs) {
    const me = meOf(r, h.id);
    for (const o of r.runners) {
      if (o.horseId === h.id || !o.stableId || o.stableId === me.stableId) continue;
      const m = meet.get(o.horseId) ?? { horse: o, meetings: 0, ahead: 0, lastMs: 0, lastRaceId: r.raceId, order: [] };
      m.meetings++;
      if (me.position < o.position) m.ahead++;
      m.lastMs = r.atMs;
      m.lastRaceId = r.raceId;
      m.horse = o;
      m.order.push(r.raceId);
      meet.set(o.horseId, m);
    }
  }
  const rival =
    [...meet.values()]
      .filter((m) => m.meetings >= STORY_RIVAL_MIN_MEETINGS)
      .sort((a, b) => b.meetings - a.meetings || b.lastMs - a.lastMs || (a.horse.horseId < b.horse.horseId ? -1 : 1))[0] ?? null;

  // --- Per-race facts --------------------------------------------------------------------------
  const injuriesBy = new Map<string, StoryInjury>();
  for (const i of input.injuries ?? []) if (runIndex.has(i.raceId)) injuriesBy.set(i.raceId, i);
  if (h.diedAtRaceId && runIndex.has(h.diedAtRaceId) && !injuriesBy.has(h.diedAtRaceId)) injuriesBy.set(h.diedAtRaceId, { raceId: h.diedAtRaceId, atMs: h.diedAtMs ?? 0, severity: "fatal", kind: null });
  const quirksBy = new Map<string, QuirkKey[]>();
  for (const q of input.quirks ?? []) {
    if (!runIndex.has(q.raceId)) continue;
    const list = quirksBy.get(q.raceId) ?? [];
    for (const k of q.quirks) if (isQuirk(k) && !list.includes(k)) list.push(k);
    quirksBy.set(q.raceId, list);
  }

  // the career-high rating: the first run that reached the highest rating after a race
  const rated = runs.filter((r) => (r.ratingAfter ?? 0) > 0);
  const peakValue = rated.reduce((m, r) => Math.max(m, r.ratingAfter ?? 0), 0);
  const peakRun = rated.length >= 3 && peakValue > (rated[0]!.ratingAfter ?? 0) ? rated.find((r) => r.ratingAfter === peakValue) : undefined;

  const winsSorted = runs.filter((r) => meOf(r, h.id).position === 1);
  const biggest =
    wins >= 2
      ? [...winsSorted].sort((a, b) => storyClassRank(b.kind, b.raceClass) - storyClassRank(a.kind, a.raceClass) || b.purse - a.purse || a.atMs - b.atMs)[0]
      : undefined;

  const facts: RaceFacts[] = [];
  let winsSoFar = 0;
  let pending: { inj: StoryInjury; raceName: string; atMs: number } | null = null;
  let lastInjuryIdx = -1;
  for (const [i, r] of runs.entries()) {
    const me = meOf(r, h.id);
    const f: RaceFacts = { run: r, me, start: i + 1, tags: new Set(), wins, starts: runs.length };
    const won = me.position === 1;
    if (i === 0) f.tags.add("debut");
    if (won && winsSoFar === 0) f.tags.add("first_win");
    if (won && biggest?.raceId === r.raceId) f.tags.add("biggest_win");
    else if (won && isBigRace(r.kind, r.raceClass)) f.tags.add("big_win");
    // photo finishes: a win with the second within a head, or a second beaten that close
    if (isPhoto(r) && (me.position === 1 || me.position === 2)) {
      const opp = r.runners.find((x) => x.position === (me.position === 1 ? 2 : 1));
      if (opp) {
        f.tags.add(won ? "photo_win" : "photo_loss");
        f.opponent = opp;
        if (rival && opp.horseId === rival.horse.horseId) f.meeting = rival.order.indexOf(r.raceId) + 1;
      }
    }
    // an upset: won when rated in the bottom half of the field (and at least 3rd) beforehand
    if (won && me.ratingBefore > 0 && r.runners.length >= STORY_UPSET_MIN_FIELD) {
      const rank = 1 + r.runners.filter((x) => x.horseId !== h.id && x.ratingBefore > me.ratingBefore).length;
      if (rank >= 3 && rank * 2 > r.runners.length) {
        f.tags.add("upset");
        f.upsetRank = rank;
        f.ratedField = r.runners.length;
      }
    }
    if (peakRun?.raceId === r.raceId) {
      f.tags.add("rating_peak");
      f.peak = peakValue;
    }
    const q = quirksBy.get(r.raceId);
    if (q?.length) {
      f.tags.add("quirk");
      f.quirks = q;
    }
    // a comeback: the first win after an injury that was not the end
    if (won && pending) {
      f.tags.add("comeback");
      f.comeback = { inj: pending.inj, injRaceName: pending.raceName, firstBack: lastInjuryIdx === i - 1, days: Math.floor((r.atMs - pending.atMs) / DAY_MS) };
      pending = null;
    }
    const inj = injuriesBy.get(r.raceId);
    if (inj) {
      const fatal = inj.severity === "fatal" || h.diedAtRaceId === r.raceId;
      const ending = fatal || inj.severity === "career_ending";
      const next = runs[i + 1];
      f.tags.add(fatal ? "memorial" : "injury");
      f.injury = { inj, ending, fatal, layoffDays: next && !ending ? Math.floor((next.atMs - r.atMs) / DAY_MS) : null };
      if (!ending) {
        pending = { inj, raceName: r.raceName, atMs: r.atMs };
        lastInjuryIdx = i;
      }
    }
    if (won) winsSoFar++;
    if (f.tags.size) facts.push(f);
  }

  const out: Omit<StoryEntry, "highlight">[] = [];
  for (const f of facts) {
    const tags = [...f.tags].sort((a, b) => STORY_WEIGHT[b] - STORY_WEIGHT[a]);
    out.push({
      key: `race:${f.run.raceId}`,
      kind: tags[0]!,
      tags,
      atMs: f.run.atMs,
      text: raceLine(f, p),
      raceId: f.run.raceId,
      horseId: f.opponent?.horseId ?? null,
      weight: STORY_WEIGHT[tags[0]!] + tags.length - 1,
    });
  }

  if (rival) {
    const rp = pronounsOf(rival.horse.sex);
    const behind = rival.meetings - rival.ahead;
    out.push({
      key: `rival:${rival.horse.horseId}`,
      kind: "rival",
      tags: ["rival"],
      atMs: rival.lastMs + 1,
      text: `${rival.horse.name} became ${p.her} rival: ${count(rival.meetings, "meeting", "meetings")}, more than any other horse, and ${rival.ahead}–${behind} against ${rp.her === "her" ? "her" : "him"}.`,
      raceId: rival.lastRaceId,
      horseId: rival.horse.horseId,
      weight: STORY_WEIGHT.rival,
    });
  }

  const honourKeys = new Set<string>();
  for (const hon of input.honours ?? []) {
    if (honourKeys.has(hon.key)) continue;
    honourKeys.add(hon.key);
    out.push({ key: `hall:${hon.key}`, kind: "hall_of_fame", tags: ["hall_of_fame"], atMs: hon.atMs, text: `Inducted into the Hall of Fame: ${hon.honour}.`, raceId: null, horseId: null, weight: STORY_WEIGHT.hall_of_fame });
  }

  // --- Retirement (a horse lost in a race has its memorial line instead) ------------------------
  if (runs.length && h.diedAtMs === null && h.retiredAtMs !== null && h.careerStatus !== "racing") {
    const record = `${count(runs.length, "start", "starts")} and ${count(wins, "win", "wins")}`;
    const where = p.she === "she" ? "to the broodmare band" : h.gelded ? "from racing" : "to stud";
    const ending = [...injuriesBy.values()].filter((i) => i.severity === "career_ending").sort((a, b) => b.atMs - a.atMs)[0];
    const why = h.retirementReason === "max_starts" ? `after a full career: ${record}` : h.retirementReason === "injury" && ending ? `after ${injuryWord(ending) ?? "an injury"} ended ${p.her} racing: ${record}` : `after ${record}`;
    const together = h.pasturedAtMs !== null && h.pasturedAtMs - h.retiredAtMs < 60_000;
    out.push({
      key: "retired",
      kind: together ? "legacy" : "retired",
      tags: together ? ["retired", "legacy"] : ["retired"],
      atMs: h.retiredAtMs,
      text: together ? `Retired to the Legacy Farm ${why}.` : `Retired ${where} ${why}.`,
      raceId: null,
      horseId: null,
      weight: STORY_WEIGHT.retired,
    });
    if (h.pasturedAtMs !== null && !together) {
      out.push({ key: "legacy", kind: "legacy", tags: ["legacy"], atMs: h.pasturedAtMs, text: `Moved to the Legacy Farm, ${p.her} home for good.`, raceId: null, horseId: null, weight: STORY_WEIGHT.legacy });
    }
  }

  // --- The next generation: each foal's first win and its big wins -----------------------------
  const foalSeen = new Set<string>();
  const firstOf = new Map<string, string>();
  for (const w of [...(input.foalWins ?? [])].sort((a, b) => a.atMs - b.atMs || (a.raceId < b.raceId ? -1 : 1))) {
    const k = `${w.foalId}:${w.raceId}`;
    if (foalSeen.has(k)) continue;
    foalSeen.add(k);
    const first = !firstOf.has(w.foalId);
    if (first) firstOf.set(w.foalId, w.raceId);
    const big = isBigRace(w.kind, w.raceClass);
    if (!first && !big) continue;
    const fp = pronounsOf(w.foalSex);
    const who = `${p.Her} ${offspring(w.foalSex)} ${w.foalName}`;
    const text = big ? `${who} won the ${w.raceName}${first ? `, ${fp.her} first win` : ""}.` : `${who} won for the first time, in the ${w.raceName}.`;
    const kind: StoryKind = big ? "foal_big_win" : "foal_first_win";
    out.push({ key: `foal:${k}`, kind, tags: big && first ? ["foal_big_win", "foal_first_win"] : [kind], atMs: w.atMs, text, raceId: w.raceId, horseId: w.foalId, weight: STORY_WEIGHT[kind] + storyClassRank(w.kind, w.raceClass) });
  }

  // --- Highlights and order --------------------------------------------------------------------
  const keep = Math.max(0, opts.highlights ?? STORY_HIGHLIGHTS);
  const best = new Set(
    [...out]
      .sort((a, b) => b.weight - a.weight || b.atMs - a.atMs || (a.key < b.key ? -1 : 1))
      .slice(0, keep)
      .map((e) => e.key),
  );
  return out.sort((a, b) => a.atMs - b.atMs || (a.key < b.key ? -1 : 1)).map((e) => ({ ...e, highlight: best.has(e.key) }));
}

function meOf(r: StoryRun, id: string): StoryRunner {
  return r.runners.find((x) => x.horseId === id)!;
}

/** One race, everything it meant, in one or two short sentences. */
function raceLine(f: RaceFacts, p: ReturnType<typeof pronounsOf>): string {
  const r = f.run;
  const t = f.tags;
  const n = r.runners.length;
  const race = `the ${r.raceName}`;
  if (f.injury?.fatal) {
    return `Fatally injured in ${race}. ${p.She} ran ${count(f.starts, "time", "times")}${f.wins ? ` and won ${count(f.wins, "race", "races")}` : ""}; ${p.her} memory stays on the Legacy Farm.`;
  }
  const oppHim = f.opponent ? (pronounsOf(f.opponent.sex).she === "she" ? "her" : "him") : "";
  const meeting = f.opponent && f.meeting && f.meeting >= 2 ? `${p.her} ${nth(f.meeting)} meeting with ${oppHim}` : null;
  const tail: string[] = [];
  let lead: string;
  if (f.me.position === 1) {
    const by = f.opponent ? ` by ${marginPhrase(r.wonBy ?? "nose")} from ${f.opponent.name}` : r.wonBy ? ` by ${marginPhrase(r.wonBy)}` : "";
    lead = t.has("debut") ? `Won on ${p.her} debut in ${race}${by}` : `Won ${race}${by}`;
    if (t.has("first_win") && !t.has("debut")) tail.push(`${p.her} first win at start ${f.start}`);
    if (t.has("biggest_win")) tail.push(`the biggest win of ${p.her} career`);
    if (meeting) tail.push(meeting);
  } else if (t.has("photo_loss") && f.opponent) {
    lead = `Beaten ${marginPhrase(r.wonBy ?? "nose")} by ${f.opponent.name} ${t.has("debut") ? `on ${p.her} debut in` : "in"} ${race}`;
    if (meeting) tail.push(meeting);
  } else if (t.has("debut")) {
    lead = `Made ${p.her} debut in ${race}, ${ordinal(f.me.position)} of ${n}`;
  } else {
    lead = `${ordinal(f.me.position)} of ${n} in ${race}`;
  }
  const sentences = [`${cap(lead)}${tail.length ? `, ${tail.join(", ")}` : ""}.`];
  if (f.upsetRank) sentences.push(`Only ${ordinal(f.upsetRank)} of ${f.ratedField} on ratings beforehand.`);
  if (f.comeback) {
    const what = injuryWord(f.comeback.inj);
    sentences.push(
      f.comeback.firstBack
        ? `First time back, ${count(f.comeback.days, "day", "days")} after ${what ?? "an injury"} in the ${f.comeback.injRaceName}.`
        : `${p.Her} first win since ${what ?? "an injury"} in the ${f.comeback.injRaceName}.`,
    );
  }
  if (f.peak) sentences.push(`Rated ${f.peak} afterwards, ${p.her} career high.`);
  if (f.quirks?.length) sentences.push(`The race showed ${p.she} ${f.quirks.map((q) => QUIRK_PHRASE[q]).join(" and ")}.`);
  if (f.injury) {
    const what = injuryWord(f.injury.inj);
    sentences.push(
      f.injury.ending
        ? `Came home injured${what ? `: ${what}` : ""}, and never raced again.`
        : `Came home injured${what ? `: ${what}` : ""}${f.injury.layoffDays !== null && f.injury.layoffDays >= 1 ? `, ${count(f.injury.layoffDays, "day", "days")} off` : ""}.`,
    );
  }
  return sentences.join(" ");
}

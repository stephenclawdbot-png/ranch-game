/**
 * The race call as speech: each call line also becomes a short sequence of phrase ids and slots
 * (horse names, saddle-cloth numbers, margins, ordinals, courses...) plus an intensity. The
 * 1960s radio commentary (docs/commentary.md) plays these from a library of pre-rendered clips,
 * so a race costs nothing to voice and the server does no work.
 *
 * Pure and deterministic: no DOM, no clock. The spoken wording is a shorter, radio-shaped
 * version of the text line (the text call is unchanged); every fixed fragment below is one clip
 * per caster and intensity, and the vocabulary is derived from these templates, so the clip
 * library (tools/commentary) and the speech can never drift apart (manifest test).
 */
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";
import { hash32, numberWord, ordinal } from "../phrases";

/** How the caster delivers a line: calm (the early race), building (the turn, a move), climax (a duel, a comeback, the line). */
export type Intensity = "calm" | "building" | "climax";
export const INTENSITIES: readonly Intensity[] = ["calm", "building", "climax"];

/** A horse as spoken: its name clip, or "number six" until the name has a clip. */
export interface NameToken {
  k: "name";
  name: string;
  /** Saddle-cloth number (the gate), said instead of the name when no clip exists. */
  num: number;
  /** Said as "your X" (the viewer's horse). */
  your?: boolean;
}
export interface PhraseToken {
  k: "p";
  /** A library clip id (VOCABULARY). */
  id: string;
}
export type SpeechToken = NameToken | PhraseToken;

export interface Speech {
  intensity: Intensity;
  tokens: SpeechToken[];
}

/** Slot values a spoken template reads. Horses are indices into `names`. */
export interface SpeechSlots {
  a?: number;
  b?: number;
  c?: number;
  d?: number;
  /** A list of horses ("Copper Comet, Golden Mile and Quiet Riot"). */
  rest?: number[];
  /** A distance in mm, said as lengths. */
  gap?: number;
  /** The official margin at the line, mm. */
  margin?: number;
  /** A position (1 = first). */
  pos?: number;
  /** Lane (0 = the rail). */
  lane?: number;
  course?: string;
  /** Raw going ("firm" | "good" | "soft" | "heavy"). */
  going?: string;
  /** Horse slots are said as the text calls them: the viewer's horses as "your X". */
  called?: boolean;
}

/** The six racecourses (game-core COURSES; apps/web checks the two lists agree). */
export const COURSE_NAMES = ["Ashcombe", "Kestrel Downs", "Saltmarsh", "Bellmont", "Larkspur", "Harrowgate"] as const;
/** Highest saddle-cloth number / position with a clip. */
export const MAX_NUMBER = 24;

/**
 * Spoken templates per beat. `{a}`..`{d}` horses, `{#a}` horse a's saddle-cloth number
 * ("number six"), `{rest}` a list of horses, `{gap}` / `{margin}` lengths, `{pos}` an ordinal,
 * `{lane}`, `{course}`, `{going}`. Literal text between slots is one clip each.
 * A template whose slot can't be voiced (an unknown course) is skipped for the next one.
 */
export const SPOKEN = {
  off: ["And they're off!", "They're off, and racing!", "The stalls open, and they're away!", "And away they go, on {going}."],
  offSlow: ["And they're off! {rest} slowly away.", "They're away, but {rest} missed the break."],
  slowLate: ["{a} was slowly away.", "A slow start from {a}."],
  position: ["{a} leads by {gap} from {b}. {c} third.", "It's {a}, by {gap}, from {b} and {c}.", "{a} still in front, {gap} up on {b}, then {c}."],
  positionTwo: ["{a} leads by {gap} from {b}.", "{a} still in front, {b} tracking."],
  strung: ["They're well strung out now."],
  bunched: ["They're closely bunched."],
  half: ["Halfway, and {a} is the leader."],
  home: ["They turn for home, {a} in front!", "Into the straight, and {a} leads!"],
  homeLong: ["Into the long straight at {course}, {a} in front!"],
  homeShort: ["Into the short straight at {course}, {a} leads!"],
  homeCourse: ["Into the straight at {course}, {a} in front!"],
  hillUp: ["Up the hill now, {a} holds on in front!"],
  hillDown: ["Downhill to the line, {a} leading!"],
  twoOut: ["Two furlongs out, {a} leads from {b}!", "Two to run, {a} from {b}!"],
  finalFurlong: ["Into the final furlong! {a}, with {b} closing!", "A furlong to run, {a} from {b}!"],
  finalFurlongClear: ["A furlong to run, and {a} is clear!", "Inside the last furlong, {a} going away!"],
  hundred: ["A hundred metres to go!", "{a}! {b}! A hundred to go!"],
  leadTake: ["{a} takes it up from {b}.", "{a} goes to the front."],
  leadLate: ["And {a} goes past {b}!", "{a} grabs the lead from {b}!"],
  moveWide: ["Here comes {a}, on the outside!", "{a} sweeps around the field!"],
  moveInside: ["{a} is improving along the rail.", "{a} is picking them off."],
  gain: ["{a} is flying, up to {pos}!", "Look at {a}, up into {pos}!"],
  /** A horse making big ground late (spoken only; the text says "gain"). */
  comeback: ["But look at this! {a}, coming from nowhere!", "And here comes {a}, from the back of the field!"],
  boxedIn: ["{a} has nowhere to go!"],
  kick: ["{a} kicks for home!", "{a} quickens!"],
  tiring: ["{a} is weakening.", "{a} has had enough."],
  tiringGoing: ["{a} is feeling the {going}."],
  challenge: ["Here comes {b}, to take on {a}!", "{b} throws down the challenge!"],
  /** Variant 0 is the shouted duel, always used at climax. */
  duel: ["{a}! {b}! {a}! {b}!", "{a} and {b}, head to head!"],
  finish: ["{a} wins it!", "And {a} has won it!"],
  finishEasy: ["{a} wins easily.", "{a} hacks up."],
  finishClose: ["{a} just holds {b}!", "{a} by a whisker, from {b}!"],
  photo: ["They hit the line together! It's a photograph!", "{a} and {b}, together on the line! Photograph!"],
  result: ["First, {#a}, {a}. Second, {b}, beaten {margin}. And {c} third."],
  resultTwo: ["First, {#a}, {a}. Second, {b}, beaten {margin}."],
  resultPhoto: ["Here's the result of the photograph... First, {#a}, {a}! By {margin}! Second, {b}. And {c} third."],
  deadHeat: ["It's a dead heat! {a} and {b}!"],
  youSettle: ["And your {a} has settled {pos}, {lane}."],
  youPos: ["Your {a} is {pos}, {lane}."],
  youLead: ["Your {a} is in front!"],
  youFront: ["Your {a} hits the front!"],
  youGain: ["Here comes your {a}, up to {pos}!"],
  youBoxed: ["Your {a} needs a gap!"],
  youWon: ["Your {a} has won it!"],
  youPlaced: ["Your {a} finishes {pos}. A fine run."],
  youOther: ["Your {a} came home {pos}."],
  // The first call (built in code): "{a} leads from {b}, then ... and ..., with {z} at the rear."
  orderParts: ["leads from", "then", "and", "with", "at the rear.", "Further back,", "your"],
} as const satisfies Record<string, readonly string[]>;

export type SpokenBeat = Exclude<keyof typeof SPOKEN, "orderParts">;

/** A clip id from literal text: lowercase words joined by "_". */
export function phraseId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

type Piece = { lit: string } | { slot: string };

const parsed = new Map<string, Piece[]>();
/** Splits a template into literal fragments and slots (punctuation-only fragments are dropped). */
export function parseTemplate(tpl: string): Piece[] {
  let out = parsed.get(tpl);
  if (out) return out;
  out = [];
  for (const part of tpl.split(/(\{#?\w+\})/)) {
    const m = /^\{(#?\w+)\}$/.exec(part);
    if (m) out.push({ slot: m[1]! });
    else {
      const lit = part.trim().replace(/^[,;.!?]+\s*/, "");
      if (/[a-z0-9]/i.test(lit)) out.push({ lit });
    }
  }
  parsed.set(tpl, out);
  return out;
}

// ---- slot vocabularies ---------------------------------------------------------------------

/** Every lengths / margin phrase the call can say, with its clip id. */
const MARGIN_TEXTS: string[] = (() => {
  const t = ["a nose", "a short head", "a head", "a neck", "half a length", "three-quarters of a length", "a length", "a length and a half", "two lengths", "two and a half lengths"];
  for (let n = 3; n <= 20; n++) t.push(`${numberWord(n)} lengths`);
  t.push("over twenty lengths");
  return t;
})();

/** Lengths as said (the same buckets as phrases.ts lengthsPhrase / marginPhrase). */
export function marginId(mm: number, official = false): string {
  const l = Math.max(0, mm) / HORSE_LENGTH_MM;
  let text: string;
  if (official && l >= 0.05 && l < 0.1) text = "a short head";
  else if (official && l >= 0.2 && l < 0.3) text = "a neck";
  else if (l < (official ? 0.05 : 0.1)) text = "a nose";
  else if (l < 0.3) text = "a head";
  else if (l < 0.6) text = "half a length";
  else if (l < 0.85) text = "three-quarters of a length";
  else if (l < 1.25) text = "a length";
  else if (l < 1.75) text = "a length and a half";
  else if (l < 2.25) text = "two lengths";
  else if (l < 2.75) text = "two and a half lengths";
  else {
    const whole = Math.round(l);
    text = whole > 20 ? "over twenty lengths" : `${numberWord(whole)} lengths`;
  }
  return `m_${phraseId(text)}`;
}

const GOING_TEXT: Record<string, string> = { firm: "fast ground", good: "good ground", soft: "soft ground", heavy: "heavy ground" };
const LANE_TEXTS = ["on the rail", "one off the rail", "three wide", "out wide"];
export function laneId(lane: number): string {
  const k = lane < 0.5 ? 0 : lane < 1.5 ? 1 : lane < 2.5 ? 2 : 3;
  return `lane_${phraseId(LANE_TEXTS[k]!)}`;
}

/** Every clip the commentary can play: id -> text as the caster says it. */
export const VOCABULARY: ReadonlyMap<string, string> = (() => {
  const v = new Map<string, string>();
  const add = (id: string, text: string) => {
    const had = v.get(id);
    if (had !== undefined && had.toLowerCase() !== text.toLowerCase()) throw new Error(`phrase id ${id}: "${had}" vs "${text}"`);
    if (had === undefined) v.set(id, text);
  };
  for (const list of Object.values(SPOKEN)) {
    for (const tpl of list) for (const p of parseTemplate(tpl)) if ("lit" in p) add(phraseId(p.lit), p.lit);
  }
  for (let n = 1; n <= MAX_NUMBER; n++) {
    add(`num_${n}`, `number ${n <= 20 ? numberWord(n) : `twenty-${numberWord(n - 20)}`}`);
    add(`ord_${n}`, ordinal(n));
  }
  for (const t of MARGIN_TEXTS) add(`m_${phraseId(t)}`, t);
  for (const t of new Set(Object.values(GOING_TEXT))) add(`going_${phraseId(t)}`, t);
  for (const t of LANE_TEXTS) add(`lane_${phraseId(t)}`, t);
  for (const c of COURSE_NAMES) add(`course_${phraseId(c)}`, c);
  return v;
})();

// ---- building speech -----------------------------------------------------------------------

export interface SpeechContext {
  /** horse index -> name token (name, saddle-cloth number; `called`: "your X" for the viewer's horses). */
  name: (h: number, called?: boolean) => NameToken;
  /** Picks the spoken variant; stable per race and line. */
  key: string;
}

const P = (text: string): PhraseToken => ({ k: "p", id: phraseId(text) });

function slotTokens(slot: string, s: SpeechSlots, ctx: SpeechContext): SpeechToken[] | null {
  const horse = (h: number | undefined) => (h === undefined ? null : ctx.name(h, s.called));
  switch (slot) {
    case "a":
    case "b":
    case "c":
    case "d": {
      const t = horse(s[slot]);
      return t ? [t] : null;
    }
    case "#a": {
      if (s.a === undefined) return null;
      const n = ctx.name(s.a).num;
      return n >= 1 && n <= MAX_NUMBER ? [{ k: "p", id: `num_${n}` }] : [];
    }
    case "rest":
      return s.rest?.length ? listTokens(s.rest.map((h) => ctx.name(h, s.called))) : null;
    case "gap":
      return s.gap === undefined ? null : [{ k: "p", id: marginId(s.gap) }];
    case "margin":
      return s.margin === undefined ? null : [{ k: "p", id: marginId(s.margin, true) }];
    case "pos":
      return s.pos === undefined || s.pos < 1 || s.pos > MAX_NUMBER ? null : [{ k: "p", id: `ord_${s.pos}` }];
    case "lane":
      return s.lane === undefined ? null : [{ k: "p", id: laneId(s.lane) }];
    case "course": {
      const c = COURSE_NAMES.find((x) => x === s.course);
      return c ? [{ k: "p", id: `course_${phraseId(c)}` }] : null;
    }
    case "going": {
      const g = GOING_TEXT[s.going ?? "good"];
      return g ? [{ k: "p", id: `going_${phraseId(g)}` }] : null;
    }
    default:
      return null;
  }
}

/** "A, B and C" as tokens. */
export function listTokens(names: NameToken[]): SpeechToken[] {
  const out: SpeechToken[] = [];
  names.forEach((n, i) => {
    if (i > 0 && i === names.length - 1) out.push(P("and"));
    out.push(n);
  });
  return out;
}

function render(tpl: string, s: SpeechSlots, ctx: SpeechContext): SpeechToken[] | null {
  const out: SpeechToken[] = [];
  for (const p of parseTemplate(tpl)) {
    if ("lit" in p) out.push(P(p.lit));
    else {
      const t = slotTokens(p.slot, s, ctx);
      if (!t) return null;
      out.push(...t);
    }
  }
  return out;
}

/** The spoken form of one beat, or null when nothing in it can be voiced. */
export function speak(beat: SpokenBeat, slots: SpeechSlots, intensity: Intensity, ctx: SpeechContext): Speech | null {
  const list: readonly string[] = SPOKEN[beat];
  if (!list.length) return null;
  const first = beat === "duel" && intensity === "climax" ? 0 : hash32(`${ctx.key}|${beat}`) % list.length;
  for (let k = 0; k < list.length; k++) {
    const tokens = render(list[(first + k) % list.length]!, slots, ctx);
    if (tokens) return { intensity, tokens };
  }
  return null;
}

/** Joins several speeches into one line (the later ones' intensity wins only if higher). */
export function joinSpeech(...parts: Array<Speech | null>): Speech | null {
  const ok = parts.filter((p): p is Speech => !!p);
  if (!ok.length) return null;
  const rank = (i: Intensity) => INTENSITIES.indexOf(i);
  const intensity = ok.reduce<Intensity>((m, p) => (rank(p.intensity) > rank(m) ? p.intensity : m), ok[0]!.intensity);
  return { intensity, tokens: ok.flatMap((p) => p.tokens) };
}

/**
 * The opening order as speech: the leader, second and a couple more, then the backmarker. A big
 * field is split over two lines: `rear` false on the first (the backmarker comes in the second,
 * `continued`, which names up to three more).
 */
export function speakOrder(names: NameToken[], intensity: Intensity, continued: boolean, rear = true): Speech | null {
  if (!names.length) return null;
  const t: SpeechToken[] = [];
  if (continued) {
    t.push(P("Further back,"), ...listTokens(names.slice(0, -1).slice(0, 3)), P("with"), names[names.length - 1]!, P("at the rear."));
    return { intensity, tokens: t };
  }
  t.push(names[0]!);
  if (names.length >= 2) t.push(P("leads from"), names[1]!);
  const mid = names.slice(2, rear ? Math.max(2, names.length - 1) : names.length).slice(0, rear ? 2 : 3);
  if (mid.length) t.push(P("then"), ...listTokens(mid));
  if (rear && names.length >= 3) t.push(P("with"), names[names.length - 1]!, P("at the rear."));
  return { intensity, tokens: t };
}

/** Every clip id a speech needs (names excluded). */
export function phraseIdsOf(s: Speech): string[] {
  const out: string[] = [];
  for (const t of s.tokens) {
    if (t.k === "p") out.push(t.id);
    else if (t.your) out.push("your");
  }
  return out;
}

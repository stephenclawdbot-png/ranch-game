/**
 * Words and numbers for the form book (form lines, splits, the horse's log). Client-safe: no
 * server imports. Racing conventions: beaten distances in lengths (HORSE_LENGTH_MM = 2.4 m, to
 * the nearest quarter), times as m:ss.hh, draw thirds, rest since the previous run.
 */
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";
import { injuryKindOf } from "@thoroughbred/game-core";
import type { FormLineView, SplitBucketView, SplitsView } from "./types";
import { GOING_LABEL, STYLE_LABEL, SURFACE_LABEL, formatDistance, ordinal } from "./format";

/** Beaten distance: "won", "3 1/4 L", "12 L"; null margins read "—". */
export function lengthsText(mm: number | null, position?: number): string {
  if (position === 1) return "won";
  if (mm === null) return "—";
  if (mm < 150) return "nose";
  if (mm < 400) return "s.hd";
  if (mm < 700) return "hd";
  if (mm < 1200) return "nk";
  const quarters = Math.round((mm * 4) / HORSE_LENGTH_MM);
  const whole = Math.floor(quarters / 4);
  const frac = ["", "1/4", "1/2", "3/4"][quarters % 4]!;
  return `${whole > 0 ? whole : ""}${whole > 0 && frac ? " " : ""}${frac} L`.trim();
}

/** An engine margin label as words: "neck" -> "a neck", "1 1/4" -> "1 1/4 lengths", "dist" -> "a distance". */
export function marginPhrase(label: string): string {
  if (label === "dist") return "a distance";
  if (/^[0-9]/.test(label)) return label === "1" ? "1 length" : `${label} lengths`;
  return `a ${label}`;
}

/** Average beaten distance in lengths with one decimal ("2.3 L"), "—" without margins. */
export function avgLengthsText(mm: number | null): string {
  if (mm === null) return "—";
  return `${(mm / HORSE_LENGTH_MM).toFixed(1)} L`;
}

/** Microseconds as a race time: 72_345_678 -> "1:12.35". */
export function raceTimeText(us: number | null): string {
  if (us === null || us <= 0) return "—";
  const hundredths = Math.round(us / 10_000);
  const m = Math.floor(hundredths / 6000);
  const s = (hundredths % 6000) / 100;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/** Own time behind the winner: "+0.84 s". */
export function behindText(timeUs: number | null, winnerUs: number | null): string | null {
  if (timeUs === null || winnerUs === null || timeUs <= winnerUs) return null;
  return `+${((timeUs - winnerUs) / 1_000_000).toFixed(2)} s`;
}

export const DIMENSION_LABEL: Record<string, string> = {
  going: "Going",
  distance: "Trip",
  surface: "Surface",
  course: "Course",
  tactic: "Tactic",
  jockey: "Jockey",
  draw: "Draw",
  rest: "Rest",
};

const DISTANCE_BAND_LABEL: Record<string, string> = { sprint: "Sprint", mile: "Mile", middle: "Middle", staying: "Long" };
/** game-core distanceBand edges. */
export const DISTANCE_BAND_RANGE: Record<string, string> = { sprint: "under 1,300 m", mile: "1,300–1,749 m", middle: "1,750–2,299 m", staying: "2,300 m+" };
const DRAW_LABEL: Record<string, string> = { low: "Low draw", mid: "Middle draw", high: "High draw" };
const REST_LABEL: Record<string, string> = { first: "First in list", same_day: "Same day", "1_2_days": "1–2 days", "3_6_days": "3–6 days", "7_plus_days": "7+ days" };
export const JOCKEY_LABEL: Record<string, string> = { apprentice: "Apprentice", journeyman: "Journeyman", top: "Top jockey" };
export const EXTRA_LABEL: Record<string, string> = { soft_shoes: "Soft shoes", firm_shoes: "Firm shoes", physio: "Physio", vet_check: "Vet check" };
export const INTENSITY_LABEL: Record<string, string> = { conservative: "Conservative", normal: "Normal", all_out: "All out" };

/** A bucket's name: "Good", "Mile", "Low draw", "3–6 days"... */
export function bucketLabel(dimension: string, key: string): string {
  switch (dimension) {
    case "going":
      return GOING_LABEL[key as keyof typeof GOING_LABEL] ?? key;
    case "surface":
      return SURFACE_LABEL[key as keyof typeof SURFACE_LABEL] ?? key;
    case "distance":
      return DISTANCE_BAND_LABEL[key] ?? key;
    case "tactic":
      return STYLE_LABEL[key as keyof typeof STYLE_LABEL] ?? key;
    case "jockey":
      return JOCKEY_LABEL[key] ?? key;
    case "draw":
      return DRAW_LABEL[key] ?? key;
    case "rest":
      return REST_LABEL[key] ?? key;
    default:
      return key;
  }
}

/** How a best / worst pick reads: "good ground", "a mile", "a low draw". */
export function pickPhrase(dimension: string, key: string): string {
  const l = bucketLabel(dimension, key);
  switch (dimension) {
    case "going":
      return `${l.toLowerCase()} ground`;
    case "distance":
      return key === "staying" ? "a long trip" : `a ${l.toLowerCase()}`;
    case "surface":
      return l.toLowerCase();
    case "tactic":
      return `riding as a ${l.toLowerCase()}`;
    case "jockey":
      return JOCKEY_LABEL[key] ? `a ${l.toLowerCase()}` : l;
    case "draw":
      return `a ${l.toLowerCase()}`;
    case "course":
      return `at ${l}`;
    case "rest":
      return key === "first" ? "the first run in the book" : key === "same_day" ? "a second run the same day" : `${l} since the last run`;
    default:
      return l;
  }
}

/** "2-1-0 from 3". */
export function recordText(b: Pick<SplitBucketView, "wins" | "seconds" | "thirds" | "runs">): string {
  return `${b.wins}-${b.seconds}-${b.thirds} from ${b.runs}`;
}

/** "Best: good ground, 2-1-0 from 3 · worst: soft ground, 0-0-1 from 4", or null when nothing stands out yet. */
export function bestWorstText(s: SplitsView): { best: string; worst: string } | null {
  if (!s.best || !s.worst) return null;
  return {
    best: `${pickPhrase(s.best.dimension, s.best.bucket.key)}, ${recordText(s.best.bucket)}, beaten ${avgLengthsText(s.best.bucket.avgBeatenMm)} on average`,
    worst: `${pickPhrase(s.worst.dimension, s.worst.bucket.key)}, ${recordText(s.worst.bucket)}, beaten ${avgLengthsText(s.worst.bucket.avgBeatenMm)} on average`,
  };
}

/** The jockey as the form line prints it: a name once jockeys have names, else the tier. */
export function jockeyText(j: FormLineView["jockey"]): string {
  if (j.name) return j.name;
  if (j.tier) return JOCKEY_LABEL[j.tier] ?? j.tier;
  return "—";
}

/** Draw as "4/10". */
export function drawText(l: Pick<FormLineView, "gate" | "fieldSize">): string {
  return l.gate ? `${l.gate}/${l.fieldSize}` : "—";
}

/** Field size: "10 ran" once run; "8 runners" when the field is locked; "3 declared so far" before. */
export function fieldText(l: Pick<FormLineView, "result" | "gate" | "fieldSize">): string {
  if (l.result) return `${l.fieldSize} ran`;
  return l.gate ? `${l.fieldSize} runners` : `${l.fieldSize} declared so far`;
}

/** The meta line of a phone row: date, trip, going, and the course unless the race is named after it. */
export function shortMeta(l: Pick<FormLineView, "postTimeMs" | "course" | "raceName" | "distanceM" | "going">): string {
  const course = l.course && !l.raceName.startsWith(l.course) ? l.course : null;
  return [dateText(l.postTimeMs), formatDistance(l.distanceM), GOING_LABEL[l.going], course].filter(Boolean).join(" · ");
}

/** Weight carried: "131 lb (+5)"; "—" at level weights. */
export function weightText(l: Pick<FormLineView, "weightLb" | "extraWeightLb">): string {
  if (l.weightLb === null) return "—";
  return l.extraWeightLb ? `${l.weightLb} lb (+${l.extraWeightLb})` : `${l.weightLb} lb`;
}

/** Fatigue in words (the training board's scale). */
export function fatigueWord(f: number): string {
  return f > 600 ? "Overworked" : f > 300 ? "Tired" : f > 150 ? "Ready" : "Fresh";
}

/** Official rating change: "52 → 55 (+3)". */
export function ratingText(before: number, after: number | null): string {
  if (after === null) return `${before}`;
  const d = after - before;
  return d === 0 ? `${before} → ${after}` : `${before} → ${after} (${d > 0 ? "+" : ""}${d})`;
}

/** Race conditions in one line: "Saltmarsh · 2,000 m · Turf · Soft". */
export function conditionsText(l: Pick<FormLineView, "course" | "distanceM" | "surface" | "going">): string {
  return [l.course, formatDistance(l.distanceM), SURFACE_LABEL[l.surface], GOING_LABEL[l.going]].filter(Boolean).join(" · ");
}

export function dateText(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Realisation permille as percent of potential: 12 -> "+1.2%". */
export function realisationText(permille: number): string {
  return `${permille >= 0 ? "+" : ""}${(permille / 10).toFixed(1)}%`;
}

const STAT_LABEL: Record<string, string> = { speed: "Speed", stamina: "Stamina", burst: "Burst", durability: "Durability", adaptability: "Adaptability", temperament: "Temperament" };
const FEED_LABEL: Record<string, string> = { growth_mix: "growth mix", performance: "performance feed", recovery: "recovery feed", maintenance: "maintenance feed" };
const ORIGIN_LABEL: Record<string, string> = { starter: "a starter from the Club", bred: "bred in the stud book", pack: "from a pack", gift: "a gift from the Club", house: "a Club horse", admin: "registered" };
const RETIRE_LABEL: Record<string, string> = { choice: "by choice", max_starts: "after 40 starts", injury: "through injury" };
const LEASE_END_LABEL: Record<string, string> = { term: "at the end of the term", returned: "handed back early", injured: "after an injury", retired: "on retirement", died: "on its death" };
const SEVERITY_LABEL: Record<string, string> = { minor: "Minor injury", moderate: "Moderate injury", career_ending: "Career-ending injury", fatal: "Fatal injury" };
/** The catalogue name of an injury kind (game-core injuries.ts), or null for old entries. */
function injuryKindName(kind: string): string | null {
  return kind ? (injuryKindOf(kind)?.name ?? null) : null;
}

const QUIRK_TEXT: Record<string, string> = { mudlark: "Mudlark", gateShy: "Gate-shy", lateKick: "Late kick", crowdShy: "Crowd-shy" };

export type LogTone = "race" | "work" | "care" | "health" | "life" | "money";

export interface LogEntryText {
  /** Short kind tag shown in the gutter. */
  tag: string;
  tone: LogTone;
  title: string;
  /** Second line (facts), may be empty. */
  detail: string;
}

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * One log entry in words. `numbers`: the page's "Show numbers" toggle (fatigue and realisation
 * as permille alongside the words).
 */
export function logEntryText(e: { kind: string; data: Record<string, unknown>; line?: FormLineView }, numbers = false): LogEntryText {
  const d = e.data;
  switch (e.kind) {
    case "race": {
      const l = e.line!;
      const r = l.result;
      const cond = `${conditionsText(l)} · ${fieldText(l)}`;
      if (!r) return { tag: "Race", tone: "race", title: `${l.status === "running" ? "Running in" : "Declared for"} the ${l.raceName}`, detail: cond };
      const res = r.position === 1 ? `Won the ${l.raceName}${r.marginLabel ? ` by ${marginPhrase(r.marginLabel)}` : ""}` : `${ordinal(r.position)} in the ${l.raceName}, beaten ${lengthsText(r.beatenMm)}`;
      const extra = [cond, `OR ${ratingText(l.ratingBefore, r.ratingAfter)}`, r.prize > 0 ? `+${r.prize.toLocaleString("en-GB")} credits` : ""].filter(Boolean).join(" · ");
      return { tag: "Race", tone: "race", title: res, detail: extra };
    }
    case "training": {
      const gains = Object.entries((d.gains ?? {}) as Record<string, number>)
        .map(([k, v]) => `${STAT_LABEL[k] ?? k} ${realisationText(v)}`)
        .join(", ");
      const fb = n(d.fatigueBefore);
      const fa = n(d.fatigueAfter);
      const fatigue = fb !== null && fa !== null ? `fatigue ${fatigueWord(fb)} → ${fatigueWord(fa)}${numbers ? ` (${fb} → ${fa}‰)` : ""}` : "";
      const notes = [d.overworked ? "tired: half the gains" : "", d.injured ? `picked up a knock${injuryKindName(s(d.injuryKind)) ? `: ${injuryKindName(s(d.injuryKind))!.toLowerCase()}` : ""}` : ""].filter(Boolean).join(", ");
      const cost = n(d.cost);
      return {
        tag: "Training",
        tone: "work",
        title: `${s(d.label) || s(d.workout)}${n(d.session) ? ` (session ${n(d.session)})` : ""}`,
        detail: [gains || "no gains (rest)", fatigue, notes, cost ? `${cost} credits` : ""].filter(Boolean).join(" · "),
      };
    }
    case "care": {
      const q = n(d.quality);
      return { tag: "Care", tone: "care", title: `Fed ${FEED_LABEL[s(d.feed)] ?? (s(d.feed) || "feed")}, groomed and turned out`, detail: q !== null ? `Care quality ${numbers ? `${q}‰` : q >= 900 ? "excellent" : q >= 700 ? "good" : "fair"}` : "" };
    }
    case "injury": {
      const back = n(d.backAtMs);
      const named = injuryKindName(s(d.injuryKind));
      const sev = SEVERITY_LABEL[s(d.severity)] ?? "Injury";
      return {
        tag: "Injury",
        tone: "health",
        title: `${named ?? sev}${d.source === "race" ? " in a race" : ""}`,
        detail: [named ? sev : "", back ? `Expected back ${dateText(back)}` : ""].filter(Boolean).join(" · "),
      };
    }
    case "vet": {
      const back = n(d.backAtMs);
      return { tag: "Vet", tone: "health", title: "Vet treatment", detail: [n(d.cost) ? `${n(d.cost)} credits` : "", back ? `back ${dateText(back)}` : "recovered"].filter(Boolean).join(" · ") };
    }
    case "quirk":
      return { tag: "Reveal", tone: "life", title: `Showed a quirk: ${((d.quirks ?? []) as string[]).map((q) => QUIRK_TEXT[q] ?? q).join(", ")}`, detail: "Seen in a race; now on the horse page" };
    case "scan":
      return { tag: "Scan", tone: "money", title: "Pedigree Scan: potential ranges narrowed", detail: n(d.cost) ? `${n(d.cost)} credits` : "" };
    case "improver":
      return { tag: "Improver", tone: "life", title: "Started to improve", detail: `A late step up in ability after start ${n(d.start) ?? "?"}` };
    case "born":
      return { tag: "Born", tone: "life", title: "Foaled", detail: ORIGIN_LABEL[s(d.origin)] ?? "" };
    case "graduated":
      return { tag: "Milestone", tone: "life", title: "Ready to race", detail: "Grew up through care and joined the yard" };
    case "retired":
      return { tag: "Milestone", tone: "life", title: `Retired from racing ${RETIRE_LABEL[s(d.reason)] ?? ""}`.trim(), detail: "" };
    case "legacy_farm":
      return { tag: "Milestone", tone: "life", title: "Moved to the Legacy Farm", detail: "" };
    case "died":
      return { tag: "Milestone", tone: "health", title: "Died of a race injury", detail: "Remembered at the Legacy Farm" };
    case "released":
      return { tag: "Owner", tone: "life", title: "Released to the Club", detail: "" };
    case "renamed":
      return { tag: "Name", tone: "life", title: `Renamed ${s(d.from)} → ${s(d.to)}`, detail: "" };
    case "cover":
      return { tag: "Breeding", tone: "life", title: d.role === "sire" ? `Covered ${s(d.partner)}` : `Covered by ${s(d.partner)}`, detail: "" };
    case "foal":
      return { tag: "Breeding", tone: "life", title: `Foal born: ${s(d.name)}`, detail: "" };
    case "sold":
      return { tag: "Owner", tone: "money", title: `Sold to ${s(d.to)}`, detail: [d.from ? `from ${s(d.from)}` : "from the Club", n(d.price) ? `${n(d.price)!.toLocaleString("en-GB")} credits` : ""].filter(Boolean).join(" · ") };
    case "claimed":
      return { tag: "Owner", tone: "money", title: `Claimed by ${s(d.to)}`, detail: [`from ${s(d.from)}`, n(d.price) ? `${n(d.price)!.toLocaleString("en-GB")} credits` : ""].join(" · ") };
    case "lease_start":
      return {
        tag: "Lease",
        tone: "life",
        title: `Leased to ${s(d.lessee)}`,
        detail: [d.owner ? `owner ${s(d.owner)}` : "a Club lease", n(d.termDays) ? `${n(d.termDays)} days` : "", n(d.ownerSharePct) !== null ? `owner's purse share ${n(d.ownerSharePct)}%` : ""].filter(Boolean).join(" · "),
      };
    case "lease_end":
      return { tag: "Lease", tone: "life", title: `Lease to ${s(d.lessee)} ended ${LEASE_END_LABEL[s(d.reason)] ?? ""}`.trim(), detail: n(d.races) !== null ? `${n(d.races)} races on lease` : "" };
    default:
      return { tag: e.kind, tone: "life", title: e.kind, detail: "" };
  }
}


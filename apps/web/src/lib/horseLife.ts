/**
 * Horse life (care, nursery, training, condition, career, facilities): the shapes the server
 * sends to these pages, plus small display helpers. Types and pure functions only, so client
 * components may import it.
 */
import type { Horse } from "@thoroughbred/shared";
import type { RideIntensity, StableHorse } from "./types";

export type StatKey = "speed" | "stamina" | "burst" | "durability" | "adaptability" | "temperament";

export interface GrowthView {
  stage: "foal" | "weanling" | "yearling";
  stageLabel: string;
  /** Counted care sessions so far (0..19). */
  sessions: number;
  /** Sessions done inside the current stage, and its length (5 / 7 / 7). */
  inStage: number;
  stageLength: number;
  nextLabel: string;
  toNext: number;
  toRacing: number;
  racingAt: number;
}

export interface FeedOption {
  key: string;
  label: string;
  hint: string;
  recommended: boolean;
}

export interface CareView {
  /** A session was already counted today (the player's local date). */
  caredToday: boolean;
  /** The player's local date (YYYY-MM-DD). */
  day: string;
  lastCareDay: string | null;
  sessions: number;
  /** Null once the horse is of racing age. */
  growth: GrowthView | null;
  feeds: FeedOption[];
  /** 0..1000; never decays from absence. */
  bond: number;
  careQuality: number;
  canCare: boolean;
}

export interface RangeView {
  key: StatKey;
  label: string;
  lo: number;
  hi: number;
  loGrade: string;
  hiGrade: string;
  exact: boolean;
}

export interface RiskRow {
  intensity: RideIntensity;
  label: "low" | "moderate" | "elevated" | "high";
  permille: number;
  careerEndingShare: number;
  factors: string[];
  /** Most likely injuries if hurt in this context (game-core likelyInjuriesText). */
  likely?: string;
}

export interface ConditionView {
  fatigue: number;
  /** 0..1000 bar. */
  freshness: number;
  fitness: number;
  morale: number;
  /** The freshness peak 3-5 days after hard work. */
  peak: { phase: "none" | "building" | "peak" | "fading"; fromMs: number | null; toMs: number | null; bonus: number };
  injury: {
    severity: string;
    /** The injury's name (game-core injuries.ts), or its severity for old injuries. */
    label: string;
    /** "Moderate injury" etc. */
    severityLabel: string;
    /** Body area and one plain line, when the injury has a catalogue kind. */
    area: string | null;
    description: string | null;
    hoursLeft: number;
    untilMs: number;
    careerEnding: boolean;
    vetCost: number;
    treatedToday: boolean;
  } | null;
  /** Injury risk of the next start at its best trip on good going, per ride. */
  risks: RiskRow[];
  /** Career-ending chance per race (per 1,000 races), normal ride at its best trip on good going. */
  insurance: { insured: boolean; premium: number; payout: number; available: boolean; careerEndingPerRace: number };
}

export interface WorkoutView {
  key: string;
  label: string;
  cost: number;
  fatigue: number;
  hard: boolean;
  allowed: boolean;
  trains: StatKey[];
}

export interface RealisationRow {
  key: StatKey;
  label: string;
  /** 600..1000 permille of the potential realised by training. */
  permille: number;
  nearCeiling: boolean;
  current: number;
}

export interface TrainingView {
  available: boolean;
  blockedReason: string | null;
  slots: number;
  plan: string[];
  sessionsUsed: number;
  nextWorkout: string | null;
  /** Monday 00:00 UTC of next week. */
  weekResetsMs: number;
  workouts: WorkoutView[];
  realisation: RealisationRow[];
  trainerLevel: number;
  lightOnly: boolean;
  /** Per workout: what the next session would do (empty when the week is done). */
  previews: TrainingPreviewView[];
}

export interface TrainingPreviewView {
  key: string;
  block: string | null;
  /** Realisation gained per stat, permille of potential (10 = +1%). */
  gains: Partial<Record<StatKey, number>>;
  fatigueBefore: number;
  fatigueAfter: number;
  overworked: boolean;
  /** Chance of a minor knock this session, permille. */
  injuryPermille: number;
  setsUpPeak: boolean;
}

export interface CareerStageRow {
  key: "juvenile" | "prime" | "veteran";
  label: string;
  from: number;
  to: number;
  current: boolean;
}

export interface CareerView {
  starts: number;
  maxStarts: number;
  stage: string;
  stageLabel: string;
  careerStatus: "racing" | "retired" | "pasture";
  retirementReason: string | null;
  /** Set when a fatal race injury ended the horse's life: in memoriam on the Legacy Farm. */
  diedAtMs: number | null;
  stages: CareerStageRow[];
  maturity: { type: "early" | "normal" | "late"; label: string; peakFrom: number; peakTo: number; blurb: string };
  /** An improver's step-up once it has happened (game-core progressionOf): never shown in advance. */
  progression: { status: "improving" | "improved"; gainOr: number } | null;
  ranges: RangeView[];
  scanned: boolean;
  scanCost: number;
  canRename: boolean;
  canRetire: boolean;
  canLegacy: boolean;
  canRelease: boolean;
  releasePayout: number;
  bound: boolean;
  lockReason: string | null;
  breedingsLeft: number;
  racingAge: boolean;
}

export interface HorseLifeView {
  id: string;
  name: string;
  horse: Horse;
  status: StableHorse;
  care: CareView;
  condition: ConditionView;
  training: TrainingView;
  career: CareerView;
  credits: number;
  stableHand: boolean;
  serverNowMs: number;
}

export interface NurseryFoal {
  id: string;
  name: string;
  horse: Horse;
  /** One-line genetics, e.g. "bay roan · Sabino · 88% TB". */
  geneticsLine: string | null;
  care: CareView;
  ranges: RangeView[];
  scanned: boolean;
  awaitingGraduation: boolean;
}

export interface NurseryView {
  foals: NurseryFoal[];
  graduates: NurseryFoal[];
  stalls: { slots: number; used: number; free: number; overflow: boolean; overflowSlots: number };
  stableHand: boolean;
  scanCost: number;
  credits: number;
  /** Horses (any age) not cared for yet today: what "Care for all" would do. */
  uncared: number;
}

export interface FacilityItem {
  key: "stalls" | "entries" | "trainer" | "vet" | "stableHand";
  name: string;
  blurb: string;
  level: number;
  maxLevel: number;
  levelLabel: string;
  now: string;
  next: string | null;
  nextCost: number | null;
}

export interface FacilitiesView {
  credits: number;
  items: FacilityItem[];
  stalls: { slots: number; used: number };
}

export const STAT_NAMES: Record<StatKey, string> = {
  speed: "Speed",
  stamina: "Stamina",
  burst: "Burst",
  durability: "Durability",
  adaptability: "Adaptability",
  temperament: "Temperament",
};

/** "in 3 d 4 h" / "in 5 h" / "now" for a number of hours. */
export function hoursText(h: number): string {
  if (h <= 0) return "now";
  const d = Math.floor(h / 24);
  const r = Math.ceil(h - d * 24);
  if (d === 0) return `${r} h`;
  return r === 0 || r === 24 ? `${d + (r === 24 ? 1 : 0)} d` : `${d} d ${r} h`;
}

export function dayName(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export const RISK_LABEL: Record<RiskRow["label"], string> = { low: "Low", moderate: "Moderate", elevated: "Elevated", high: "High" };
export const INTENSITY_LABEL: Record<RideIntensity, string> = { conservative: "Conservative ride", normal: "Normal ride", all_out: "All-out ride" };

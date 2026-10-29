/**
 * Training: a weekly plan of 3 slots (4 with the Trainer facility). The plan pre-selects
 * workouts; each session runs when the player triggers it (training is an activity, so it
 * never runs or costs anything while the player is away).
 *
 * Depth underneath:
 *   - each workout trains specific stats (realisation towards 100% of potential) with
 *     diminishing returns near the ceiling: gain = base × (1000 − r) / 400;
 *   - fatigue builds; overworked (tired) horses gain less and risk a minor injury
 *     (a few days off, never fatal, never career-ending from training);
 *   - hard work sets up the freshness peak 3–5 days later (condition.freshnessBonus).
 */
import type { HorseState, StatKey, StatRecord, TrainingPlan, Workout } from "./types";
import { STAT_KEYS } from "./types";
import { dayIndex, weekIndex } from "./time";
import { fatigueAt, rollInjury, withFatigue, isHealed, TIRED_THRESHOLD } from "./condition";
import { stageOf } from "./lifecycle";
import { potentialOf } from "./genome";
import { clampInt, seedFrom } from "./rng";

export interface WorkoutSpec {
  gains: Partial<StatRecord<number>>;
  fatigue: number;
  fitness: number;
  hard: boolean;
  cost: number;
  /** Allowed for yearlings (light work). */
  light: boolean;
  label: string;
}

/**
 * Training session cost (credits) is an economy sink. Speed work costs more: speed is the most
 * valuable stat in the engine (docs/balance.md), so it is priced up rather than made free to chase.
 */
export const WORKOUTS: Record<Workout, WorkoutSpec> = {
  speed_work: { gains: { speed: 30, burst: 12 }, fatigue: 260, fitness: 60, hard: true, cost: 90, light: false, label: "Speed work" },
  stamina_gallops: { gains: { stamina: 30, durability: 10 }, fatigue: 240, fitness: 80, hard: true, cost: 60, light: false, label: "Stamina gallops" },
  gate_practice: { gains: { temperament: 24, burst: 10 }, fatigue: 90, fitness: 15, hard: false, cost: 40, light: true, label: "Gate practice" },
  swimming: { gains: { stamina: 14, durability: 14 }, fatigue: 70, fitness: 50, hard: false, cost: 50, light: true, label: "Swimming" },
  rest: { gains: {}, fatigue: -200, fitness: 0, hard: false, cost: 0, light: true, label: "Rest" },
  race_prep: { gains: { speed: 10, stamina: 10, burst: 10, adaptability: 10 }, fatigue: 160, fitness: 70, hard: true, cost: 70, light: false, label: "Race prep" },
};

export const BASE_SLOTS = 3;
/** Trainer facility: +1 slot and +10% efficiency per level (max 1 extra slot). */
export const TRAINER_EFFICIENCY_PER_LEVEL = 100;
/** Divisor of the diminishing-returns curve. */
export const REALISATION_CURVE = 400;

export function slotsFor(trainerLevel: number): number {
  return BASE_SLOTS + (trainerLevel > 0 ? 1 : 0);
}

export const DEFAULT_PLAN: TrainingPlan = { slots: ["speed_work", "stamina_gallops", "rest"] };

/** Realisation gain for one stat from a base amount (diminishing near 1000). */
export function realisationGain(current: number, base: number, efficiencyPermille = 1000): number {
  if (current >= 1000 || base <= 0) return 0;
  return Math.max(1, Math.floor((base * (1000 - current) * efficiencyPermille) / (REALISATION_CURVE * 1000)));
}

export function applyRealisation(state: HorseState, gains: Partial<StatRecord<number>>, efficiencyPermille: number): HorseState {
  const r = { ...state.training.realisation };
  for (const [k, base] of Object.entries(gains) as [StatKey, number][]) {
    r[k] = Math.min(1000, r[k] + realisationGain(r[k], base, efficiencyPermille));
  }
  return { ...state, training: { ...state.training, realisation: r } };
}

export type TrainBlock = "foal" | "not_light" | "injured" | "retired" | "week_full";

export interface TrainContext {
  nowMs: number;
  trainerLevel: number;
  vetLevel: number;
  /** Credits available; a session the player cannot afford is refused (never debt). */
  credits: number;
}

export function trainBlock(state: HorseState, workout: Workout, ctx: Pick<TrainContext, "nowMs" | "trainerLevel">): TrainBlock | null {
  const stage = stageOf(state);
  if (stage === "foal" || stage === "weanling") return "foal";
  if (stage === "stud" || stage === "pasture") return "retired";
  if (stage === "yearling" && !WORKOUTS[workout].light) return "not_light";
  if (state.injury && !isHealed(state.injury, ctx.nowMs) && workout !== "rest") return "injured";
  const week = weekIndex(ctx.nowMs);
  const used = state.training.week === week ? state.training.sessionsThisWeek : 0;
  if (used >= slotsFor(ctx.trainerLevel)) return "week_full";
  return null;
}

/** Workout that the plan has next this week (by sessions already used). */
export function nextPlannedWorkout(plan: TrainingPlan, state: HorseState, nowMs: number): Workout | null {
  const week = weekIndex(nowMs);
  const used = state.training.week === week ? state.training.sessionsThisWeek : 0;
  return plan.slots[used] ?? null;
}

/** Arrow per stat for the simple UI: +1 up, 0 flat. */
export type StatArrows = StatRecord<0 | 1>;

export interface TrainResult {
  ok: boolean;
  block?: TrainBlock | "insufficient_credits";
  state: HorseState;
  cost: number;
  arrows: StatArrows;
  /** Minor injury picked up from overwork, if any. */
  injured: boolean;
  /** Overworked: a tired horse gains half. */
  overworked: boolean;
}

/** Overwork injury chance per hard session when tired, permille at fatigue 1000. */
export const OVERWORK_INJURY_MAX_PERMILLE = 60;

/** What one session would do, computed before committing (the trade-off board shows it). */
export interface TrainingPreview {
  workout: Workout;
  block: TrainBlock | "insufficient_credits" | null;
  cost: number;
  /** Realisation gained per stat, permille of potential (10 = +1%). */
  gains: Partial<StatRecord<number>>;
  fatigueBefore: number;
  fatigueAfter: number;
  /** Hard work while tired: half the gains. */
  overworked: boolean;
  /** Chance of a minor training knock this session, permille (0 when not tired enough). */
  injuryPermille: number;
  /** Hard work sets up the freshness peak 3-5 days later. */
  setsUpPeak: boolean;
}

function efficiencyOf(state: HorseState, spec: WorkoutSpec, trainerLevel: number, fatigueBefore: number): { eff: number; overworked: boolean } {
  const overworked = spec.hard && fatigueBefore > 600;
  let eff = 1000 + TRAINER_EFFICIENCY_PER_LEVEL * Math.min(2, trainerLevel);
  if (overworked) eff = Math.floor(eff / 2);
  if (stageOf(state) === "yearling") eff = Math.floor(eff / 2);
  return { eff, overworked };
}

function overworkInjuryPermille(state: HorseState, spec: WorkoutSpec, fatigueBefore: number): number {
  if (!spec.hard || fatigueBefore <= TIRED_THRESHOLD + 200 || stageOf(state) === "yearling") return 0;
  const dur = potentialOf(state.genome, "durability");
  return Math.round(((fatigueBefore - (TIRED_THRESHOLD + 200)) * OVERWORK_INJURY_MAX_PERMILLE * (1500 - dur)) / ((1000 - TIRED_THRESHOLD - 200) * 1000));
}

export function previewTraining(state: HorseState, workout: Workout, ctx: TrainContext): TrainingPreview {
  const spec = WORKOUTS[workout];
  const fatigueBefore = fatigueAt(state, ctx.nowMs);
  const block = trainBlock(state, workout, ctx) ?? (ctx.credits < spec.cost ? "insufficient_credits" : null);
  const { eff, overworked } = efficiencyOf(state, spec, ctx.trainerLevel, fatigueBefore);
  const gains: Partial<StatRecord<number>> = {};
  for (const [k, base] of Object.entries(spec.gains) as [StatKey, number][]) {
    const r = state.training.realisation[k];
    gains[k] = Math.min(1000, r + realisationGain(r, base, eff)) - r;
  }
  return {
    workout,
    block,
    cost: spec.cost,
    gains,
    fatigueBefore,
    fatigueAfter: clampInt(fatigueBefore + spec.fatigue, 0, 1000),
    overworked,
    injuryPermille: overworkInjuryPermille(state, spec, fatigueBefore),
    setsUpPeak: spec.hard,
  };
}

/**
 * Run one training session now. Deterministic in (state, workout, ctx, seed). Seed default:
 * derived from horse id, day and session number so a retry on the same day is idempotent.
 */
export function train(state: HorseState, workout: Workout, ctx: TrainContext, seed?: string): TrainResult {
  const flat = Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as StatArrows;
  const block = trainBlock(state, workout, ctx);
  if (block) return { ok: false, block, state, cost: 0, arrows: flat, injured: false, overworked: false };
  const spec = WORKOUTS[workout];
  if (ctx.credits < spec.cost) return { ok: false, block: "insufficient_credits", state, cost: 0, arrows: flat, injured: false, overworked: false };

  const week = weekIndex(ctx.nowMs);
  const used = state.training.week === week ? state.training.sessionsThisWeek : 0;
  const fatigueBefore = fatigueAt(state, ctx.nowMs);
  const { eff, overworked } = efficiencyOf(state, spec, ctx.trainerLevel, fatigueBefore);

  let next = applyRealisation(state, spec.gains, eff);
  next = withFatigue(next, spec.fatigue, ctx.nowMs, spec.hard);
  next = {
    ...next,
    condition: { ...next.condition, fitness: clampInt(next.condition.fitness + spec.fitness, 0, 1000), bond: Math.min(1000, next.condition.bond + 2) },
    training: { ...next.training, week, sessionsThisWeek: used + 1 },
  };

  let injured = false;
  const p = overworkInjuryPermille(state, spec, fatigueBefore);
  if (p > 0) {
    const inj = rollInjury({ permille: p, careerEndingShare: 0 }, seed ?? seedFrom("train", state.id, dayIndex(ctx.nowMs), used), ctx.nowMs, ctx.vetLevel, "training");
    if (inj) {
      next = { ...next, injury: { ...inj, severity: "minor", unitsRequired: Math.min(inj.unitsRequired, 4 * 24) } };
      injured = true;
    }
  }

  const arrows = { ...flat };
  for (const k of STAT_KEYS) if (next.training.realisation[k] > state.training.realisation[k]) arrows[k] = 1;
  return { ok: true, state: next, cost: spec.cost, arrows, injured, overworked };
}

/** Racing experience: every start realises a little of every stat (adaptability and temperament most). */
export const RACE_EXPERIENCE: StatRecord<number> = { speed: 6, stamina: 6, burst: 6, durability: 5, adaptability: 12, temperament: 10 };

/** Workouts open to this horse: none for foals/weanlings/retired; light work only for yearlings. */
export function allowedWorkouts(state: HorseState): Workout[] {
  const st = stageOf(state);
  if (st === "foal" || st === "weanling" || st === "stud" || st === "pasture") return [];
  const all = Object.keys(WORKOUTS) as Workout[];
  return st === "yearling" ? all.filter((w) => WORKOUTS[w].light) : all;
}

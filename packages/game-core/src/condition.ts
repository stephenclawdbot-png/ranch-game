/**
 * Day-to-day condition: fatigue and freshness (real-time recovery), form and morale, bond,
 * injury risk (computable before entry), injury rolls and healing.
 *
 * Ethics (§4a): elapsed time alone only ever *helps* a horse — fatigue recovers and injuries
 * heal. Nothing decays, ages or declines from absence.
 */
import type { Going } from "@thoroughbred/shared";
import type { GameStage, HorseState, Injury, InjurySeverity, RideIntensity } from "./types";
import { MS_PER_DAY, MS_PER_HOUR, dayIndex } from "./time";
import { IRON_LEGS_RISK, hasIronLegs, isFragile, potentialOf } from "./genome";
import { Rng, clampInt } from "./rng";

// ---------------------------------------------------------------------------
// Fatigue and freshness
// ---------------------------------------------------------------------------

/** Fatigue recovered per real hour (full 1000 -> 0 in ~3.5 days). */
export const FATIGUE_RECOVERY_PER_HOUR = 12;
/** Fatigue above this starts to cost performance and raise injury risk. */
export const TIRED_THRESHOLD = 300;
/** Performance penalty at fatigue 1000, permille. */
export const TIRED_MAX_PENALTY = 80;
/** Freshness peak bonus 3-5 days after hard work, permille. */
export const FRESHNESS_PEAK_BONUS = 25;

/** Fatigue at `nowMs` (recovers with real time; this is healing, allowed while away). */
export function fatigueAt(state: Pick<HorseState, "condition">, nowMs: number): number {
  const hours = Math.max(0, Math.floor((nowMs - state.condition.fatigueAtMs) / MS_PER_HOUR));
  return Math.max(0, state.condition.fatigue - hours * FATIGUE_RECOVERY_PER_HOUR);
}

/** Add fatigue (from work or a race) at `nowMs`, settling recovery first. */
export function withFatigue<T extends Pick<HorseState, "condition">>(state: T, add: number, nowMs: number, hard: boolean): T {
  const f = clampInt(fatigueAt(state, nowMs) + add, 0, 1000);
  return {
    ...state,
    condition: { ...state.condition, fatigue: f, fatigueAtMs: nowMs, lastHardWorkMs: hard ? nowMs : state.condition.lastHardWorkMs },
  };
}

/**
 * Supercompensation bonus (permille) by hours since the last hard work: nothing for 2 days,
 * ramps to the peak on day 3, holds to day 5, fades to zero by day 8.
 */
export function freshnessBonus(lastHardWorkMs: number | null, nowMs: number): number {
  if (lastHardWorkMs === null) return 0;
  const h = (nowMs - lastHardWorkMs) / MS_PER_HOUR;
  if (h < 48) return 0;
  if (h < 72) return Math.round((FRESHNESS_PEAK_BONUS * (h - 48)) / 24);
  if (h <= 120) return FRESHNESS_PEAK_BONUS;
  if (h < 192) return Math.round((FRESHNESS_PEAK_BONUS * (192 - h)) / 72);
  return 0;
}

/** Penalty (permille, >= 0) for racing tired. */
export function tiredPenalty(fatigue: number): number {
  if (fatigue <= TIRED_THRESHOLD) return 0;
  return Math.round(((fatigue - TIRED_THRESHOLD) * TIRED_MAX_PENALTY) / (1000 - TIRED_THRESHOLD));
}

/** Freshness shown as a bar: 0 (exhausted) .. 1000 (peak). */
export function freshnessBar(state: Pick<HorseState, "condition">, nowMs: number): number {
  const f = fatigueAt(state, nowMs);
  return clampInt(800 - (f * 800) / 1000 + (freshnessBonus(state.condition.lastHardWorkMs, nowMs) * 200) / FRESHNESS_PEAK_BONUS, 0, 1000);
}

// ---------------------------------------------------------------------------
// Form and morale
// ---------------------------------------------------------------------------

/** Morale -100..100 from the last 5 runs (top-3 finishes lift, back-half finishes dent) and bond. */
export function morale(state: Pick<HorseState, "recentRuns" | "condition">): number {
  const runs = state.recentRuns.slice(-5);
  let m = 0;
  for (const r of runs) {
    if (r.position === 1) m += 20;
    else if (r.position <= 3) m += 10;
    else if (r.position * 2 > r.fieldSize) m -= 8;
  }
  m += Math.floor(state.condition.bond / 40); // 0..25
  return clampInt(m, -100, 100);
}

/** Morale's effect on performance, permille (±15). */
export function moraleEffect(m: number): number {
  return Math.round((m * 15) / 100);
}

/** Fitness factor permille: 940 (unfit) .. 1000 (fully fit). */
export function fitnessFactor(fitness: number): number {
  return 940 + Math.round((60 * fitness) / 1000);
}

export interface ConditionReport {
  fatigue: number;
  freshnessBonus: number;
  tiredPenalty: number;
  morale: number;
  /** Combined multiplier (permille) applied to speed/stamina/burst in the race snapshot. */
  multiplier: number;
}

export function conditionReport(state: HorseState, nowMs: number): ConditionReport {
  const fatigue = fatigueAt(state, nowMs);
  const fb = freshnessBonus(state.condition.lastHardWorkMs, nowMs);
  const tp = tiredPenalty(fatigue);
  const mo = morale(state);
  const mult = Math.round((fitnessFactor(state.condition.fitness) * (1000 + fb - tp + moraleEffect(mo))) / 1000);
  return { fatigue, freshnessBonus: fb, tiredPenalty: tp, morale: mo, multiplier: mult };
}

// ---------------------------------------------------------------------------
// Injury risk (shown before entry) and injury rolls
// ---------------------------------------------------------------------------

/** Base injury chance per start, permille (0.4%). */
export const BASE_INJURY_PERMILLE = 4;
export const MAX_INJURY_PERMILLE = 80;
export const GOING_RISK: Record<Going, number> = { firm: 1300, good: 1000, soft: 1100, heavy: 1400 };
export const INTENSITY_RISK: Record<RideIntensity, number> = { conservative: 700, normal: 1000, all_out: 1500 };
/** Share of injuries that are career-ending at baseline, permille (rises when tired / all-out). */
export const CAREER_ENDING_SHARE = 30;
/** Share of career-ending injuries that are fatal, permille (Live races only; never Story or training). */
export const FATAL_SHARE_OF_CAREER_ENDING = 200;
/** Fragile legs (inherited) raise the injury risk by this multiplier, permille. */
export const FRAGILE_RISK = 1300;

export interface RiskFactor {
  key: "durability" | "fatigue" | "frequency" | "going" | "intensity" | "distance" | "veteran" | "fragile" | "ironLegs";
  /** Multiplier permille applied by this factor (1000 = neutral). */
  multiplier: number;
  /** One short line for the entry sheet. */
  text: string;
}

export interface InjuryRisk {
  /** Chance of any injury in this start, permille. */
  permille: number;
  label: "low" | "moderate" | "elevated" | "high";
  /** Chance that an injury, if it happens, ends the racing career, permille. */
  careerEndingShare: number;
  factors: RiskFactor[];
}

export interface RiskContext {
  nowMs: number;
  going: Going;
  distanceM: number;
  intensity: RideIntensity;
  stage: GameStage;
}

/** Injury risk for the next start — the number shown on the entry sheet. Pure; no roll. */
export function injuryRisk(state: HorseState, ctx: RiskContext): InjuryRisk {
  const factors: RiskFactor[] = [];
  const dur = potentialOf(state.genome, "durability");
  const durM = 1600 - Math.round((dur * 1000) / 1000); // 1600 at 0, 600 at 1000
  factors.push({ key: "durability", multiplier: durM, text: dur >= 650 ? "Sound, durable type" : dur >= 450 ? "Average durability" : "Fragile type" });
  const fatigue = fatigueAt(state, ctx.nowMs);
  const fatM = 1000 + Math.round((2000 * Math.max(0, fatigue - TIRED_THRESHOLD)) / (1000 - TIRED_THRESHOLD));
  if (fatM > 1000) factors.push({ key: "fatigue", multiplier: fatM, text: "Still tired from recent work" });
  const day = dayIndex(ctx.nowMs);
  const today = state.recentRuns.filter((r) => dayIndex(r.atMs) === day).length;
  const week = state.recentRuns.filter((r) => ctx.nowMs - r.atMs < 7 * MS_PER_DAY).length;
  const freqM = 1000 + today * 400 + Math.max(0, week - 6) * 100;
  if (freqM > 1000) factors.push({ key: "frequency", multiplier: freqM, text: today > 0 ? `Already ran ${today}x today` : "Busy week" });
  const goingM = GOING_RISK[ctx.going];
  if (goingM !== 1000) factors.push({ key: "going", multiplier: goingM, text: `${ctx.going} going` });
  const intM = INTENSITY_RISK[ctx.intensity];
  if (intM !== 1000) factors.push({ key: "intensity", multiplier: intM, text: ctx.intensity === "all_out" ? "All-out ride" : "Conservative ride" });
  const distM = ctx.distanceM > 2400 ? 1100 : 1000;
  if (distM !== 1000) factors.push({ key: "distance", multiplier: distM, text: "Long trip" });
  if (isFragile(state.genome)) factors.push({ key: "fragile", multiplier: FRAGILE_RISK, text: "Fragile legs (inherited)" });
  if (hasIronLegs(state.genome)) factors.push({ key: "ironLegs", multiplier: IRON_LEGS_RISK, text: "Iron legs (inherited)" });
  const vetM = ctx.stage === "veteran" ? 1200 : 1000;
  if (vetM !== 1000) factors.push({ key: "veteran", multiplier: vetM, text: "Veteran legs" });

  let p = BASE_INJURY_PERMILLE * 1000; // in micro (permille * 1000)
  for (const f of factors) p = Math.round((p * f.multiplier) / 1000);
  const permille = Math.min(MAX_INJURY_PERMILLE, Math.max(1, Math.round(p / 1000)));
  const ce = clampInt(CAREER_ENDING_SHARE + (fatigue > 700 ? 30 : 0) + (ctx.intensity === "all_out" ? 20 : 0), 0, 200);
  const label = permille < 5 ? "low" : permille < 12 ? "moderate" : permille < 25 ? "elevated" : "high";
  return { permille, label, careerEndingShare: ce, factors };
}

export const INJURY_DAYS: Record<InjurySeverity, [number, number]> = { minor: [2, 4], moderate: [6, 12], career_ending: [14, 21], fatal: [21, 21] };

/**
 * Roll for an injury after a start or workout. Deterministic in the seed. A share of career-ending
 * injuries is fatal when `fatal` is allowed (Live races; never Story races or training).
 */
export function rollInjury(risk: Pick<InjuryRisk, "permille" | "careerEndingShare">, seed: string, atMs: number, vetLevel: number, source: string, opts: { fatal?: boolean } = {}): Injury | null {
  const rng = new Rng(`${seed}|injury`);
  // Roll in 1/1,000,000 so permille risks below 1 still work.
  if (rng.int(1_000_000) >= risk.permille * 1000) return null;
  let sev: InjurySeverity = rng.chance(risk.careerEndingShare) ? "career_ending" : rng.chance(300) ? "moderate" : "minor";
  if (sev === "career_ending" && opts.fatal && new Rng(`${seed}|fatal`).chance(FATAL_SHARE_OF_CAREER_ENDING)) sev = "fatal";
  const [lo, hi] = INJURY_DAYS[sev];
  return { severity: sev, atMs, unitsRequired: rng.range(lo, hi) * 24, bonusUnits: 0, vetLevel: clampInt(vetLevel, 0, 3), source };
}

/** Healing speed: +25% per vet facility level. */
export function healingHours(injury: Injury, nowMs: number): number {
  const elapsedH = Math.max(0, Math.floor((nowMs - injury.atMs) / MS_PER_HOUR));
  return Math.floor((elapsedH * (100 + 25 * injury.vetLevel)) / 100) + injury.bonusUnits;
}

export function isHealed(injury: Injury, nowMs: number): boolean {
  return healingHours(injury, nowMs) >= injury.unitsRequired;
}

/** Hours of healing left (0 when healed). */
export function hoursToHeal(injury: Injury, nowMs: number): number {
  return Math.max(0, injury.unitsRequired - healingHours(injury, nowMs));
}

/** Care session during recovery: +12 h; vet treatment: +24 h. */
export const CARE_HEAL_BONUS_H = 12;
export const VET_HEAL_BONUS_H = 24;

/** Vet treatment during recovery (charge VET_TREATMENT_COST credits): +24 h of healing. */
export function treatInjury<T extends { injury: Injury | null }>(state: T): T {
  if (!state.injury) return state;
  return { ...state, injury: { ...state.injury, bonusUnits: state.injury.bonusUnits + VET_HEAL_BONUS_H } };
}

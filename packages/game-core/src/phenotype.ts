/**
 * Phenotype: genetic potential → current stats → the shared `Horse` race snapshot.
 *
 *   current = potential × maturity(stat, maturity type, care/starts) × min(1, realisation + care bonus)
 *   race snapshot = current × condition (fitness, freshness, tiredness, morale) on speed/stamina/burst,
 *                   + quirks for the race conditions, + handicap weight, + optional ride modifier.
 *
 * Maturity runs on the career clock (care sessions before racing age, starts after), never on
 * calendar time.
 */
import type { Going, Horse, RunningStyle, Silks, Surface } from "@thoroughbred/shared";
import { type Grade, type HorseState, type MaturityType, type QuirkKey, type RacePlan, STAT_KEYS, type StatKey, type StatRecord, RIDE_MODIFIER_MAX_PERMILLE } from "./types";
import {
  expressedQuirks,
  gradeOf,
  maturityType,
  potentials,
  preferredDistanceM,
  preferredSurface,
  runningStyle,
  SURFACE_HET_ADAPT_BONUS,
} from "./genome";
import { CAREER_MAX_STARTS, CARE_TO_RACING, careBonus, displayAge, sexLabel, sharedLifeStage, stageOf } from "./lifecycle";
import { conditionReport } from "./condition";
import { appearanceOf } from "./coat";
import { Rng, clampInt } from "./rng";

// ---------------------------------------------------------------------------
// Maturity curves over the career clock
// ---------------------------------------------------------------------------

/** Peak window [from, to] in starts, by maturity type. */
export const PEAK_WINDOW: Record<MaturityType, [number, number]> = { early: [6, 18], normal: [10, 28], late: [16, 34] };
/** Per-stat shift of the peak window (speed and burst mature first, stamina and temperament later). */
export const STAT_PEAK_SHIFT: StatRecord<number> = { speed: -2, stamina: 3, burst: -2, durability: 0, adaptability: 3, temperament: 2 };
/** Maturity (permille) at racing age, 0 starts. */
export const JUVENILE_BASE: StatRecord<number> = { speed: 900, stamina: 820, burst: 900, durability: 860, adaptability: 820, temperament: 840 };
export const TYPE_BASE_SHIFT: Record<MaturityType, number> = { early: 40, normal: 0, late: -50 };
/** Maturity at 40 starts as a share of peak (speed fades first). */
export const CAREER_END_LEVEL: StatRecord<number> = { speed: 860, stamina: 930, burst: 880, durability: 930, adaptability: 1000, temperament: 1000 };
export const TYPE_END_SHIFT: Record<MaturityType, number> = { early: -40, normal: 0, late: 20 };
/** Maturity of a newborn foal (permille). */
export const FOAL_BASE = 300;

/** Maturity permille for one stat at a career position. Monotonic non-decreasing in care sessions. */
export function maturityAt(stat: StatKey, type: MaturityType, careSessions: number, starts: number): number {
  const base = clampInt(JUVENILE_BASE[stat] + TYPE_BASE_SHIFT[type], 300, 1000);
  if (careSessions < CARE_TO_RACING) {
    return FOAL_BASE + Math.floor(((base - FOAL_BASE) * Math.max(0, careSessions)) / CARE_TO_RACING);
  }
  const [p0, p1] = PEAK_WINDOW[type];
  const from = clampInt(p0 + STAT_PEAK_SHIFT[stat], 1, CAREER_MAX_STARTS - 2);
  const to = clampInt(p1 + STAT_PEAK_SHIFT[stat], from, CAREER_MAX_STARTS - 1);
  const end = clampInt(CAREER_END_LEVEL[stat] + TYPE_END_SHIFT[type], 700, 1000);
  const s = clampInt(starts, 0, CAREER_MAX_STARTS);
  if (s < from) return base + Math.floor(((1000 - base) * s) / from);
  if (s <= to) return 1000;
  return 1000 - Math.floor(((1000 - end) * (s - to)) / (CAREER_MAX_STARTS - to));
}

/** Maturity used for a horse (retired horses keep their final racing level). */
export function maturityOf(state: HorseState, stat: StatKey): number {
  return maturityAt(stat, maturityType(state.genome), state.care.sessions, state.career.starts);
}

/**
 * How much of the current stat training realisation governs (permille). Realisation is stored
 * and shown on the design's 60%→100% scale; it moves the top 20% of the stat, so an untrained
 * racing-age horse shows ~92% of its matured potential. This keeps launch horses on the stat
 * scale the engine and docs/balance.md are calibrated for (starters ≈ 450–550 current).
 */
export const TRAINING_WEIGHT_PERMILLE = 200;

/** Effective training factor (permille) for a realisation value (+ care bonus). */
export function trainingFactor(realisation: number, careBonusPermille = 0): number {
  const r = Math.min(1000, realisation + careBonusPermille);
  return 1000 - Math.floor(((1000 - r) * TRAINING_WEIGHT_PERMILLE) / 1000);
}

/** Current (resting, unmodified) stats: potential × maturity × training factor (incl. care bonus). */
export function currentStats(state: HorseState): StatRecord<number> {
  const pot = potentials(state.genome);
  const cb = careBonus(state);
  const out = {} as StatRecord<number>;
  for (const k of STAT_KEYS) {
    out[k] = clampInt((pot[k] * maturityOf(state, k) * trainingFactor(state.training.realisation[k], cb)) / 1_000_000, 0, 1000);
  }
  // Versatile (heterozygous surface) types adapt a little better.
  if (preferredSurface(state.genome) === "synthetic") out.adaptability = Math.min(1000, out.adaptability + SURFACE_HET_ADAPT_BONUS);
  return out;
}

// ---------------------------------------------------------------------------
// Revealed ranges ("B to A stamina")
// ---------------------------------------------------------------------------

export const REVEAL_BASE_WIDTH: Record<"foal" | "weanling" | "yearling" | "racing", number> = { foal: 260, weanling: 240, yearling: 200, racing: 160 };
export const REVEAL_PER_START = 12;
/** A Pedigree Scan multiplies the width by this (permille). */
export const SCAN_WIDTH_PERMILLE = 400;
export const REVEAL_EXACT_BELOW = 10;

export interface RevealedRange {
  lo: number;
  hi: number;
  loGrade: Grade;
  hiGrade: Grade;
  exact: boolean;
}

/** Width of the revealed potential range for a horse. Never grows with more information. */
export function revealWidth(state: Pick<HorseState, "care" | "career" | "reveal">): number {
  const c = state.care.sessions;
  const base = c < 5 ? REVEAL_BASE_WIDTH.foal : c < 12 ? REVEAL_BASE_WIDTH.weanling : c < CARE_TO_RACING ? REVEAL_BASE_WIDTH.yearling : REVEAL_BASE_WIDTH.racing;
  let w = Math.max(0, base - REVEAL_PER_START * state.career.starts);
  if (state.reveal.scanned) w = Math.floor((w * SCAN_WIDTH_PERMILLE) / 1000);
  return w < REVEAL_EXACT_BELOW ? 0 : w;
}

/**
 * Revealed range per stat. The true potential sits at a fixed, secret position inside the
 * range (per horse and stat), so ranges are nested as they narrow and the midpoint does not
 * give the answer away.
 */
export function revealedRanges(state: HorseState): StatRecord<RevealedRange> {
  const pot = potentials(state.genome);
  const w = revealWidth(state);
  const rng = new Rng(`reveal|${state.id}|${state.genome.markingSeed}`);
  const out = {} as StatRecord<RevealedRange>;
  for (const k of STAT_KEYS) {
    const u = rng.int(1001); // 0..1000 position of the truth inside the range
    const lo = clampInt(pot[k] - Math.floor((w * u) / 1000), 0, 1000);
    const hi = clampInt(pot[k] + (w - Math.floor((w * u) / 1000)), 0, 1000);
    out[k] = { lo, hi, loGrade: gradeOf(lo), hiGrade: gradeOf(hi), exact: w === 0 };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quirks (genetic, revealed through racing)
// ---------------------------------------------------------------------------

export interface QuirkContext {
  going: Going;
  fieldSize: number;
  /** Feature / final / graded races have a big crowd. */
  bigCrowd: boolean;
}

/** Whether a quirk shows itself in a race with these conditions (only then can it be revealed). */
export function quirkTriggered(q: QuirkKey, ctx: QuirkContext): boolean {
  switch (q) {
    case "mudlark":
      return ctx.going === "soft" || ctx.going === "heavy";
    case "gateShy":
      return true;
    case "lateKick":
      return true;
    case "crowdShy":
      return ctx.bigCrowd || ctx.fieldSize >= 12;
  }
}

/** Stat deltas a quirk applies in a triggering race. */
export const QUIRK_EFFECT: Record<QuirkKey, Partial<StatRecord<number>>> = {
  mudlark: { adaptability: 150, speed: 15 },
  gateShy: { temperament: -90 },
  lateKick: { burst: 45 },
  crowdShy: { temperament: -110 },
};

/** Chance (permille) that a triggered quirk is noticed and revealed after the race. */
export const QUIRK_REVEAL_PERMILLE = 350;

// ---------------------------------------------------------------------------
// Race snapshot (shared Horse)
// ---------------------------------------------------------------------------

/** Speed stat points per lb carried above the lightest weight in the race. */
export const HANDICAP_SPEED_PER_LB = 5;
/** Burst stat points per lb (weight blunts the kick too). */
export const HANDICAP_BURST_PER_LB = 2;

export interface SnapshotContext {
  nowMs: number;
  silks: Silks;
  /** Race conditions; omit for a resting snapshot (no quirks). */
  race?: QuirkContext & { surface: Surface; distanceM: number };
  /** lb carried above the lightest horse in a handicap (see ratings.handicapWeights). */
  extraWeightLb?: number;
  plan?: RacePlan;
}

export interface Snapshot {
  horse: Horse;
  /** Condition multiplier applied (permille). */
  conditionPermille: number;
  quirksActive: QuirkKey[];
}

/**
 * Build the immutable race snapshot (shared `Horse`) the engine runs. All modifiers end up in
 * the stats, so the engine and the shared contract are unchanged.
 */
export function raceSnapshot(state: HorseState, ctx: SnapshotContext): Snapshot {
  const base = currentStats(state);
  const cond = conditionReport(state, ctx.nowMs);
  const s = { ...base };
  for (const k of ["speed", "stamina", "burst"] as const) s[k] = (s[k] * cond.multiplier) / 1000;
  s.temperament += Math.round((cond.morale * 30) / 100);

  const quirksActive: QuirkKey[] = [];
  if (ctx.race) {
    for (const q of expressedQuirks(state.genome)) {
      if (!quirkTriggered(q, ctx.race)) continue;
      quirksActive.push(q);
      for (const [k, d] of Object.entries(QUIRK_EFFECT[q]) as [StatKey, number][]) s[k] += d;
    }
  }
  const lb = Math.max(0, ctx.extraWeightLb ?? 0);
  s.speed -= lb * HANDICAP_SPEED_PER_LB;
  s.burst -= lb * HANDICAP_BURST_PER_LB;

  if (ctx.plan) {
    if (ctx.plan.intensity === "all_out") {
      s.burst += 25;
      s.temperament -= 20;
    } else if (ctx.plan.intensity === "conservative") {
      s.burst -= 20;
      s.stamina += 10;
    }
    const ride = clampInt(ctx.plan.rideModifierPermille ?? 0, -RIDE_MODIFIER_MAX_PERMILLE, RIDE_MODIFIER_MAX_PERMILLE);
    if (ride !== 0) {
      s.speed += (s.speed * ride) / 1000;
      s.burst += (s.burst * ride) / 1000;
    }
  }

  const stats = {} as StatRecord<number>;
  for (const k of STAT_KEYS) stats[k] = clampInt(s[k], 0, 1000);
  const stage = stageOf(state);
  const horse: Horse = {
    id: state.id,
    name: state.name,
    sex: sexLabel(state),
    age: displayAge(state),
    stage: sharedLifeStage(stage),
    generation: state.generation,
    ownerId: state.ownerId,
    sireId: state.sireId,
    damId: state.damId,
    stats,
    preferredDistanceM: preferredDistanceM(state.genome),
    preferredSurface: preferredSurface(state.genome),
    style: runningStyle(state.genome) as RunningStyle,
    appearance: appearanceOf(
      state.genome,
      { racingAge: state.care.sessions >= CARE_TO_RACING, starts: state.career.starts, retired: state.career.racingRetired !== null },
      ctx.silks,
    ),
    record: state.record,
  };
  return { horse, conditionPermille: cond.multiplier, quirksActive };
}

/** Resting snapshot for display (no race conditions, no weight, no plan). */
export function toSharedHorse(state: HorseState, nowMs: number, silks: Silks): Horse {
  return raceSnapshot(state, { nowMs, silks }).horse;
}

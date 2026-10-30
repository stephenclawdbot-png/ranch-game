/**
 * Race settlement for horses: career clock, record, rating, fatigue, experience, injuries,
 * quirk reveals, mandatory retirement at 40 starts.
 *
 * Deterministic: every roll is seeded from the race seed and horse id, so settling the same
 * race twice gives the same result (and settlement can be idempotent).
 */
import type { FinishRecord, Going } from "@thoroughbred/shared";
import type { HorseState, Injury, QuirkKey, RaceSlot, RideIntensity } from "./types";
import { RACE_EXPERIENCE, applyRealisation } from "./training";
import { injuryRisk, rollInjury, withFatigue, withPhysio } from "./condition";
import type { RaceDayChoice } from "./raceDay";
import { CAREER_MAX_STARTS, retireFromRacing, stageOf } from "./lifecycle";
import { potentialOf, expressedQuirks } from "./genome";
import { QUIRK_REVEAL_PERMILLE, quirkTriggered } from "./phenotype";
import { TIER_RULES } from "./eligibility";
import { updateRatings } from "./ratings";
import { Rng, clampInt } from "./rng";

export interface RunConditions {
  raceId: string;
  /** Race seed (64 hex) — every per-horse roll derives from it. */
  seed: string;
  atMs: number;
  tier: RaceSlot["tier"];
  distanceM: number;
  going: Going;
  fieldSize: number;
  bigCrowd: boolean;
}

export interface HorseRunInput {
  position: number;
  prize: number;
  intensity: RideIntensity;
  /** Owner's vet facility level (healing speed). */
  vetLevel: number;
  /** OR after the race (from updateRatings); omit for unrated races. */
  newOr?: number;
  /** Race-day extras bought with the entry (physio, shoes, vet check: raceDay.ts). */
  raceDay?: RaceDayChoice;
}

export interface HorseRunResult {
  state: HorseState;
  injury: Injury | null;
  revealedQuirks: QuirkKey[];
  /** Racing career ended in this race (40 starts or career-ending injury). */
  retired: boolean;
  /** Insurance pays out (career-ending or fatal injury on an insured horse). */
  insurancePayout: boolean;
  /** The horse died of its injury (rare; Live races only). */
  fatal: boolean;
}

/** Fatigue from a race: 150 + distance/10, scaled by durability (sound horses tire less). */
export function raceFatigue(state: HorseState, distanceM: number): number {
  const dur = potentialOf(state.genome, "durability");
  return Math.round(((150 + distanceM / 10) * (1300 - (dur * 600) / 1000)) / 1000);
}

/** Apply one run to one horse. */
export function applyRun(prior: HorseState, cond: RunConditions, run: HorseRunInput): HorseRunResult {
  const rule = TIER_RULES[cond.tier];
  // A physio session takes its fatigue off before the off (the race snapshot did the same).
  const state = withPhysio(prior, run.raceDay, cond.atMs);
  const stageBefore = stageOf(state);
  // Risk is computed on the pre-race state: the same number the entry sheet showed.
  const risk = injuryRisk(state, { nowMs: cond.atMs, going: cond.going, distanceM: cond.distanceM, intensity: run.intensity, stage: stageBefore, raceDay: run.raceDay });

  let next = withFatigue(state, raceFatigue(state, cond.distanceM), cond.atMs, true);
  next = applyRealisation(next, RACE_EXPERIENCE, 1000);
  const pos = run.position;
  next = {
    ...next,
    condition: {
      ...next.condition,
      fitness: clampInt(next.condition.fitness + 40, 0, 1000),
      bond: Math.min(1000, next.condition.bond + (pos === 1 ? 10 : 4)),
    },
    record: {
      starts: next.record.starts + (rule.rated ? 1 : 0),
      wins: next.record.wins + (rule.rated && pos === 1 ? 1 : 0),
      places: next.record.places + (rule.rated && pos === 2 ? 1 : 0),
      shows: next.record.shows + (rule.rated && pos === 3 ? 1 : 0),
      earnings: next.record.earnings + Math.max(0, run.prize),
    },
    recentRuns: [...next.recentRuns, { atMs: cond.atMs, position: pos, fieldSize: cond.fieldSize, raceId: cond.raceId }].slice(-10),
  };
  if (rule.rated) {
    const starts = Math.min(CAREER_MAX_STARTS, next.career.starts + 1);
    next = { ...next, career: { ...next.career, starts } };
    if (run.newOr !== undefined) {
      next = { ...next, rating: { or: run.newOr, ratedRuns: next.rating.ratedRuns + 1, peakOr: Math.max(next.rating.peakOr, run.newOr) } };
    }
  }

  // Quirks: a triggered quirk may be noticed (seeded) and is then revealed for good.
  const revealed: QuirkKey[] = [];
  const qr = new Rng(`${cond.seed}|quirk|${state.id}`);
  for (const q of expressedQuirks(state.genome)) {
    if (next.reveal.quirks.includes(q)) continue;
    if (!quirkTriggered(q, { going: cond.going, fieldSize: cond.fieldSize, bigCrowd: cond.bigCrowd })) continue;
    if (qr.chance(QUIRK_REVEAL_PERMILLE)) revealed.push(q);
  }
  if (revealed.length) next = { ...next, reveal: { ...next.reveal, quirks: [...next.reveal.quirks, ...revealed] } };

  // Injury (unrated runs — trials — carry no injury risk).
  let injury: Injury | null = null;
  if (rule.rated) {
    // fatal injuries only in Live races (never Story / quick races)
    injury = rollInjury(risk, `${cond.seed}|${state.id}`, cond.atMs, run.vetLevel, cond.raceId, { fatal: cond.tier !== "quick" });
    if (injury) next = { ...next, injury };
  }

  let retired = false;
  let insurancePayout = false;
  const fatal = injury?.severity === "fatal";
  if (fatal) {
    // the horse is gone: off the stable's books for good (the Legacy Farm keeps its memory)
    next = retireFromRacing(next, "injury");
    next = { ...next, location: "legacy_farm", career: { ...next.career, pastured: true } };
    retired = true;
    insurancePayout = next.career.insured;
  } else if (injury?.severity === "career_ending") {
    next = retireFromRacing(next, "injury");
    retired = true;
    insurancePayout = next.career.insured;
  } else if (next.career.starts >= CAREER_MAX_STARTS) {
    next = retireFromRacing(next, "max_starts");
    retired = true;
  }
  return { state: next, injury, revealedQuirks: revealed, retired, insurancePayout, fatal };
}

/**
 * Settle a whole field: ratings from the finish order, then applyRun per horse.
 * `finish` is the engine's result.finishOrder. Horses missing from `states` are ignored
 * (e.g. AI rivals that are not persisted).
 */
export function settleField(
  states: readonly HorseState[],
  finish: readonly FinishRecord[],
  cond: RunConditions,
  perHorse: (id: string) => { intensity: RideIntensity; vetLevel: number; raceDay?: RaceDayChoice },
  aiRatings: Readonly<Record<string, number>> = {},
): HorseRunResult[] {
  const rule = TIER_RULES[cond.tier];
  const byId = new Map(states.map((s) => [s.id, s]));
  let newOr = new Map<string, number>();
  if (rule.rated) {
    const runners = finish.map((f) => {
      const s = byId.get(f.horseId);
      return { horseId: f.horseId, or: s ? s.rating.or : (aiRatings[f.horseId] ?? 40), ratedRuns: s ? s.rating.ratedRuns : 10, position: f.position };
    });
    newOr = new Map(updateRatings(runners).map((c) => [c.horseId, c.after]));
  }
  const out: HorseRunResult[] = [];
  for (const f of finish) {
    const s = byId.get(f.horseId);
    if (!s) continue;
    const p = perHorse(f.horseId);
    out.push(applyRun(s, { ...cond, fieldSize: finish.length }, { position: f.position, prize: f.prize, intensity: p.intensity, vetLevel: p.vetLevel, newOr: newOr.get(f.horseId), raceDay: p.raceDay }));
  }
  return out;
}

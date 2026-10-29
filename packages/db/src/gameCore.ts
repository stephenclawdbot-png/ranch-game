/**
 * Bridge between database rows and @thoroughbred/game-core.
 *
 * game-core owns the rules (pure functions over `HorseState`); this package owns
 * persistence, locking and idempotency. Services load rows under row locks, build a
 * HorseState with `toHorseState`, ask game-core (pairingBlock, listBlock, appraise,
 * pullPack, inherit, grantFor, ...), then write the result back. The database constraints
 * stay as the backstop.
 *
 * Rows created without a real genome (legacy or test fixtures) still work: every helper
 * falls back to the database's own simple rules when `isGenome(row.genome)` is false.
 */
import * as gc from "@thoroughbred/game-core";
import type { HorseRow, PregnancyRow } from "./schema";
import { defaultAppraise, RULES, type GameHooks, type HorseSpec } from "./rules";

export type HorseState = gc.HorseState;
export type Genome = gc.Genome;

/**
 * True when `x` is a genome we can play: v2 as stored, or a v1 genome from before genetics v2
 * (upgraded on read — rows are never rewritten). Junk stays junk.
 */
export function isGenome(x: unknown): x is gc.Genome {
  return gc.upgradeGenome(x) !== null;
}

/** Any stored genome as v2 (v1 upgraded on read); null when the row holds no real genome. */
export function genomeOf(x: unknown): gc.Genome | null {
  return gc.upgradeGenome(x);
}

export function isInjury(x: unknown): x is gc.Injury {
  return gc.InjurySchema.safeParse(x).success;
}

const DEFAULT_SILKS = { primary: "#16224d", secondary: "#e2b33c", pattern: "hoops", cap: "#e2b33c" } as const;

export interface HorseDynamics {
  training?: gc.HorseState["training"];
  lastHardWorkMs?: number | null;
  recentRuns?: gc.HorseState["recentRuns"];
  ratedRuns?: number;
  peakOr?: number;
  retiredAtStarts?: number;
  lastCareDay?: number | null;
  /** Set when a fatal race injury ended the horse's life (it stays on the Legacy Farm in memoriam). */
  diedAtMs?: number;
  diedAtRaceId?: string;
}

function defaultTraining(): gc.HorseState["training"] {
  const realisation = Object.fromEntries(gc.STAT_KEYS.map((k) => [k, 600])) as gc.HorseState["training"]["realisation"];
  return { realisation, week: 0, sessionsThisWeek: 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * Builds the game-core state of a horse from its row. `bySeason` (coverings per competition
 * season) and the pregnancy come from their own tables when the caller has them.
 */
export function toHorseState(
  row: HorseRow,
  extra: { pregnancy?: PregnancyRow | null; bySeason?: { season: number; count: number }[] } = {},
): gc.HorseState {
  const dyn = (row.dynamics ?? {}) as HorseDynamics;
  const sex: gc.HorseState["sex"] = row.sex === "female" ? "filly" : row.gelded ? "gelding" : "colt";
  const location: gc.HorseLocation = row.careerStatus === "pasture" ? "legacy_farm" : row.ownerStableId === null ? "club" : "stable";
  const binding: gc.Binding = row.bound ? "club_bred" : row.starts < row.tradeMinStarts ? "until_5_starts" : "free";
  const preg = extra.pregnancy && extra.pregnancy.status === "carrying" ? extra.pregnancy : null;
  return {
    id: row.id,
    name: row.name,
    sex,
    ownerId: row.ownerStableId ?? gc.CLUB_OWNER_ID,
    sireId: row.sireId,
    damId: row.damId,
    generation: row.generation,
    genome: genomeOf(row.genome) ?? (row.genome as gc.Genome),
    location,
    binding,
    bornAtMs: row.bornAt.getTime(),
    bornSeason: Math.max(1, row.birthSeasonNumber ?? 1),
    care: { sessions: row.careSessions, lastCareDay: dyn.lastCareDay ?? null, quality: clamp(row.careQuality, 0, 1000) },
    condition: {
      fitness: clamp(row.fitness, 0, 1000),
      fatigue: clamp(row.fatigue, 0, 1000),
      fatigueAtMs: (row.fatigueAt ?? row.updatedAt).getTime(),
      lastHardWorkMs: dyn.lastHardWorkMs ?? null,
      bond: clamp(row.bond, 0, 1000),
    },
    training: dyn.training ?? defaultTraining(),
    career: {
      starts: clamp(row.starts, 0, gc.CAREER_MAX_STARTS),
      racingRetired: row.careerStatus === "racing" ? null : { reason: row.retirementReason ?? "choice", atStarts: dyn.retiredAtStarts ?? row.starts },
      pastured: row.careerStatus === "pasture",
      insured: row.insured,
    },
    injury: isInjury(row.injury) ? row.injury : null,
    rating: { or: clamp(row.rating, 0, 140), ratedRuns: dyn.ratedRuns ?? row.starts, peakOr: clamp(Math.max(dyn.peakOr ?? 0, row.rating), 0, 140) },
    record: { starts: row.starts, wins: row.wins, places: row.places, shows: row.shows, earnings: row.earnings },
    recentRuns: (dyn.recentRuns ?? []).slice(-10),
    breeding: { used: row.breedingCount, bySeason: extra.bySeason ?? [] },
    pregnancy: preg ? { sireId: preg.sireId, coveredAtMs: preg.conceivedAt.getTime(), dueAtMs: preg.dueAt.getTime(), coi: preg.coi, foalSeed: preg.seed } : null,
    reveal: { scanned: row.scanned, quirks: ((row.quirks as string[]) ?? []).filter((q): q is gc.QuirkKey => (gc.QUIRK_KEYS as readonly string[]).includes(q)) },
  };
}

/**
 * Columns to write back after game-core changed a state (settlement, care, training).
 * Counters the database owns (starts, record, breeding count, ownership, career status)
 * are NOT taken from the state; services compute those under their locks.
 */
export function statePatch(state: gc.HorseState, nowMs: number) {
  const valid = isGenome(state.genome);
  const injury = state.injury;
  return {
    rating: state.rating.or,
    careQuality: state.care.quality,
    fitness: state.condition.fitness,
    fatigue: state.condition.fatigue,
    fatigueAt: new Date(state.condition.fatigueAtMs),
    bond: state.condition.bond,
    quirks: state.reveal.quirks,
    scanned: state.reveal.scanned,
    injury: injury ?? null,
    injuredUntil: injury ? new Date(nowMs + Math.ceil(gc.hoursToHeal(injury, nowMs)) * 3_600_000) : null,
    ...(valid ? { stats: gc.currentStats(state) } : {}),
    dynamics: {
      training: state.training,
      lastHardWorkMs: state.condition.lastHardWorkMs,
      recentRuns: state.recentRuns,
      ratedRuns: state.rating.ratedRuns,
      peakOr: state.rating.peakOr,
      lastCareDay: state.care.lastCareDay,
      ...(state.career.racingRetired ? { retiredAtStarts: state.career.racingRetired.atStarts } : {}),
    } satisfies HorseDynamics,
  };
}

/** A complete HorseSpec for a genome (look, current stats, maturity) via game-core. */
export function specFromGenome(input: {
  genome: gc.Genome;
  name: string;
  sex: "colt" | "filly";
  careSessions: number;
  season: number;
  silks?: { primary: string; secondary: string; pattern: string; cap: string };
}): HorseSpec {
  const state = gc.createHorseState({
    id: "spec",
    name: input.name,
    sex: input.sex,
    ownerId: "spec",
    sireId: null,
    damId: null,
    generation: 0,
    genome: input.genome,
    bornAtMs: 0,
    bornSeason: input.season,
    careSessions: input.careSessions,
  });
  const silks = (input.silks ?? DEFAULT_SILKS) as Parameters<typeof gc.appearanceOf>[2];
  return {
    name: input.name,
    sex: input.sex === "filly" ? "female" : "male",
    genome: input.genome,
    appearance: gc.appearanceOf(input.genome, { racingAge: input.careSessions >= gc.CARE_TO_RACING, starts: 0, retired: false }, silks),
    stats: gc.currentStats(state),
    maturityType: gc.maturityType(input.genome),
    rating: gc.INITIAL_OR,
    careSessions: input.careSessions,
  };
}

function placeholderFallback(seed: string, label: string, careSessions: number, name?: string): HorseSpec {
  const genome = gc.generateFoundationGenome(gc.seedFrom("db-fallback", seed, label), { season: 1, rarity: "common" });
  const rng = new gc.Rng(`${seed}|${label}|name`);
  return specFromGenome({ genome, name: name ?? gc.clubHorseName(rng), sex: rng.chance(500) ? "colt" : "filly", careSessions, season: 1 });
}

/** Production hooks: every horse, foal and rule decision comes from game-core. */
export const gameCoreHooks: GameHooks = {
  starterHorse: ({ seed, index, season }) => {
    const states = gc.createStarterStable({ ownerId: "new", seed, nowMs: 0, season: season ?? 1 });
    const s = states[index % states.length]!;
    return specFromGenome({ genome: s.genome, name: s.name, sex: s.sex === "filly" ? "filly" : "colt", careSessions: gc.CARE_TO_RACING, season: season ?? 1 });
  },
  packHorse: ({ seed, rarity, season, genome, sex }) => {
    const g = genomeOf(genome) ?? gc.generateFoundationGenome(seed, { season: season ?? 1, rarity });
    const rng = new gc.Rng(`${seed}|pack-name`);
    return specFromGenome({ genome: g, name: gc.clubHorseName(rng), sex: sex ?? (rng.chance(500) ? "colt" : "filly"), careSessions: 0, season: season ?? 1 });
  },
  breedFoal: ({ seed, sire, dam, name, coi, season, family }) => {
    const sg = genomeOf(sire.genome);
    const dg = genomeOf(dam.genome);
    if (!sg || !dg) return { ...placeholderFallback(seed, `foal:${sire.id}:${dam.id}`, 0, name), careSessions: 0 };
    const genome = gc.inherit(sg, dg, seed, {
      coi: coi ?? 0,
      family: (family ?? []).map((r) => genomeOf(r.genome)).filter((g): g is gc.Genome => g !== null),
      // a parent whose racing ended in an injury may pass on fragile legs
      injured: { sire: sire.retirementReason === "injury", dam: dam.retirementReason === "injury" },
    });
    const sex = new gc.Rng(`${seed}|sex`).chance(500) ? "colt" : "filly";
    const fallbackName = gc.clubHorseName(new gc.Rng(`${seed}|foal-name`));
    return specFromGenome({ genome, name: name ?? fallbackName, sex, careSessions: 0, season: season ?? 1 });
  },
  houseHorse: ({ seed, index, rating, season }) => {
    // Even breed weights so Live fields look varied (owner: "genetics aren't seen in race").
    const genome = gc.generateFoundationGenome(gc.seedFrom("house", seed, index), { season: season ?? 1, evenBreeds: true });
    const rng = new gc.Rng(`${seed}|house|${index}`);
    return { ...specFromGenome({ genome, name: gc.clubHorseName(rng), sex: rng.chance(500) ? "colt" : "filly", careSessions: gc.CARE_TO_RACING, season: season ?? 1 }), rating };
  },
  appraise: (row) => (isGenome(row.genome) ? gc.appraise(toHorseState(row)) : defaultAppraise(row)),
};

/** Local calendar date string → game-core day index (days since 1970-01-01). */
export function dayNumber(isoDate: string): number {
  return Math.round(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
}

/** game-core EntryBank for a stable row. */
export function entryBankOf(stable: { entryBalance: number; entryAllowance: number }, lastGrantDay: number | null, lastRefillDay: number | null): gc.EntryBank {
  return { balance: stable.entryBalance, lastGrantDay, lastRefillDay, tier: Math.max(0, stable.entryAllowance - RULES.entryDailyAllowance) };
}

export { gc };

/**
 * The rating a horse is judged at for band caps and Story difficulty (game-core bandCheck):
 * today's OR, never far below its peak while its ability still supports it, never below its
 * ability floor. Throwing races lowers the stored OR (ratings stay zero-sum) but not this.
 */
export function bandRatingOf(h: HorseRow): gc.BandCheck {
  const dyn = (h.dynamics ?? {}) as { peakOr?: number };
  const mark = isGenome(h.genome) ? gc.abilityMark(toHorseState(h)) : 0;
  return gc.bandCheck({ or: h.rating, peakOr: Math.max(dyn.peakOr ?? 0, h.rating) }, mark);
}

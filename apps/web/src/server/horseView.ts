/**
 * Database horse rows / entry snapshots -> the shared `Horse` the UI and the engine use, via
 * game-core (`raceSnapshot` / `toSharedHorse`). Server-only.
 */
import type { Horse, Silks } from "@thoroughbred/shared";
import { SilksSchema } from "@thoroughbred/shared";
import * as gc from "@thoroughbred/game-core";
import { isGenome, toHorseState, type HorseRow, type PublicRace, type RaceConditions } from "@thoroughbred/db";
import type { RacePlan, RiskView, StableHorse } from "@/lib/types";
import { houseOwnerFor, storyHouseHorse } from "./storyField";

export const DEFAULT_SILKS: Silks = { pattern: "hoops", primary: "#16224d", secondary: "#e2b33c", cap: "#e2b33c" };

export function parseSilks(x: unknown): Silks {
  const p = SilksSchema.safeParse(x);
  return p.success ? p.data : DEFAULT_SILKS;
}

export function parsePlan(x: unknown, fallbackTactic: Horse["style"] = "stalker"): RacePlan {
  const p = gc.RacePlanSchema.safeParse(x);
  return p.success ? { tactic: p.data.tactic, intensity: p.data.intensity } : { tactic: fallbackTactic, intensity: "normal" };
}

type RaceLike = Pick<PublicRace, "kind" | "raceClass" | "conditions" | "postTime" | "targetRunners"> & { id?: string };

export interface RaceConds {
  distanceM: number;
  surface: "turf" | "dirt" | "synthetic";
  going: "firm" | "good" | "soft" | "heavy";
  weather: "clear" | "overcast" | "rain" | "dusk";
  track: string;
}

/** Normalised conditions of a race row (defaults for anything missing). */
export function raceConds(race: Pick<PublicRace, "conditions">): RaceConds {
  const c = (race.conditions ?? {}) as RaceConditions;
  const surface = c.surface === "dirt" || c.surface === "synthetic" ? c.surface : "turf";
  const going = c.going === "firm" || c.going === "soft" || c.going === "heavy" ? c.going : "good";
  const weather = c.weather === "overcast" || c.weather === "rain" || c.weather === "dusk" ? c.weather : "clear";
  return { distanceM: typeof c.distanceM === "number" ? c.distanceM : 1600, surface, going, weather, track: typeof c.track === "string" ? c.track : "Club" };
}

export function bigCrowd(race: Pick<PublicRace, "kind" | "raceClass">): boolean {
  return race.kind === "feature" || race.kind === "final" || race.raceClass === "graded";
}

/** game-core tier of a database race (eligibility, rated or not). */
export function raceTier(race: Pick<PublicRace, "kind" | "raceClass" | "conditions">): gc.RaceTier {
  if (race.kind === "quick") return "quick";
  if (race.kind === "daily_cup") return "daily_cup";
  if (race.kind === "trial") return "trial";
  const c = (race.conditions ?? {}) as RaceConditions;
  switch (race.raceClass) {
    case "maiden":
      return "maiden";
    case "novice":
      return "novice";
    case "listed":
      return "listed";
    case "graded":
      return "g3";
    default: {
      const max = c.maxRating ?? 140;
      return max <= 55 ? "hcp_0_55" : max <= 75 ? "hcp_50_75" : "hcp_70_95";
    }
  }
}

/** Last-resort Horse for rows without a game-core genome (legacy rows). */
function fallbackHorse(src: Record<string, unknown>, silks: Silks): Horse {
  const stats = (src.stats ?? {}) as Partial<Horse["stats"]>;
  const n = (v: unknown) => (typeof v === "number" ? Math.max(0, Math.min(1000, Math.round(v))) : 500);
  const app = (src.appearance ?? {}) as Partial<Horse["appearance"]>;
  const rec = (src.record ?? {}) as Partial<Horse["record"]>;
  return {
    id: String(src.id),
    name: String(src.name ?? "Unnamed").slice(0, 32),
    sex: src.sex === "female" ? "filly" : "colt",
    age: 3,
    stage: "prime",
    generation: typeof src.generation === "number" ? src.generation : 0,
    ownerId: String(src.ownerStableId ?? "club"),
    sireId: (src.sireId as string | null) ?? null,
    damId: (src.damId as string | null) ?? null,
    stats: { speed: n(stats.speed), stamina: n(stats.stamina), burst: n(stats.burst), durability: n(stats.durability), adaptability: n(stats.adaptability), temperament: n(stats.temperament) },
    preferredDistanceM: 1600,
    preferredSurface: "turf",
    style: "stalker",
    appearance: { coat: app.coat ?? "bay", face: app.face ?? "none", legs: app.legs ?? ["none", "none", "none", "none"], silks },
    record: { starts: rec.starts ?? 0, wins: rec.wins ?? 0, places: rec.places ?? 0, shows: rec.shows ?? 0, earnings: rec.earnings ?? 0 },
  };
}

/** Resting display Horse for a row (current stats, the owner's silks). */
export function horseFromRow(row: HorseRow, silks: Silks, nowMs: number): Horse {
  if (!isGenome(row.genome)) return fallbackHorse(row as unknown as Record<string, unknown>, silks);
  return gc.toSharedHorse(toHorseState(row), nowMs, silks);
}

/**
 * The engine Horse for an entry snapshot: game-core raceSnapshot at post time with the
 * race conditions and the entry's plan (intensity folds into the stats). This is the
 * `engineHorse` field hook, so the locked field (and its hash) holds exactly what races.
 */
export function engineHorseFromSnapshot(snapshot: Record<string, unknown>, race: RaceLike, isHouse: boolean): Horse {
  const id = String(snapshot.id);
  // Story chapter races: house runners race as the named rival stables' horses (storyField.ts).
  if (isHouse && race.id) {
    const rival = storyHouseHorse(snapshot, { id: race.id, kind: race.kind, conditions: race.conditions });
    if (rival) return rival;
  }
  const silks = isHouse ? houseOwnerFor(race, id).silks : parseSilks(snapshot.silks);
  const stateParse = gc.HorseStateSchema.safeParse(snapshot.state);
  if (!stateParse.success) return fallbackHorse(snapshot, silks);
  const state = stateParse.data;
  const conds = raceConds(race);
  const natural = gc.runningStyle(state.genome) as Horse["style"];
  const plan = parsePlan(snapshot.plan, natural);
  return gc.raceSnapshot(state, {
    nowMs: race.postTime.getTime(),
    silks,
    race: { going: conds.going, fieldSize: race.targetRunners, bigCrowd: bigCrowd(race), surface: conds.surface, distanceM: conds.distanceM },
    plan,
  }).horse;
}

export function riskView(r: gc.InjuryRisk): RiskView {
  return { permille: r.permille, label: r.label, careerEndingShare: r.careerEndingShare, factors: r.factors.map((f) => f.text) };
}

const BLOCK_TEXT: Record<string, string> = {
  not_racing_age: "Not yet of racing age",
  retired: "Retired from racing",
  career_complete: "Career complete",
  injured: "Recovering from injury",
  in_foal: "In foal",
  daily_limit: "Raced 3 times today",
};

/** Everything the stable pages show about one of the player's horses. */
export function stableHorseView(row: HorseRow, silks: Silks, nowMs: number): StableHorse {
  const horse = horseFromRow(row, silks, nowMs);
  const base = {
    id: row.id,
    horse,
    careerStatus: row.careerStatus,
    starts: row.starts,
    maxStarts: gc.CAREER_MAX_STARTS,
    rating: row.rating,
    injury: row.injury && row.injuredUntil && row.injuredUntil.getTime() > nowMs ? { severity: String((row.injury as { severity?: string }).severity ?? "minor"), untilMs: row.injuredUntil.getTime() } : null,
    lockedRaceId: row.lockKind === "race" ? row.lockRef : null,
  };
  if (!isGenome(row.genome)) {
    return { ...base, stage: row.stage, fatigue: row.fatigue, freshness: 1000 - row.fatigue, condition: "ok", ranToday: 0, block: null, risk: { permille: 4, label: "low", careerEndingShare: 30, factors: [] } };
  }
  const state = toHorseState(row);
  const stage = gc.stageOf(state);
  const fatigue = gc.fatigueAt(state, nowMs);
  const day = gc.dayIndex(nowMs);
  const ranToday = state.recentRuns.filter((r) => gc.dayIndex(r.atMs) === day).length;
  const block = gc.raceBlock(state, nowMs);
  const risk = gc.injuryRisk(state, { nowMs, going: "good", distanceM: horse.preferredDistanceM, intensity: "normal", stage });
  return {
    ...base,
    stage,
    fatigue,
    freshness: gc.freshnessBar(state, nowMs),
    condition: fatigue > gc.TIRED_THRESHOLD ? "tired" : fatigue > 120 ? "ok" : "fresh",
    ranToday,
    block: base.lockedRaceId ? "Entered in a race" : block ? (BLOCK_TEXT[block] ?? block) : null,
    risk: riskView(risk),
  };
}

/** Injury risk for a specific race and ride (the entry sheet). */
export function raceRisk(row: HorseRow, race: Pick<PublicRace, "conditions">, intensity: RacePlan["intensity"], nowMs: number): RiskView | null {
  if (!isGenome(row.genome)) return null;
  const state = toHorseState(row);
  const c = raceConds(race);
  return riskView(gc.injuryRisk(state, { nowMs, going: c.going, distanceM: c.distanceM, intensity, stage: gc.stageOf(state) }));
}

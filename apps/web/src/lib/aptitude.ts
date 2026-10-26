/**
 * Aptitudes: letter grades (A–E) for how well a horse suits a trip, a surface, the going and a
 * riding plan — the key decision aid on the roster, the horse page and the entry sheet.
 *
 * `conditionRating` is the form-guide rating (formerly mirrored by the demo's raceRating, now in
 * tools/balance/legacy), mirroring the engine's deterministic terms. Grades are the
 * rating points lost against the horse's best case, so "why" is always the same maths the race
 * uses — never a separate opinion.
 */
import type { Going, Horse, HorseStats, RunningStyle, Surface } from "@thoroughbred/shared";

export type Grade = "S" | "A" | "B" | "C" | "D" | "E";

export interface Conditions {
  distanceM: number;
  surface: Surface;
  going: Going;
}

/** Same formula as raceRating(): expected strength on the stat scale (650 = plain horse, ideal day). */
export function conditionRating(
  horse: Pick<Horse, "stats" | "style" | "preferredDistanceM" | "preferredSurface">,
  tactic: RunningStyle,
  race: Conditions,
): number {
  const s = horse.stats;
  const D = race.distanceM;
  const adaptGap = 1000 - s.adaptability;
  const matched = horse.style === tactic;
  let cruise = ((s.speed - 650) * 105) / 100;
  if (horse.preferredSurface !== race.surface) cruise -= 40 + (110 * adaptGap) / 1000;
  cruise -= ({ firm: 0, good: 0, soft: 140, heavy: 300 }[race.going] * adaptGap) / 1000;
  const distDelta = D - horse.preferredDistanceM;
  if (distDelta < 0) cruise += (distDelta * (1100 - s.adaptability)) / 6000;
  cruise += matched ? 15 : -15;
  const stamMul = 1000 + ((650 - s.stamina) * ((Math.max(0, D - 800) * 9) / 20)) / 1000;
  const distMul = distDelta > 0 ? 1000 + (distDelta * (1100 - s.adaptability)) / 3000 : 1000;
  const durMul = 1000 + (600 - s.durability) / 6;
  const tacMul = matched ? 994 : 1006;
  const drain = (stamMul * distMul * durMul * tacMul) / 1e9;
  const drainRef = (1000 * 1000 * (1000 + (600 - 650) / 6) * 994) / 1e9;
  const burstW = Math.max(0.05, 0.3 - (D - 1000) / 6000);
  const r = 650 + cruise / 1.05 - 0.85 * (drain - drainRef) + burstW * (s.burst - 650) + 0.2 * (s.temperament - 650);
  return Math.round(r);
}

/** Rating points lost -> grade. */
export function lossGrade(loss: number): Grade {
  if (loss <= 10) return "A";
  if (loss <= 25) return "B";
  if (loss <= 45) return "C";
  if (loss <= 70) return "D";
  return "E";
}

export const TRIP_BANDS: { id: string; label: string; distanceM: number; range: string }[] = [
  { id: "sprint", label: "Sprint", distanceM: 1100, range: "1,000–1,200 m" },
  { id: "mile", label: "Mile", distanceM: 1500, range: "1,400–1,600 m" },
  { id: "middle", label: "Middle", distanceM: 2000, range: "2,000 m" },
  { id: "long", label: "Long", distanceM: 2400, range: "2,400 m" },
];
export const SURFACES: Surface[] = ["turf", "dirt", "synthetic"];
export const GOINGS: Going[] = ["firm", "good", "soft", "heavy"];
export const STYLES: RunningStyle[] = ["front", "stalker", "closer"];

export interface AptitudeCell<K extends string = string> {
  key: K;
  grade: Grade;
  loss: number;
  best: boolean;
}

export interface Aptitudes {
  trip: AptitudeCell[];
  surface: AptitudeCell<Surface>[];
  going: AptitudeCell<Going>[];
  style: AptitudeCell<RunningStyle>[];
  /** Rating in the horse's ideal conditions (its ceiling today). */
  ideal: number;
}

type HorseLike = Pick<Horse, "stats" | "style" | "preferredDistanceM" | "preferredSurface">;

function cells<K extends string>(keys: readonly K[], rate: (k: K) => number): AptitudeCell<K>[] {
  const scores = keys.map(rate);
  const top = Math.max(...scores);
  return keys.map((key, i) => {
    const loss = top - scores[i]!;
    return { key, loss, grade: lossGrade(loss), best: loss === 0 };
  });
}

export function aptitudes(horse: HorseLike): Aptitudes {
  const ideal: Conditions = { distanceM: horse.preferredDistanceM, surface: horse.preferredSurface, going: "good" };
  const natural = horse.style;
  return {
    trip: cells(
      TRIP_BANDS.map((b) => b.id),
      (id) => conditionRating(horse, natural, { ...ideal, distanceM: TRIP_BANDS.find((b) => b.id === id)!.distanceM }),
    ),
    surface: cells(SURFACES, (surface) => conditionRating(horse, natural, { ...ideal, surface })),
    going: cells(GOINGS, (going) => conditionRating(horse, natural, { ...ideal, going })),
    style: cells(STYLES, (t) => conditionRating(horse, t, ideal)),
    ideal: conditionRating(horse, natural, ideal),
  };
}

/** Trip band label for a distance. */
export function tripBand(distanceM: number): (typeof TRIP_BANDS)[number] {
  return TRIP_BANDS.reduce((best, b) => (Math.abs(b.distanceM - distanceM) < Math.abs(best.distanceM - distanceM) ? b : best));
}

// ---------------------------------------------------------------------------
// Fit check for a specific race (pre-race and the post-race "why" card)
// ---------------------------------------------------------------------------

export type FitLevel = "good" | "ok" | "poor";
export interface Fit {
  id: "trip" | "surface" | "going" | "plan";
  label: string;
  level: FitLevel;
  /** Plain-language detail, e.g. "1,600 m · best 1,200 m". */
  detail: string;
}

export const FIT_SYMBOL: Record<FitLevel, string> = { good: "✓", ok: "~", poor: "✗" };

function level(loss: number): FitLevel {
  return loss <= 12 ? "good" : loss <= 40 ? "ok" : "poor";
}

const nf = new Intl.NumberFormat("en-GB");
const SURF: Record<Surface, string> = { turf: "turf", dirt: "dirt", synthetic: "synthetic" };
const STYLE_NAME: Record<RunningStyle, string> = { front: "front-runner", stalker: "stalker", closer: "closer" };

export function fitCheck(horse: HorseLike, tactic: RunningStyle, race: Conditions): Fit[] {
  const ideal: Conditions = { distanceM: horse.preferredDistanceM, surface: horse.preferredSurface, going: "good" };
  const base = conditionRating(horse, horse.style, ideal);
  const tripLoss = base - conditionRating(horse, horse.style, { ...ideal, distanceM: race.distanceM });
  const surfLoss = base - conditionRating(horse, horse.style, { ...ideal, surface: race.surface });
  const goingLoss = base - conditionRating(horse, horse.style, { ...ideal, going: race.going });
  const planLoss = base - conditionRating(horse, tactic, ideal);
  return [
    {
      id: "trip",
      label: "Trip",
      level: level(tripLoss),
      detail:
        race.distanceM === horse.preferredDistanceM
          ? `${nf.format(race.distanceM)} m, ideal`
          : `${nf.format(race.distanceM)} m · best ${nf.format(horse.preferredDistanceM)} m`,
    },
    {
      id: "surface",
      label: "Surface",
      level: level(surfLoss),
      detail:
        race.surface === horse.preferredSurface
          ? `${SURF[race.surface]}, favourite`
          : `${SURF[race.surface]} · prefers ${SURF[horse.preferredSurface]}`,
    },
    { id: "going", label: "Going", level: level(goingLoss), detail: race.going },
    {
      id: "plan",
      label: "Plan",
      level: level(planLoss),
      detail: tactic === horse.style ? `${STYLE_NAME[tactic]}, natural` : `${STYLE_NAME[tactic]} · natural ${STYLE_NAME[horse.style]}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// "Why this horse is good at X": a plain-language summary from the stats
// ---------------------------------------------------------------------------

export const STAT_NAME: Record<keyof HorseStats, string> = {
  speed: "Speed",
  stamina: "Stamina",
  burst: "Burst",
  durability: "Durability",
  adaptability: "Adaptability",
  temperament: "Temperament",
};

export function statGrade(v: number): Grade {
  if (v >= 850) return "S";
  if (v >= 720) return "A";
  if (v >= 600) return "B";
  if (v >= 480) return "C";
  if (v >= 360) return "D";
  return "E";
}

/** e.g. "Best at sprints on turf. Speed B and Burst C are her strengths. Stamina D is why longer trips find her out." */
export function pronoun(sex: Horse["sex"]): { he: string; his: string } {
  return sex === "filly" || sex === "mare" ? { he: "she", his: "her" } : { he: "he", his: "his" };
}

export function horseSummary(horse: HorseLike & Pick<Horse, "name" | "sex">): string {
  const { he, his } = pronoun(horse.sex);
  const apt = aptitudes(horse);
  const bestTrip = TRIP_BANDS[apt.trip.findIndex((c) => c.best)]!;
  const entries = (Object.keys(STAT_NAME) as (keyof HorseStats)[]).map((k) => [k, horse.stats[k]] as const);
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const [s1, s2] = sorted;
  const weak = sorted[sorted.length - 1]!;
  const strong = `${STAT_NAME[s1![0]]} ${statGrade(s1![1])} and ${STAT_NAME[s2![0]]} ${statGrade(s2![1])}`;
  const tripWord = { sprint: "sprints", mile: "a mile", middle: "middle distances", long: "a long trip" }[bestTrip.id as "sprint"];
  const weakLine =
    weak[0] === "stamina"
      ? `Stamina ${statGrade(weak[1])} is why longer trips find ${he === "she" ? "her" : "him"} out.`
      : weak[0] === "adaptability"
        ? `Adaptability ${statGrade(weak[1])}: ${he} needs ${his} own trip and ground.`
        : weak[0] === "temperament"
          ? `Temperament ${statGrade(weak[1])}: ${he} can be keen and erratic.`
          : `${STAT_NAME[weak[0]]} ${statGrade(weak[1])} is ${his} weak spot.`;
  // Still growing (all low grades): describe the trip and ground only; the stats aren't fair yet.
  if (statGrade(s1![1]) === statGrade(weak[1])) {
    return `Bred for ${tripWord} on ${SURF[horse.preferredSurface]}. ${he.charAt(0).toUpperCase()}${he.slice(1)}'s still growing: ${his} abilities show as ${he} matures.`;
  }
  return `Best at ${tripWord} on ${SURF[horse.preferredSurface]}. ${strong} are ${his} strengths. ${weakLine}`;
}

/**
 * The horse to suggest first: highest rating in its own ideal conditions, skipping horses in
 * `exclude` (run recently) unless that leaves none. Mirrors the server's Quick Pick.
 */
export function recommendIndex(horses: readonly HorseLike[], exclude: readonly number[] = []): number {
  let pool = horses.map((h, i) => ({ h, i })).filter(({ i }) => !exclude.includes(i));
  if (pool.length === 0) pool = horses.map((h, i) => ({ h, i }));
  let best = pool[0]?.i ?? 0;
  let bestScore = -Infinity;
  for (const { h, i } of pool) {
    const score = aptitudes(h).ideal;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

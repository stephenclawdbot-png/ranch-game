/**
 * Ability mark calibration (game-core ability.ts): the OR a horse of a given CURRENT ability
 * settles at, plus the engine's strength→win regression check.
 *   npx vitest run --config tools/balance/vitest.config.ts ability       # full run
 *   BAL_ABILITY_ROUNDS=100 npx vitest run ... ability                   # quick pass
 *
 * Part 1 fits the table. A population of known-ability horses — the shape of a real player
 * base: starter-grade horses dominate (the Club genome pool), with a thin tail of bred
 * improvement — starts at OR 40 (like every newcomer) and races the card's bands: maidens and
 * novices by wins, handicap bands by OR with 1 OR = 1 lb weights, then Listed and Group 3 at
 * level weights. Horses pick races at their trip (the card offers several distances a day),
 * so each field runs at the nearest card distance to its runners' trips — racing everyone at
 * one rotating distance would add mismatch noise and compress the fit. Every band runs every
 * round, with Club fillers like the Live card's pickHouseHorses: free house horses whose
 * rating fits the band, and when the pool is short, fresh ones bred at the band midpoint (db
 * defaultHouseHorse — starter grade at bandRating). Without the fillers the top bands are
 * dead: strong horses have nobody to beat and never reach Listed. Horses retire after
 * CAREER_MAX_STARTS rated races and a newcomer of the same ability enters at OR 40 — that
 * matters because the rating update leaks a little OR per race (the +10/−7 clamps cut
 * losers' losses among equals), harmless over one career (~3 OR) but compounding when a
 * horse never retires. A horse's settled OR is the mean over the last half of its career;
 * races run through the real engine, ratings through game-core updateRatings, rounds continue
 * until the fit over recent generations of retirements stops changing (and at least 3000
 * rated races, 3 generations). The fitted monotone knots are committed as ABILITY_OR_TABLE in
 * packages/game-core/src/ability.ts; this report prints the committed table's drift against a
 * fresh fit.
 *
 * Part 2 is the lead's regression measurement (8 runners, 400 races, field all 600): one full
 * grade better on speed/stamina/burst wins ~45%, two grades ~80%, one grade worse ~2%.
 */
import { expect, it } from "vitest";
import type { Going, HorseStats, RunningStyle, Surface } from "@thoroughbred/shared";
import { simulateRace } from "../../packages/racing-engine/src/index";
import { makeInput, seedFor, type EntryOpts } from "../../packages/racing-engine/src/test-fixtures";
import { ABILITY_OR_TABLE, CAREER_MAX_STARTS, Rng, abilityOrOf, abilityScore, carryWeight, handicapWeights, seedFrom, updateRatings } from "../../packages/game-core/src/index";

import { LIVE_MODEL, writeReport, yieldNow } from "./out";

const ROUNDS = Number(process.env.BAL_ABILITY_ROUNDS ?? 600);
const MIN_RACES = 3000;
/** Retirements per ability lineage before the fit counts as settled (a generation each). */
const MIN_GENERATIONS = 3;
const FIELD = 8;
/** Max per-level mean-OR drift per 50 rounds for the population to count as settled. */
const SETTLE_DRIFT = 3;
const STYLES: RunningStyle[] = ["front", "stalker", "closer"];
const SURFACE: Surface = "turf";
const GOING: Going = "good";
const DIST = [1100, 1400, 1600, 2000, 2400, 2800];
/** The card's bands (card.ts ClassDefs): maidens and novices gate on wins, the rest on OR. */
const BANDS = [
  { id: "maiden", min: 0, max: 60, maxWins: 0, handicap: false },
  { id: "novice", min: 0, max: 70, maxWins: 2, handicap: false },
  { id: "hcp55", min: 0, max: 55, handicap: true },
  { id: "hcp75", min: 50, max: 75, handicap: true },
  { id: "hcp95", min: 70, max: 95, handicap: true },
  { id: "listed", min: 85, max: 140, handicap: false },
  { id: "g3", min: 95, max: 140, handicap: false },
] as const;
/** The player base: starter-grade ability dominates, with a thin tail of bred improvement. */
const MIX: readonly (readonly [ability: number, copies: number])[] = [
  [300, 1], [350, 2], [400, 4], [450, 6], [500, 8], [550, 6], [600, 5], [650, 4], [700, 3], [750, 2], [800, 1], [850, 1], [900, 1],
];
const TRIPS = [1100, 1600, 2400, 3200];
/** Club house horses come from the starter genome pool: current ability 420-580. */
const HOUSE_ABILITY = [420, 435, 450, 465, 480, 495, 510, 525, 540, 555, 570, 580];
/** Population stat tilts by trip, so the fit exercises the trip weighting. */
const TILT: Record<number, Pick<HorseStats, "speed" | "stamina" | "burst">> = {
  1100: { speed: 30, stamina: -30, burst: 20 },
  1600: { speed: 0, stamina: 0, burst: 0 },
  2400: { speed: -10, stamina: 10, burst: 0 },
  3200: { speed: -30, stamina: 40, burst: -20 },
};

interface Runner {
  id: string;
  /** Resting stats (durability/adaptability/temperament fixed at 650 to isolate ability). */
  stats: HorseStats;
  trip: number;
  style: RunningStyle;
  /** Nominal ability (settling is tracked per level); score is the trip-weighted blend. */
  level: number;
  score: number;
  or: number;
  ratedRuns: number;
  wins: number;
}

function statsOf(ability: number, trip: number): HorseStats {
  const t = TILT[trip]!;
  return { speed: ability + t.speed, stamina: ability + t.stamina, burst: ability + t.burst, durability: 650, adaptability: 650, temperament: 650 };
}

function runnerOf(id: string, ability: number, trip: number, style: RunningStyle, or: number): Runner {
  const stats = statsOf(ability, trip);
  return {
    id,
    stats,
    trip,
    style,
    level: ability,
    score: abilityScore({ speed: stats.speed, stamina: stats.stamina, burst: stats.burst }, trip),
    or,
    ratedRuns: 0,
    wins: 0,
  };
}

/** The population: the MIX at every trip, so the fit covers the whole score range. */
function population(): Runner[] {
  const out: Runner[] = [];
  for (const [ability, copies] of MIX) {
    for (let c = 0; c < copies; c++) {
      for (const trip of TRIPS) out.push(runnerOf(`p${out.length}`, ability, trip, STYLES[out.length % 3]!, 40));
    }
  }
  return out;
}

const levels = MIX.map(([a]) => a);
const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);

/** Monotone knots [score, or] fitted from settled samples: mean per 25-point bin, pool adjacent violators. */
function fitKnots(xs: { score: number; or: number }[]): { score: number; or: number; n: number }[] {
  const bins = new Map<number, { sum: number; n: number }>();
  for (const s of xs) {
    const b = Math.floor(s.score / 25) * 25;
    const x = bins.get(b) ?? { sum: 0, n: 0 };
    bins.set(b, { sum: x.sum + s.or, n: x.n + 1 });
  }
  let fitted: { score: number; or: number; n: number }[] = [...bins.entries()].map(([score, x]) => ({ score, or: x.sum / x.n, n: x.n })).sort((a, b) => a.score - b.score);
  for (let i = 1; i < fitted.length;) {
    if (fitted[i]!.or < fitted[i - 1]!.or) {
      const a = fitted[i - 1]!, b = fitted[i]!;
      const merged = { score: b.score, or: (a.or * a.n + b.or * b.n) / (a.n + b.n), n: a.n + b.n };
      fitted = [...fitted.slice(0, i - 1), merged, ...fitted.slice(i + 1)];
      i = Math.max(1, i - 1);
    } else i++;
  }
  return fitted;
}

/** The card distance nearest the field's trips (horses pick races at their trip). */
function distanceOf(field: Runner[]): number {
  const trips = field.map((r) => r.trip).sort((a, b) => a - b);
  const mid = trips[Math.floor(trips.length / 2)]!;
  return DIST.reduce((best, d) => (Math.abs(d - mid) < Math.abs(best - mid) ? d : best), DIST[0]!);
}

it("ability mark calibration", async () => {
  const players = population();
  let house: Runner[] = [];
  let mints = 0;
  /** A fresh Club horse for a band, rated at its midpoint (db pickHouseHorses' bred path). */
  const mintHouse = (band: (typeof BANDS)[number]): Runner => {
    const ability = HOUSE_ABILITY[mints % HOUSE_ABILITY.length]!;
    return runnerOf(`h${mints++}`, ability, [1100, 1600, 2400, 3200][mints % 4]!, STYLES[mints % 3]!, Math.round((band.min + band.max) / 2));
  };

  /** Today's rule: the lowest band the horse fits by current OR (and wins, for the juveniles). */
  const bandOf = (r: Runner): (typeof BANDS)[number] | null => {
    for (const b of BANDS) {
      if (b.maxWins !== undefined && r.wins > b.maxWins) continue;
      if (r.or < b.min || r.or > b.max) continue;
      return b;
    }
    return null;
  };

  let races = 0;
  let quiet = 0;
  let round = 0;
  const hist = players.map(() => [] as number[]);
  /** A settled OR per retired horse: the mean over the last half of its career. */
  const samples: { level: number; score: number; or: number }[] = [];
  let prevFit: { score: number; or: number; n: number }[] | null = null;
  const levelMeans: number[][] = []; // per round: mean OR per ability level (settling printout)
  const trajectory: { round: number; meanOr: number[] }[] = [];
  let lastDrift = 0;
  for (; round < ROUNDS && (races < MIN_RACES || samples.length < players.length * MIN_GENERATIONS || quiet < 3); round++) {
    if (round % 10 === 0) await yieldNow();
    for (const band of BANDS) {
      const entrants = players.filter((p) => bandOf(p) === band);
      if (entrants.length === 0) continue; // house-only races move no player ratings
      // New fields every round (Fisher-Yates off the game-core rng, deterministic).
      const rng = new Rng(seedFrom("ability-field", round, band.id));
      const order = [...entrants];
      for (let i = order.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      const moved = new Set<Runner>(); // one race per horse per round
      for (let from = 0; from + 1 < order.length; from += FIELD) {
        const field = order.slice(from, from + FIELD);
        const pool = house.filter((h) => bandOf(h) === band && !moved.has(h));
        let next = 0;
        while (field.length < FIELD) {
          const h = pool[next++] ?? mintHouse(band);
          moved.add(h);
          if (!house.includes(h)) house.push(h);
          field.push(h);
        }
        // Handicap bands: 1 OR = 1 lb, each lb costing 1 OR of ability (game-core handicapWeights, carryWeight).
        const lb = new Map(handicapWeights(field.map((r) => ({ horseId: r.id, or: r.or })), band.handicap).map((w) => [w.horseId, w.extraLb]));
        const entries: EntryOpts[] = field.map((r) => ({
          id: r.id,
          stats: carryWeight(r.stats, r.trip, lb.get(r.id) ?? 0),
          style: r.style,
          tactic: r.style,
          preferredDistanceM: r.trip,
        }));
        const result = simulateRace({ ...makeInput(entries, { distanceM: distanceOf(field), surface: SURFACE, going: GOING, seed: seedFor(900_000 + races) }), ...LIVE_MODEL }).result;
        races++;
        const pos = new Map(result.finishOrder.map((f) => [f.horseId, f.position]));
        for (const c of updateRatings(field.map((r) => ({ horseId: r.id, or: r.or, ratedRuns: r.ratedRuns, position: pos.get(r.id) ?? 1 })))) {
          const r = field.find((x) => x.id === c.horseId)!;
          r.or = c.after;
          r.ratedRuns++;
        }
        const winner = result.finishOrder[0]!.horseId;
        for (const r of field) if (r.id === winner) r.wins++;
      }
    }
    // Settling watch: the fit over the most recent generation of retirements must stop
    // changing (single horses random-walk ±20, so the test is the table, not a frozen rating).
    // Careers: at CAREER_MAX_STARTS rated races the horse retires (its OR leaves the pool with
    // it, and for the Club fillers too) and a newcomer of the same ability enters at OR 40.
    levelMeans.push(levels.map((lv) => Math.round(mean(players.filter((p) => p.level === lv).map((p) => p.or)))));
    for (const [i, p] of players.entries()) {
      hist[i]!.push(p.or);
      if (p.ratedRuns < CAREER_MAX_STARTS) continue;
      samples.push({ level: p.level, score: p.score, or: mean(hist[i]!.slice(-CAREER_MAX_STARTS / 2)) });
      p.or = 40;
      p.ratedRuns = 0;
      p.wins = 0;
    }
    house = house.filter((h) => h.ratedRuns < CAREER_MAX_STARTS);
    if (round % 10 === 0 && samples.length >= players.length * 2) {
      const fit = fitKnots(samples.slice(-players.length));
      if (prevFit && prevFit.length === fit.length) {
        lastDrift = Math.max(...fit.map((f, i) => Math.abs(f.or - prevFit![i]!.or)));
        quiet = lastDrift <= SETTLE_DRIFT ? quiet + 1 : 0;
      }
      prevFit = fit;
    }
    if ((round + 1) % 50 === 0) trajectory.push({ round: round + 1, meanOr: levelMeans[levelMeans.length - 1]! });
  }

  // Fit: knots over every retired horse.
  const fitted = fitKnots(samples);
  const knots = fitted.map((f) => [f.score, Math.round(f.or)] as const);
  const driftOf = fitted.map((f) => ({ score: f.score, fitted: Math.round(f.or), committed: abilityOrOf(f.score), delta: abilityOrOf(f.score) - Math.round(f.or) }));

  // Regression check (lead's measurement): 8 runners, field all 600, one runner ± grades better.
  const winShare = async (delta: number, n = 400): Promise<number> => {
    let wins = 0;
    for (let k = 0; k < n; k++) {
      if (k % 50 === 0) await yieldNow();
      const entries: EntryOpts[] = Array.from({ length: 8 }, (_, i) => ({
        stats: { speed: 600 + (i === 0 ? delta : 0), stamina: 600 + (i === 0 ? delta : 0), burst: 600 + (i === 0 ? delta : 0) },
        style: STYLES[i % 3]!,
        preferredDistanceM: 1600,
        gate: ((i + k) % 8) + 1,
      }));
      const r = simulateRace({ ...makeInput(entries, { distanceM: 1600, surface: SURFACE, going: GOING, seed: seedFor(700_000 + k) }), ...LIVE_MODEL }).result;
      if (r.finishOrder[0]!.horseId === "h1") wins++; // makeHorse ids: h1..h8
    }
    return wins / n;
  };
  const reg = { oneBetter: await winShare(100), twoBetter: await winShare(200), oneWorse: await winShare(-100) };

  const lines = [
    `# Ability mark calibration: ${players.length} known-ability horses, ${races} rated races over ${round} rounds, ${samples.length} retired (${(samples.length / players.length).toFixed(1)} generations; fit drift ${lastDrift.toFixed(2)} OR between the last generation cohorts)`,
    `# Settling: mean OR by ability level ${levels.join(" ")} at rounds ${trajectory.map((t) => t.round).join(", ")}`,
    ...trajectory.map((t) => `#   r${String(t.round).padStart(4)}: ${t.meanOr.join(" ")}`),
    "score fitted committed delta   (committed = game-core ABILITY_OR_TABLE)",
    ...driftOf.map((d) => `${String(d.score).padStart(5)} ${String(d.fitted).padStart(6)} ${String(d.committed).padStart(9)} ${String(d.delta).padStart(5)}`),
    "",
    "# Knots to commit in packages/game-core/src/ability.ts (ABILITY_OR_TABLE):",
    knots.map(([s, o]) => `  [${s}, ${o}],`).join("\n"),
    "",
    `# Boundary checks: ability 500 -> OR ${abilityOrOf(500)}, 600 -> ${abilityOrOf(600)}, 700 -> ${abilityOrOf(700)}, 800 -> ${abilityOrOf(800)}`,
    `# (a 700 newcomer is blocked from 0-55 when its mark > ${55 + 15}; a 500 newcomer must stay under it)`,
    "",
    `# Engine regression (8 runners, 400 races, field all 600): one grade better wins ${Math.round(reg.oneBetter * 100)}% (target ~45%), two grades ${Math.round(reg.twoBetter * 100)}% (target ~80%), one grade worse ${Math.round(reg.oneWorse * 100)}% (target ~2%)`,
  ];
  writeReport("ability", { rounds: round, races, retired: samples.length, knots, driftOf, trajectory, regression: reg, committed: ABILITY_OR_TABLE }, lines);
  expect(races, "the calibration must run at least MIN_RACES rated races").toBeGreaterThanOrEqual(MIN_RACES);
  expect(quiet, "the fit must settle within BAL_ABILITY_ROUNDS (recent generations agree for 3 checks)").toBeGreaterThanOrEqual(3);
  expect(reg.oneBetter).toBeGreaterThan(0.32);
  expect(reg.oneBetter).toBeLessThan(0.58);
  expect(reg.twoBetter).toBeGreaterThan(0.68);
  expect(reg.twoBetter).toBeLessThan(0.9);
  expect(reg.oneWorse).toBeLessThan(0.06);
});
/**
 * Race drama: how close finishes are, and how often a weaker horse beats a stronger one.
 *   npx vitest run --config tools/balance/vitest.config.ts drama          # full run (~2-3 min)
 *   BAL_DRAMA_RACES=400 npx vitest run --config tools/balance/vitest.config.ts drama   # quick look
 *
 * Owner request (2026-10-30): narrow wins between nearly equal horses should be common, and a
 * 68 should be able to beat a 75. Research (docs/reports/2026-10-30 race experience research.md):
 * players enjoy narrow wins most; foregone races are the top complaint.
 *
 * Races are built the way Live races are: minted horses (game-core generateFoundationGenome,
 * every breed, seasons 1-9, varied career stage and training) go through game-core raceSnapshot
 * (the path engineHorseFromSnapshot uses), run on a card trip near their best trip and a
 * surface that suits them, on a course from courses.ts that races the surface (the Live card's
 * course profile), with race-day kit drawn like owners buy it (most ride the free apprentice).
 *
 * Every runner's racing stats are then shifted (speed, stamina and burst by the same amount) so
 * that its ability mark (game-core abilityScore at its best trip through ABILITY_OR_TABLE) is
 * exactly the OR the field needs. The OR here is the horse's TRUE ability on the day, so the
 * numbers measure the engine alone; real ORs lag ability, which makes real upsets a little more
 * common than these.
 *
 * Field types (8 runners):
 *   even     - all within 2 OR (marks B..B+2);
 *   handicap - marks spread over a 25-OR band (like the card's 50-75 handicap), with handicap
 *              weights from ratings.ts handicapWeights (1 OR = 1 lb; ability.ts carryWeight makes
 *              each lb cost 1 OR of ability on the ABILITY_OR_TABLE scale);
 *   mixed    - the same fields, gates and seeds at level weights (Live handicaps run like this
 *              today: KNOBS mismatch 6, weights are not applied live).
 * Upsets: win rate by OR below the field's best runner in the mixed fields, a lone horse d OR
 * below seven equal rivals, and a 68 against a 75 in otherwise even fields (six runners at 71-72).
 *
 * Real-racing anchors: favourites win about 30-35% of flat races (UK/US market data, e.g.
 * Racing Post / Timeform favourite strike rates ~31-34%); in UK flat handicaps a large share of
 * races are decided by under a length and photo finishes (a head or less) are routine; a
 * horse's Timeform/BHA rating moves by several pounds from run to run.
 *
 * BAL_MODEL=legacy runs every race as the engine ran Live races before 1.4.0 (course
 * character, no drama model), for the before/after comparison.
 */
import { expect, it } from "vitest";
import type { Going, Horse, RaceCourse, RaceKit, RaceReplay, Surface, Weather } from "@thoroughbred/shared";
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";
import { simulateRace } from "../../packages/racing-engine/src/index";
import {
  ABILITY_OR_TABLE,
  BREEDS,
  CARE_TO_RACING,
  carryWeight,
  JOCKEYS,
  Rng,
  abilityOrOf,
  abilityScore,
  courseProfile,
  coursesFor,
  createHorseState,
  deriveSeed,
  generateFoundationGenome,
  handicapWeights,
  preferredDistanceM,
  preferredSurface,
  raceDayKit,
  raceSnapshot,
  runningStyle,
  type HorseState,
} from "../../packages/game-core/src/index";
import { LEGACY_MODEL, LIVE_MODEL, writeReport, yieldNow } from "./out";

const RACES = Number(process.env.BAL_DRAMA_RACES ?? 2000);
const FIELD = 8;
const POOL = 1500;
const OPEN_TRIPS = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2800, 3200];
const SURFACES: Surface[] = ["turf", "dirt", "synthetic"];
const GOINGS: Going[] = ["good", "good", "good", "firm", "soft", "heavy"];
const SILKS = { primary: "#112233", secondary: "#ffffff", pattern: "hoops", cap: "#aa0000" } as const;
const T0 = 1_800_000_000_000;
const DEFICITS = [0, 3, 5, 7, 10, 15];
const LONE_RACES = Math.max(200, Math.round(RACES / 4));
const H2H_RACES = Math.max(400, Math.round(RACES * 0.6));

const LEGACY = LEGACY_MODEL;

function poolHorse(i: number): HorseState {
  const breed = BREEDS[i % BREEDS.length]!;
  const r = new Rng(`drama-pool-${i}`);
  const genome = generateFoundationGenome(`drama-${i}`, { season: 1 + (i % 9), breed });
  const h = createHorseState({ id: `d${i}`, name: `Drama ${i}`, sex: i % 2 ? "colt" : "filly", ownerId: "bal", sireId: null, damId: null, generation: 0, genome, bornAtMs: T0, bornSeason: 1, careSessions: CARE_TO_RACING });
  const realisation = { ...h.training.realisation };
  for (const k of Object.keys(realisation) as (keyof typeof realisation)[]) realisation[k] = r.range(600, 1000);
  return { ...h, career: { ...h.career, starts: r.range(2, 32) }, training: { ...h.training, realisation } };
}

/** Highest OR the ability table reaches (marks are drawn below it). */
const TOP_OR = ABILITY_OR_TABLE[ABILITY_OR_TABLE.length - 1]![1];

/** Inverse of ABILITY_OR_TABLE: the ability score whose mark is `or`. */
function scoreForOr(or: number): number {
  const t = ABILITY_OR_TABLE;
  if (or <= t[0]![1]) return t[0]![0];
  for (let i = 1; i < t.length; i++) {
    const [s0, o0] = t[i - 1]!;
    const [s1, o1] = t[i]!;
    if (or <= o1) return Math.round(s0 + ((s1 - s0) * (or - o0)) / (o1 - o0));
  }
  return t[t.length - 1]![0];
}

/** Shift speed/stamina/burst by one amount so the horse's ability mark is `or`. */
function atMark(h: Horse, or: number): Horse {
  const trip = h.preferredDistanceM;
  const s = { ...h.stats };
  // The blend is linear with weights summing to 1, so one shift moves the score by that much (bar clamping).
  for (let k = 0; k < 3; k++) {
    const d = scoreForOr(or) - abilityScore(s, trip);
    if (d === 0) break;
    s.speed = Math.min(1000, Math.max(0, s.speed + d));
    s.stamina = Math.min(1000, Math.max(0, s.stamina + d));
    s.burst = Math.min(1000, Math.max(0, s.burst + d));
  }
  for (let g = 0; g < 400 && abilityOrOf(abilityScore(s, trip)) < or; g++) { s.speed++; s.stamina++; s.burst++; }
  for (let g = 0; g < 400 && abilityOrOf(abilityScore(s, trip)) > or; g++) { s.speed--; s.stamina--; s.burst--; }
  return { ...h, stats: s };
}

interface Race {
  distanceM: number;
  surface: Surface;
  going: Going;
  weather: Weather;
  course: RaceCourse;
  states: HorseState[];
  kits: (RaceKit | undefined)[];
}

/** Trip, surface, going, course and 8 horses that fit (as players enter Live races). */
function drawRace(rng: Rng, pool: HorseState[]): Race {
  for (;;) {
    const distanceM = rng.pick(OPEN_TRIPS);
    const surface = rng.pick(SURFACES);
    const going: Going = surface === "synthetic" ? "good" : rng.pick(GOINGS);
    const weather: Weather = going === "soft" || going === "heavy" ? (rng.chance(600) ? "rain" : "overcast") : rng.chance(150) ? "overcast" : "clear";
    const fits = pool.filter((h) => Math.abs(preferredDistanceM(h.genome) - distanceM) <= 300 && [surface, "synthetic"].includes(preferredSurface(h.genome)));
    if (fits.length < FIELD * 3) continue;
    const states: HorseState[] = [];
    while (states.length < FIELD) {
      const h = rng.pick(fits);
      if (!states.includes(h)) states.push(h);
    }
    const kits = states.map(() => {
      const jockey = rng.weighted([75, 15, 10]);
      const shoes = (going === "soft" || going === "heavy") && rng.chance(300);
      return raceDayKit({ extras: shoes ? ["soft_shoes"] : [], jockey: (["apprentice", "journeyman", "top"] as const)[jockey]! }, going);
    });
    return { distanceM, surface, going, weather, course: courseProfile(rng.pick(coursesFor(surface))), states, kits };
  }
}

/** The horse carrying `lb` extra pounds (as raceSnapshot's extraWeightLb applies it). */
function withWeight(h: Horse, lb: number): Horse {
  return lb > 0 ? { ...h, stats: carryWeight(h.stats, h.preferredDistanceM, lb) } : h;
}

function snapshot(h: HorseState, race: Race): Horse {
  return raceSnapshot(h, {
    nowMs: T0,
    silks: SILKS,
    race: { going: race.going, fieldSize: FIELD, bigCrowd: false, surface: race.surface, distanceM: race.distanceM },
    plan: { tactic: runningStyle(h.genome), intensity: "normal" },
  }).horse;
}

function run(race: Race, horses: Horse[], seed: string): RaceReplay {
  return simulateRace({
    race: { id: "drama", name: "Drama Handicap", distanceM: race.distanceM, surface: race.surface, weather: race.weather, going: race.going, raceClass: "handicap", postTimeMs: T0, purse: 0 },
    course: race.course,
    entries: horses.map((horse, i) => ({ gate: i + 1, tactic: horse.style, horse, ...(race.kits[i] ? { kit: race.kits[i] } : {}) })),
    seed,
    ...LIVE_MODEL,
  });
}

/** Margin buckets, in the game's own margin language (racing-engine marginLabel). */
const BUCKETS = ["nose", "short head", "head", "neck", "1/2-3/4", "1", "1 1/4-2", "2 1/2-3", "3+"] as const;
function bucketOf(label: string): (typeof BUCKETS)[number] {
  if (label === "nose" || label === "short head" || label === "head" || label === "neck") return label;
  if (label === "1/2" || label === "3/4") return "1/2-3/4";
  if (label === "1") return "1";
  if (["1 1/4", "1 1/2", "1 3/4", "2"].includes(label)) return "1 1/4-2";
  if (label === "2 1/2" || label === "3") return "2 1/2-3";
  return "3+";
}

interface Margins {
  races: number;
  buckets: Map<string, number>;
  spreads: number[];
  /** Winning margins (1st to 2nd) and 1st-to-3rd gaps, lengths. */
  wins: number[];
  top3: number[];
  favWins: number;
  /** Wins by the winner's tactic (front / stalker / closer). */
  styles: Map<string, number>;
  favRaces: number;
}
const blank = (): Margins => ({ races: 0, buckets: new Map(BUCKETS.map((b) => [b, 0])), spreads: [], wins: [], top3: [], favWins: 0, favRaces: 0, styles: new Map([["front", 0], ["stalker", 0], ["closer", 0]]) });

const PROBE = process.env.BAL_DRAMA_PROBE === "1";
const probeAt = [0.25, 0.5, 0.75, 0.9, 1];
const probeSpread = probeAt.map(() => 0);
const probeGap12 = probeAt.map(() => 0);
const probeTired = probeAt.map(() => 0);
let probeN = 0;
/** Leader-to-last and 1st-to-2nd gaps (lengths) when the leader reaches each checkpoint; share of runners under 10% energy. */
function probe(r: RaceReplay): void {
  const n = r.horses.length;
  const L = r.trackLengthMm;
  probeN++;
  let c = 0;
  for (const f of r.frames) {
    if (c >= probeAt.length) break;
    const xs = Array.from({ length: n }, (_, h) => f[h * 4]!);
    const lead = Math.max(...xs);
    if (lead < L * probeAt[c]! && c < probeAt.length - 1) continue;
    if (c === probeAt.length - 1 && lead < L) continue;
    const sorted = [...xs].sort((a, b) => b - a);
    probeSpread[c] += (sorted[0]! - sorted[n - 1]!) / HORSE_LENGTH_MM;
    probeGap12[c] += (sorted[0]! - sorted[1]!) / HORSE_LENGTH_MM;
    probeTired[c] += Array.from({ length: n }, (_, h) => f[h * 4 + 3]!).filter((e) => e < 100).length / n;
    c++;
  }
}

function tally(m: Margins, r: RaceReplay, marks: Map<string, number>): void {
  const fo = r.result.finishOrder;
  m.races++;
  const b = bucketOf(fo[1]!.marginLabel);
  m.buckets.set(b, m.buckets.get(b)! + 1);
  m.spreads.push(fo.reduce((s, f) => s + f.marginMm, 0) / HORSE_LENGTH_MM);
  m.wins.push(fo[1]!.marginMm / HORSE_LENGTH_MM);
  m.top3.push((fo[1]!.marginMm + fo[2]!.marginMm) / HORSE_LENGTH_MM);
  // Favourite: the highest mark (a share of a win when several tie at the top).
  const top = Math.max(...marks.values());
  const favs = [...marks.entries()].filter(([, v]) => v === top).map(([k]) => k);
  m.favRaces++;
  const tactic = r.horses.find((h) => h.horseId === fo[0]!.horseId)!.tactic;
  m.styles.set(tactic, (m.styles.get(tactic) ?? 0) + 1);
  if (favs.includes(fo[0]!.horseId)) m.favWins += 1 / favs.length;
}

const pct = (a: number, b: number): string => `${((100 * a) / Math.max(1, b)).toFixed(1)}`.padStart(5);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2 : 0;
};

it("drama report", async () => {
  const pool = Array.from({ length: POOL }, (_, i) => poolHorse(i));
  const rng = new Rng(`drama-report`);
  const even = blank();
  const hcp = blank();
  const mixed = blank();
  const identical = blank();
  const identicalHcp = blank();
  // Two ways to build a field: real mixed horses (stats other than ability differ, as in Live) and
  // identical horses (one horse cloned eight times, only ability differs). A Live OR is earned from
  // results, so it prices in the rest of a horse's make-up; ability marks alone don't, and the
  // mixed-horse upset numbers overstate how often a horse that much lower RATED wins.
  const kinds = ["mixed", "identical"] as const;
  const fieldOf = (race: Race, marks: number[], kind: (typeof kinds)[number]): Horse[] => {
    if (kind === "mixed") return race.states.map((h, i) => atMark(snapshot(h, race), marks[i]!));
    const base = snapshot(race.states[0]!, race);
    return race.states.map((h, i) => ({ ...atMark(base, marks[i]!), id: h.id, name: h.name }));
  };
  /** Banded level-weight fields: [wins, starts] by OR below the field's best runner, per kind. */
  const byDeficit = new Map<string, [number, number]>();

  for (let r = 0; r < RACES; r++) {
    if (r % 50 === 0) await yieldNow();
    // Even: all within 2 OR.
    {
      const race = drawRace(rng, pool);
      const base = rng.range(30, Math.min(85, TOP_OR - 2));
      const horses = race.states.map((h) => atMark(snapshot(h, race), base + rng.range(0, 2)));
      const marks = new Map(horses.map((h) => [h.id, abilityOrOf(abilityScore(h.stats, h.preferredDistanceM))]));
      const rep = run(race, horses, deriveSeed("drama-even", String(r)));
      if (PROBE) probe(rep);
      tally(even, rep, marks);
    }
    // Handicap and mixed: one 25-OR band, the same horses, gates and seed with and without weights.
    {
      const race = drawRace(rng, pool);
      const base = rng.range(30, Math.min(70, TOP_OR - 24));
      const bandMarks = race.states.map(() => base + rng.range(0, 24));
      const horses = fieldOf(race, bandMarks, "mixed");
      const marks = new Map(horses.map((h) => [h.id, abilityOrOf(abilityScore(h.stats, h.preferredDistanceM))]));
      const seed = deriveSeed("drama-band", String(r));
      const lb = new Map(handicapWeights(horses.map((h) => ({ horseId: h.id, or: marks.get(h.id)! })), true).map((w) => [w.horseId, w.extraLb]));
      const weighted = horses.map((h) => withWeight(h, lb.get(h.id) ?? 0));
      tally(hcp, run(race, weighted, seed), marks);
      const level = run(race, horses, seed);
      tally(mixed, level, marks);
      const clones = fieldOf(race, bandMarks, "identical");
      const cloneMarks = new Map(clones.map((h) => [h.id, abilityOrOf(abilityScore(h.stats, h.preferredDistanceM))]));
      const cloneRun = run(race, clones, seed);
      tally(identical, cloneRun, cloneMarks);
      const cloneLb = new Map(handicapWeights(clones.map((x) => ({ horseId: x.id, or: cloneMarks.get(x.id)! })), true).map((w) => [w.horseId, w.extraLb]));
      tally(identicalHcp, run(race, clones.map((x) => withWeight(x, cloneLb.get(x.id) ?? 0)), seed), cloneMarks);
      for (const [kind, replay, ms] of [["mixed", level, marks], ["identical", cloneRun, cloneMarks]] as const) {
        const best = Math.max(...ms.values());
        const winner = replay.result.finishOrder[0]!.horseId;
        for (const [id, m] of ms) {
          const key = `${kind}-${best - m}`;
          const x = byDeficit.get(key) ?? [0, 0];
          byDeficit.set(key, [x[0] + (id === winner ? 1 : 0), x[1] + 1]);
        }
      }
    }
  }

  // Lone horse: seven runners at M, one at M - d (its gate rotates).
  const lone = new Map<string, number>();
  for (const kind of kinds) {
    for (const d of DEFICITS) {
      let wins = 0;
      for (let k = 0; k < LONE_RACES; k++) {
        if (k % 50 === 0) await yieldNow();
        const race = drawRace(rng, pool);
        const M = rng.range(40, Math.min(85, TOP_OR));
        const slot = k % FIELD;
        const horses = fieldOf(race, race.states.map((_, i) => (i === slot ? M - d : M)), kind);
        if (run(race, horses, deriveSeed(`drama-lone-${d}`, String(k))).result.finishOrder[0]!.horseId === horses[slot]!.id) wins++;
      }
      lone.set(`${kind}-${d}`, wins / LONE_RACES);
    }
  }

  // Weight calibration: a horse d OR better carrying d lb more than seven equal rivals (identical
  // horses) should be back to an equal chance (1/8), if 1 lb really costs 1 OR.
  const weightCheck = new Map<number, [number, number]>();
  for (const d of [5, 10, 15]) {
    let carrying = 0;
    let level = 0;
    for (let k = 0; k < LONE_RACES; k++) {
      if (k % 50 === 0) await yieldNow();
      const race = drawRace(rng, pool);
      const M = rng.range(30, Math.min(80, TOP_OR - 15));
      const slot = k % FIELD;
      const horses = fieldOf(race, race.states.map((_, i) => (i === slot ? M + d : M)), "identical");
      const seed = deriveSeed(`drama-weight-${d}`, String(k));
      if (run(race, horses, seed).result.finishOrder[0]!.horseId === horses[slot]!.id) level++;
      if (run(race, horses.map((h, i) => (i === slot ? withWeight(h, d) : h)), seed).result.finishOrder[0]!.horseId === horses[slot]!.id) carrying++;
    }
    weightCheck.set(d, [carrying / LONE_RACES, level / LONE_RACES]);
  }

  // 68 vs 75 in otherwise even fields (six runners at 71-72).
  const h2h = new Map<string, { ahead: number; win68: number; win75: number }>();
  for (const kind of kinds) {
    const t = { ahead: 0, win68: 0, win75: 0 };
    for (let k = 0; k < H2H_RACES; k++) {
      if (k % 50 === 0) await yieldNow();
      const race = drawRace(rng, pool);
      const a = k % FIELD;
      const b = (k + 1 + (k % 7)) % FIELD;
      const horses = fieldOf(race, race.states.map((_, i) => (i === a ? 68 : i === b ? 75 : 71 + rng.range(0, 1))), kind);
      const fo = run(race, horses, deriveSeed("drama-h2h", String(k))).result.finishOrder;
      const pos = (id: string) => fo.find((f) => f.horseId === id)!.position;
      if (pos(horses[a]!.id) < pos(horses[b]!.id)) t.ahead++;
      if (fo[0]!.horseId === horses[a]!.id) t.win68++;
      if (fo[0]!.horseId === horses[b]!.id) t.win75++;
    }
    h2h.set(kind, t);
  }

  const lines = [
    `# Race drama (${LEGACY ? "BEFORE: the engine Live races ran before 1.4.0" : "as Live races run now"}): ${RACES} even fields, ${RACES} banded fields run with and without handicap weights, ${FIELD} runners`,
    "",
    "## Winning margin (1st to 2nd), % of races",
    `${"field".padEnd(10)} ${BUCKETS.map((b) => b.padStart(7)).join(" ")} | <=head  <=1L   >3L | win L mean/med | 1st-3rd L | spread mean/median (L) | fav win% | front/stalk/close win%`,
  ];
  const data: Record<string, unknown> = { legacy: LEGACY, races: RACES };
  const avg = (xs: number[]): number => xs.reduce((a, v) => a + v, 0) / Math.max(1, xs.length);
  for (const [name, m] of [["even", even], ["handicap", hcp], ["mixed", mixed], ["ident hcp", identicalHcp], ["identical", identical]] as const) {
    const n = m.races;
    const c = (b: string) => m.buckets.get(b)!;
    const photo = c("nose") + c("short head") + c("head");
    const upTo1 = photo + c("neck") + c("1/2-3/4") + c("1");
    const over3 = c("3+");
    const meanSpread = m.spreads.reduce((s, v) => s + v, 0) / Math.max(1, n);
    lines.push(
      `${name.padEnd(10)} ${BUCKETS.map((b) => pct(c(b), n).padStart(7)).join(" ")} | ${pct(photo, n)} ${pct(upTo1, n)} ${pct(over3, n)} | ${avg(m.wins).toFixed(2)} / ${median(m.wins).toFixed(2)} | ${avg(m.top3).toFixed(2).padStart(6)}    | ${meanSpread.toFixed(1).padStart(6)} / ${median(m.spreads).toFixed(1).padStart(5)}      | ${pct(m.favWins, m.favRaces)}    | ${["front", "stalker", "closer"].map((t) => pct(m.styles.get(t)!, n)).join(" ")}`,
    );
    data[name] = {
      races: n,
      buckets: Object.fromEntries([...m.buckets].map(([k, v]) => [k, v / n])),
      photoShare: photo / n,
      withinLengthShare: upTo1 / n,
      over3Share: over3 / n,
      spreadMeanL: meanSpread,
      spreadMedianL: median(m.spreads),
      winMarginMeanL: avg(m.wins),
      winMarginMedianL: median(m.wins),
      firstToThirdMeanL: avg(m.top3),
      favouriteWinShare: m.favWins / m.favRaces,
      styleWinShare: Object.fromEntries([...m.styles].map(([k, v]) => [k, v / n])),
    };
  }
  lines.push(
    "  (photo = a head or less; spread = leader to last at the line, lengths; fav = highest ability mark, ties share)",
    "  (handicap and mixed are the same 25-OR-band fields, gates and seeds with and without weights; ident hcp / identical: the same band with one horse cloned)",
  );
  lines.push("", "## Upsets", `Banded 25-OR fields at level weights: win % by OR below the field's best runner (1/8 = 12.5%)`);
  for (const kind of kinds) {
    const defRow = DEFICITS.map((d) => {
      const [w, n] = byDeficit.get(`${kind}-${d}`) ?? [0, 0];
      return `${String(d).padStart(2)} below: ${pct(w, n)}% (${n})`;
    });
    lines.push(`  ${kind.padEnd(9)} ${defRow.join("  ")}`);
  }
  for (const kind of kinds) {
    lines.push(`Lone horse d OR below seven equal rivals (${kind} horses): ${DEFICITS.map((d) => `${d}: ${(100 * lone.get(`${kind}-${d}`)!).toFixed(1)}%`).join("  ")}   (${LONE_RACES} races each)`);
  }
  lines.push(
    `Weights (1 lb = 1 OR): a horse d OR better than seven equal rivals wins ${[...weightCheck].map(([d, [w, l]]) => `d=${d}: ${(100 * w).toFixed(1)}% carrying ${d} lb (${(100 * l).toFixed(1)}% at level weights)`).join("; ")}   (1/8 = 12.5%)`,
  );
  data.weightCheck = Object.fromEntries([...weightCheck].map(([d, [w, l]]) => [d, { carrying: w, level: l }]));
  for (const kind of kinds) {
    const t = h2h.get(kind)!;
    lines.push(`68 vs 75 among six at 71-72 (${kind} horses): the 68 finishes ahead ${pct(t.ahead, H2H_RACES)}% of ${H2H_RACES}; wins the race ${pct(t.win68, H2H_RACES)}%, the 75 wins ${pct(t.win75, H2H_RACES)}%`);
  }
  data.byDeficit = Object.fromEntries(kinds.map((kind) => [kind, Object.fromEntries(DEFICITS.map((d) => [d, (byDeficit.get(`${kind}-${d}`)?.[0] ?? 0) / Math.max(1, byDeficit.get(`${kind}-${d}`)?.[1] ?? 0)]))]));
  data.lone = Object.fromEntries(lone);
  data.h2h68v75 = Object.fromEntries([...h2h].map(([k, t]) => [k, { ahead: t.ahead / H2H_RACES, win68: t.win68 / H2H_RACES, win75: t.win75 / H2H_RACES }]));
  lines.push(
    "",
    "Anchors: favourites win ~30-35% of flat races; UK flat handicaps are mostly decided by under a length, with photo finishes routine.",
    `Jockeys used: ${Object.keys(JOCKEYS).join(", ")} (75/15/10%); soft shoes on 30% of soft/heavy runners.`,
  );
  if (PROBE) {
    lines.push("", "## Probe (even fields): when the leader reaches 25/50/75/90/100% of the trip");
    lines.push(`  spread L: ${probeSpread.map((v) => (v / probeN).toFixed(1)).join(" ")}   1st-2nd L: ${probeGap12.map((v) => (v / probeN).toFixed(2)).join(" ")}   runners <10% energy: ${probeTired.map((v) => ((100 * v) / probeN).toFixed(0)).join(" ")}%`);
  }
  writeReport("drama", data, lines);
  expect(even.races).toBe(RACES);
});

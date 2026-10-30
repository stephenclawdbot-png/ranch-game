/**
 * Course character balance (racing-engine 1.3.0): each racecourse tilts races towards a type of
 * horse, never decides them.
 *   npx vitest run --config tools/balance/vitest.config.ts courses          # full run
 *   BAL_COURSE_RACES=300 npx vitest run --config tools/balance/vitest.config.ts courses   # quick look (noisier: the
 *     breed checks hold at the default 3000 races, about 3 minutes)
 *   BAL_COURSE_PROBES=1 ...   # also run one-effect probe courses (each effect on its own)
 *
 * The breeds report's pool (mature rare mints of every breed, at their peak) races 8-runner
 * fields fitted to the trip and surface, as players enter Live races (the breeds report's "fitted"
 * mode: its trips, surfaces and going), every runner on its natural style. Each field (same horses,
 * gates and seed) is run once on every course and once with no course, so the differences
 * between rows are the course alone (the engine's course effects don't depend on the surface,
 * so every course runs every surface here).
 *
 * Per course: the share of races won by running style (front / stalker / closer); by the field's
 * speediest horse (largest speed-over-stamina) and its stoutest (largest stamina-over-speed),
 * each fair at 1/8 = 12.5%; by draw (gates 1-3 vs 6-8); the mean winning time per km. Then each
 * breed's win rate per start over all course races (and with no course, for comparison).
 * Targets: the intended tilt shows (Kestrel Downs front-runners and low draws, Saltmarsh closers,
 * Harrowgate stamina, Bellmont and Larkspur speed); no style wins more than 50% or less than 10%
 * of races on any course; every breed wins 10-15% of its starts over all courses.
 */
import { expect, it } from "vitest";
import type { Going, RaceCourse, RunningStyle, Surface } from "@thoroughbred/shared";
import { simulateRace } from "../../packages/racing-engine/src/index";
import {
  BREEDS,
  BREED_LABEL,
  CARE_TO_RACING,
  COURSES,
  Rng,
  courseProfile,
  createHorseState,
  deriveSeed,
  generateFoundationGenome,
  preferredDistanceM,
  preferredSurface,
  raceSnapshot,
  runningStyle,
  type Breed,
  type HorseState,
} from "../../packages/game-core/src/index";
import { LIVE_MODEL, writeReport, yieldNow } from "./out";

const RACES = Number(process.env.BAL_COURSE_RACES ?? 3000);
const PROBES = process.env.BAL_COURSE_PROBES === "1";
const PER_BREED = 150;
const FIELD = 8;
const TRIPS = [1000, 1200, 1400, 1600, 2000, 2400, 2800];
const SURFACES: Surface[] = ["turf", "dirt", "synthetic"];
const GOINGS: Going[] = ["good", "good", "firm", "soft"];
const SILKS = { primary: "#112233", secondary: "#ffffff", pattern: "hoops", cap: "#aa0000" } as const;
const T0 = 1_800_000_000_000;
const STYLES: RunningStyle[] = ["front", "stalker", "closer"];

function horse(breed: Breed, i: number): HorseState {
  const genome = generateFoundationGenome(`breeds-${breed}-${i}`, { season: 1, rarity: "rare", breed });
  const h = createHorseState({ id: `${breed}-${i}`, name: `${breed} ${i}`.slice(0, 32), sex: i % 2 ? "colt" : "filly", ownerId: "bal", sireId: null, damId: null, generation: 0, genome, bornAtMs: T0, bornSeason: 1, careSessions: CARE_TO_RACING });
  // Mid-career and fully trained: every horse at its peak, so only genes differ.
  const full = { speed: 1000, stamina: 1000, burst: 1000, durability: 1000, adaptability: 1000, temperament: 1000 };
  return { ...h, career: { ...h.career, starts: 14 }, training: { ...h.training, realisation: full } };
}

interface Tally {
  races: number;
  styleWins: Record<RunningStyle, number>;
  speediestWins: number;
  stoutestWins: number;
  lowDrawWins: number;
  highDrawWins: number;
  breedWins: Map<Breed, number>;
  breedStarts: Map<Breed, number>;
  secPerKm: number;
}

const blank = (): Tally => ({
  races: 0,
  styleWins: { front: 0, stalker: 0, closer: 0 },
  speediestWins: 0,
  stoutestWins: 0,
  lowDrawWins: 0,
  highDrawWins: 0,
  breedWins: new Map(),
  breedStarts: new Map(),
  secPerKm: 0,
});

/** One-effect probe courses: a neutral course (no tightness, reference straight, flat) with one thing changed. */
function probes(): { key: string; label: string; course: RaceCourse }[] {
  const base: RaceCourse = { id: "probe", direction: "left", circumferenceM: 2400, homeStraightM: 500, bendsPerLap: 2, bendTightness: 0, finishGradientPermille: 0 };
  return [
    { key: "p-neutral", label: "probe neutral", course: base },
    { key: "p-tight", label: "probe tight850", course: { ...base, bendTightness: 850 } },
    { key: "p-short", label: "probe str300", course: { ...base, homeStraightM: 300 } },
    { key: "p-long", label: "probe str800", course: { ...base, homeStraightM: 800 } },
    { key: "p-up", label: "probe up+30", course: { ...base, finishGradientPermille: 30 } },
    { key: "p-down", label: "probe down-10", course: { ...base, finishGradientPermille: -10 } },
  ];
}

it("courses report", async () => {
  const pool = BREEDS.flatMap((b) => Array.from({ length: PER_BREED }, (_, i) => horse(b, i)));
  const breedOf = new Map(pool.map((h) => [h.id, h.id.split("-")[0] as Breed]));
  const variants: { key: string; label: string; course: RaceCourse | null; probe?: boolean }[] = [
    { key: "none", label: "(no course)", course: null },
    ...COURSES.map((c) => ({ key: c.id, label: c.name, course: courseProfile(c) })),
    ...(PROBES ? probes().map((p) => ({ ...p, probe: true })) : []),
  ];
  const tallies = new Map(variants.map((v) => [v.key, blank()]));
  const rng = new Rng("courses-report");

  for (let r = 0; r < RACES; r++) {
    const distanceM = rng.pick(TRIPS);
    const surface = rng.pick(SURFACES);
    const going: Going = surface === "synthetic" ? "good" : rng.pick(GOINGS);
    const fits = pool.filter((h) => Math.abs(preferredDistanceM(h.genome) - distanceM) <= 300 && [surface, "synthetic"].includes(preferredSurface(h.genome)));
    if (fits.length < FIELD) continue;
    const runners: HorseState[] = [];
    while (runners.length < FIELD) {
      const h = rng.pick(fits);
      if (!runners.includes(h)) runners.push(h);
    }
    const entries = runners.map((h, i) => {
      const snap = raceSnapshot(h, { nowMs: T0, silks: SILKS, race: { going, fieldSize: FIELD, bigCrowd: false, surface, distanceM }, plan: { tactic: runningStyle(h.genome), intensity: "normal" } }).horse;
      return { gate: i + 1, tactic: snap.style, horse: snap };
    });
    const tilt = (e: (typeof entries)[number]) => e.horse.stats.speed - e.horse.stats.stamina;
    const speediest = entries.reduce((a, b) => (tilt(b) > tilt(a) ? b : a)).horse.id;
    const stoutest = entries.reduce((a, b) => (tilt(b) < tilt(a) ? b : a)).horse.id;
    const seed = deriveSeed("courses-report", String(r));
    for (const v of variants) {
      const t = tallies.get(v.key)!;
      // The same field, gates and seed on every course (and none): the rows differ by the course alone.
      const replay = simulateRace({
        race: { id: `cr-${r}`, name: "Courses", distanceM, surface, weather: "clear", going, raceClass: "listed", postTimeMs: T0, purse: 0 },
        ...(v.course ? { course: v.course } : {}),
        entries,
        seed,
        ...LIVE_MODEL,
      });
      const winnerId = replay.result.finishOrder[0]!.horseId;
      const winner = entries.find((e) => e.horse.id === winnerId)!;
      t.races++;
      t.secPerKm += replay.result.winningTimeUs / 1000 / distanceM;
      t.styleWins[winner.tactic]++;
      if (winnerId === speediest) t.speediestWins++;
      if (winnerId === stoutest) t.stoutestWins++;
      if (winner.gate <= 3) t.lowDrawWins++;
      if (winner.gate >= FIELD - 2) t.highDrawWins++;
      for (const e of entries) {
        const b = breedOf.get(e.horse.id)!;
        t.breedStarts.set(b, (t.breedStarts.get(b) ?? 0) + 1);
        if (e.horse.id === winnerId) t.breedWins.set(b, (t.breedWins.get(b) ?? 0) + 1);
      }
    }
    if (r % 20 === 0) await yieldNow();
  }

  const pct = (x: number, of: number) => ((100 * x) / Math.max(1, of)).toFixed(1).padStart(5);
  const lines = [`# Course character: % of races won, ${tallies.get("none")!.races} fitted ${FIELD}-runner fields, the same fields on every course`];
  lines.push(`${"course".padEnd(15)} front stalk close | speediest stoutest | gate1-3 gate6-8 | s/km`);
  const data: Record<string, unknown> = {};
  for (const v of variants) {
    const t = tallies.get(v.key)!;
    lines.push(
      `${v.label.padEnd(15)} ${STYLES.map((s) => pct(t.styleWins[s], t.races)).join(" ")} |   ${pct(t.speediestWins, t.races)}    ${pct(t.stoutestWins, t.races)} |   ${pct(t.lowDrawWins, t.races)}   ${pct(t.highDrawWins, t.races)} | ${(t.secPerKm / Math.max(1, t.races)).toFixed(2)}`,
    );
    data[v.key] = {
      races: t.races,
      styleWinShare: Object.fromEntries(STYLES.map((s) => [s, t.styleWins[s] / t.races])),
      speediestWinShare: t.speediestWins / t.races,
      stoutestWinShare: t.stoutestWins / t.races,
      lowDrawWinShare: t.lowDrawWins / t.races,
      highDrawWinShare: t.highDrawWins / t.races,
    };
    if (v.course && !v.probe) {
      for (const s of STYLES) {
        expect.soft(t.styleWins[s] / t.races, `${v.label} ${s} win share`).toBeGreaterThanOrEqual(0.1);
        expect.soft(t.styleWins[s] / t.races, `${v.label} ${s} win share`).toBeLessThanOrEqual(0.5);
      }
    }
  }

  lines.push("", `# Breed win rate per start over all six courses (1/8 = 12.5%; target 10-15%), with no course, and by course (${variants.filter((v) => v.course).map((v) => v.label.split(" ").slice(0, v.probe ? 2 : 1).join(" ")).join(", ")})`);
  const breedRates: Record<string, { courses: number; none: number }> = {};
  const none = tallies.get("none")!;
  for (const b of BREEDS) {
    let w = 0;
    let s = 0;
    for (const v of variants) {
      if (!v.course || v.probe) continue;
      w += tallies.get(v.key)!.breedWins.get(b) ?? 0;
      s += tallies.get(v.key)!.breedStarts.get(b) ?? 0;
    }
    const nw = none.breedWins.get(b) ?? 0;
    const ns = none.breedStarts.get(b) ?? 0;
    breedRates[b] = { courses: w / Math.max(1, s), none: nw / Math.max(1, ns) };
    expect.soft(w / Math.max(1, s), `${BREED_LABEL[b]} win rate over the courses`).toBeGreaterThanOrEqual(0.1);
    expect.soft(w / Math.max(1, s), `${BREED_LABEL[b]} win rate over the courses`).toBeLessThanOrEqual(0.15);
    const perCourse = variants.filter((v) => v.course).map((v) => pct(tallies.get(v.key)!.breedWins.get(b) ?? 0, tallies.get(v.key)!.breedStarts.get(b) ?? 0));
    lines.push(`${BREED_LABEL[b].padEnd(14)} ${pct(w, s)}%   (no course ${pct(nw, ns)}%, ${ns} starts per course)  by course ${perCourse.join(" ")}`);
  }
  data.breeds = breedRates;
  writeReport("courses", data, lines);
});

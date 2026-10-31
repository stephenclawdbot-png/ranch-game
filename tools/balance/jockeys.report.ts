/**
 * Jockeys: what the worst, a median and the best jockey are worth to the same horse.
 *   npx vitest run --config tools/balance/vitest.config.ts jockeys
 *   BAL_JOCKEY_RACES=600 npx vitest run --config tools/balance/vitest.config.ts jockeys   # quick look
 *
 * Even 8-runner Live fields (engine 1.4.0 close-finish model, a course from courses.ts, trips
 * 1000-2400 m, every going): seven rivals and the test horse all have the same ability give or take
 * a little, every rival rides a median (C, all skills 500) jockey. The test horse runs the same
 * seeds with an E (all skills 150: a raw apprentice), the median and an A (all skills 900: the
 * best the generator makes) jockey. For scale it also runs with the median jockey carrying
 * 1..4 lb less than its rivals (ability.ts carryWeight: 1 lb = 1 OR), so the jockey effect can be
 * read in OR. Target (docs/design/jockeys.md): best vs worst about 2-3 OR in total.
 */
import { expect, it } from "vitest";
import type { Going, RaceInput, RaceKit, RunningStyle, Surface } from "@thoroughbred/shared";
import { simulateRace } from "../../packages/racing-engine/src/index";
import { COURSES, carryWeight, courseProfile, jockeyKit, type JockeySkills } from "../../packages/game-core/src/index";
import { LIVE_MODEL, writeReport, yieldNow } from "./out";

const RACES = Number(process.env.BAL_JOCKEY_RACES ?? 3000);
const FIELD = 8;
const TRIPS = [1000, 1200, 1400, 1600, 2000, 2400];
const GOINGS: Going[] = ["good", "good", "firm", "soft", "heavy"];
const SURFACES: Surface[] = ["turf", "dirt", "synthetic"];
const STYLES: RunningStyle[] = ["front", "stalker", "closer"];
const SILKS = { primary: "#112233", secondary: "#ffffff", pattern: "hoops", cap: "#aa0000" } as const;
const all = (v: number): JockeySkills => ({ gate: v, pace: v, finish: v, handling: v });
const RIDERS = { worst: all(150), median: all(500), best: all(900) } as const;

function seedHex(k: number): string {
  let out = "";
  let x = (k * 2654435761 + 977) >>> 0;
  for (let i = 0; i < 8; i++) {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    x = (x ^ (x >>> 12)) >>> 0;
    out += x.toString(16).padStart(8, "0");
  }
  return out;
}

function race(k: number, testKit: RaceKit, testLighterLb: number): RaceInput {
  const trip = TRIPS[k % TRIPS.length]!;
  const surface = SURFACES[(k >> 3) % 3]!;
  const going = GOINGS[(k >> 1) % GOINGS.length]!;
  const course = COURSES[k % COURSES.length]!;
  const median = jockeyKit(RIDERS.median);
  const entries = Array.from({ length: FIELD }, (_, i) => {
    const style = STYLES[(i + k) % 3]!;
    const wobble = ((i * 37 + k * 11) % 7) * 6 - 18; // ±18 stat points: a few OR either way
    let stats = { speed: 650 + wobble, stamina: 650 - Math.trunc(wobble / 2), burst: 650 + Math.trunc(wobble / 3), durability: 640, adaptability: 600, temperament: 450 + ((i * 53 + k) % 9) * 50 };
    const isTest = i === k % FIELD;
    if (isTest) stats = { speed: 650, stamina: 650, burst: 650, durability: 640, adaptability: 600, temperament: 550 };
    // Rivals carry the extra lb when the test horse runs lighter.
    if (!isTest && testLighterLb > 0) stats = { ...carryWeight(stats, trip, testLighterLb) };
    return {
      gate: i + 1,
      tactic: style,
      kit: isTest ? { ...testKit } : { ...median },
      horse: {
        id: isTest ? "test" : `r${i}`,
        name: isTest ? "Test" : `Rival ${i}`,
        sex: "colt" as const,
        age: 4,
        stage: "prime" as const,
        generation: 1,
        ownerId: "o",
        sireId: null,
        damId: null,
        stats,
        preferredDistanceM: trip,
        preferredSurface: surface,
        style,
        appearance: { coat: "bay", face: "none", legs: ["none", "none", "none", "none"], silks: SILKS },
        record: { starts: 5, wins: 1, places: 1, shows: 1, earnings: 0 },
      },
    };
  });
  return {
    race: { id: `jk-${k}`, name: "Jockey test", distanceM: trip, surface, weather: going === "soft" || going === "heavy" ? "rain" : "clear", going, raceClass: "handicap", postTimeMs: 1_800_000_000_000, purse: 2_000 },
    course: courseProfile({ ...course, surface }),
    ...LIVE_MODEL,
    entries,
    seed: seedHex(k),
  } as RaceInput;
}

interface Tally { wins: number; posSum: number; slow: number }

async function run(label: string, kit: RaceKit, lighter = 0): Promise<Tally & { label: string }> {
  const t: Tally = { wins: 0, posSum: 0, slow: 0 };
  for (let k = 0; k < RACES; k++) {
    const r = simulateRace(race(k, kit, lighter));
    const pos = r.result.finishOrder.find((f) => f.horseId === "test")!.position;
    if (pos === 1) t.wins++;
    t.posSum += pos;
    if (r.events.some((e) => e.type === "slow_start" && e.horseId === "test")) t.slow++;
    if (k % 200 === 0) await yieldNow();
  }
  return { label, ...t };
}

it("jockeys: worst vs median vs best, read in OR", async () => {
  const median = jockeyKit(RIDERS.median);
  const rows = [
    await run("worst (E, 150)", jockeyKit(RIDERS.worst)),
    await run("median (C, 500)", median),
    await run("best (A, 900)", jockeyKit(RIDERS.best)),
    ...(await Promise.all([1, 2, 3, 4].map((lb) => run(`median, ${lb} lb lighter`, median, lb)))),
  ];
  const pct = (x: number) => ((100 * x) / RACES).toFixed(1);
  const base = rows[1]!;
  // Win-rate points per lb from the weight runs (least squares through the median point).
  const lbRows = rows.slice(3);
  let num = 0;
  let den = 0;
  lbRows.forEach((r, i) => {
    num += (i + 1) * (r.wins - base.wins);
    den += (i + 1) * (i + 1);
  });
  const winsPerLb = num / den;
  const orOf = (r: Tally) => (r.wins - base.wins) / winsPerLb;
  const posPerLb = lbRows.reduce((a, r, i) => a + (i + 1) * (base.posSum - r.posSum), 0) / den;
  const orByPos = (r: Tally) => (base.posSum - r.posSum) / posPerLb;
  const lines = [
    `Jockeys: same horse, 8-runner even Live fields, ${RACES} races each (rivals ride a median jockey)`,
    "",
    "rider                      win %   mean pos   slow starts   ≈ OR (wins)   ≈ OR (mean pos)",
    ...rows.map((r) => `${r.label.padEnd(26)} ${pct(r.wins).padStart(5)}   ${(r.posSum / RACES).toFixed(2).padStart(8)}   ${pct(r.slow).padStart(10)}%   ${orOf(r).toFixed(2).padStart(10)}   ${orByPos(r).toFixed(2).padStart(14)}`),
    "",
    `1 lb ≈ ${((100 * winsPerLb) / RACES).toFixed(2)} win-% points here.`,
    `best vs worst ≈ ${(orOf(rows[2]!) - orOf(rows[0]!)).toFixed(2)} OR by wins, ${(orByPos(rows[2]!) - orByPos(rows[0]!)).toFixed(2)} OR by mean position (target 2-3).`,
  ];
  writeReport("jockeys", { races: RACES, rows, winsPerLb }, lines);
  expect(rows[2]!.wins).toBeGreaterThan(rows[0]!.wins);
});

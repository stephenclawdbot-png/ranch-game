import { describe, expect, it } from "vitest";
import { RaceInputSchema, LIVE_RACE_MODEL } from "@thoroughbred/shared";
import { simulateRace } from "../../racing-engine/src/index";
import { COURSES } from "./courses";
import { JOCKEY_GRADE_FLOORS, jockeyGradeOf } from "./jockeys";
import {
  DAILY_CHALLENGE_FIELD,
  DAILY_POINTS_TAKING_PART,
  QUICK_RIDER_SKILLS,
  QUICK_TRIPS,
  dailyChallengeHorse,
  dailyChallengeInput,
  dailyChallengeSpec,
  dailyHorseId,
  dailyPoints,
  dailyStreak,
  dailyTopCut,
  dailyWeightLb,
  DAILY_RIDER_CLAIM_LB,
  DAILY_TOP_WEIGHT_LB,
  drawGates,
  matchTally,
  quickConditionsError,
  quickRaceBlock,
  quickRaceInput,
  rankDaily,
  type DailyChoice,
} from "./quickRaces";
import { clubRunner } from "./field";

const SEED = "ab".repeat(32);
const SEED2 = "cd".repeat(32);

describe("quick race conditions", () => {
  it("accepts a course's own surfaces and the race trips only", () => {
    const ash = COURSES.find((c) => c.id === "ashcombe")!;
    expect(quickConditionsError({ courseId: ash.id, distanceM: 1600, surface: ash.surfaces[0]!, going: "good" })).toBeNull();
    expect(quickConditionsError({ courseId: "saltmarsh", distanceM: 1600, surface: "dirt", going: "good" })).toMatch(/doesn't race on dirt/);
    expect(quickConditionsError({ courseId: "ashcombe", distanceM: 1650, surface: "turf", going: "good" })).toMatch(/trip/);
    expect(quickConditionsError({ courseId: "nowhere" as never, distanceM: 1600, surface: "turf", going: "good" })).toMatch(/course/);
    expect(quickConditionsError({ courseId: "bellmont", distanceM: 1600, surface: "synthetic", going: "soft" })).toMatch(/all-weather/);
    expect(QUICK_TRIPS).toContain(1000);
    expect(QUICK_TRIPS).toContain(3200);
  });

  it("draws gates 1..n from the seed, the same every time", () => {
    const g = drawGates(SEED, 4);
    expect([...g].sort()).toEqual([1, 2, 3, 4]);
    expect(drawGates(SEED, 4)).toEqual(g);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(drawGates(i.toString(16).padStart(64, "0"), 4).join(""));
    expect(seen.size).toBeGreaterThan(3);
  });

  it("builds a valid current-model input with a course profile", () => {
    const runners = [0, 1].map((i) => ({ horse: clubRunner(SEED, { id: `h${i}`, strength: 500, distanceM: 1600, surface: "turf" }), tactic: "stalker" as const }));
    const input = quickRaceInput({ id: "m1", name: "Match race", conditions: { courseId: "ashcombe", distanceM: 1600, surface: "turf", going: "soft" }, runners, seed: SEED, postTimeMs: 0 });
    expect(RaceInputSchema.safeParse(input).success).toBe(true);
    expect(input.model).toBe(LIVE_RACE_MODEL);
    expect(input.course?.id).toBe("ashcombe");
    expect(input.race.weather).toBe("overcast");
    expect(input.race.purse).toBe(0);
    const replay = simulateRace(input);
    expect(replay.engineVersion).toBe("1.4.0");
    expect(replay.result.finishOrder).toHaveLength(2);
  });

  it("rides the typical freelancer of each grade inside the grade's band", () => {
    for (const [g, skills] of Object.entries(QUICK_RIDER_SKILLS)) {
      for (const v of Object.values(skills)) expect(jockeyGradeOf(v)).toBe(g);
    }
    expect(JOCKEY_GRADE_FLOORS.length).toBe(5);
  });
});

describe("who can run a quick race", () => {
  it("any racing horse of racing age, even one at its career's 40 starts; never a retired one", () => {
    const h = dailyChallengeSpec(20_760).horse;
    expect(quickRaceBlock(h, 0)).toBeNull();
    expect(quickRaceBlock({ ...h, career: { ...h.career, starts: 40 } }, 0)).toBeNull();
    expect(quickRaceBlock({ ...h, career: { ...h.career, pastured: true } }, 0)).toBe("retired");
  });
});

describe("the daily challenge", () => {
  const day = 20_760;
  const choice: DailyChoice = { tactic: "stalker", intensity: "normal", grade: "C" };

  it("is the same puzzle for everyone on a day, and a different one the next", () => {
    const a = dailyChallengeSpec(day);
    const b = dailyChallengeSpec(day);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.rivals).toHaveLength(DAILY_CHALLENGE_FIELD - 1);
    const gates = [a.gate, ...a.rivals.map((r) => r.gate)].sort((x, y) => x - y);
    expect(gates).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a.horse.id).toBe(dailyHorseId(day));
    expect(COURSES.find((c) => c.id === a.conditions.courseId)!.surfaces).toContain(a.conditions.surface);
    expect(quickConditionsError(a.conditions)).toBeNull();
    const c = dailyChallengeSpec(day + 1);
    expect(JSON.stringify(c.rivals)).not.toBe(JSON.stringify(a.rivals));
    expect(a.closesAtMs - a.opensAtMs).toBe(86_400_000);
  });

  it("an attempt is deterministic in (day, choice, seed): same choice, same result", () => {
    const spec = dailyChallengeSpec(day);
    const input = dailyChallengeInput(spec, choice, SEED);
    expect(RaceInputSchema.safeParse(input).success).toBe(true);
    const r1 = simulateRace(input);
    const r2 = simulateRace(dailyChallengeInput(dailyChallengeSpec(day), choice, SEED));
    expect(r2.result.resultHash).toBe(r1.result.resultHash);
    expect(r1.result.finishOrder).toHaveLength(DAILY_CHALLENGE_FIELD);
  });

  it("only the player's three choices differ between attempts; the rivals and the luck do not", () => {
    const spec = dailyChallengeSpec(day);
    const a = dailyChallengeInput(spec, choice, SEED);
    const b = dailyChallengeInput(spec, { tactic: "closer", intensity: "all_out", grade: "A" }, SEED);
    const rivalsOf = (x: typeof a) => x.entries.filter((e) => e.horse.id !== dailyHorseId(day));
    expect(JSON.stringify(rivalsOf(b))).toBe(JSON.stringify(rivalsOf(a)));
    expect(b.seed).toBe(a.seed);
    const mine = (x: typeof a) => x.entries.find((e) => e.horse.id === dailyHorseId(day))!;
    expect(mine(b).gate).toBe(mine(a).gate);
    expect(mine(b).tactic).toBe("closer");
    expect(mine(b).kit).not.toEqual(mine(a).kit);
    // Riding all out (same rider, so the same weight) lifts the burst.
    expect(dailyChallengeHorse(spec, { tactic: "closer", intensity: "all_out", grade: "C" }).stats.burst).toBeGreaterThan(mine(a).horse.stats.burst);
    // A different seed is different luck.
    expect(simulateRace(dailyChallengeInput(spec, choice, SEED2)).result.resultHash).not.toBe(simulateRace(a).result.resultHash);
  });
});

describe("the daily challenge rider's weight", () => {
  it("a better rider carries more weight: A the full top weight, E nothing", () => {
    expect(dailyWeightLb("A")).toBe(DAILY_TOP_WEIGHT_LB);
    expect(dailyWeightLb("E")).toBe(Math.max(0, DAILY_TOP_WEIGHT_LB - DAILY_RIDER_CLAIM_LB.E));
    const grades = ["A", "B", "C", "D", "E"] as const;
    for (let i = 1; i < grades.length; i++) expect(dailyWeightLb(grades[i]!)).toBeLessThanOrEqual(dailyWeightLb(grades[i - 1]!));
    const spec = dailyChallengeSpec(20_760);
    const a = dailyChallengeInput(spec, { tactic: "stalker", intensity: "normal", grade: "A" }, SEED);
    const e = dailyChallengeInput(spec, { tactic: "stalker", intensity: "normal", grade: "E" }, SEED);
    const mine = (x: typeof a) => x.entries.find((r) => r.horse.id === dailyHorseId(20_760))!;
    expect(mine(a).horse.stats.speed).toBeLessThanOrEqual(mine(e).horse.stats.speed);
  });
});

describe("daily challenge standings", () => {
  it("ranks by position, then time, then who went first; the best tenth gets the badge", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ key: `s${i}`, position: (i % 8) + 1, finishTimeUs: 100_000_000 + i * 1000, atMs: i }));
    const ranked = rankDaily(rows);
    expect(ranked[0]!.position).toBe(1);
    expect(ranked[0]!.key).toBe("s0");
    expect(ranked[1]!.key).toBe("s8");
    expect(ranked.filter((r) => r.top).map((r) => r.key)).toEqual(["s0", "s8"]);
    expect(rankDaily([{ key: "solo", position: 5, finishTimeUs: 1, atMs: 0 }])[0]!.top).toBe(true);
    expect([0, 1, 9, 10, 19, 20, 100].map(dailyTopCut)).toEqual([0, 1, 1, 1, 1, 2, 10]);
    expect(dailyPoints(1)).toBe(10);
    expect(dailyPoints(4)).toBe(3);
    expect(dailyPoints(8)).toBe(DAILY_POINTS_TAKING_PART);
  });

  it("counts a streak without losing it before today is over", () => {
    expect(dailyStreak([], 100)).toEqual({ current: 0, best: 0 });
    expect(dailyStreak([98, 99], 100)).toEqual({ current: 2, best: 2 });
    expect(dailyStreak([98, 99, 100], 100)).toEqual({ current: 3, best: 3 });
    expect(dailyStreak([90, 91, 92, 93, 99], 100)).toEqual({ current: 1, best: 4 });
    expect(dailyStreak([97], 100)).toEqual({ current: 0, best: 1 });
  });

  it("tallies a head-to-head", () => {
    expect(matchTally([{ a: 1, b: 2 }, { a: 3, b: 1 }, { a: 1, b: 4 }])).toEqual({ a: 2, b: 1, meetings: 3 });
  });
});

import { describe, expect, it } from "vitest";
import {
  APPRENTICE_CLAIMS,
  JOCKEYS_PER_STABLE_MAX,
  JOCKEY_CAREER_WEEKS,
  JOCKEY_FREELANCE_PRICE,
  JOCKEY_PERSONALITIES,
  JOCKEY_SCOUT_RIDES,
  JOCKEY_SKILLS,
  apprenticeClaimLb,
  canHoldAnother,
  declineSkills,
  freelanceFee,
  generateApprentice,
  generateSeasonedJockey,
  growSkills,
  jockeyCardName,
  jockeyGrade,
  jockeyGradeOf,
  jockeyIntake,
  jockeyKit,
  jockeyName,
  jockeyPoolTarget,
  jockeyRetireAt,
  jockeyStageAt,
  potentialLabel,
  potentialRange,
  retirementAnnouncedAt,
  rideExperience,
  ridesClash,
  signingFee,
  type JockeySkills,
} from "./jockeys";
import { JOCKEYS, raceDayPrice, parseRaceDay, hasRaceDay } from "./raceDay";
import { MS_PER_DAY } from "./time";

const all = (v: number): JockeySkills => ({ gate: v, pace: v, finish: v, handling: v });
const WEEK = 7 * MS_PER_DAY;

describe("grades and claims", () => {
  it("grades A-E on the overall mean", () => {
    expect(jockeyGradeOf(800)).toBe("A");
    expect(jockeyGradeOf(600)).toBe("B");
    expect(jockeyGradeOf(450)).toBe("C");
    expect(jockeyGradeOf(300)).toBe("D");
    expect(jockeyGradeOf(0)).toBe("E");
    expect(jockeyGrade({ gate: 900, pace: 700, finish: 600, handling: 800 })).toBe("A");
  });
  it("apprentices claim 7/5/3 lb until 10/25/50 winners", () => {
    expect(APPRENTICE_CLAIMS.map((c) => c.lb)).toEqual([7, 5, 3]);
    expect(apprenticeClaimLb(0)).toBe(7);
    expect(apprenticeClaimLb(9)).toBe(7);
    expect(apprenticeClaimLb(10)).toBe(5);
    expect(apprenticeClaimLb(24)).toBe(5);
    expect(apprenticeClaimLb(25)).toBe(3);
    expect(apprenticeClaimLb(49)).toBe(3);
    expect(apprenticeClaimLb(50)).toBe(0);
  });
  it("racecard name with claim", () => {
    expect(jockeyCardName("Tom Ashby", 5)).toBe("T. Ashby (5)");
    expect(jockeyCardName("Tom Ashby")).toBe("T. Ashby");
  });
  it("potential range narrows with rides and always contains the truth", () => {
    for (let k = 0; k < 50; k++) {
      const seed = `s${k}`;
      const j = generateApprentice(seed);
      const r0 = potentialRange(j.skills.gate, j.potential.gate, 0, seed, "gate");
      const r1 = potentialRange(j.skills.gate, j.potential.gate, 30, seed, "gate");
      const r2 = potentialRange(j.skills.gate, j.potential.gate, JOCKEY_SCOUT_RIDES, seed, "gate");
      expect(r0.lo).toBeLessThanOrEqual(j.potential.gate);
      expect(r0.hi).toBeGreaterThanOrEqual(j.potential.gate);
      expect(r1.hi - r1.lo).toBeLessThanOrEqual(r0.hi - r0.lo);
      expect(r2.lo).toBe(j.potential.gate);
      expect(r2.hi).toBe(j.potential.gate);
      expect(potentialLabel(r2)).toBe(r2.loGrade);
    }
  });
});

describe("growth and decline", () => {
  it("bigger, stronger races teach more", () => {
    expect(rideExperience({ purse: 6_000, fieldMeanOr: 90 })).toBeGreaterThan(rideExperience({ purse: 1_000, fieldMeanOr: 40 }));
    expect(rideExperience({ purse: 0, fieldMeanOr: 0 })).toBe(10);
    expect(rideExperience({ purse: 1e9, fieldMeanOr: 140 })).toBe(40);
  });
  it("moves towards potential, fast early and slow near the ceiling, never past it", () => {
    const pot = all(800);
    const early = growSkills(all(200), pot, 20).gate - 200;
    const late = growSkills(all(780), pot, 20).gate - 780;
    expect(early).toBeGreaterThan(late);
    expect(late).toBeGreaterThanOrEqual(1);
    let s = all(200);
    for (let i = 0; i < 2000; i++) s = growSkills(s, pot, 25);
    expect(s).toEqual(pot);
    expect(growSkills(pot, pot, 25)).toEqual(pot);
  });
  it("veterans decline, pace judgement holds", () => {
    const d = declineSkills(all(700), all(750));
    expect(700 - d.skills.gate).toBeGreaterThan(700 - d.skills.pace);
    expect(d.skills.pace).toBeGreaterThanOrEqual(690);
    for (const k of JOCKEY_SKILLS) expect(d.skills[k]).toBeLessThanOrEqual(d.potential[k]);
  });
});

describe("career", () => {
  it("apprentice 4 weeks, prime 12, veteran 4-8, retirement announced 2 weeks ahead", () => {
    const born = 1_800_000_000_000;
    expect(jockeyStageAt(born, born + 3 * WEEK)).toBe("apprentice");
    expect(jockeyStageAt(born, born + 4 * WEEK)).toBe("prime");
    expect(jockeyStageAt(born, born + 16 * WEEK)).toBe("veteran");
    const weeks = new Set<number>();
    for (let k = 0; k < 200; k++) {
      const w = (jockeyRetireAt(born, `r${k}`) - born) / WEEK;
      expect(w).toBeGreaterThanOrEqual(4 + 12 + JOCKEY_CAREER_WEEKS.veteranMin);
      expect(w).toBeLessThanOrEqual(4 + 12 + JOCKEY_CAREER_WEEKS.veteranMax);
      weeks.add(w);
    }
    expect(weeks.size).toBe(5);
    expect(retirementAnnouncedAt(born + 20 * WEEK)).toBe(born + 18 * WEEK);
  });
});

describe("supply", () => {
  it("targets 1.5 per active stable and tops up the shortfall only", () => {
    expect(jockeyPoolTarget(50)).toBe(75);
    expect(jockeyPoolTarget(5000)).toBe(7500);
    expect(jockeyPoolTarget(3)).toBe(5);
    expect(jockeyIntake(50, 70)).toBe(5);
    expect(jockeyIntake(50, 90)).toBe(0);
    expect(jockeyIntake(0, 10)).toBe(0);
  });
  it("max 3 per stable; rides 10 minutes apart", () => {
    expect(JOCKEYS_PER_STABLE_MAX).toBe(3);
    expect(canHoldAnother(2)).toBe(true);
    expect(canHoldAnother(3)).toBe(false);
    expect(ridesClash(0, 9 * 60_000)).toBe(true);
    expect(ridesClash(0, 10 * 60_000)).toBe(false);
  });
});

describe("fees", () => {
  it("a C freelancer costs the old journeyman, an A the old top jockey", () => {
    for (const purse of [0, 1_000, 2_500, 16_000, 100_000]) {
      expect(freelanceFee("C", purse)).toBe(raceDayPrice(JOCKEYS.journeyman.price, purse));
      expect(freelanceFee("A", purse)).toBe(raceDayPrice(JOCKEYS.top.price, purse));
    }
    expect(freelanceFee("E", 2_000)).toBeLessThan(freelanceFee("D", 2_000));
    expect(JOCKEY_FREELANCE_PRICE.B.purseBps).toBeGreaterThan(JOCKEY_FREELANCE_PRICE.C.purseBps);
    expect(signingFee("A")).toBeGreaterThan(signingFee("E"));
  });
});

describe("kit mapping", () => {
  it("worst jockey = neutral on cost shares, best = the published caps", () => {
    expect(jockeyKit(all(0))).toEqual({ slowStartPermille: 1000, drainPermille: 1000, battlePermille: 700, formAmpPermille: 1000, keenPermille: 1000 });
    expect(jockeyKit(all(1000))).toEqual({ slowStartPermille: 500, drainPermille: 960, battlePermille: 1000, formAmpPermille: 780, keenPermille: 450 });
  });
  it("a C-grade rider handles about like the old journeyman, an A like the old top jockey", () => {
    const c = jockeyKit(all(500));
    const a = jockeyKit(all(850));
    expect(Math.abs(c.formAmpPermille - JOCKEYS.journeyman.formAmpPermille)).toBeLessThanOrEqual(20);
    expect(Math.abs(c.keenPermille - JOCKEYS.journeyman.keenPermille)).toBeLessThanOrEqual(30);
    expect(Math.abs(a.formAmpPermille - JOCKEYS.top.formAmpPermille)).toBeLessThanOrEqual(20);
    expect(Math.abs(a.keenPermille - JOCKEYS.top.keenPermille)).toBeLessThanOrEqual(40);
  });
  it("is monotone in each skill and clamps out-of-range skills", () => {
    expect(jockeyKit(all(-50))).toEqual(jockeyKit(all(0)));
    expect(jockeyKit(all(2000))).toEqual(jockeyKit(all(1000)));
    const lo = jockeyKit(all(300));
    const hi = jockeyKit(all(700));
    expect(hi.slowStartPermille).toBeLessThan(lo.slowStartPermille);
    expect(hi.drainPermille).toBeLessThan(lo.drainPermille);
    expect(hi.battlePermille).toBeGreaterThan(lo.battlePermille);
  });
});

describe("generation", () => {
  it("is deterministic, varied, British-sounding and within bounds", () => {
    expect(generateApprentice("x")).toEqual(generateApprentice("x"));
    const names = new Set<string>();
    const personalities = new Set<string>();
    const grades = new Map<string, number>();
    for (let k = 0; k < 300; k++) {
      const j = generateApprentice(`seed-${k}`);
      names.add(j.name);
      personalities.add(j.personality);
      for (const s of JOCKEY_SKILLS) {
        expect(j.skills[s]).toBeLessThanOrEqual(j.potential[s]);
        expect(j.potential[s]).toBeGreaterThanOrEqual(400);
        expect(j.potential[s]).toBeLessThanOrEqual(950);
      }
      const g = jockeyGrade(j.potential);
      grades.set(g, (grades.get(g) ?? 0) + 1);
    }
    expect(names.size).toBeGreaterThan(250);
    expect(personalities.size).toBe(JOCKEY_PERSONALITIES.length);
    // Most top out C-B, a few A prospects.
    expect((grades.get("A") ?? 0) / 300).toBeLessThan(0.3);
    expect((grades.get("A") ?? 0)).toBeGreaterThan(0);
    expect(jockeyName("abc")).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
  it("seasoned pool jockeys have grown, and carry a winners tally out of their claim", () => {
    const j = generateSeasonedJockey("pool-1", 10);
    const a = generateApprentice("pool-1");
    expect(j.skills.gate).toBeGreaterThan(a.skills.gate);
    expect(j.rides).toBe(120);
    expect(j.wins).toBeGreaterThan(5);
  });
});

describe("race-day choice carries the jockey", () => {
  it("parses a jockeyId; old choices without one still parse", () => {
    expect(parseRaceDay({ extras: [], jockey: "apprentice", jockeyId: "j1" }).jockeyId).toBe("j1");
    expect(parseRaceDay({ extras: [], jockey: "top" }).jockeyId).toBeUndefined();
    expect(hasRaceDay({ extras: [], jockey: "apprentice", jockeyId: "j1" })).toBe(true);
  });
});

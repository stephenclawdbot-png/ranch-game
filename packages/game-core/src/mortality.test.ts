import { describe, expect, it } from "vitest";
import { applyRun, type RunConditions } from "./career";
import { FATAL_SHARE_OF_CAREER_ENDING, injuryRisk, rollInjury } from "./condition";
import { FRAGILE_FROM_INJURY_PERMILLE, fragileChance, inherit } from "./genetics";
import { FRAGILE_DURABILITY_PENALTY, isFragile, potentialOf } from "./genome";
import { injuredParents, previewBreeding } from "./breeding";
import { retireFromRacing, stageOf } from "./lifecycle";
import { seedFrom } from "./rng";
import { GenomeSchema, HorseStateSchema, type Genome } from "./types";
import { T0, DAY, makeHorse } from "./test-helpers";

const cond = (i: number, tier: RunConditions["tier"] = "hcp_0_55"): RunConditions => ({ raceId: `r${i}`, seed: seedFrom("mort", i), atMs: T0 + i * DAY, tier, distanceM: 1600, going: "good", fieldSize: 10, bigCrowd: false });

describe("fatal injuries (rare, Live races only)", () => {
  it("only career-ending injuries can turn fatal, only when allowed, about the set share", () => {
    let careerEnding = 0;
    let fatal = 0;
    for (let i = 0; i < 40_000; i++) {
      const inj = rollInjury({ permille: 1000, careerEndingShare: 1000 }, `f${i}`, T0, 0, "race", { fatal: true });
      if (inj?.severity === "fatal") fatal++;
      else if (inj?.severity === "career_ending") careerEnding++;
      expect(rollInjury({ permille: 1000, careerEndingShare: 1000 }, `f${i}`, T0, 0, "race")?.severity).toBe("career_ending");
    }
    const share = (fatal * 1000) / (fatal + careerEnding);
    expect(share).toBeGreaterThan(FATAL_SHARE_OF_CAREER_ENDING - 20);
    expect(share).toBeLessThan(FATAL_SHARE_OF_CAREER_ENDING + 20);
    // a minor or moderate injury is never fatal
    for (let i = 0; i < 2000; i++) expect(rollInjury({ permille: 1000, careerEndingShare: 0 }, `m${i}`, T0, 0, "race", { fatal: true })?.severity).not.toBe("fatal");
  });

  it("a fatal injury ends the horse's story: retired for good, never in a Story race", () => {
    let fatalSeen = 0;
    for (let i = 0; i < 6000 && fatalSeen < 3; i++) {
      // an all-out ride on a tired horse: the riskiest case, to find fatal rolls quickly
      const h = { ...makeHorse(`fx${i}`, { starts: 10 }), condition: { ...makeHorse(`fx${i}`).condition, fatigue: 900, fatigueAtMs: T0 + i * DAY } };
      const live = applyRun(h, cond(i), { position: 5, prize: 0, intensity: "all_out", vetLevel: 0 });
      const story = applyRun(h, cond(i, "quick"), { position: 5, prize: 0, intensity: "all_out", vetLevel: 0 });
      expect(story.fatal).toBe(false);
      if (live.fatal) {
        fatalSeen++;
        expect(live.injury?.severity).toBe("fatal");
        expect(live.retired).toBe(true);
        expect(stageOf(live.state)).toBe("pasture");
        expect(live.state.location).toBe("legacy_farm");
        expect(HorseStateSchema.safeParse(live.state).success).toBe(true);
      }
    }
    expect(fatalSeen).toBeGreaterThan(0);
  });
});

describe("fragile legs: the gamble of breeding from a career-ending injury", () => {
  const sire = makeHorse("fr-s", { starts: 30 });
  const dam = makeHorse("fr-d", { starts: 30, sex: "filly" });

  it("older genomes without the locus stay valid and sound", () => {
    const { fragile: _f, ...old } = sire.genome;
    expect(GenomeSchema.safeParse(old).success).toBe(true);
    expect(isFragile(old as Genome)).toBe(false);
  });

  it("a parent retired by injury passes it about half the time; sound parents never", () => {
    const injured = retireFromRacing(sire, "injury");
    expect(injuredParents(injured, dam)).toEqual({ sire: true, dam: false });
    let fragile = 0;
    let soundFragile = 0;
    for (let i = 0; i < 2000; i++) {
      if (isFragile(inherit(injured.genome, dam.genome, `fr${i}`, { injured: { sire: true } }))) fragile++;
      if (isFragile(inherit(sire.genome, dam.genome, `fr${i}`))) soundFragile++;
    }
    expect(soundFragile).toBe(0);
    expect(fragile / 2000).toBeGreaterThan(FRAGILE_FROM_INJURY_PERMILLE / 1000 - 0.05);
    expect(fragile / 2000).toBeLessThan(FRAGILE_FROM_INJURY_PERMILLE / 1000 + 0.05);
    expect(fragileChance(injured.genome, dam.genome, { sire: true })).toBe(FRAGILE_FROM_INJURY_PERMILLE);
    const p = previewBreeding(injured, dam, {}, 1);
    expect(p.fragile).toEqual({ permille: FRAGILE_FROM_INJURY_PERMILLE, fromInjury: true });
  });

  it("the fragile locus draws on its own stream: the rest of the foal is the same either way", () => {
    for (let i = 0; i < 50; i++) {
      const a = inherit(sire.genome, dam.genome, `same${i}`);
      const b = inherit(sire.genome, dam.genome, `same${i}`, { injured: { sire: true, dam: true } });
      expect({ ...b, fragile: a.fragile }).toEqual(a);
    }
  });

  it("fragile legs cost durability and raise the injury risk", () => {
    const sound = makeHorse("fr-x", { starts: 5 });
    const frail = { ...sound, genome: { ...sound.genome, fragile: [1, 0] as [0 | 1, 0 | 1] } };
    expect(potentialOf(frail.genome, "durability")).toBe(Math.max(0, potentialOf(sound.genome, "durability") - FRAGILE_DURABILITY_PENALTY));
    const ctx = { nowMs: T0, going: "good" as const, distanceM: 1600, intensity: "normal" as const, stage: "prime" as const };
    const r1 = injuryRisk(sound, ctx);
    const r2 = injuryRisk(frail, ctx);
    expect(r2.permille).toBeGreaterThan(r1.permille);
    expect(r2.factors.some((f) => f.key === "fragile")).toBe(true);
  });
});

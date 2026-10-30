import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Going } from "@thoroughbred/shared";
import { conditionReport, fatigueAt, injuryRisk, withFatigue, withPhysio, GOING_RISK } from "./condition";
import { applyRun, settleField } from "./career";
import { raceSnapshot } from "./phenotype";
import {
  JOCKEYS,
  NO_RACE_DAY,
  PHYSIO_FATIGUE_OFF,
  RACE_EXTRAS,
  RaceDayChoiceSchema,
  VET_CHECK_RISK_PERMILLE,
  offeredExtras,
  parseRaceDay,
  raceDayKit,
  raceDayPrice,
  raceDayProblem,
  raceDayQuote,
  raceDayTags,
  type RaceDayChoice,
} from "./raceDay";
import type { RideIntensity } from "./types";
import { HOUR, T0, makeHorse } from "./test-helpers";

const base = makeHorse("raceday", { starts: 10 });
const ctx = { nowMs: T0, going: "good" as Going, distanceM: 1600, intensity: "normal" as RideIntensity, stage: "prime" as const };
const choice = (extras: RaceDayChoice["extras"], jockey: RaceDayChoice["jockey"] = "apprentice"): RaceDayChoice => ({ extras, jockey });
const silks = { primary: "#111111", secondary: "#ffffff", pattern: "hoops", cap: "#111111" } as const;

describe("prices", () => {
  it("scale with the purse between a floor and a cap, rounded to 10", () => {
    const p = RACE_EXTRAS.vet_check.price;
    expect(raceDayPrice(p, 0)).toBe(p.floor);
    expect(raceDayPrice(p, 2_000)).toBe(40); // 2% of a maiden purse = the floor
    expect(raceDayPrice(p, 16_000)).toBe(320); // a Feature Qualifier
    expect(raceDayPrice(p, 10_000_000)).toBe(p.cap);
    expect(raceDayPrice(JOCKEYS.top.price, 16_000)).toBe(800);
    expect(raceDayPrice(JOCKEYS.top.price, 72_000)).toBe(JOCKEYS.top.price!.cap);
    expect(raceDayPrice(JOCKEYS.apprentice.price, 72_000)).toBe(0);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200_000 }), fc.integer({ min: 0, max: 200_000 }), (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (const j of Object.values(JOCKEYS)) expect(raceDayPrice(j.price, lo)).toBeLessThanOrEqual(raceDayPrice(j.price, hi));
        expect(raceDayPrice(p, lo) % 10).toBe(0);
      }),
    );
  });

  it("a better jockey always costs more", () => {
    for (const purse of [0, 2_000, 8_000, 16_000, 48_000, 72_000]) {
      expect(raceDayPrice(JOCKEYS.journeyman.price, purse)).toBeGreaterThan(raceDayPrice(JOCKEYS.apprentice.price, purse));
      expect(raceDayPrice(JOCKEYS.top.price, purse)).toBeGreaterThan(raceDayPrice(JOCKEYS.journeyman.price, purse));
    }
  });

  it("quotes add up per item", () => {
    const q = raceDayQuote(choice(["physio", "vet_check"], "journeyman"), 16_000);
    expect(q.extras).toEqual([
      { key: "physio", price: 320 },
      { key: "vet_check", price: 320 },
    ]);
    expect(q.jockeyFee).toBe(400);
    expect(q.total).toBe(1_040);
    expect(raceDayQuote(NO_RACE_DAY, 16_000).total).toBe(0);
  });
});

describe("what is offered and stored", () => {
  it("shoes only on the going they are made for", () => {
    expect(offeredExtras("good")).toEqual(["physio", "vet_check"]);
    expect(offeredExtras("soft")).toEqual(["soft_shoes", "physio", "vet_check"]);
    expect(offeredExtras("heavy")).toContain("soft_shoes");
    expect(offeredExtras("firm")).toEqual(["firm_shoes", "physio", "vet_check"]);
    expect(raceDayProblem(choice(["soft_shoes"]), { going: "good", live: true })).toMatch(/aren't offered/);
    expect(raceDayProblem(choice(["firm_shoes"]), { going: "firm", live: true })).toBeNull();
    expect(raceDayProblem(choice([], "top"), { going: "good", live: false })).toMatch(/Live races/);
    expect(raceDayProblem(NO_RACE_DAY, { going: "good", live: false })).toBeNull();
  });

  it("the stored choice parses safely: duplicates and junk are refused", () => {
    expect(RaceDayChoiceSchema.safeParse({ extras: ["physio", "physio"] }).success).toBe(false);
    expect(RaceDayChoiceSchema.parse({})).toEqual(NO_RACE_DAY);
    expect(parseRaceDay(undefined)).toEqual(NO_RACE_DAY);
    expect(parseRaceDay({ extras: ["teleport"] })).toEqual(NO_RACE_DAY);
    expect(parseRaceDay({ extras: ["vet_check"], jockey: "top" })).toEqual(choice(["vet_check"], "top"));
  });

  it("racecard tags: equipment, then the jockey (the apprentice shows nothing)", () => {
    expect(raceDayTags(NO_RACE_DAY)).toEqual([]);
    expect(raceDayTags(choice(["vet_check", "soft_shoes"], "top"))).toEqual(["Soft shoes", "Vet-checked", "Top jockey"]);
  });
});

describe("engine kit", () => {
  it("no kit for the default ride or for extras that act off the track", () => {
    expect(raceDayKit(NO_RACE_DAY, "heavy")).toBeUndefined();
    expect(raceDayKit(choice(["physio", "vet_check"]), "good")).toBeUndefined();
    expect(raceDayKit(choice(["firm_shoes"]), "firm")).toBeUndefined();
  });
  it("soft shoes halve the going penalty; jockeys narrow day form and settle keen horses", () => {
    expect(raceDayKit(choice(["soft_shoes"]), "heavy")).toEqual({ goingPenaltyPermille: 500 });
    expect(raceDayKit(choice(["soft_shoes"]), "good")).toBeUndefined();
    expect(raceDayKit(choice([], "journeyman"), "good")).toEqual({ formAmpPermille: 900, keenPermille: 750 });
    expect(raceDayKit(choice(["soft_shoes"], "top"), "soft")).toEqual({ goingPenaltyPermille: 500, formAmpPermille: 800, keenPermille: 500 });
  });
});

describe("effects on the horse", () => {
  it("physio takes its fatigue off, never below zero, and never lifts a rested horse", () => {
    const tired = withFatigue(base, 600, T0, true);
    const before = fatigueAt(tired, T0 + HOUR);
    expect(fatigueAt(withPhysio(tired, choice(["physio"]), T0 + HOUR), T0 + HOUR)).toBe(before - PHYSIO_FATIGUE_OFF);
    const rested = { ...base, condition: { ...base.condition, fatigue: 0, fatigueAtMs: T0 } };
    expect(fatigueAt(withPhysio(rested, choice(["physio"]), T0), T0)).toBe(0);
    expect(conditionReport(withPhysio(rested, choice(["physio"]), T0), T0).multiplier).toBe(conditionReport(rested, T0).multiplier);
    expect(withPhysio(tired, NO_RACE_DAY, T0)).toBe(tired);
  });

  it("a physio'd snapshot is never stronger than the same horse fully rested", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), (f) => {
        const s = withFatigue({ ...base, condition: { ...base.condition, fatigue: 0 } }, f, T0, false);
        const rested = { ...base, condition: { ...base.condition, fatigue: 0, fatigueAtMs: T0, lastHardWorkMs: s.condition.lastHardWorkMs } };
        const physio = raceSnapshot(s, { nowMs: T0, silks, raceDay: choice(["physio"]) }).horse.stats;
        const plain = raceSnapshot(s, { nowMs: T0, silks }).horse.stats;
        const best = raceSnapshot(rested, { nowMs: T0, silks }).horse.stats;
        for (const k of ["speed", "stamina", "burst"] as const) {
          expect(physio[k]).toBeGreaterThanOrEqual(plain[k]);
          expect(physio[k]).toBeLessThanOrEqual(best[k]);
        }
      }),
    );
  });

  it("the vet check is a published factor line: risk × 0.75", () => {
    const tired = withFatigue(base, 900, T0, true);
    const plain = injuryRisk(tired, { ...ctx, going: "heavy", intensity: "all_out" });
    const checked = injuryRisk(tired, { ...ctx, going: "heavy", intensity: "all_out", raceDay: choice(["vet_check"]) });
    const line = checked.factors.find((f) => f.key === "vetCheck")!;
    expect(line).toEqual({ key: "vetCheck", multiplier: VET_CHECK_RISK_PERMILLE, text: "Vet-checked" });
    expect(checked.permille).toBeLessThan(plain.permille);
    expect(Math.abs(checked.permille - Math.round((plain.permille * VET_CHECK_RISK_PERMILLE) / 1000))).toBeLessThanOrEqual(1);
    expect(plain.factors.some((f) => f.key === "vetCheck")).toBe(false);
  });

  it("shoes that suit the going halve its extra risk; others do nothing", () => {
    for (const going of ["firm", "soft", "heavy"] as const) {
      const shoes = going === "firm" ? "firm_shoes" : "soft_shoes";
      const line = injuryRisk(base, { ...ctx, going, raceDay: choice([shoes]) }).factors.find((f) => f.key === "going")!;
      expect(line.multiplier).toBe(1000 + Math.round((GOING_RISK[going] - 1000) / 2));
      expect(line.text).toMatch(/shod/);
    }
    const wrong = injuryRisk(base, { ...ctx, going: "firm", raceDay: choice(["soft_shoes"]) }).factors.find((f) => f.key === "going")!;
    expect(wrong.multiplier).toBe(GOING_RISK.firm);
  });

  it("settlement applies the same extras: physio lowers post-race fatigue and the risk rolled", () => {
    const tired = withFatigue(base, 700, T0 - HOUR, true);
    const cond = { raceId: "r1", seed: "ab".repeat(32), atMs: T0, tier: "hcp_50_75" as const, distanceM: 1600, going: "good" as Going, fieldSize: 8, bigCrowd: false };
    const run = { position: 3, prize: 0, intensity: "normal" as RideIntensity, vetLevel: 0 };
    const plain = applyRun(tired, cond, run);
    const fixed = applyRun(tired, cond, { ...run, raceDay: choice(["physio"]) });
    expect(fixed.state.condition.fatigue).toBe(plain.state.condition.fatigue - PHYSIO_FATIGUE_OFF);
    // Without extras the run is exactly what it always was.
    expect(applyRun(tired, cond, { ...run, raceDay: NO_RACE_DAY })).toEqual(plain);
    const finish = [{ horseId: tired.id, position: 1, finishTimeUs: 1, marginMm: 0, marginLabel: "", prize: 0 }];
    const viaField = settleField([tired], finish, cond, () => ({ intensity: "normal", vetLevel: 0, raceDay: choice(["physio"]) }));
    expect(viaField[0]!.state.condition.fatigue).toBe(applyRun(tired, cond, { ...run, position: 1, raceDay: choice(["physio"]) }).state.condition.fatigue);
  });
});

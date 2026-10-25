import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { HorseSchema } from "@thoroughbred/shared";
import { simulateRace } from "../../racing-engine/src/index";
import { applyRun, settleField, type RunConditions } from "./career";
import { injuryRisk } from "./condition";
import { CAREER_MAX_STARTS, stageOf } from "./lifecycle";
import { toSharedHorse } from "./phenotype";
import { createGiftFoal, createStarterStable, firstMaidenRace, giftFoalDue } from "./onboarding";
import { HorseStateSchema } from "./types";
import { seedFrom } from "./rng";
import { DAY, HOUR, SILKS, T0, makeHorse } from "./test-helpers";

const cond = (i: number, tier: RunConditions["tier"] = "hcp_0_55"): RunConditions => ({ raceId: `r${i}`, seed: seedFrom("race", i), atMs: T0 + i * DAY, tier, distanceM: 1600, going: "good", fieldSize: 10, bigCrowd: false });

describe("race settlement on the career clock", () => {
  it("each rated start advances the career; 40 starts forces racing retirement", () => {
    let h = makeHorse("c", { starts: 0 });
    for (let i = 0; i < CAREER_MAX_STARTS; i++) {
      const r = applyRun({ ...h, injury: null }, cond(i), { position: (i % 10) + 1, prize: 10, intensity: "normal", vetLevel: 0 });
      h = r.state;
      if (r.retired && r.injury?.severity === "career_ending") break;
    }
    if (!h.career.racingRetired || h.career.racingRetired.reason === "max_starts") {
      expect(h.career.starts).toBe(CAREER_MAX_STARTS);
      expect(h.career.racingRetired?.reason).toBe("max_starts");
      expect(stageOf(h)).toBe("stud");
    }
    expect(HorseStateSchema.safeParse(h).success).toBe(true);
  });

  it("trials don't count as starts and carry no injury", () => {
    const h = makeHorse("t", { care: 15 });
    const r = applyRun(h, cond(1, "trial"), { position: 1, prize: 0, intensity: "all_out", vetLevel: 0 });
    expect(r.state.career.starts).toBe(0);
    expect(r.injury).toBeNull();
  });

  it("is deterministic; injuries are never fatal; insurance pays only when insured", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), fc.boolean(), (i, insured) => {
        const h0 = makeHorse("d", { starts: 30 });
        const h = { ...h0, condition: { ...h0.condition, fatigue: 1000, fatigueAtMs: T0 + i * DAY }, career: { ...h0.career, insured } };
        const a = applyRun(h, cond(i), { position: 3, prize: 0, intensity: "all_out", vetLevel: 1 });
        expect(applyRun(h, cond(i), { position: 3, prize: 0, intensity: "all_out", vetLevel: 1 })).toEqual(a);
        if (a.injury?.severity === "career_ending") {
          expect(a.state.career.racingRetired?.reason).toBe("injury");
          expect(a.insurancePayout).toBe(insured);
          expect(a.state.location).toBe("stable"); // still a stud/broodmare prospect
        }
      }),
      { numRuns: 300 },
    );
  });

  it("the risk used at settlement is the one shown before entry", () => {
    const h = makeHorse("risk", { starts: 10 });
    const shown = injuryRisk(h, { nowMs: T0 + DAY, going: "good", distanceM: 1600, intensity: "normal", stage: "prime" });
    let hits = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (applyRun(h, { ...cond(1), seed: seedFrom("risk", i) }, { position: 1, prize: 0, intensity: "normal", vetLevel: 0 }).injury) hits++;
    expect(hits / N).toBeGreaterThan((shown.permille / 1000) * 0.5);
    expect(hits / N).toBeLessThan((shown.permille / 1000) * 1.6 + 0.002);
  });

  it("settleField rates the field from the engine's finish order", () => {
    const hs = [0, 1, 2, 3].map((i) => makeHorse(`f${i}`, { id: `f${i}`, starts: 10 }));
    const finish = hs.map((h, i) => ({ horseId: h.id, position: i + 1, finishTimeUs: 1000 + i, marginMm: 100, marginLabel: "nose", prize: 0 }));
    const res = settleField(hs, finish, cond(1), () => ({ intensity: "normal", vetLevel: 0 }));
    expect(res[0]!.state.rating.or).toBeGreaterThan(hs[0]!.rating.or);
    expect(res[3]!.state.rating.or).toBeLessThan(hs[3]!.rating.or);
    expect(res.every((r) => r.state.record.starts === 1)).toBe(true);
  });
});

describe("onboarding", () => {
  const starters = createStarterStable({ ownerId: "p1", seed: seedFrom("starter", "p1"), nowMs: T0, season: 1 });
  it("3 modest, race-ready, Club-bred starters with distinct trips", () => {
    expect(starters.length).toBe(3);
    for (const s of starters) {
      expect(HorseStateSchema.safeParse(s).success).toBe(true);
      expect(stageOf(s)).toBe("juvenile");
      expect(s.binding).toBe("club_bred");
      expect(HorseSchema.safeParse(toSharedHorse(s, T0, SILKS)).success).toBe(true);
    }
    expect(new Set(starters.map((s) => s.sex)).size).toBe(2);
  });
  it("first maiden is competitive but honest: the player's horse wins sometimes and loses sometimes", () => {
    let wins = 0;
    let top3 = 0;
    const N = 40;
    for (let i = 0; i < N; i++) {
      const st = createStarterStable({ ownerId: `p${i}`, seed: seedFrom("starter", i), nowMs: T0, season: 1 })[1]!;
      const me = toSharedHorse(st, T0, SILKS);
      const { race, entries } = firstMaidenRace(me, st, seedFrom("fm", i), T0 + HOUR);
      const replay = simulateRace({ race, entries, seed: seedFrom("fm-seed", i) });
      const pos = replay.result.finishOrder.find((f) => f.horseId === me.id)!.position;
      if (pos === 1) wins++;
      if (pos <= 3) top3++;
    }
    expect(wins).toBeGreaterThan(N * 0.15);
    expect(wins).toBeLessThan(N);
    expect(top3).toBeGreaterThan(N * 0.5);
  });
  it("day-2 gift foal", () => {
    expect(giftFoalDue(T0, T0 + HOUR, false)).toBe(false);
    expect(giftFoalDue(T0, T0 + DAY, false)).toBe(true);
    expect(giftFoalDue(T0, T0 + 5 * DAY, true)).toBe(false);
    const f = createGiftFoal({ ownerId: "p1", seed: seedFrom("gift", "p1"), nowMs: T0 + DAY, season: 1, name: "Gift" });
    expect(stageOf(f)).toBe("foal");
    expect(f.binding).toBe("club_bred");
  });
});

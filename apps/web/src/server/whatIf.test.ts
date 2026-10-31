/**
 * "What if?" re-runs, the determinism proof (no database): a re-run with no change is the
 * official race byte for byte, through the same simulateRace call verifyReplay makes, on every
 * engine version a stored race can carry (the racing-engine's frozen pre-1.3.0, pre-1.4.0 and
 * pre-jockeys fixtures, plus a fresh 1.4.0 race). A change re-runs on the race's own version and
 * moves only the changed runner's inputs; a change that would need another version is refused.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { LIVE_RACE_MODEL, type RaceInput, type RaceReplay } from "@thoroughbred/shared";
import { engineVersionFor, simulateRace, verifyReplay } from "@thoroughbred/racing-engine";
import { fixtureInput } from "./testing";
import { GRADE_RIDER_SKILLS, kitWithRider, kitWithShoes, lockedRunner, rerun, runnerLine, statsWithDelta, topRows, whatIfInput } from "./whatIf";
import { changeKey, parseChangeKey, type WhatIfChange } from "@/lib/whatIf";

type Stored = { input: RaceInput; replay: RaceReplay };
const fixtures = (file: string): Stored[] =>
  (JSON.parse(readFileSync(new URL(`../../../../packages/racing-engine/src/fixtures/${file}`, import.meta.url), "utf8")) as { races: Stored[] }).races;

const STORED: Stored[] = [...fixtures("pre-1.3.0-races.json"), ...fixtures("pre-1.4.0-races.json"), ...fixtures("pre-jockeys-races.json")];
const fresh = (() => {
  const input: RaceInput = { ...fixtureInput("what-if-1.4", 1_800_000_000_000, { runners: 9 }), model: LIVE_RACE_MODEL };
  return { input, replay: simulateRace(input) };
})();
const ALL: Stored[] = [...STORED, fresh];

describe("what-if: a re-run with no change is the official race", () => {
  it("covers every engine version a stored race can carry", () => {
    expect(new Set(ALL.map((s) => s.replay.engineVersion))).toEqual(new Set(["1.1.0", "1.2.0", "1.3.0", "1.4.0"]));
  });

  for (const s of ALL) {
    it(`${s.input.race.id} (${s.replay.engineVersion}): byte for byte, for every runner`, () => {
      for (const e of s.input.entries) {
        const input = whatIfInput(s.input, lockedRunner(s.input, e.gate));
        // The same check verifyReplay makes (seed, commitment, hash, result, ticks, every frame) ...
        expect(verifyReplay(input, s.replay)).toBe(true);
        // ... and the whole replay, serialised.
        expect(JSON.stringify(rerun(s.input, lockedRunner(s.input, e.gate)))).toBe(JSON.stringify(s.replay));
      }
    });
  }
});

describe("what-if: one change", () => {
  it("changes only the chosen runner's input; everything else is the locked input", () => {
    for (const s of ALL) {
      const e = s.input.entries[1]!;
      const tactic = e.tactic === "closer" ? "front" : "closer";
      const input = whatIfInput(s.input, { ...lockedRunner(s.input, e.gate), tactic });
      expect(input.seed).toBe(s.input.seed);
      expect(input.race).toEqual(s.input.race);
      expect(input.course).toEqual(s.input.course);
      expect(input.model).toEqual(s.input.model);
      expect(input.entries.map((x) => x.gate)).toEqual(s.input.entries.map((x) => x.gate));
      for (const x of input.entries) {
        const was = s.input.entries.find((y) => y.gate === x.gate)!;
        if (x.gate === e.gate) expect({ ...x, tactic: was.tactic }).toEqual(was);
        else expect(x).toEqual(was);
      }
      // It re-runs on the race's own engine version, with the same seed commitment.
      const replay = rerun(s.input, { ...lockedRunner(s.input, e.gate), tactic });
      expect(replay.engineVersion).toBe(s.replay.engineVersion);
      expect(replay.seedCommitment).toBe(s.replay.seedCommitment);
      expect(replay.horses.map((h) => h.horseId)).toEqual(s.replay.horses.map((h) => h.horseId));
    }
  });

  it("is deterministic: the same change gives the same race every time", () => {
    const e = fresh.input.entries[3]!;
    const r = { ...lockedRunner(fresh.input, e.gate), tactic: "front" as const };
    expect(JSON.stringify(rerun(fresh.input, r))).toBe(JSON.stringify(rerun(fresh.input, r)));
  });

  it("refuses a change that would move an old race onto another engine version", () => {
    const plain = STORED.find((s) => s.replay.engineVersion === "1.1.0")!;
    expect(plain.input.entries.every((e) => e.kit === undefined)).toBe(true);
    const gate = plain.input.entries[0]!.gate;
    // Kit didn't exist in 1.1.0: shoes or a jockey would make it a 1.2.0 race.
    expect(() => whatIfInput(plain.input, { ...lockedRunner(plain.input, gate), kit: kitWithRider(null, GRADE_RIDER_SKILLS.A) })).toThrow(/didn't exist/);
    // A tactic change is fine and stays 1.1.0.
    expect(rerun(plain.input, { ...lockedRunner(plain.input, gate), tactic: "closer" }).engineVersion).toBe("1.1.0");
    // A 1.2.0 race (kit) re-runs a new rider as 1.2.0.
    const kit = STORED.find((s) => s.replay.engineVersion === "1.2.0")!;
    const g2 = kit.input.entries[0]!.gate;
    expect(rerun(kit.input, { ...lockedRunner(kit.input, g2), kit: kitWithRider(lockedRunner(kit.input, g2).kit, GRADE_RIDER_SKILLS.E) }).engineVersion).toBe("1.2.0");
  });

  it("removing the only kit on a kit-era race is refused too (the version would fall back)", () => {
    const kit = STORED.find((s) => s.replay.engineVersion === "1.2.0")!;
    const withKit = kit.input.entries.filter((e) => e.kit);
    if (withKit.length !== 1) return;
    expect(() => whatIfInput(kit.input, { ...lockedRunner(kit.input, withKit[0]!.gate), kit: null })).toThrow(/didn't exist/);
  });

  it("refuses a gate that isn't in the race", () => {
    expect(() => lockedRunner(fresh.input, 16)).toThrow();
  });
});

describe("what-if: kit and stats helpers", () => {
  it("shoes act on soft and heavy going only, and keep the rider's fields", () => {
    const rider = kitWithRider(null, GRADE_RIDER_SKILLS.C);
    expect(kitWithShoes(rider, true, "soft")).toEqual({ ...rider, goingPenaltyPermille: gc.SHOES_KEEP_PERMILLE });
    expect(kitWithShoes(rider, true, "good")).toEqual(rider);
    expect(kitWithShoes({ goingPenaltyPermille: 500 }, false, "heavy")).toBeNull();
  });

  it("a new rider replaces all five rider fields through the jockeys kit mapping and keeps the shoes", () => {
    const shod = kitWithShoes(kitWithRider(null, GRADE_RIDER_SKILLS.E), true, "heavy");
    const a = kitWithRider(shod, GRADE_RIDER_SKILLS.A);
    expect(a).toEqual({ goingPenaltyPermille: gc.SHOES_KEEP_PERMILLE, ...gc.jockeyKit(GRADE_RIDER_SKILLS.A) });
    for (const g of ["A", "B", "C", "D", "E"] as const) expect(gc.jockeyGrade(GRADE_RIDER_SKILLS[g])).toBe(g);
  });

  it("stat deltas are clamped to 0..1000", () => {
    const s = { speed: 990, stamina: 5, burst: 500, temperament: 500, adaptability: 500 } as never;
    expect(statsWithDelta(s, { speed: 25, stamina: -20, burst: 25 } as never)).toMatchObject({ speed: 1000, stamina: 0, burst: 525 });
  });

  it("change keys round-trip and are canonical", () => {
    const changes: WhatIfChange[] = [
      { kind: "tactic", tactic: "closer" },
      { kind: "intensity", intensity: "all_out" },
      { kind: "extras", extras: ["physio", "soft_shoes"] },
      { kind: "extras", extras: [] },
      { kind: "jockey", jockeyId: "3f1c2a4e-8b7d-4c1a-9e2f-0a1b2c3d4e5f" },
      { kind: "jockey_grade", grade: "B" },
    ];
    for (const c of changes) expect(parseChangeKey(changeKey(c))).not.toBeNull();
    expect(changeKey({ kind: "extras", extras: ["physio", "soft_shoes"] })).toBe(changeKey({ kind: "extras", extras: ["soft_shoes", "physio"] }));
    expect(parseChangeKey("tactic:sideways")).toBeNull();
    expect(parseChangeKey("extras:physio+physio")).toBeNull();
  });
});

describe("what-if: the comparison", () => {
  it("reads position, distance behind and sectionals from a replay", () => {
    const winner = fresh.replay.result.finishOrder[0]!;
    const last = fresh.replay.result.finishOrder.at(-1)!;
    expect(runnerLine(fresh.replay, winner.horseId)).toMatchObject({ position: 1, behindMm: 0 });
    const l = runnerLine(fresh.replay, last.horseId);
    expect(l.position).toBe(fresh.replay.result.finishOrder.length);
    expect(l.behindMm).toBeGreaterThan(0);
    expect(l.sectionals.reduce((a, b) => a + b, 0)).toBeCloseTo(last.finishTimeUs / 1e6, 1);
    const rows = topRows(fresh.replay, last.horseId);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, l.position]);
    expect(rows.filter((r) => r.mine)).toHaveLength(1);
    expect(engineVersionFor(fresh.input.entries, null, fresh.input.model)).toBe("1.4.0");
  });
});

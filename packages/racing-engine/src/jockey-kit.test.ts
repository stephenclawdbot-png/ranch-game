/**
 * Jockey kit fields (gate, pace judgement, finishing drive): optional per-runner kit that only acts
 * when present. Races stored before they existed replay byte for byte (fixtures/pre-jockeys-races.json).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RaceInput, RaceKit, RaceReplay } from "@thoroughbred/shared";
import { ENGINE_VERSION, jockeyBattle, simulateRace, verifyReplay } from "./index";
import { streamSeedBytes } from "./hash";
import { buildProfile } from "./model";
import { Rng } from "./prng";
import { makeInput, seedFor, typicalField } from "./test-fixtures";

const live = (input: RaceInput): RaceInput => ({ ...input, model: "1.4.0" });
function withKit(input: RaceInput, gate: number, kit: RaceKit): RaceInput {
  const out = JSON.parse(JSON.stringify(input)) as RaceInput;
  out.entries = out.entries.map((e) => (e.gate === gate ? { ...e, kit: { ...e.kit, ...kit } } : e));
  return out;
}
function profileOf(input: RaceInput, gate: number) {
  const e = input.entries.find((x) => x.gate === gate)!;
  return buildProfile(e, input.race, 5000, new Rng(streamSeedBytes(input.seed, gate, 1)), input.model === "1.4.0");
}

describe("back-compat: Live races stored before the jockey kit fields existed", () => {
  const stored = JSON.parse(readFileSync(new URL("./fixtures/pre-jockeys-races.json", import.meta.url), "utf8")) as {
    races: { input: RaceInput; replay: RaceReplay }[];
  };
  it("still verify, and re-simulate byte for byte as 1.4.0", () => {
    expect(stored.races.map((r) => r.replay.engineVersion)).toEqual([ENGINE_VERSION, ENGINE_VERSION]);
    expect(stored.races[1]!.input.entries.some((e) => e.kit !== undefined)).toBe(true);
    for (const { input, replay } of stored.races) {
      expect(verifyReplay(input, replay)).toBe(true);
      expect(JSON.stringify(simulateRace(input))).toBe(JSON.stringify(replay));
    }
  });
  it("neutral jockey fields (1000) change nothing on the track", () => {
    const { input, replay } = stored.races[0]!;
    let neutral = input;
    for (const e of input.entries) neutral = withKit(neutral, e.gate, { slowStartPermille: 1000, drainPermille: 1000, battlePermille: 1000 });
    const r = simulateRace(neutral);
    expect(r.frames).toEqual(replay.frames);
    expect(r.result.resultHash).toBe(replay.result.resultHash);
  });
});

describe("jockey kit fields", () => {
  const base = live(makeInput(typicalField(10, 1600), { seed: seedFor(91) }));

  it("gate: scales the slow-start chance without moving any draw", () => {
    let slowBase = 0;
    let slowBest = 0;
    for (let k = 0; k < 400; k++) {
      const input = live(makeInput([{ stats: { temperament: 300 } }, { stats: 650 }], { seed: seedFor(3000 + k) }));
      const a = profileOf(input, 1);
      const b = profileOf(withKit(input, 1, { slowStartPermille: 500 }), 1);
      // The same single draw: a start is only ever saved, never made slow; cruise is drawn before it.
      expect(b.cruise).toBe(a.cruise);
      if (b.slowStart === a.slowStart) expect(b.prefLane).toBe(a.prefLane);
      if (b.slowStart) expect(a.slowStart).toBe(true);
      slowBase += a.slowStart ? 1 : 0;
      slowBest += b.slowStart ? 1 : 0;
    }
    expect(slowBest).toBeLessThan(slowBase);
  });

  it("pace judgement: scales the drain multiplier after its clamp", () => {
    const a = profileOf(base, 2).drainMul;
    expect(profileOf(withKit(base, 2, { drainPermille: 980 }), 2).drainMul).toBe(Math.trunc((a * 980) / 1000));
  });

  it("finishing drive: a share of the battle response", () => {
    expect(jockeyBattle(300, undefined)).toBe(300);
    expect(jockeyBattle(300, 1000)).toBe(300);
    expect(jockeyBattle(300, 850)).toBe(255);
  });

  it("only touches its own runner's profile; deterministic and verifiable; tamper fails", () => {
    const kitted = withKit(base, 4, { slowStartPermille: 500, drainPermille: 985, battlePermille: 900, formAmpPermille: 820 });
    for (const g of [1, 2, 3, 5, 6, 7, 8, 9, 10]) expect(profileOf(kitted, g)).toEqual(profileOf(base, g));
    const r = simulateRace(kitted);
    expect(r.engineVersion).toBe(ENGINE_VERSION);
    expect(verifyReplay(kitted, r)).toBe(true);
    expect(verifyReplay(withKit(kitted, 4, { battlePermille: 950 }), r) && verifyReplay(withKit(kitted, 4, { drainPermille: 990 }), r)).toBe(false);
  });

  it("the schema refuses shares above 1000", () => {
    expect(() => simulateRace(withKit(base, 1, { drainPermille: 1001 }))).toThrow();
    expect(() => simulateRace(withKit(base, 1, { battlePermille: 1200 }))).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { RaceInputSchema, type RaceInput, type RaceKit } from "@thoroughbred/shared";
import { ENGINE_VERSION, LEGACY_ENGINE_VERSION, engineVersionFor, simulateRace, verifyReplay } from "./index";
import { streamSeedBytes } from "./hash";
import { buildProfile } from "./model";
import { Rng } from "./prng";
import { makeInput, seedFor, typicalField } from "./test-fixtures";

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function withKit(input: RaceInput, gate: number, kit: RaceKit): RaceInput {
  const out = clone(input);
  out.entries = out.entries.map((e) => (e.gate === gate ? { ...e, kit } : e));
  return out;
}

/** The form-stream profile of one entry, as runRace builds it. */
function profileOf(input: RaceInput, gate: number) {
  const e = input.entries.find((x) => x.gate === gate)!;
  return buildProfile(e, input.race, 5000, new Rng(streamSeedBytes(input.seed, gate, 1)));
}

describe("race-day kit (engine 1.2.0)", () => {
  const base = makeInput(typicalField(10, 1600), { seed: seedFor(77), going: "heavy" });

  it("a race without kit is labelled and hashed as the legacy engine", () => {
    const r = simulateRace(base);
    expect(r.engineVersion).toBe(LEGACY_ENGINE_VERSION);
    expect(engineVersionFor(base.entries)).toBe(LEGACY_ENGINE_VERSION);
    expect(verifyReplay(base, r)).toBe(true);
  });

  it("a neutral kit changes nothing on the track but labels the race 1.2.0", () => {
    const neutral = withKit(base, 3, { goingPenaltyPermille: 1000, formAmpPermille: 1000, keenPermille: 1000 });
    const a = simulateRace(base);
    const b = simulateRace(neutral);
    expect(b.engineVersion).toBe(ENGINE_VERSION);
    expect(b.frames).toEqual(a.frames);
    expect(b.result.finishOrder).toEqual(a.result.finishOrder);
    // The version is part of the hashed result, so the two proofs differ.
    expect(b.result.resultHash).not.toBe(a.result.resultHash);
    expect(verifyReplay(neutral, b)).toBe(true);
    expect(verifyReplay(base, b)).toBe(false);
  });

  it("is deterministic and verifiable; tampering with a kit fails verification", () => {
    const kitted = withKit(base, 2, { goingPenaltyPermille: 500, formAmpPermille: 800, keenPermille: 500 });
    const a = simulateRace(kitted);
    const b = simulateRace(clone(kitted));
    expect(b).toEqual(a);
    expect(verifyReplay(kitted, a)).toBe(true);
    expect(verifyReplay(withKit(base, 2, { goingPenaltyPermille: 500, formAmpPermille: 900, keenPermille: 500 }), a)).toBe(false);
  });

  it("kit only touches its own runner's form stream: other horses' profiles are unchanged", () => {
    const kitted = withKit(base, 2, { formAmpPermille: 800 });
    for (const gate of [1, 3, 4, 5, 6, 7, 8, 9, 10]) expect(profileOf(kitted, gate)).toEqual(profileOf(base, gate));
  });

  it("shoes take back a share of the going penalty, never more", () => {
    const slow = makeInput([{ stats: { adaptability: 200 } }, { stats: 650 }], { going: "heavy", seed: seedFor(5) });
    const none = profileOf(slow, 1).cruise;
    const half = profileOf(withKit(slow, 1, { goingPenaltyPermille: 500 }), 1).cruise;
    const all = profileOf(withKit(slow, 1, { goingPenaltyPermille: 0 }), 1).cruise;
    // heavy penalty: 300 * (1000 - 200) / 1000 = 240 mm/s; half of it back is 120.
    expect(half - none).toBe(120);
    expect(all - none).toBe(240);
    // On good going there is no going penalty, so shoes do nothing.
    const good = makeInput([{ stats: { adaptability: 200 } }, { stats: 650 }], { going: "good", seed: seedFor(5) });
    expect(profileOf(withKit(good, 1, { goingPenaltyPermille: 500 }), 1).cruise).toBe(profileOf(good, 1).cruise);
  });

  it("a jockey narrows the day-form swing around the same centre", () => {
    let maxBase = 0;
    let maxTop = 0;
    for (let k = 0; k < 200; k++) {
      const input = makeInput([{ stats: { temperament: 400 } }, { stats: 650 }], { seed: seedFor(1000 + k) });
      const centre = profileOf(withKit(input, 1, { formAmpPermille: 0 }), 1).cruise;
      maxBase = Math.max(maxBase, Math.abs(profileOf(input, 1).cruise - centre));
      maxTop = Math.max(maxTop, Math.abs(profileOf(withKit(input, 1, { formAmpPermille: 800 }), 1).cruise - centre));
    }
    // temperament 400: amplitude 220 + 200 * 0.6 = 340; a top jockey's is 272.
    expect(maxBase).toBeLessThanOrEqual(340);
    expect(maxTop).toBeLessThanOrEqual(272);
    expect(maxTop).toBeLessThan(maxBase);
  });

  it("a jockey settles a keen horse: only the extra early drain shrinks", () => {
    const keen = makeInput([{ stats: { temperament: 300 } }, { stats: { temperament: 700 } }], { seed: seedFor(9) });
    expect(profileOf(keen, 1).keenMul).toBe(1100);
    expect(profileOf(withKit(keen, 1, { keenPermille: 500 }), 1).keenMul).toBe(1050);
    // A calm horse has no keen drain to settle.
    expect(profileOf(withKit(keen, 2, { keenPermille: 500 }), 2).keenMul).toBe(1000);
  });

  it("the schema refuses a kit that would add ability (shares above 1000)", () => {
    const bad = withKit(base, 1, { formAmpPermille: 1200 });
    expect(RaceInputSchema.safeParse(bad).success).toBe(false);
    expect(() => simulateRace(bad)).toThrow();
  });
});

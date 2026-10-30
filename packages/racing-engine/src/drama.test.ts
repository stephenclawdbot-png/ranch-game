/**
 * Engine 1.4.0, the close-finish race model (racing in a pack, late battles, steadier day form).
 * Only a race whose input carries `model: "1.4.0"` runs it; every older race keeps its version,
 * replay and result hash. Balance numbers live in tools/balance/drama.report.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { HORSE_LENGTH_MM, type RaceCourse, type RaceInput, type RaceReplay, type RunningStyle } from "@thoroughbred/shared";
import {
  BATTLE_BASE,
  BATTLE_GRIT,
  BATTLE_TEMPER,
  COURSE_ENGINE_VERSION,
  DRAMA_FORM_PERMILLE,
  ENGINE_VERSION,
  KIT_ENGINE_VERSION,
  LEGACY_ENGINE_VERSION,
  PACK_CARRY,
  PACK_PULL,
  battleResponse,
  engineVersionFor,
  packCarried,
  packPull,
  simulateRace,
  verifyReplay,
} from "./index";
import { buildProfile } from "./model";
import { Rng } from "./prng";
import { streamSeedBytes } from "./hash";
import { checkFrames, makeInput, makeStats, seedFor, typicalField, type EntryOpts } from "./test-fixtures";

const COURSE: RaceCourse = { id: "ashcombe", direction: "right", circumferenceM: 2400, homeStraightM: 500, bendsPerLap: 2, bendTightness: 150, finishGradientPermille: 0 };
const live = (input: RaceInput): RaceInput => ({ ...input, model: "1.4.0" });
const STYLES: RunningStyle[] = ["front", "stalker", "closer"];

describe("version selection", () => {
  it("only a race carrying the model runs (and is sealed as) 1.4.0", () => {
    const base = makeInput(typicalField(8, 1600), { seed: seedFor(1) });
    expect(ENGINE_VERSION).toBe("1.4.0");
    expect(engineVersionFor(base.entries)).toBe(LEGACY_ENGINE_VERSION);
    expect(engineVersionFor(base.entries, COURSE)).toBe(COURSE_ENGINE_VERSION);
    expect(engineVersionFor([{ kit: { formAmpPermille: 800 } }])).toBe(KIT_ENGINE_VERSION);
    expect(engineVersionFor(base.entries, null, "1.4.0")).toBe(ENGINE_VERSION);
    expect(engineVersionFor(base.entries, COURSE, "1.4.0")).toBe(ENGINE_VERSION);
    const r = simulateRace(live(base));
    expect(r.engineVersion).toBe("1.4.0");
    expect(verifyReplay(live(base), r)).toBe(true);
    // The model is sealed: the same replay doesn't verify as an older race, nor an older one as 1.4.0.
    expect(verifyReplay(base, r)).toBe(false);
    expect(verifyReplay(live(base), simulateRace(base))).toBe(false);
    // An unknown model is rejected by the schema.
    expect(() => simulateRace({ ...base, model: "9.9.9" } as unknown as RaceInput)).toThrow();
  });

  it("1.4.0 replays pass the frame invariants, with and without a course", () => {
    for (const [k, course] of [null, COURSE].entries()) {
      const input = live(makeInput(typicalField(12, 2000), { distanceM: 2000, going: "soft", weather: "rain", seed: seedFor(40 + k) }));
      const withCourse = course ? { ...input, course } : input;
      const r = simulateRace(withCourse);
      checkFrames(withCourse, r);
      expect(verifyReplay(withCourse, r)).toBe(true);
    }
  });

  it("is deterministic and independent of entry order", () => {
    const input = live(makeInput(typicalField(10, 1400), { distanceM: 1400, seed: seedFor(77) }));
    const a = simulateRace(input);
    const b = simulateRace({ ...input, entries: [...input.entries].reverse() });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("golden 1.4.0 result (cross-version reproducibility guard)", () => {
    const r = simulateRace({ ...live(makeInput(typicalField(8, 1600), { seed: seedFor(2024) })), course: COURSE });
    expect(r.engineVersion).toBe("1.4.0");
    expect(r.result.finishOrder.map((f) => f.horseId).join(",")).toBe("h3,h8,h5,h7,h4,h6,h2,h1");
    expect(r.result.resultHash).toBe("c4fc50f192b22ad77e94a30ca9d2b4b6e9e78881caf21d00f1d8c16c45af31b1");
    expect(bytesToHex(sha256(utf8ToBytes(JSON.stringify([r.frames, r.events]))))).toBe("8a0744167616a1f6c2d30b873a901af002dc6c217cd4ad314bfeff76d5a0e59b");
  });
});

describe("back-compat: Live races stored before the 1.4.0 model existed", () => {
  const stored = JSON.parse(readFileSync(new URL("./fixtures/pre-1.4.0-races.json", import.meta.url), "utf8")) as {
    races: { input: RaceInput; replay: RaceReplay }[];
  };

  it("still verify, and re-simulate byte for byte as 1.3.0", () => {
    expect(stored.races.map((r) => r.replay.engineVersion)).toEqual([COURSE_ENGINE_VERSION, COURSE_ENGINE_VERSION]);
    expect(stored.races[1]!.input.entries.some((e) => e.kit !== undefined)).toBe(true);
    for (const { input, replay } of stored.races) {
      expect(verifyReplay(input, replay)).toBe(true);
      expect(JSON.stringify(simulateRace(input))).toBe(JSON.stringify(replay));
    }
  });

  it("their proofs don't carry over to the new model: adding it is a different race", () => {
    for (const { input, replay } of stored.races) expect(verifyReplay(live(input), replay)).toBe(false);
  });
});

describe("lever: racing in a pack", () => {
  it("pulls a horse PACK_PULL of the way to the field's pace, PACK_CARRY of that free", () => {
    expect(packPull(17_000, 16_600)).toBe(Math.trunc((400 * PACK_PULL) / 1000));
    expect(packPull(17_000, 17_400)).toBe(-Math.trunc((400 * PACK_PULL) / 1000));
    expect(packPull(17_000, 17_000)).toBe(0);
    expect(packCarried(200)).toBe(Math.trunc((200 * PACK_CARRY) / 1000));
    expect(packCarried(-200)).toBe(Math.trunc((-200 * PACK_CARRY) / 1000));
    expect(PACK_PULL).toBeGreaterThan(0);
    expect(PACK_PULL).toBeLessThan(1000);
  });

  it("keeps the field closer together through the race", () => {
    // Leader-to-last spread when the leader passes 60% of the trip, same fields with and without the model.
    let legacy = 0;
    let model = 0;
    for (let s = 0; s < 40; s++) {
      const input = makeInput(typicalField(8, 1600), { seed: seedFor(5_000 + s) });
      legacy += spreadAt(simulateRace(input), 0.6);
      model += spreadAt(simulateRace(live(input)), 0.6);
    }
    expect(model).toBeLessThan(legacy);
  });
});

describe("lever: late battle", () => {
  it("a horse finds base + temperament share + its fight on the day", () => {
    const rng = new Rng(streamSeedBytes(seedFor(9), 1, 4));
    const twin = new Rng(streamSeedBytes(seedFor(9), 1, 4));
    const grit = twin.range(0, BATTLE_GRIT);
    expect(battleResponse(800, rng)).toBe(BATTLE_BASE + Math.trunc((800 * BATTLE_TEMPER) / 1000) + grit);
    // A composed horse fights harder than a hot one with the same draw.
    const hot = battleResponse(300, new Rng(streamSeedBytes(seedFor(9), 1, 4)));
    const calm = battleResponse(900, new Rng(streamSeedBytes(seedFor(9), 1, 4)));
    expect(calm).toBeGreaterThan(hot);
    // Bounded: never more than base + temperament share + grit.
    for (let g = 1; g <= 16; g++) {
      const v = battleResponse(1000, new Rng(streamSeedBytes(seedFor(10), g, 4)));
      expect(v).toBeGreaterThanOrEqual(BATTLE_BASE + BATTLE_TEMPER);
      expect(v).toBeLessThanOrEqual(BATTLE_BASE + BATTLE_TEMPER + BATTLE_GRIT);
    }
  });

  it("two evenly matched horses finish closer: more photos, smaller margins", () => {
    let legacyMargin = 0;
    let modelMargin = 0;
    let legacyPhotos = 0;
    let modelPhotos = 0;
    const N = 120;
    for (let s = 0; s < N; s++) {
      const field: EntryOpts[] = [
        { stats: 640, style: "stalker", preferredDistanceM: 1600 },
        { stats: 640, style: "stalker", preferredDistanceM: 1600 },
      ];
      const input = makeInput(field, { seed: seedFor(6_000 + s) });
      const a = simulateRace(input).result.finishOrder[1]!.marginMm;
      const b = simulateRace(live(input)).result.finishOrder[1]!.marginMm;
      legacyMargin += a;
      modelMargin += b;
      if (a < 700) legacyPhotos++;
      if (b < 700) modelPhotos++;
    }
    expect(modelMargin).toBeLessThan(legacyMargin);
    expect(modelPhotos).toBeGreaterThan(legacyPhotos);
  });
});

describe("lever: steadier day form", () => {
  it("the day-form swing is DRAMA_FORM_PERMILLE of the old one", () => {
    const entry = { gate: 1, tactic: "stalker" as const, horse: makeInput([{ stats: makeStats(600) }]).entries[0]!.horse };
    const race = makeInput([{}]).race;
    let legacyDev = 0;
    let modelDev = 0;
    const base = buildProfile(entry, race, 7000, new Rng(new Uint8Array(16)), false).cruise; // reference only
    const centre = (drama: boolean) => {
      let sum = 0;
      for (let k = 0; k < 400; k++) sum += buildProfile(entry, race, 7000, new Rng(streamSeedBytes(seedFor(k), 1, 1)), drama).cruise;
      return sum / 400;
    };
    const cL = centre(false);
    const cM = centre(true);
    for (let k = 0; k < 400; k++) {
      legacyDev += Math.abs(buildProfile(entry, race, 7000, new Rng(streamSeedBytes(seedFor(k), 1, 1)), false).cruise - cL);
      modelDev += Math.abs(buildProfile(entry, race, 7000, new Rng(streamSeedBytes(seedFor(k), 1, 1)), true).cruise - cM);
    }
    expect(base).toBeGreaterThan(0);
    expect(modelDev / legacyDev).toBeCloseTo(DRAMA_FORM_PERMILLE / 1000, 1);
  });
});

describe("the better horse still wins more", () => {
  it("a horse 100 points better wins far more than its share; one 100 worse rarely wins", () => {
    let better = 0;
    let worse = 0;
    const N = 200;
    for (let s = 0; s < N; s++) {
      const field = (delta: number): EntryOpts[] =>
        Array.from({ length: 8 }, (_, i) => ({ stats: 600 + (i === 0 ? delta : 0), style: STYLES[i % 3]!, preferredDistanceM: 1600, gate: ((i + s) % 8) + 1 }));
      if (simulateRace(live(makeInput(field(100), { seed: seedFor(8_000 + s) }))).result.finishOrder[0]!.horseId === "h1") better++;
      if (simulateRace(live(makeInput(field(-100), { seed: seedFor(8_000 + s) }))).result.finishOrder[0]!.horseId === "h1") worse++;
    }
    expect(better / N).toBeGreaterThan(0.35);
    expect(worse / N).toBeLessThan(0.05);
  });
});

/** Leader-to-last spread (lengths) on the first frame where the leader has run `share` of the trip. */
function spreadAt(r: RaceReplay, share: number): number {
  const n = r.horses.length;
  for (const f of r.frames) {
    const xs = Array.from({ length: n }, (_, h) => f[h * 4]!);
    const lead = Math.max(...xs);
    if (lead >= r.trackLengthMm * share) return (lead - Math.min(...xs)) / HORSE_LENGTH_MM;
  }
  return 0;
}

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { HorseSchema } from "@thoroughbred/shared";
import { currentStats, maturityAt, raceSnapshot, revealedRanges, revealWidth, trainingFactor, toSharedHorse, PEAK_WINDOW } from "./phenotype";
import { meanPotential, potentials } from "./genome";
import { CAREER_MAX_STARTS, CARE_TO_RACING } from "./lifecycle";
import { STAT_KEYS, type MaturityType, type StatKey } from "./types";
import { SILKS, T0, makeHorse } from "./test-helpers";

const statArb = fc.constantFrom<StatKey>(...STAT_KEYS);
const typeArb = fc.constantFrom<MaturityType>("early", "normal", "late");

describe("maturity curves (career clock)", () => {
  it("never regress with care; stay within 300..1000", () => {
    fc.assert(
      fc.property(statArb, typeArb, fc.integer({ min: 0, max: CARE_TO_RACING }), (k, t, c) => {
        const a = maturityAt(k, t, c, 0);
        const b = maturityAt(k, t, c + 1, 0);
        expect(b).toBeGreaterThanOrEqual(a);
        expect(a).toBeGreaterThanOrEqual(300);
        expect(b).toBeLessThanOrEqual(1000);
      }),
    );
  });
  it("peak inside the type's window; early peakers peak earlier than late ones", () => {
    for (const t of ["early", "normal", "late"] as MaturityType[]) {
      const [a, b] = PEAK_WINDOW[t];
      expect(maturityAt("durability", t, CARE_TO_RACING, Math.round((a + b) / 2))).toBe(1000);
    }
    expect(maturityAt("speed", "early", CARE_TO_RACING, 6)).toBeGreaterThan(maturityAt("speed", "late", CARE_TO_RACING, 6));
    expect(maturityAt("speed", "late", CARE_TO_RACING, 34)).toBeGreaterThan(maturityAt("speed", "early", CARE_TO_RACING, 34));
  });
  it("veterans decline, speed fades first; temperament never declines", () => {
    expect(maturityAt("speed", "normal", CARE_TO_RACING, CAREER_MAX_STARTS)).toBeLessThan(maturityAt("stamina", "normal", CARE_TO_RACING, CAREER_MAX_STARTS));
    expect(maturityAt("temperament", "normal", CARE_TO_RACING, CAREER_MAX_STARTS)).toBe(1000);
  });
});

describe("current stats and the race snapshot", () => {
  it("current ≤ potential; snapshot is a valid shared Horse", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 25 }), (seed, starts, care) => {
        const h = makeHorse(seed, { starts, care });
        const cur = currentStats(h);
        const pot = potentials(h.genome);
        for (const k of STAT_KEYS) expect(cur[k]).toBeLessThanOrEqual(Math.min(1000, pot[k] + 20));
        const horse = toSharedHorse(h, T0, SILKS);
        expect(HorseSchema.safeParse(horse).success).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
  it("training realisation 60% → 100% moves the top 20% of the stat", () => {
    expect(trainingFactor(600)).toBe(920);
    expect(trainingFactor(1000)).toBe(1000);
    expect(trainingFactor(980, 50)).toBe(1000);
  });
  it("starters sit on the balance scale: an untrained juvenile shows ~75–90% of potential", () => {
    const h = makeHorse("scale", { rarity: "uncommon" });
    const cur = currentStats(h);
    const mean = STAT_KEYS.reduce((s, k) => s + cur[k], 0) / 6;
    const ratio = mean / meanPotential(h.genome);
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(0.9);
  });
  it("handicap weight, ride modifier and quirks only move stats within bounds", () => {
    const h = makeHorse("snap", { starts: 12 });
    const plain = raceSnapshot(h, { nowMs: T0, silks: SILKS }).horse;
    const weighted = raceSnapshot(h, { nowMs: T0, silks: SILKS, extraWeightLb: 10 }).horse;
    expect(weighted.stats.speed).toBeLessThan(plain.stats.speed);
    const up = raceSnapshot(h, { nowMs: T0, silks: SILKS, plan: { tactic: "front", intensity: "normal", rideModifierPermille: 50 } }).horse;
    expect(up.stats.speed).toBeGreaterThan(plain.stats.speed);
    expect(up.stats.speed).toBeLessThanOrEqual(Math.ceil(plain.stats.speed * 1.05) + 1);
    const mud = { ...h, genome: { ...h.genome, quirks: { ...h.genome.quirks, mudlark: [1, 1] as [1, 1] } } };
    const s = raceSnapshot(mud, { nowMs: T0, silks: SILKS, race: { going: "heavy", fieldSize: 8, bigCrowd: false, surface: "turf", distanceM: 1600 } });
    expect(s.quirksActive).toContain("mudlark");
  });
});

describe("revealed ranges", () => {
  it("contain the truth, are nested as information grows, and become exact", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 39 }), (seed, starts) => {
        const h = makeHorse(seed, { starts });
        const more = makeHorse(seed, { starts: starts + 1 });
        const pot = potentials(h.genome);
        const a = revealedRanges(h);
        const b = revealedRanges(more);
        for (const k of STAT_KEYS) {
          expect(a[k].lo).toBeLessThanOrEqual(pot[k]);
          expect(a[k].hi).toBeGreaterThanOrEqual(pot[k]);
          expect(b[k].lo).toBeGreaterThanOrEqual(a[k].lo);
          expect(b[k].hi).toBeLessThanOrEqual(a[k].hi);
        }
      }),
      { numRuns: 200 },
    );
    const foal = makeHorse("f", { care: 0 });
    const scanned = { ...foal, reveal: { ...foal.reveal, scanned: true } };
    expect(revealWidth(scanned)).toBeLessThan(revealWidth(foal));
    expect(revealWidth(makeHorse("x", { starts: 14 }))).toBe(0);
  });
});

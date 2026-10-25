import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { GoingSchema, RaceReplaySchema, RunningStyleSchema, SurfaceSchema, WeatherSchema, type RaceInput } from "@thoroughbred/shared";
import { simulateRace } from "./index";
import { checkFrames, makeHorse } from "./test-fixtures";

const stat = fc.integer({ min: 0, max: 1000 });
const statsArb = fc.record({ speed: stat, stamina: stat, burst: stat, durability: stat, adaptability: stat, temperament: stat });
const style = fc.constantFrom(...RunningStyleSchema.options);
const surface = fc.constantFrom(...SurfaceSchema.options);

const inputArb: fc.Arbitrary<RaceInput> = fc
  .record({
    gates: fc.uniqueArray(fc.integer({ min: 1, max: 16 }), { minLength: 2, maxLength: 16 }),
    horses: fc.array(
      fc.record({ stats: statsArb, style, tactic: style, surface, pref: fc.integer({ min: 800, max: 4000 }) }),
      { minLength: 16, maxLength: 16 },
    ),
    distanceM: fc.integer({ min: 800, max: 4000 }),
    surface,
    going: fc.constantFrom(...GoingSchema.options),
    weather: fc.constantFrom(...WeatherSchema.options),
    purse: fc.integer({ min: 0, max: 1_000_000 }),
    seed: fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")),
  })
  .map((r) => ({
    race: {
      id: "prop",
      name: "Property Plate",
      distanceM: r.distanceM,
      surface: r.surface,
      weather: r.weather,
      going: r.going,
      raceClass: "maiden" as const,
      postTimeMs: 0,
      purse: r.purse,
    },
    entries: r.gates.map((gate, i) => {
      const h = r.horses[i]!;
      const horse = makeHorse(i + 1, { stats: h.stats, style: h.style, preferredSurface: h.surface, preferredDistanceM: h.pref });
      return { gate, tactic: h.tactic, horse };
    }),
    seed: r.seed,
  }));

describe("property: any valid input", () => {
  it("produces a schema-valid, physically consistent replay", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = simulateRace(input);
        RaceReplaySchema.parse(r);
        checkFrames(input, r);
        const n = input.entries.length;
        const fo = r.result.finishOrder;
        expect(fo.length).toBe(n);
        expect(new Set(fo.map((f) => f.position)).size).toBe(n);
        expect(fo.map((f) => f.position).sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
        expect(new Set(fo.map((f) => f.horseId)).size).toBe(n);
        for (let i = 1; i < n; i++) {
          expect(fo[i]!.finishTimeUs).toBeGreaterThanOrEqual(fo[i - 1]!.finishTimeUs);
          expect(fo[i]!.marginMm).toBeGreaterThanOrEqual(0);
        }
        expect(fo.reduce((s, f) => s + f.prize, 0)).toBe(input.race.purse);
        for (let i = 1; i < r.events.length; i++) expect(r.events[i]!.tick).toBeGreaterThanOrEqual(r.events[i - 1]!.tick);
        expect(r.totalTicks).toBeLessThanOrEqual(20 * 600);
      }),
      { numRuns: 80, seed: 20261025 },
    );
  });

  it("is invariant to entry order", () => {
    fc.assert(
      fc.property(inputArb, fc.integer({ min: 1, max: 1000 }), (input, k) => {
        const a = simulateRace(input);
        const shuffled = { ...input, entries: [...input.entries] };
        for (let i = shuffled.entries.length - 1; i > 0; i--) {
          const j = (k * (i + 7)) % (i + 1);
          [shuffled.entries[i], shuffled.entries[j]] = [shuffled.entries[j]!, shuffled.entries[i]!];
        }
        expect(simulateRace(shuffled).result).toEqual(a.result);
      }),
      { numRuns: 20, seed: 7 },
    );
  });
});

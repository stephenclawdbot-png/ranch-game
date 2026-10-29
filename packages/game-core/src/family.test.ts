import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { FAMILY_HEADROOM, FAMILY_HEADROOM_MIN, familyRange, inherit } from "./genetics";
import { previewBreeding } from "./breeding";
import { overallPotential, potentials } from "./genome";
import { STAT_KEYS, type Genome } from "./types";
import { makeHorse } from "./test-helpers";

const g = (seed: string, rarity: "common" | "rare" | "legendary" = "rare") => makeHorse(seed, { rarity }).genome;
/** A genome with every stat allele shifted by d (clamped), same everything else. */
const shift = (x: Genome, d: number): Genome => ({
  ...x,
  stats: Object.fromEntries(STAT_KEYS.map((k) => [k, x.stats[k].map((a) => Math.max(0, Math.min(1000, a + d)))])) as Genome["stats"],
});

describe("family bounds (lineage sets a foal's lower and upper limit)", () => {
  it("every foal allele stays inside the family range, for any seed, COI and family", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 4 }), (seed, coi, nFam) => {
        const sire = g(`s${seed}`);
        const dam = g(`d${seed}`);
        const family = Array.from({ length: nFam }, (_, i) => g(`f${i}${seed}`, "common"));
        const range = familyRange(sire, dam, family, coi);
        const foal = inherit(sire, dam, seed, { coi, family });
        for (const k of STAT_KEYS) for (const a of foal.stats[k]) {
          expect(a).toBeGreaterThanOrEqual(range[k].floor);
          expect(a).toBeLessThanOrEqual(range[k].ceiling);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("a deep line keeps the full headroom; a one-generation spike keeps less", () => {
    const sire = g("deep-s", "legendary");
    const dam = g("deep-d", "legendary");
    const deep = familyRange(sire, dam, [sire, dam, sire, dam]);
    const spike = familyRange(sire, dam, [shift(sire, -300), shift(dam, -300), shift(sire, -300), shift(dam, -300)]);
    for (const k of STAT_KEYS) {
      const top = Math.max(...sire.stats[k], ...dam.stats[k]);
      expect(deep[k].ceiling).toBe(Math.min(1000, top + FAMILY_HEADROOM));
      expect(spike[k].ceiling).toBe(Math.min(1000, top + FAMILY_HEADROOM_MIN));
      expect(spike[k].centre).toBeLessThan(deep[k].centre);
    }
  });

  it("inbreeding lowers the floor", () => {
    const a = familyRange(g("i-s"), g("i-d"), [], 0);
    const b = familyRange(g("i-s"), g("i-d"), [], 250);
    for (const k of STAT_KEYS) expect(b[k].floor).toBeLessThan(a[k].floor === 0 ? 1 : a[k].floor);
  });

  it("a strong family protects the floor; a weak one lets a mutation drop below the parents", () => {
    // level parents (every allele 500), so only the family differs
    const level = (x: Genome): Genome => ({ ...x, stats: Object.fromEntries(STAT_KEYS.map((k) => [k, [500, 500]])) as Genome["stats"] });
    const sire = level(g("fl-s"));
    const dam = level(g("fl-d"));
    const strong = familyRange(sire, dam, [shift(sire, 250), shift(dam, 250), shift(sire, 250), shift(dam, 250)]);
    const weak = familyRange(sire, dam, [shift(sire, -250), shift(dam, -250), shift(sire, -250), shift(dam, -250)]);
    for (const k of STAT_KEYS) {
      const weakest = Math.min(...sire.stats[k], ...dam.stats[k]);
      expect(strong[k].floor).toBeLessThanOrEqual(weakest);
      expect(strong[k].floor).toBeGreaterThanOrEqual(weak[k].floor);
      expect(strong[k].floor).toBe(weakest);
      expect(weak[k].floor).toBe(weakest - 40);
    }
  });

  it("every real foal lands between the limits the preview showed", () => {
    const s = makeHorse("PL-s", { rarity: "rare", starts: 30 });
    const m = { ...makeHorse("PL-m", { rarity: "rare", sex: "filly", starts: 30 }) };
    const family = [g("gp1"), g("gp2"), g("gp3"), g("gp4")];
    const p = previewBreeding(s, m, {}, 1, family);
    expect(p.limits.lineage).not.toBe("foundation");
    expect(p.limits.overall.floor).toBeLessThanOrEqual(p.overall.p10);
    expect(p.limits.overall.ceiling).toBeGreaterThanOrEqual(p.overall.p90);
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const foal = inherit(s.genome, m.genome, seed, { coi: p.coi, family });
        const pot = potentials(foal);
        for (const k of STAT_KEYS) {
          expect(pot[k]).toBeGreaterThanOrEqual(p.limits.stats[k].floor);
          expect(pot[k]).toBeLessThanOrEqual(p.limits.stats[k].ceiling);
        }
        const o = overallPotential(foal);
        expect(o).toBeGreaterThanOrEqual(p.limits.overall.floor);
        expect(o).toBeLessThanOrEqual(p.limits.overall.ceiling);
      }),
      { numRuns: 200 },
    );
  });

  it("selection can't run away: best-to-best for 8 generations climbs at most the headroom per generation", () => {
    let pop: Genome[] = Array.from({ length: 16 }, (_, i) => g(`pop${i}`));
    const grandOf = new Map<Genome, Genome[]>();
    const best0 = Math.max(...pop.map(overallPotential));
    for (let gen = 0; gen < 8; gen++) {
      pop.sort((a, b) => overallPotential(b) - overallPotential(a));
      const [a, b] = [pop[0]!, pop[1]!];
      const family = [...(grandOf.get(a) ?? []), ...(grandOf.get(b) ?? [])];
      const kids = Array.from({ length: 16 }, (_, i) => inherit(a, b, `gen${gen}-${i}`, { family }));
      for (const kid of kids) grandOf.set(kid, [a, b]);
      pop = kids;
    }
    const best8 = Math.max(...pop.map(overallPotential));
    // allele bound +40 a generation, so expressed overall can't rise faster than that
    expect(best8 - best0).toBeLessThanOrEqual(8 * FAMILY_HEADROOM);
  });
});

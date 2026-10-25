import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { coiOf, inherit, kinBlock, kinship, MUTATION_MAX, mutationParams, VIGOUR_MUTATION_MAX } from "./genetics";
import { generateFoundationGenome, meanPotential } from "./genome";
import { GenomeSchema, STAT_KEYS, type PedigreeEntry } from "./types";

const sire = generateFoundationGenome("sire", { season: 1, rarity: "rare" });
const dam = generateFoundationGenome("dam", { season: 1, rarity: "epic" });

describe("inherit", () => {
  it("is deterministic and schema-valid", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 500 }), (seed, coi) => {
        const a = inherit(sire, dam, seed, { coi });
        expect(inherit(sire, dam, seed, { coi })).toEqual(a);
        expect(GenomeSchema.safeParse(a).success).toBe(true);
        expect(a.coi).toBe(coi);
      }),
      { numRuns: 200 },
    );
  });

  it("takes one allele from each parent per locus (within the bounded mutation)", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const f = inherit(sire, dam, seed);
        for (const k of STAT_KEYS) {
          const [fromS, fromD] = f.stats[k];
          expect(Math.min(...sire.stats[k].map((a) => Math.abs(a - fromS)))).toBeLessThanOrEqual(MUTATION_MAX);
          expect(Math.min(...dam.stats[k].map((a) => Math.abs(a - fromD)))).toBeLessThanOrEqual(MUTATION_MAX);
        }
        expect(Math.min(...sire.vigour.map((a) => Math.abs(a - f.vigour[0])))).toBeLessThanOrEqual(VIGOUR_MUTATION_MAX);
        expect(sire.coat.extension).toContain(f.coat.extension[0]);
        expect(dam.coat.extension).toContain(f.coat.extension[1]);
        expect(sire.surface).toContain(f.surface[0]);
        expect(dam.maturity).toContain(f.maturity[1]);
      }),
      { numRuns: 300 },
    );
  });

  it("mutation is rare at COI 0 and more frequent and more negative with COI", () => {
    const a = mutationParams(0);
    const b = mutationParams(250);
    expect(a.ratePermille).toBeLessThanOrEqual(80);
    expect(b.ratePermille).toBeGreaterThan(a.ratePermille);
    expect(b.negPermille).toBeGreaterThan(a.negPermille);
    let mutated = 0;
    let total = 0;
    for (let i = 0; i < 400; i++) {
      const f = inherit(sire, sire, `m${i}`);
      for (const k of STAT_KEYS) for (const v of f.stats[k]) {
        total++;
        if (!sire.stats[k].includes(v)) mutated++;
      }
    }
    expect(mutated / total).toBeGreaterThan(0.03);
    expect(mutated / total).toBeLessThan(0.1);
  });

  it("provides real segregation variance: two moderate parents can throw a clearly better foal", () => {
    let best = 0;
    const parents = meanPotential(sire) > meanPotential(dam) ? meanPotential(sire) : meanPotential(dam);
    for (let i = 0; i < 300; i++) best = Math.max(best, meanPotential(inherit(sire, dam, `seg${i}`)));
    expect(best).toBeGreaterThan(parents);
  });
});

describe("kinship and COI", () => {
  const ped: Record<string, PedigreeEntry> = {
    A: { sireId: null, damId: null, generation: 0 },
    B: { sireId: null, damId: null, generation: 0 },
    C: { sireId: null, damId: null, generation: 0 },
    S1: { sireId: "A", damId: "B", generation: 1 },
    S2: { sireId: "A", damId: "B", generation: 1 },
    H1: { sireId: "A", damId: "C", generation: 1 },
    X: { sireId: "S1", damId: "S2", generation: 2 },
  };
  it("matches textbook values", () => {
    expect(kinship("A", "B", ped)).toBe(0);
    expect(coiOf("S1", "S2", ped)).toBe(250); // full siblings
    expect(coiOf("S1", "H1", ped)).toBe(125); // half siblings
    expect(coiOf("A", "S1", ped)).toBe(250); // parent-offspring
    expect(kinship("A", "A", ped)).toBe(0.5);
    expect(kinship("X", "X", ped)).toBeCloseTo(0.625, 10); // inbred individual: (1 + 0.25) / 2
  });
  it("is symmetric", () => {
    for (const a of Object.keys(ped)) for (const b of Object.keys(ped)) expect(kinship(a, b, ped)).toBeCloseTo(kinship(b, a, ped), 12);
  });
  it("blocks self, parent-child and full siblings only", () => {
    expect(kinBlock("A", "A", ped)).toBe("self");
    expect(kinBlock("A", "S1", ped)).toBe("parent_child");
    expect(kinBlock("S1", "B", ped)).toBe("parent_child");
    expect(kinBlock("S1", "S2", ped)).toBe("full_siblings");
    expect(kinBlock("S1", "H1", ped)).toBeNull();
    expect(kinBlock("A", "C", ped)).toBeNull();
  });
});

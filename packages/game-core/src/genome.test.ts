import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  alleleCap,
  bestAlleles,
  blendBreeds,
  expressedQuirks,
  generateFoundationGenome,
  gradeOf,
  locusValue,
  maturityType,
  meanCeiling,
  meanPotential,
  overallPotential,
  potentialCeiling,
  potentials,
  preferredDistanceM,
  preferredSurface,
  rarityOf,
  runningStyle,
  vigourValue,
} from "./genome";
import { GenomeSchema, RARITY_ORDER, STAT_KEYS, type Genome, type Rarity } from "./types";

const rarityArb = fc.constantFrom<Rarity>(...RARITY_ORDER);

describe("locus value (partial dominance)", () => {
  it("lies between the alleles, nearer the higher one, and is symmetric", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }), (a, b) => {
        const v = locusValue([a, b]);
        expect(v).toBe(locusValue([b, a]));
        expect(v).toBeGreaterThanOrEqual(Math.min(a, b));
        expect(v).toBeLessThanOrEqual(Math.max(a, b));
        expect(v).toBeGreaterThanOrEqual(Math.floor((a + b) / 2));
      }),
    );
  });
  it("works for negative vigour alleles", () => {
    expect(vigourValue([-100, 100])).toBe(10);
    expect(vigourValue([50, 50])).toBe(50);
  });
});

describe("grades", () => {
  it("maps the design scale (C at 600, A at 800)", () => {
    expect(gradeOf(599)).toBe("D");
    expect(gradeOf(600)).toBe("C");
    expect(gradeOf(799)).toBe("B");
    expect(gradeOf(800)).toBe("A");
    expect(gradeOf(900)).toBe("S");
    expect(gradeOf(0)).toBe("E");
  });
});

describe("foundation minting", () => {
  it("is deterministic and schema-valid", () => {
    fc.assert(
      fc.property(fc.string(), rarityArb, fc.integer({ min: 1, max: 20 }), (seed, rarity, season) => {
        const a = generateFoundationGenome(seed, { season, rarity });
        const b = generateFoundationGenome(seed, { season, rarity });
        expect(a).toEqual(b);
        expect(GenomeSchema.safeParse(a).success).toBe(true);
        expect(JSON.parse(JSON.stringify(a))).toEqual(a);
      }),
      { numRuns: 200 },
    );
  });

  it("respects the season ceilings (per stat, mean, alleles) and hits the requested rarity", () => {
    fc.assert(
      fc.property(fc.string(), rarityArb, fc.integer({ min: 1, max: 20 }), (seed, rarity, season) => {
        const g = generateFoundationGenome(seed, { season, rarity });
        const p = potentials(g);
        for (const k of STAT_KEYS) {
          expect(p[k]).toBeLessThanOrEqual(potentialCeiling(season));
          expect(Math.max(...g.stats[k])).toBeLessThanOrEqual(alleleCap(season, k));
        }
        expect(meanPotential(g)).toBeLessThanOrEqual(meanCeiling(season));
        expect(rarityOf(g)).toBe(rarity);
        expect(g.coi).toBe(0);
      }),
      { numRuns: 400 },
    );
  });

  it("launch ceiling: mean ≤ 600 and no stat above 700 (docs/balance.md)", () => {
    expect(meanCeiling(1)).toBe(600);
    expect(potentialCeiling(1)).toBe(700);
    expect(potentialCeiling(100)).toBeLessThanOrEqual(780);
  });

  it("carries hidden breeding value: some minted alleles sit well above what the horse shows", () => {
    let hidden = 0;
    for (let i = 0; i < 300; i++) {
      const g = generateFoundationGenome(`h${i}`, { season: 1, rarity: "common" });
      const best = bestAlleles(g);
      const p = potentials(g);
      for (const k of STAT_KEYS) if (best[k] - p[k] >= 150) hidden++;
    }
    expect(hidden).toBeGreaterThan(100);
  });

  it("breeds look like their breed (Quarter Horses sprint, Arabians stay)", () => {
    let qhSprint = 0;
    let arStay = 0;
    for (let i = 0; i < 200; i++) {
      if (preferredDistanceM(generateFoundationGenome(`q${i}`, { season: 1, breed: "quarterHorse" })) < 1400) qhSprint++;
      if (preferredDistanceM(generateFoundationGenome(`a${i}`, { season: 1, breed: "arabian" })) >= 1900) arStay++;
    }
    expect(qhSprint).toBeGreaterThan(120);
    expect(arStay).toBeGreaterThan(110);
  });
});

describe("aptitudes", () => {
  const base = generateFoundationGenome("apt", { season: 1 });
  const g = (patch: Partial<Genome>): Genome => ({ ...base, ...patch });
  it("surface: TT turf, DD dirt, TD synthetic", () => {
    expect(preferredSurface(g({ surface: ["T", "T"] }))).toBe("turf");
    expect(preferredSurface(g({ surface: ["D", "D"] }))).toBe("dirt");
    expect(preferredSurface(g({ surface: ["D", "T"] }))).toBe("synthetic");
  });
  it("style rules", () => {
    expect(runningStyle(g({ style: ["front", "closer"] }))).toBe("stalker");
    expect(runningStyle(g({ style: ["stalker", "front"] }))).toBe("front");
    expect(runningStyle(g({ style: ["stalker", "closer"] }))).toBe("closer");
  });
  it("maturity sum rule", () => {
    expect(maturityType(g({ maturity: ["early", "normal"] }))).toBe("early");
    expect(maturityType(g({ maturity: ["early", "late"] }))).toBe("normal");
    expect(maturityType(g({ maturity: ["late", "normal"] }))).toBe("late");
  });
  it("preferred distance stays within the shared contract range", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const d = preferredDistanceM(generateFoundationGenome(s, { season: 1 }));
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThanOrEqual(3200);
        expect(d % 50).toBe(0);
      }),
    );
  });
  it("quirks: recessive need two copies, dominant one", () => {
    const q = { mudlark: [1, 0], gateShy: [0, 1], lateKick: [1, 1], crowdShy: [0, 0] } as Genome["quirks"];
    expect(expressedQuirks(g({ quirks: q })).sort()).toEqual(["gateShy", "lateKick"]);
  });
});

describe("breed shares and inbreeding", () => {
  it("blendBreeds always sums to 1000", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const x = blendBreeds(generateFoundationGenome(a, { season: 1 }).breed, generateFoundationGenome(b, { season: 1 }).breed);
        expect(x.thoroughbred + x.arabian + x.quarterHorse + x.akhalTeke).toBe(1000);
      }),
    );
  });
  it("COI lowers durability and temperament potential only", () => {
    const g = generateFoundationGenome("coi", { season: 1 });
    const inbred = { ...g, coi: 250 };
    const a = potentials(g);
    const b = potentials(inbred);
    expect(b.durability).toBeLessThan(a.durability);
    expect(b.temperament).toBeLessThan(a.temperament);
    expect(b.speed).toBe(a.speed);
    expect(overallPotential(inbred)).toBeLessThan(overallPotential(g));
  });
});

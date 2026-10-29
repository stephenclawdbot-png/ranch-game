import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { appearanceOf } from "./coat";
import { generateFoundationGenome } from "./genome";
import { geneticsLine, geneticsSummary } from "./geneticsSummary";
import { SILKS } from "./test-helpers";
import type { CoatGenes, Genome, QuirkKey } from "./types";

const wild: CoatGenes = {
  extension: ["E", "E"],
  agouti: ["A", "A"],
  cream: ["n", "n"],
  grey: ["n", "n"],
  roan: ["n", "n"],
  dun: ["n", "n"],
  liver: ["L", "L"],
  sabino: ["n", "n"],
};
const g0 = generateFoundationGenome("genetics-summary", { season: 1 });
const withCoat = (c: Partial<CoatGenes>, o: Partial<Genome> = {}): Genome => ({ ...g0, ...o, coat: { ...wild, ...c } });
/** Breed shares with only the original four breeds set (a v2 record, new breeds at 0). */
const breedOf = (thoroughbred: number, arabian: number): Genome["breed"] => ({
  thoroughbred,
  arabian,
  quarterHorse: 0,
  akhalTeke: 0,
  standardbred: 0,
  appaloosa: 0,
  paintHorse: 0,
  mustang: 0,
  andalusian: 0,
  friesian: 0,
  warmblood: 0,
  marwari: 0,
});
const progress = { racingAge: true, starts: 5, retired: false };
const app = (g: Genome) => appearanceOf(g, progress, SILKS);
const summary = (g: Genome, revealed: string[] = []) => geneticsSummary(g, app(g), revealed);

describe("geneticsSummary", () => {
  it("names the phenotype, and greys say what they were born as", () => {
    expect(summary(withCoat({ extension: ["e", "e"], roan: ["Rn", "n"] })).coat.name).toBe("Strawberry Roan");
    const grey = summary(withCoat({ grey: ["G", "n"], extension: ["e", "e"], cream: ["Cr", "n"] }));
    expect(grey.coat.name).toBe("Grey");
    expect(grey.coat.bornAs).toBe("Palomino");
    expect(summary(withCoat({})).coat.bornAs).toBeNull();
  });

  it("writes loci in standard notation and flags what the coat hides", () => {
    const s = summary(withCoat({ extension: ["E", "e"], agouti: ["A", "a"] }));
    const ext = s.coat.loci.find((l) => l.locus === "Extension")!;
    expect(ext).toEqual({ locus: "Extension", alleles: "E/e", meaning: "black pigment (carries red)", carried: true });
    expect(s.coat.loci.find((l) => l.locus === "Agouti")!.carried).toBe(true);
    expect(s.coat.loci.find((l) => l.locus === "Agouti")!.alleles).toBe("A/a");

    const chestnut = summary(withCoat({ extension: ["e", "e"], liver: ["l", "l"] }));
    expect(chestnut.coat.loci.find((l) => l.locus === "Agouti")!.carried).toBe(true);
    expect(chestnut.coat.loci.find((l) => l.locus === "Liver")!.carried).toBe(false);

    const liverOnBlack = summary(withCoat({ liver: ["l", "l"] }));
    expect(liverOnBlack.coat.loci.find((l) => l.locus === "Liver")!.carried).toBe(true);
    // A single cream dose shows (buckskin, palomino): it is not a hidden copy.
    expect(summary(withCoat({ cream: ["Cr", "n"] })).coat.loci.find((l) => l.locus === "Cream")!.carried).toBe(false);
    // Black base: a mixed agouti pair hides its weaker allele; a matching pair hides nothing.
    const agouti = (pair: [string, string]) => summary(withCoat({ extension: ["E", "E"], agouti: pair as never })).coat.loci.find((l) => l.locus === "Agouti")!;
    expect(agouti(["A", "a"])).toMatchObject({ carried: true, meaning: "bay: black kept to the points (carries black)" });
    expect(agouti(["a", "a"])).toMatchObject({ carried: false, meaning: "solid black (no agouti)" });
    expect(agouti(["A", "A"]).carried).toBe(false);
    expect(summary(withCoat({ cream: ["Cr", "Cr"] })).coat.loci.find((l) => l.locus === "Cream")!.carried).toBe(false);
  });

  it("always covers all eight coat loci with non-empty text", () => {
    const s = summary(g0);
    expect(s.coat.loci.map((l) => l.locus)).toEqual(["Extension", "Agouti", "Cream", "Grey", "Roan", "Dun", "Liver", "Sabino"]);
    for (const l of s.coat.loci) {
      expect(l.alleles).toMatch(/^[A-Za-z0-9]+\/[A-Za-z0-9]+$/);
      expect(l.meaning.length).toBeGreaterThan(3);
    }
  });

  it("describes markings, sabino and the white-spotting tendency", () => {
    const plain = summary(withCoat({}, { white: [0, 0] }));
    expect(plain.white.sabino).toBe("n/n");
    expect(plain.white.face).toBe("Plain face");
    expect(plain.white.legs).toBe("No leg markings");
    const loud = summary(withCoat({ sabino: ["Sb1", "Sb1"] }, { white: [100, 100] }));
    expect(loud.white.sabino).toBe("Sb1/Sb1");
    expect(loud.white.tendency).toBe("high");
    expect(summary(withCoat({}, { white: [30, 30] })).white.tendency).toBe("medium");
    expect(summary(withCoat({}, { white: [10, 10] })).white.tendency).toBe("low");
  });

  it("lists non-zero breed shares in %, largest first, under the named-cross label", () => {
    const s = summary(withCoat({}, { breed: breedOf(880, 120) }));
    expect(s.breed).toEqual([
      { key: "thoroughbred", label: "Thoroughbred", share: 88 },
      { key: "arabian", label: "Arabian", share: 12 },
    ]);
    expect(s.breedLabel).toBe("Purebred Thoroughbred");
    expect(s.breedLine).toBe("Purebred Thoroughbred — 88% Thoroughbred · 12% Arabian");
  });

  it("keeps the build to 2–3 descriptive words with no numbers", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const g = generateFoundationGenome(seed, { season: 1 });
        const words = geneticsSummary(g, app(g), []).build.split(", ");
        expect(words.length).toBeGreaterThanOrEqual(2);
        expect(words.length).toBeLessThanOrEqual(3);
        expect(words.join(" ")).not.toMatch(/\d/);
      }),
    );
  });

  it("reports inbreeding as a percent, and 'None' at 0 COI", () => {
    expect(summary(withCoat({}, { coi: 0 })).inbreeding.text).toBe("None");
    expect(summary(withCoat({}, { coi: 34 })).inbreeding.text).toBe("3.4%");
    expect(summary(withCoat({}, { coi: 250 })).inbreeding.text).toBe("25%");
  });

  it("only lists revealed quirks, never the hidden ones", () => {
    const g = withCoat({}, { quirks: { mudlark: [1, 1], gateShy: [1, 1], lateKick: [1, 1], crowdShy: [1, 1] } });
    expect(summary(g, []).quirks).toEqual([]);
    const out = JSON.stringify(summary(g, ["lateKick", "mudlark", "nonsense"]));
    expect(out).toContain("Late kick");
    expect(out).toContain("Mudlark");
    expect(out).not.toContain("Gate-shy");
    expect(out).not.toContain("Crowd-shy");
  });

  it("never leaks stat alleles, vigour, aptitude alleles or potentials", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const g = generateFoundationGenome(seed, { season: 1 });
        const out = summary(g, ["mudlark"]);
        const seen: string[] = [];
        const walk = (v: unknown) => {
          if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) seen.push(k), walk(x);
        };
        walk(out);
        for (const banned of ["stats", "vigour", "distance", "distanceMod", "surface", "style", "maturity", "potential", "markingSeed", "quirkGenes"]) expect(seen).not.toContain(banned);
        const json = JSON.stringify(out);
        for (const stat of Object.values(g.stats)) for (const allele of stat) expect(json).not.toContain(`":${allele}"`);
        expect(json).not.toContain(JSON.stringify(g.vigour));
      }),
    );
  });

  it("is pure: the same inputs give the same summary", () => {
    const g = generateFoundationGenome("stable", { season: 1 });
    expect(summary(g, ["mudlark"])).toEqual(summary(g, ["mudlark"]));
  });
});

describe("geneticsLine", () => {
  it("is coat, sabino and breed mix in one line", () => {
    const g = withCoat({ extension: ["e", "e"], roan: ["Rn", "n"], sabino: ["Sb1", "n"] }, { breed: breedOf(880, 120) });
    expect(geneticsLine(g)).toBe("strawberry roan · Sabino · 88% TB · 12% Arabian");
    // Plain genotype: no sabino part, and the same breed percentages as the summary.
    const plain = withCoat({ agouti: ["a", "a"] });
    const line = geneticsLine(plain).split(" · ");
    const breed = geneticsSummary(plain, app(plain), []).breed;
    expect(line[0]).toBe("black");
    expect(line).toHaveLength(1 + breed.length);
    breed.forEach((b, i) => expect(line[1 + i]).toContain(`${b.share}%`));
  });

  it("matches the summary's coat name (lower-cased)", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const g = generateFoundationGenome(seed, { season: 1 });
        expect(geneticsLine(g).split(" · ")[0]).toBe(geneticsSummary(g, app(g), []).coat.name.toLowerCase());
      }),
    );
  });
});
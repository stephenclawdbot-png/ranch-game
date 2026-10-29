/**
 * Genetics v2 (docs/genetics-v2.md): the v1→v2 upgrade changes nothing about an existing horse,
 * committed v1 coverings still draw the same v1 loci, the new loci inherit Mendelian, the breed
 * mix is the exact average of the parents, and minting hits the per-breed allele frequencies.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appearanceOf, rigLook } from "./coat";
import { breedLabel, geneticsSummary } from "./geneticsSummary";
import { previewBreeding } from "./breeding";
import { inherit } from "./genetics";
import { BREED_PROFILES, G2_LOCI, blendBreeds, generateFoundationGenome, potentials, upgradeGenome, WILD_GENES2 } from "./genome";
import { BREEDS, GenomeSchema, type BreedShares, type Genome, type GenomeV1 } from "./types";
import { SILKS, makeHorse, pedOf } from "./test-helpers";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/v1-foal.json", import.meta.url), "utf8")) as {
  seed: string;
  coi: number;
  sire: GenomeV1;
  dam: GenomeV1;
  foal: GenomeV1;
};

const shares = (o: Partial<Record<(typeof BREEDS)[number], number>>): BreedShares => {
  const out = {} as BreedShares;
  for (const b of BREEDS) out[b] = o[b] ?? 0;
  return out;
};

const wildCoat: Genome["coat"] = { extension: ["E", "E"], agouti: ["A", "A"], cream: ["n", "n"], grey: ["n", "n"], roan: ["n", "n"], dun: ["n", "n"], liver: ["L", "L"], sabino: ["n", "n"] };

describe("upgradeGenome (v1 rows are upgraded on read, never rewritten)", () => {
  const progress = { racingAge: true, starts: 5, retired: false };

  it("fills the new breeds with 0, every new locus wild type, MSTN C/T", () => {
    const g = upgradeGenome(fixture.sire)!;
    expect(g).not.toBeNull();
    expect(GenomeSchema.safeParse(g).success).toBe(true);
    expect(g.version).toBe(2);
    for (const b of BREEDS) expect(g.breed[b]).toBe((fixture.sire.breed as Record<string, number>)[b] ?? 0);
    expect(g.genes2).toEqual(WILD_GENES2);
  });

  it("is a no-op on v2 genomes and rejects non-genomes", () => {
    const v2 = generateFoundationGenome("v2-pass", { season: 1 });
    expect(upgradeGenome(v2)).toEqual(v2);
    expect(upgradeGenome({ nonsense: true })).toBeNull();
    expect(upgradeGenome(null)).toBeNull();
  });

  it("copies every v1 field verbatim, so nothing the v1 code read can change", () => {
    const g = upgradeGenome(fixture.sire)!;
    expect({ ...g, version: undefined, breed: undefined, genes2: undefined }).toEqual({ ...fixture.sire, version: undefined, breed: undefined, genes2: undefined });
  });

  it("changes nothing the player or the renderer can see: potentials, appearance and rig look are genes2-independent and the new shares are 0", () => {
    const g = upgradeGenome(fixture.sire)!;
    // The v2 loci are not read by any v1 code path (no visuals in G1): any genes2 gives the same look.
    const otherGenes2 = { ...WILD_GENES2, champagne: ["Ch", "n"] as ["Ch", "n"], mstn: ["T", "T"] as ["T", "T"] };
    const gAlt = { ...g, genes2: otherGenes2 };
    expect(potentials(g)).toEqual(potentials(gAlt));
    expect(appearanceOf(g, progress, SILKS)).toEqual(appearanceOf(gAlt, progress, SILKS));
    expect(rigLook(g)).toEqual(rigLook(gAlt));
    // A v1 genome's breed shares are untouched (0 for the new breeds), and the four old breed
    // profiles are unchanged, so the breed-weighted morph is exactly what the v1 code computed.
    for (const b of BREEDS) if (!(b in fixture.sire.breed)) expect(g.breed[b]).toBe(0);
  });
});

describe("inherit: v1 loci are byte-identical for committed coverings", () => {
  it("reproduces the pre-v2 snapshot for every v1 field, from the same seed", () => {
    const upSire = upgradeGenome(fixture.sire)!;
    const upDam = upgradeGenome(fixture.dam)!;
    const foal = inherit(upSire, upDam, fixture.seed, { coi: fixture.coi });
    expect({ ...foal, genes2: undefined, breed: undefined, version: undefined }).toEqual({
      ...fixture.foal,
      genes2: undefined,
      breed: undefined,
      version: undefined,
    });
    // The breed is the exact average: v1 parents contribute 0 to the new breeds.
    expect(foal.breed).toEqual(blendBreeds(upSire.breed, upDam.breed));
    expect(GenomeSchema.safeParse(foal).success).toBe(true);
  });

  it("passes one allele per parent at every new locus (Mendelian, separate |g2 stream)", () => {
    const sire = generateFoundationGenome("g2-sire", { season: 1, breed: "paintHorse" });
    const dam = generateFoundationGenome("g2-dam", { season: 1, breed: "appaloosa" });
    for (const seed of ["a", "b", "c", "d"]) {
      const f = inherit(sire, dam, seed);
      for (const [locus] of G2_LOCI) {
        const pair = f.genes2[locus];
        expect(sire.genes2[locus]).toContain(pair[0]);
        expect(dam.genes2[locus]).toContain(pair[1]);
      }
    }
  });
});

describe("breed percentages and named crosses", () => {
  it("blendBreeds averages exactly over all 12 breeds (largest-remainder)", () => {
    const a = shares({ thoroughbred: 1000 });
    const b = shares({ friesian: 700, warmblood: 300 });
    expect(blendBreeds(a, b)).toEqual(shares({ thoroughbred: 500, friesian: 350, warmblood: 150 }));
    const odd = blendBreeds(shares({ thoroughbred: 333, arabian: 333, quarterHorse: 334 }), shares({ marwari: 1000 }));
    expect(BREEDS.reduce((s, k) => s + odd[k], 0)).toBe(1000);
  });

  it("labels purebreds, named crosses and plain crosses at their boundaries", () => {
    expect(breedLabel(shares({ thoroughbred: 875, arabian: 125 }))).toBe("Purebred Thoroughbred");
    expect(breedLabel(shares({ thoroughbred: 874, arabian: 126 }))).toBe("Crossbred (TB × Arabian)");
    expect(breedLabel(shares({ thoroughbred: 500, arabian: 400, quarterHorse: 100 }))).toBe("Anglo-Arab");
    expect(breedLabel(shares({ arabian: 500, thoroughbred: 400 }))).toBe("Anglo-Arab");
    expect(breedLabel(shares({ quarterHorse: 500, thoroughbred: 400 }))).toBe("Appendix Quarter Horse");
    expect(breedLabel(shares({ andalusian: 500, arabian: 400 }))).toBe("Hispano-Arabe");
    // A named cross needs both breeds at 25% and together at 87.5%.
    expect(breedLabel(shares({ thoroughbred: 700, arabian: 200 }))).toBe("Crossbred (TB × Arabian)");
    expect(breedLabel(shares({ thoroughbred: 624, arabian: 250, quarterHorse: 126 }))).toBe("Crossbred (TB × Arabian)");
    expect(breedLabel(shares({ thoroughbred: 626, arabian: 250, quarterHorse: 124 }))).toBe("Anglo-Arab");
  });
});

describe("breeding preview: exact Mendelian odds for the new loci", () => {
  let n = 0;
  const parent = (genes2: Partial<Genome["genes2"]>, coat: Partial<Genome["coat"]> = {}, breed?: Partial<Record<(typeof BREEDS)[number], number>>): Genome => {
    const base = makeHorse(`g2p-${n++}`, { id: "x", sex: "filly", retired: true }).genome;
    return { ...base, coat: { ...wildCoat, ...coat }, genes2: { ...WILD_GENES2, ...genes2 }, breed: shares(breed ?? { thoroughbred: 1000 }) };
  };
  const preview = (sire: Genome, dam: Genome) => previewBreeding({ ...makeHorse("s", { id: "s", sex: "colt", retired: true }), genome: sire }, { ...makeHorse("d", { id: "d", sex: "filly", retired: true }), genome: dam }, pedOf(), 1);
  const odds = (p: ReturnType<typeof previewBreeding>, name: string) => p.traits.find((t) => t.name === name)?.permille ?? 0;

  it("dominant, recessive and incomplete-dominant ratios are exact", () => {
    // Ch/n × n/n = 50%; Ch/n × Ch/n = 75%.
    expect(odds(preview(parent({ champagne: ["Ch", "n"] }), parent({})), "Champagne")).toBe(500);
    expect(odds(preview(parent({ champagne: ["Ch", "n"] }), parent({ champagne: ["Ch", "n"] })), "Champagne")).toBe(750);
    // prl/n × prl/n = 25% pearl; one prl next to a cream allele shows as well.
    expect(odds(preview(parent({ pearl: ["prl", "n"] }), parent({ pearl: ["prl", "n"] })), "Pearl")).toBe(250);
    const withCream = preview(parent({ pearl: ["prl", "n"] }, { cream: ["Cr", "n"] }), parent({ pearl: ["prl", "n"] }));
    expect(odds(withCream, "Pearl")).toBe(500); // 25% prl/prl + 50% prl/n × 50% cream
    // fe/fe × Fe/Fe = 0% feathered; two carriers = 25%.
    expect(odds(preview(parent({ feather: ["fe", "fe"] }), parent({ feather: ["Fe", "Fe"] })), "Feathered legs")).toBe(0);
    expect(odds(preview(parent({ feather: ["Fe", "fe"] }), parent({ feather: ["Fe", "fe"] })), "Feathered legs")).toBe(250);
  });

  it("silver is invisible on chestnut (e/e) foals and flagged as hidden", () => {
    const onRed = preview(parent({ silver: ["Z", "n"] }, { extension: ["e", "e"] }), parent({ silver: ["Z", "n"] }, { extension: ["e", "e"] }));
    expect(odds(onRed, "Silver (black coats)")).toBe(0);
    expect(onRed.hidden.some((h) => h.startsWith("Silver is invisible"))).toBe(true);
    const onBlack = preview(parent({ silver: ["Z", "n"] }, { extension: ["E", "E"] }), parent({ silver: ["Z", "n"] }, { extension: ["E", "E"] }));
    expect(odds(onBlack, "Silver (black coats)")).toBe(750);
  });

  it("PATN1 does nothing without LP; leopard spots need both", () => {
    const noLp = preview(parent({ patn1: ["PATN1", "n"] }), parent({ patn1: ["PATN1", "n"] }));
    expect(odds(noLp, "Leopard spots")).toBe(0);
    expect(noLp.hidden.some((h) => h.startsWith("PATN1 needs"))).toBe(true);
    const both = preview(parent({ leopard: ["LP", "n"], patn1: ["PATN1", "n"] }), parent({ leopard: ["LP", "n"], patn1: ["PATN1", "n"] }));
    expect(odds(both, "Leopard spots")).toBe(563); // 75% LP × 75% PATN1
  });

  it("lists hidden carriers and MSTN types", () => {
    const p = preview(parent({ pearl: ["prl", "n"], bigHeart: ["bh", "n"], mstn: ["C", "C"] }), parent({ pearl: ["prl", "n"], bigHeart: ["bh", "n"], mstn: ["T", "T"] }));
    expect(p.hidden).toContain("Both carry pearl: 25% pearl foal");
    expect(p.hidden.some((h) => h.startsWith("Both carry big heart: 25%"))).toBe(true);
    expect(p.mstn).toEqual({ sprinter: 0, miler: 1000, stayer: 0 });
  });

  it("shows the foal's exact breed % and its label", () => {
    const p = preview(parent({}, {}, { thoroughbred: 1000 }), parent({}, {}, { arabian: 1000 }));
    expect(p.breed.label).toBe("Anglo-Arab");
    expect(p.breed.shares).toEqual([
      { key: "thoroughbred", label: "Thoroughbred", share: 500 },
      { key: "arabian", label: "Arabian", share: 500 },
    ]);
  });
});

describe("geneticsSummary: one line per new locus", () => {
  const g0 = generateFoundationGenome("g2-summary", { season: 1 });
  const withG2 = (genes2: Partial<Genome["genes2"]>, coat: Partial<Genome["coat"]> = {}): Genome => ({
    ...g0,
    coat: { ...g0.coat, ...coat },
    genes2: { ...WILD_GENES2, ...genes2 },
  });
  const summary = (g: Genome) => geneticsSummary(g, appearanceOf(g, { racingAge: true, starts: 0, retired: false }, SILKS), []);
  const line = (g: Genome, locus: string) => g && summary(g).genes2.find((l) => l.locus === locus)!;

  it("covers all 14 loci with non-empty text and standard notation", () => {
    const lines = summary(withG2({})).genes2;
    expect(lines.map((l) => l.locus)).toEqual([
      "Champagne",
      "Silver",
      "Pearl",
      "Tobiano",
      "Leopard complex",
      "Pattern-1",
      "Splash white",
      "Height (LCORL)",
      "Feathering",
      "Speed gene (MSTN)",
      "Big heart",
      "Iron legs",
      "Curled ears",
      "Dished face",
    ]);
    for (const l of lines) {
      expect(l.alleles).toMatch(/^[A-Za-z0-9]+\/[A-Za-z0-9]+$/);
      expect(l.meaning.length).toBeGreaterThan(3);
    }
  });

  it("flags hidden copies: silver on red, pearl, PATN1 without LP, feather carriers", () => {
    expect(line(withG2({ silver: ["Z", "n"] }, { extension: ["e", "e"] }), "Silver").carried).toBe(true);
    expect(line(withG2({ silver: ["Z", "n"] }, { extension: ["E", "E"] }), "Silver").carried).toBe(false);
    expect(line(withG2({ pearl: ["prl", "n"] }), "Pearl").carried).toBe(true);
    expect(line(withG2({ pearl: ["prl", "n"] }, { cream: ["Cr", "n"] }), "Pearl").carried).toBe(false);
    expect(line(withG2({ pearl: ["prl", "prl"] }), "Pearl").carried).toBe(false);
    expect(line(withG2({ patn1: ["PATN1", "n"] }), "Pattern-1").carried).toBe(true);
    expect(line(withG2({ patn1: ["PATN1", "n"], leopard: ["LP", "n"] }), "Pattern-1").carried).toBe(false);
    expect(line(withG2({ feather: ["Fe", "fe"] }), "Feathering").carried).toBe(true);
    expect(line(withG2({ feather: ["fe", "fe"] }), "Feathering").carried).toBe(false);
    expect(line(withG2({ bigHeart: ["bh", "n"] }), "Big heart").carried).toBe(true);
  });
});

describe("minting draws the new loci from the per-breed frequencies", () => {
  it("hits the published frequencies within tolerance (purebred mints out of 10k)", () => {
    const n = 10_000;
    const freq = (breed: (typeof BREEDS)[number], locus: (typeof G2_LOCI)[number][0]) => {
      const [key, freqKey, alt] = G2_LOCI.find((l) => l[0] === locus)!;
      expect(BREED_PROFILES[breed].genes2[freqKey]).toBeGreaterThan(0);
      let altCount = 0;
      let alleles = 0;
      for (let i = 0; i < n && alleles < 6000; i++) {
        const g = generateFoundationGenome(`freq-${breed}-${i}`, { season: 1, breed });
        if (g.breed[breed] !== 1000) continue; // only purebreds carry the breed's own frequencies
        for (const a of g.genes2[key]) altCount += a === alt ? 1 : 0;
        alleles += 2;
      }
      expect(alleles).toBeGreaterThan(4000);
      return altCount / alleles;
    };
    // Appaloosa LP 600‰, PATN1 400‰; Paint tobiano 550‰; Friesian fe 1000‰; Marwari Ce 950‰.
    expect(freq("appaloosa", "leopard")).toBeGreaterThan(0.56);
    expect(freq("appaloosa", "leopard")).toBeLessThan(0.64);
    expect(freq("appaloosa", "patn1")).toBeGreaterThan(0.36);
    expect(freq("appaloosa", "patn1")).toBeLessThan(0.44);
    expect(freq("paintHorse", "tobiano")).toBeGreaterThan(0.52);
    expect(freq("paintHorse", "tobiano")).toBeLessThan(0.58);
    expect(freq("friesian", "feather")).toBe(1);
    expect(freq("marwari", "curledEars")).toBeGreaterThan(0.92);
    expect(freq("marwari", "curledEars")).toBeLessThan(0.98);
  });

  it("gives Club runners even breed weights (evenBreeds), starters keep profile weights", () => {
    const tally = (opts: { evenBreeds?: boolean }) => {
      const tally = {} as Record<(typeof BREEDS)[number], number>;
      for (const b of BREEDS) tally[b] = 0;
      for (let i = 0; i < 2000; i++) {
        const g = generateFoundationGenome(`even-${i}`, { season: 1, ...opts });
        for (const b of BREEDS) if (g.breed[b] >= 700) tally[b]++;
      }
      return tally;
    };
    const even = tally({ evenBreeds: true });
    for (const b of BREEDS) {
      expect(even[b]).toBeGreaterThan((2000 / BREEDS.length) * 0.75);
      expect(even[b]).toBeLessThan((2000 / BREEDS.length) * 1.25);
    }
    const profiled = tally({});
    expect(profiled.thoroughbred).toBeGreaterThan(profiled.marwari * 3); // mintWeight 500 vs 60
  });
});
/**
 * Genetics v2 (docs/genetics-v2.md): the v1→v2 upgrade changes nothing about an existing horse,
 * committed v1 coverings and pack pulls still give the same v1 genes, the new loci inherit
 * Mendelian, the breed mix is the exact average of the parents, size and MSTN are zero-sum,
 * and minting hits the per-breed allele frequencies.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { appearanceOf, rigLook } from "./coat";
import { injuryRisk } from "./condition";
import { breedLabel, geneticsLine, geneticsSummary, visibleTraits } from "./geneticsSummary";
import { previewBreeding } from "./breeding";
import { inherit } from "./genetics";
import {
  BIG_HEART_STAMINA,
  BREED_PROFILES,
  DISTANCE_CENTER_M,
  FRAGILE_DURABILITY_PENALTY,
  G2_LOCI,
  IRON_LEGS_RISK,
  MSTN_STAT_SHIFT,
  MSTN_TRIP_M,
  SIZE_MAX_PERMILLE,
  SIZE_MIN_PERMILLE,
  blendBreeds,
  expressStat,
  generateFoundationGenome,
  generateFoundationGenomeV1,
  locusValue,
  mintForVersion,
  overallOf,
  phenotypeDelta,
  potentials,
  preferredDistanceM,
  sizePermille,
  sizeStatDelta,
  upgradeGenome,
  vigourValue,
} from "./genome";
import { pullPack, NEW_PITY } from "./packs";
import { BREEDS, GenomeSchema, STAT_KEYS, WILD_GENES2, type BreedShares, type Genome, type GenomeV1, type StatRecord } from "./types";
import { SILKS, T0, makeHorse, pedOf, v2Neutral } from "./test-helpers";

const read = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
/** Genetics-v1 genomes and foals as the code produced them right before genetics v2 merged. */
const fixture = read("v1-foal.json") as { seed: string; coi: number; sire: GenomeV1; dam: GenomeV1; foal: GenomeV1; injured: { foals: { seed: string; foal: GenomeV1 }[] } };
const mints = read("v1-mints.json") as {
  mints: { seed: string; opts: { season: number; rarity?: "common" | "legendary" | "rare"; breed?: "arabian" | "quarterHorse" | "akhalTeke" }; genome: GenomeV1 }[];
  pull: { serverSeed: string; accountId: string; season: number; pack: "paddock"; pull: { genome: GenomeV1; pullSeed: string; rarity: "common" } };
};

const shares = (o: Partial<Record<(typeof BREEDS)[number], number>>): BreedShares => {
  const out = {} as BreedShares;
  for (const b of BREEDS) out[b] = o[b] ?? 0;
  return out;
};

const wildCoat: Genome["coat"] = { extension: ["E", "E"], agouti: ["A", "A"], cream: ["n", "n"], grey: ["n", "n"], roan: ["n", "n"], dun: ["n", "n"], liver: ["L", "L"], sabino: ["n", "n"] };

/** The genetics-v1 potential formula, verbatim (alleles, vigour, inbreeding, fragile legs). */
function v1Potentials(g: GenomeV1): StatRecord<number> {
  const out = {} as StatRecord<number>;
  for (const k of STAT_KEYS) {
    const v = expressStat(locusValue(g.stats[k]), vigourValue(g.vigour), k, g.coi);
    out[k] = k === "durability" && g.fragile && g.fragile[0] + g.fragile[1] > 0 ? Math.max(0, v - FRAGILE_DURABILITY_PENALTY) : v;
  }
  return out;
}
/** The genetics-v1 best-trip formula. */
const v1Trip = (g: GenomeV1) =>
  Math.max(1000, Math.min(3200, Math.round(((DISTANCE_CENTER_M[g.distance[0]] + DISTANCE_CENTER_M[g.distance[1]]) / 2 + (g.distanceMod[0] + g.distanceMod[1]) / 2) / 50) * 50));
const strip = (g: object) => ({ ...g, version: undefined, breed: undefined, genes2: undefined, upgradedFrom: undefined });

describe("upgradeGenome (v1 rows are upgraded on read, never rewritten)", () => {
  const progress = { racingAge: true, starts: 5, retired: false };
  const v1s = [fixture.sire, fixture.dam, fixture.foal, ...fixture.injured.foals.map((f) => f.foal), ...mints.mints.map((m) => m.genome)];

  it("fills the new breeds with 0, every new locus wild type (MSTN C/T) and marks the genome", () => {
    const g = upgradeGenome(fixture.sire)!;
    expect(GenomeSchema.safeParse(g).success).toBe(true);
    expect(g.version).toBe(2);
    expect(g.upgradedFrom).toBe(1);
    for (const b of BREEDS) expect(g.breed[b]).toBe((fixture.sire.breed as Record<string, number>)[b] ?? 0);
    expect(g.genes2).toEqual(WILD_GENES2);
    expect(g.genes2.mstn).toEqual(["C", "T"]);
    // Each upgrade gets its own arrays (no shared mutable wild-type object).
    expect(upgradeGenome(fixture.dam)!.genes2.height).not.toBe(g.genes2.height);
  });

  it("is a no-op on v2 genomes and rejects non-genomes", () => {
    const v2 = generateFoundationGenome("v2-pass", { season: 1 });
    expect(upgradeGenome(v2)).toEqual(v2);
    expect(upgradeGenome({ nonsense: true })).toBeNull();
    expect(upgradeGenome(null)).toBeNull();
  });

  it("copies every v1 field verbatim, fragile legs included", () => {
    for (const v1 of v1s) expect(strip(upgradeGenome(v1)!)).toEqual(strip(v1));
    const fragileFoal = fixture.injured.foals.find((f) => f.foal.fragile?.[0] === 1)!.foal;
    expect(upgradeGenome(fragileFoal)!.fragile).toEqual(fragileFoal.fragile);
  });

  it("races, looks and stays exactly as before: v1 potentials, best trip, appearance, rig look", () => {
    for (const v1 of v1s) {
      const g = upgradeGenome(v1)!;
      expect(potentials(g)).toEqual(v1Potentials(v1));
      expect(phenotypeDelta(g)).toEqual({ speed: 0, stamina: 0, burst: 0, durability: 0, adaptability: 0, temperament: 0 });
      expect(preferredDistanceM(g)).toBe(v1Trip(v1));
      // The v1 breed shares and old profiles are unchanged, so look and rig look are the v1 ones.
      const alt = { ...g, genes2: { ...WILD_GENES2, champagne: ["Ch", "n"] as ["Ch", "n"] } };
      expect(appearanceOf(g, progress, SILKS)).toEqual(appearanceOf(alt, progress, SILKS));
      expect(rigLook(g)).toEqual(rigLook(alt));
      expect(visibleTraits(g)).toEqual([]);
    }
  });
});

describe("committed seeds keep their v1 genes", () => {
  it("a covering made before v2 foals the same v1 genes (the |g2 stream is separate)", () => {
    const foal = inherit(upgradeGenome(fixture.sire)!, upgradeGenome(fixture.dam)!, fixture.seed, { coi: fixture.coi });
    expect(strip(foal)).toEqual(strip(fixture.foal));
    expect(foal.breed).toEqual(blendBreeds(upgradeGenome(fixture.sire)!.breed, upgradeGenome(fixture.dam)!.breed));
    expect(foal.upgradedFrom).toBeUndefined(); // a new horse: size counts for it
    expect(GenomeSchema.safeParse(foal).success).toBe(true);
  });

  it("family limits and fragile legs from an injured parent are unchanged too", () => {
    const [s, d] = [upgradeGenome(fixture.sire)!, upgradeGenome(fixture.dam)!];
    for (const { seed, foal } of fixture.injured.foals) {
      const now = inherit(s, d, seed, { coi: fixture.coi, family: [s, d, s, d], injured: { sire: true } });
      expect(strip(now)).toEqual(strip(foal));
      expect(now.fragile).toEqual(foal.fragile);
    }
  });

  it("the v1 mint is byte-identical, so pack pulls made before v2 still verify", () => {
    for (const m of mints.mints) expect(generateFoundationGenomeV1(m.seed, m.opts)).toEqual(m.genome);
    const p = mints.pull;
    const again = pullPack(p.pack, { ...NEW_PITY }, { serverSeed: p.serverSeed, accountId: p.accountId, season: p.season }).pull;
    expect(again.pullSeed).toBe(p.pull.pullSeed);
    expect(mintForVersion(again.pullSeed, { season: p.season, rarity: again.rarity }, 1)).toEqual(p.pull.genome);
    expect(mintForVersion(again.pullSeed, { season: p.season, rarity: again.rarity }, 2)).toEqual(again.genome);
  });
});

describe("inherit: the new loci", () => {
  it("passes one allele per parent at every new locus (Mendelian, separate |g2 stream)", () => {
    const sire = generateFoundationGenome("g2-sire", { season: 1, breed: "paintHorse" });
    const dam = generateFoundationGenome("g2-dam", { season: 1, breed: "appaloosa" });
    for (const seed of ["a", "b", "c", "d"]) {
      const f = inherit(sire, dam, seed);
      for (const [locus] of G2_LOCI) {
        expect(sire.genes2[locus]).toContain(f.genes2[locus][0]);
        expect(dam.genes2[locus]).toContain(f.genes2[locus][1]);
      }
    }
  });

  it("two hidden carriers throw the recessive about 1 in 4 (Friesian red, pearl, big heart)", () => {
    const base = v2Neutral(makeHorse("carrier").genome);
    const sire: Genome = { ...base, coat: { ...wildCoat, extension: ["E", "e"] }, genes2: { ...base.genes2, pearl: ["prl", "n"], bigHeart: ["bh", "n"] } };
    let red = 0;
    let pearl = 0;
    let heart = 0;
    for (let i = 0; i < 2000; i++) {
      const f = inherit(sire, sire, `carrier-${i}`);
      if (f.coat.extension[0] === "e" && f.coat.extension[1] === "e") red++;
      if (f.genes2.pearl[0] === "prl" && f.genes2.pearl[1] === "prl") pearl++;
      if (f.genes2.bigHeart[0] === "bh" && f.genes2.bigHeart[1] === "bh") heart++;
    }
    for (const n of [red, pearl, heart]) {
      expect(n).toBeGreaterThan(420);
      expect(n).toBeLessThan(580);
    }
  });
});

describe("breed percentages and named crosses", () => {
  it("blendBreeds averages exactly over all 12 breeds (largest-remainder)", () => {
    expect(blendBreeds(shares({ thoroughbred: 1000 }), shares({ friesian: 700, warmblood: 300 }))).toEqual(shares({ thoroughbred: 500, friesian: 350, warmblood: 150 }));
    const odd = blendBreeds(shares({ thoroughbred: 333, arabian: 333, quarterHorse: 334 }), shares({ marwari: 1000 }));
    expect(BREEDS.reduce((s, k) => s + odd[k], 0)).toBe(1000);
  });

  it("labels purebreds, named crosses and plain crosses at their boundaries", () => {
    expect(breedLabel(shares({ thoroughbred: 875, arabian: 125 }))).toBe("Purebred Thoroughbred");
    expect(breedLabel(shares({ thoroughbred: 874, arabian: 126 }))).toBe("Crossbred (TB × Arabian)");
    expect(breedLabel(shares({ thoroughbred: 500, arabian: 400, quarterHorse: 100 }))).toBe("Anglo-Arab");
    expect(breedLabel(shares({ quarterHorse: 500, thoroughbred: 400, mustang: 100 }))).toBe("Appendix Quarter Horse");
    expect(breedLabel(shares({ andalusian: 500, arabian: 400, marwari: 100 }))).toBe("Hispano-Arabe");
    expect(breedLabel(shares({ friesian: 600, warmblood: 400 }))).toBe("Crossbred (Friesian × Warmblood)");
    // A named cross needs both breeds at 25% and together at 87.5%.
    expect(breedLabel(shares({ thoroughbred: 700, arabian: 200, mustang: 100 }))).toBe("Crossbred (TB × Arabian)");
    expect(breedLabel(shares({ thoroughbred: 624, arabian: 250, quarterHorse: 126 }))).toBe("Crossbred (TB × Arabian)");
    expect(breedLabel(shares({ thoroughbred: 626, arabian: 250, quarterHorse: 124 }))).toBe("Anglo-Arab");
  });
});

describe("no breed is better overall", () => {
  it("every breed's stat means sum to 2,550–2,630 (the v1 band)", () => {
    for (const b of BREEDS) {
      const sum = STAT_KEYS.reduce((s, k) => s + BREED_PROFILES[b].statMean[k], 0);
      expect(sum, b).toBeGreaterThanOrEqual(2550);
      expect(sum, b).toBeLessThanOrEqual(2630);
    }
  });

  it("purebred mints of every breed hit the same rarity band: mean overall potential within sampling noise", () => {
    const mean: Record<string, number> = {};
    for (const b of BREEDS) {
      let s = 0;
      for (let i = 0; i < 200; i++) s += overallOf(potentials(generateFoundationGenome(`band-${b}-${i}`, { season: 1, breed: b, rarity: "rare" })));
      mean[b] = s / 200;
    }
    const vals = Object.values(mean);
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThan(3); // sampling noise only (sd ≈ 0.5)
  });
});

describe("size, MSTN and big heart (phenotype only, zero-sum)", () => {
  const zero = (d: StatRecord<number>) => STAT_KEYS.reduce((s, k) => s + d[k], 0);

  it("size and MSTN never change the stat total; big heart adds exactly its stamina", () => {
    for (let s = SIZE_MIN_PERMILLE; s <= SIZE_MAX_PERMILLE; s++) expect(zero(sizeStatDelta(s))).toBe(0);
    expect(sizeStatDelta(60)).toMatchObject({ speed: 12, stamina: 6, burst: -12, durability: -6 });
    expect(sizeStatDelta(-60)).toMatchObject({ speed: -12, stamina: -6, burst: 12, durability: 6 });
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const g = generateFoundationGenome(seed, { season: 1 });
        const bh = g.genes2.bigHeart[0] === "bh" && g.genes2.bigHeart[1] === "bh";
        expect(zero(phenotypeDelta(g))).toBe(bh ? BIG_HEART_STAMINA : 0);
        expect(sizePermille(g)).toBeGreaterThanOrEqual(SIZE_MIN_PERMILLE);
        expect(sizePermille(g)).toBeLessThanOrEqual(SIZE_MAX_PERMILLE);
      }),
      { numRuns: 200 },
    );
  });

  it("size = breed size + polygenic height + 3% per Ht copy", () => {
    const g = v2Neutral(makeHorse("size").genome); // pure Standardbred: size 0
    expect(sizePermille(g)).toBe(0);
    expect(sizePermille({ ...g, genes2: { ...g.genes2, height: ["Ht", "n"] } })).toBe(30);
    expect(sizePermille({ ...g, genes2: { ...g.genes2, height: ["Ht", "Ht"] } })).toBe(60);
    expect(sizePermille({ ...g, breed: shares({ warmblood: 1000 }) })).toBe(60);
    expect(sizePermille({ ...g, breed: shares({ mustang: 1000 }) })).toBe(-60);
    expect(sizePermille({ ...g, morph: { ...g.morph, height: [1000, 1000] } })).toBe(30);
    expect(sizePermille({ ...g, breed: shares({ warmblood: 1000 }), genes2: { ...g.genes2, height: ["Ht", "Ht"] }, morph: { ...g.morph, height: [1000, 1000] } })).toBe(SIZE_MAX_PERMILLE);
  });

  it("a taller foal of the same alleles has more speed and stamina, less burst and durability", () => {
    const g = v2Neutral(makeHorse("tall").genome);
    const tall = potentials({ ...g, genes2: { ...g.genes2, height: ["Ht", "Ht"] } });
    const base = potentials(g);
    expect(tall.speed - base.speed).toBe(12);
    expect(tall.stamina - base.stamina).toBe(6);
    expect(tall.burst - base.burst).toBe(-12);
    expect(tall.durability - base.durability).toBe(-6);
  });

  it("MSTN: C/C sprinter, T/T stayer; best trip ∓200 m and burst against stamina ±15", () => {
    const g = v2Neutral(makeHorse("mstn").genome);
    const c = { ...g, genes2: { ...g.genes2, mstn: ["C", "C"] as ["C", "C"] } };
    const t = { ...g, genes2: { ...g.genes2, mstn: ["T", "T"] as ["T", "T"] } };
    const raw = (x: Genome) => Math.round(((DISTANCE_CENTER_M[x.distance[0]] + DISTANCE_CENTER_M[x.distance[1]]) / 2 + (x.distanceMod[0] + x.distanceMod[1]) / 2) / 50) * 50;
    const mid = { ...g, distance: ["middle", "middle"] as Genome["distance"], distanceMod: [0, 0] as [number, number] };
    expect(preferredDistanceM({ ...mid, genes2: c.genes2 })).toBe(raw(mid) - MSTN_TRIP_M);
    expect(preferredDistanceM({ ...mid, genes2: t.genes2 })).toBe(raw(mid) + MSTN_TRIP_M);
    expect(potentials(c).burst - potentials(g).burst).toBe(MSTN_STAT_SHIFT);
    expect(potentials(c).stamina - potentials(g).stamina).toBe(-MSTN_STAT_SHIFT);
    expect(potentials(t).stamina - potentials(g).stamina).toBe(MSTN_STAT_SHIFT);
  });

  it("big heart is recessive: +25 stamina with two copies only", () => {
    const g = v2Neutral(makeHorse("heart").genome);
    expect(potentials({ ...g, genes2: { ...g.genes2, bigHeart: ["bh", "n"] } }).stamina).toBe(potentials(g).stamina);
    expect(potentials({ ...g, genes2: { ...g.genes2, bigHeart: ["bh", "bh"] } }).stamina).toBe(potentials(g).stamina + BIG_HEART_STAMINA);
  });

  it("iron legs (dominant) cut the injury risk by 20%", () => {
    const h = makeHorse("iron", { starts: 5 });
    const ctx = { nowMs: T0, going: "good" as const, distanceM: 1600, intensity: "normal" as const, stage: "prime" as const };
    const plain = { ...h, genome: { ...h.genome, genes2: { ...h.genome.genes2, ironLegs: ["n", "n"] as ["n", "n"] } } };
    const iron = { ...h, genome: { ...h.genome, genes2: { ...h.genome.genes2, ironLegs: ["IL", "n"] as ["IL", "n"] } } };
    const r = injuryRisk(iron, ctx);
    expect(r.factors.find((f) => f.key === "ironLegs")?.multiplier).toBe(IRON_LEGS_RISK);
    expect(injuryRisk(plain, ctx).factors.some((f) => f.key === "ironLegs")).toBe(false);
  });
});

describe("breeding preview: exact Mendelian odds for the new loci", () => {
  let n = 0;
  const parent = (genes2: Partial<Genome["genes2"]>, coat: Partial<Genome["coat"]> = {}, breed?: Partial<Record<(typeof BREEDS)[number], number>>): Genome => {
    const base = v2Neutral(makeHorse(`g2p-${n++}`, { id: "x", sex: "filly", retired: true }).genome);
    return { ...base, coat: { ...wildCoat, ...coat }, genes2: { ...WILD_GENES2, ...genes2 }, breed: shares(breed ?? { thoroughbred: 1000 }) };
  };
  const preview = (sire: Genome, dam: Genome) => previewBreeding({ ...makeHorse("s", { id: "s", sex: "colt", retired: true }), genome: sire }, { ...makeHorse("d", { id: "d", sex: "filly", retired: true }), genome: dam }, pedOf(), 1);
  const odds = (p: ReturnType<typeof previewBreeding>, name: string) => p.traits.find((t) => t.name.startsWith(name))?.permille ?? 0;

  it("dominant, recessive and incomplete-dominant ratios are exact", () => {
    expect(odds(preview(parent({ champagne: ["Ch", "n"] }), parent({})), "Champagne")).toBe(500);
    expect(odds(preview(parent({ champagne: ["Ch", "n"] }), parent({ champagne: ["Ch", "n"] })), "Champagne")).toBe(750);
    expect(odds(preview(parent({ pearl: ["prl", "n"] }), parent({ pearl: ["prl", "n"] })), "Pearl")).toBe(250);
    const withCream = preview(parent({ pearl: ["prl", "n"] }, { cream: ["Cr", "n"] }), parent({ pearl: ["prl", "n"] }));
    expect(odds(withCream, "Pearl")).toBe(500); // 25% prl/prl + 50% prl/n × 50% cream
    expect(odds(preview(parent({ feather: ["fe", "fe"] }), parent({ feather: ["Fe", "Fe"] })), "Feathered legs")).toBe(0);
    expect(odds(preview(parent({ feather: ["Fe", "fe"] }), parent({ feather: ["Fe", "fe"] })), "Feathered legs")).toBe(250);
    const dish = preview(parent({ dish: ["Dh", "n"] }), parent({ dish: ["Dh", "n"] }));
    expect(odds(dish, "Slight dish")).toBe(500);
    expect(odds(dish, "Classic dish")).toBe(250);
    expect(odds(preview(parent({ ironLegs: ["IL", "n"] }), parent({})), "Iron legs")).toBe(500);
  });

  it("silver is invisible on chestnut (e/e) foals and flagged as hidden", () => {
    const onRed = preview(parent({ silver: ["Z", "n"] }, { extension: ["e", "e"] }), parent({ silver: ["Z", "n"] }, { extension: ["e", "e"] }));
    expect(odds(onRed, "Silver")).toBe(0);
    expect(onRed.hidden.some((h) => h.startsWith("Silver is invisible"))).toBe(true);
    const onBlack = preview(parent({ silver: ["Z", "n"] }, { extension: ["E", "E"] }), parent({ silver: ["Z", "n"] }, { extension: ["E", "E"] }));
    expect(odds(onBlack, "Silver")).toBe(750);
  });

  it("PATN1 does nothing without LP; LP/n with PATN1 spots, without it varnish roan; LP/LP few-spot", () => {
    const noLp = preview(parent({ patn1: ["PATN1", "n"] }), parent({ patn1: ["PATN1", "n"] }));
    expect(odds(noLp, "Leopard spots")).toBe(0);
    expect(noLp.hidden.some((h) => h.startsWith("Pattern-1 needs"))).toBe(true);
    const both = preview(parent({ leopard: ["LP", "n"], patn1: ["PATN1", "n"] }), parent({ leopard: ["LP", "n"], patn1: ["PATN1", "n"] }));
    expect(odds(both, "Leopard spots")).toBe(375); // 50% LP/n × 75% PATN1
    expect(odds(both, "Varnish roan")).toBe(125); // 50% LP/n × 25% no PATN1
    expect(odds(both, "Few-spot")).toBe(250);
  });

  it("lists hidden carriers, MSTN types and the size range", () => {
    const p = preview(parent({ pearl: ["prl", "n"], bigHeart: ["bh", "n"], mstn: ["C", "C"] }), parent({ pearl: ["prl", "n"], bigHeart: ["bh", "n"], mstn: ["T", "T"] }));
    expect(p.hidden).toContain("Both carry pearl: 25% pearl foal");
    expect(p.hidden.some((h) => h.startsWith("Both carry big heart: 25%"))).toBe(true);
    expect(p.mstn).toEqual({ sprinter: 0, miler: 1000, stayer: 0 });
    // Pure TB parents, level polygenic height, no Ht: every foal is +3%.
    expect(p.size).toEqual({ min: 3, max: 3, likely: 3 });
    const ht = preview(parent({ height: ["Ht", "n"] }), parent({ height: ["Ht", "n"] }));
    expect(ht.size).toEqual({ min: 3, max: 9, likely: 6 });
  });

  it("the foal's exact breed % and its label", () => {
    const p = preview(parent({}, {}, { thoroughbred: 1000 }), parent({}, {}, { arabian: 1000 }));
    expect(p.breed.label).toBe("Anglo-Arab");
    expect(p.breed.shares).toEqual([
      { key: "arabian", label: "Arabian", share: 500 },
      { key: "thoroughbred", label: "Thoroughbred", share: 500 },
    ]);
  });

  it("the stat odds include size: a tall-line pairing previews more speed and less burst", () => {
    const [a, b] = [parent({}), parent({})];
    const asBreed = (g: Genome, breed: (typeof BREEDS)[number]) => ({ ...g, breed: shares({ [breed]: 1000 }) });
    const short = preview(asBreed(a, "mustang"), asBreed(b, "mustang"));
    const tall = preview(asBreed(a, "warmblood"), asBreed(b, "warmblood"));
    // The same alleles on both sides (v2Neutral keeps them), ±6% size: speed ±12, burst ∓12.
    expect(tall.stats.speed.expected - short.stats.speed.expected).toBe(24);
    expect(tall.stats.burst.expected - short.stats.burst.expected).toBe(-24);
  });
});

describe("geneticsSummary: one line per new locus", () => {
  const g0 = v2Neutral(generateFoundationGenome("g2-summary", { season: 1 }));
  const withG2 = (genes2: Partial<Genome["genes2"]>, coat: Partial<Genome["coat"]> = {}): Genome => ({ ...g0, coat: { ...g0.coat, ...coat }, genes2: { ...WILD_GENES2, ...genes2 } });
  const summary = (g: Genome, heartKnown = true) => geneticsSummary(g, appearanceOf(g, { racingAge: true, starts: 0, retired: false }, SILKS), [], { heartKnown });
  const line = (g: Genome, locus: string) => summary(g).genes2.find((l) => l.locus === locus)!;

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

  it("big heart stays unknown until the horse races or is scanned", () => {
    const g = withG2({ bigHeart: ["bh", "bh"] });
    const hidden = summary(g, false).genes2.find((l) => l.locus === "Big heart")!;
    expect(hidden.alleles).toBe("?/?");
    expect(hidden.meaning).not.toMatch(/stamina/);
    expect(summary(g, true).genes2.find((l) => l.locus === "Big heart")!.alleles).toBe("bh/bh");
  });

  it("flags hidden copies: silver on red, pearl, PATN1 without LP, feather and big-heart carriers", () => {
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

  it("lists visible traits as text (no renderer draws them yet), on the card line too", () => {
    const g = withG2({ tobiano: ["TO", "n"], leopard: ["LP", "n"], patn1: ["PATN1", "n"], champagne: ["Ch", "n"], silver: ["Z", "n"] }, { extension: ["e", "e"] });
    expect(summary(g).traits).toEqual(["Champagne", "Tobiano", "Leopard"]); // silver hidden on red
    expect(geneticsLine(g)).toContain("Tobiano");
    expect(summary(withG2({})).traits).toEqual([]);
    expect(summary(withG2({ height: ["Ht", "Ht"] })).size).toEqual({ pct: 6, text: "Tall (+6%)", effect: "speed +12 · stamina +6 · burst −12 · durability −6" });
  });
});

describe("minting draws the new loci from the per-breed frequencies", () => {
  it("hits the published frequencies within tolerance (purebred mints)", () => {
    const freq = (breed: (typeof BREEDS)[number], locus: (typeof G2_LOCI)[number][0]) => {
      const [key, freqKey, alt] = G2_LOCI.find((l) => l[0] === locus)!;
      expect(BREED_PROFILES[breed].genes2[freqKey]).toBeGreaterThan(0);
      let altCount = 0;
      let alleles = 0;
      for (let i = 0; i < 10_000 && alleles < 6000; i++) {
        const g = generateFoundationGenome(`freq-${breed}-${i}`, { season: 1, breed });
        if (g.breed[breed] !== 1000) continue; // only purebreds carry the breed's own frequencies
        for (const a of g.genes2[key]) altCount += a === alt ? 1 : 0;
        alleles += 2;
      }
      expect(alleles).toBeGreaterThan(4000);
      return altCount / alleles;
    };
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

  it("gives Club runners even breed weights (evenBreeds); starters keep profile weights", () => {
    const tally = (opts: { evenBreeds?: boolean }) => {
      const t = {} as Record<(typeof BREEDS)[number], number>;
      for (const b of BREEDS) t[b] = 0;
      for (let i = 0; i < 2000; i++) {
        const g = generateFoundationGenome(`even-${i}`, { season: 1, ...opts });
        for (const b of BREEDS) if (g.breed[b] >= 700) t[b]++;
      }
      return t;
    };
    const even = tally({ evenBreeds: true });
    for (const b of BREEDS) {
      expect(even[b]).toBeGreaterThan((2000 / BREEDS.length) * 0.75);
      expect(even[b]).toBeLessThan((2000 / BREEDS.length) * 1.25);
    }
    expect(tally({}).thoroughbred).toBeGreaterThan(tally({}).marwari * 3); // mintWeight 500 vs 60
  });
});

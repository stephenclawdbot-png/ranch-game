import { describe, expect, it } from "vitest";
import { HorseAppearanceSchema } from "@thoroughbred/shared";
import {
  NATURAL_RARE_PERMILLE,
  RARE_ALLELE,
  RARE_COLOURS,
  WILD_COSMETIC,
  carriedRareColours,
  foalSexOf,
  houseStudRareColour,
  inheritCosmetic,
  mintCosmetic,
  rareShows,
  showRareColour,
} from "./cosmetic";
import { appearanceOf, fullCoatName, horseColour } from "./coat";
import { inherit } from "./genetics";
import { generateFoundationGenome, phenotypeDelta, potentials, preferredDistanceM } from "./genome";
import { pullPack, expectedPullGenome } from "./packs";
import { createStarterStable } from "./onboarding";
import { appraise } from "./economy";
import { injuryRisk } from "./condition";
import { raceSnapshot } from "./phenotype";
import { makeHorse } from "./test-helpers";
import { Rng, seedFrom } from "./rng";
import type { CosmeticGenes, Genome } from "./types";

const SILKS = { primary: "#123456", secondary: "#abcdef", pattern: "solid", cap: "#123456" } as const;
const adult = { racingAge: true, starts: 5, retired: false };
const base = generateFoundationGenome("cosmetic-base", { season: 1 });
const withCos = (c: Partial<CosmeticGenes>, g: Genome = base): Genome => ({ ...g, cosmetic: { ...WILD_COSMETIC, ...c } });

describe("cosmetic genes: inheritance", () => {
  it("mushroom is recessive: two carriers give about a quarter mu/mu, one carrier never shows", () => {
    const carrier = withCos({ mushroom: ["mu", "n"] });
    let shows = 0;
    let carriers = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const c = inheritCosmetic(carrier, carrier, `mu-${i}`)!;
      if (c.mushroom[0] === "mu" && c.mushroom[1] === "mu") shows++;
      else if (c.mushroom.includes("mu")) carriers++;
    }
    expect(shows / N).toBeGreaterThan(0.21);
    expect(shows / N).toBeLessThan(0.29);
    expect(carriers / N).toBeGreaterThan(0.45);
    // carrier x wild: never shows
    for (let i = 0; i < 500; i++) expect(inheritCosmetic(carrier, withCos({}), `mu-w-${i}`)!.mushroom.filter((a) => a === "mu").length).toBeLessThan(2);
  });

  it("brindle is X-linked: a brindle stallion passes it to every daughter and no son", () => {
    const sire = withCos({ brindle: ["BR1", "n"] });
    const dam = withCos({});
    for (let i = 0; i < 600; i++) {
      const seed = `br-s-${i}`;
      const c = inheritCosmetic(sire, dam, seed)!;
      const shows = c.brindle.includes("BR1");
      expect(shows).toBe(foalSexOf(seed) === "filly");
      if (foalSexOf(seed) === "colt") expect(c.brindle[1]).toBe("n");
    }
  });

  it("brindle is X-linked: a brindle mare passes it to about half her foals, sons and daughters alike", () => {
    const sire = withCos({});
    const dam = withCos({ brindle: ["BR1", "n"] });
    const tally = { colt: [0, 0], filly: [0, 0] };
    for (let i = 0; i < 4000; i++) {
      const seed = `br-d-${i}`;
      const sex = foalSexOf(seed);
      tally[sex][1]!++;
      if (inheritCosmetic(sire, dam, seed)!.brindle.includes("BR1")) tally[sex][0]!++;
    }
    for (const sex of ["colt", "filly"] as const) {
      const r = tally[sex][0]! / tally[sex][1]!;
      expect(r).toBeGreaterThan(0.44);
      expect(r).toBeLessThan(0.56);
    }
  });

  it("foal sex used by the brindle rule is the sex the foal is delivered with", () => {
    for (let i = 0; i < 50; i++) expect(foalSexOf(`s${i}`)).toBe(new Rng(`s${i}|sex`).chance(500) ? "colt" : "filly");
  });

  it("dominant rare colours pass to about half the foals of a heterozygous parent", () => {
    for (const k of ["rabicano", "dominantWhite", "bendOr", "birdcatcher"] as const) {
      const carrier = withCos({ [k]: [RARE_ALLELE[k], "n"] } as Partial<CosmeticGenes>);
      let n = 0;
      for (let i = 0; i < 2000; i++) if (inheritCosmetic(carrier, withCos({}), `${k}-${i}`)![k].includes(RARE_ALLELE[k] as never)) n++;
      expect(n / 2000).toBeGreaterThan(0.44);
      expect(n / 2000).toBeLessThan(0.56);
    }
  });

  it("shade modifiers are polygenic: foals land between their parents", () => {
    const hi = withCos({ sooty: [90, 90] });
    const lo = withCos({ sooty: [10, 10] });
    for (let i = 0; i < 200; i++) {
      const c = inheritCosmetic(hi, lo, `sh-${i}`)!;
      expect(c.sooty[0]).toBeGreaterThanOrEqual(84);
      expect(c.sooty[1]).toBeLessThanOrEqual(16);
    }
  });

  it("a line from before the cosmetic genes stays without them; inherit carries them otherwise", () => {
    const old = { ...base, cosmetic: undefined };
    expect(inherit(old, old, "old-line").cosmetic).toBeUndefined();
    expect(inherit(withCos({ rabicano: ["Rb", "Rb"] }), old, "mixed").cosmetic!.rabicano).toContain("Rb");
  });
});

describe("cosmetic genes never touch performance", () => {
  const variants: Partial<CosmeticGenes>[] = [
    {},
    { sooty: [100, 100], flaxen: [100, 100], pangare: [100, 100] },
    { mushroom: ["mu", "mu"], rabicano: ["Rb", "Rb"], brindle: ["BR1", "BR1"], dominantWhite: ["W", "W"], bendOr: ["BO", "BO"], birdcatcher: ["Bc", "Bc"] },
  ];
  it("potentials, size, trip, appraisal, injury risk and the race snapshot are identical", () => {
    for (let s = 0; s < 12; s++) {
      const h = makeHorse(`perf-${s}`, { starts: 3 });
      const states = variants.map((v) => ({ ...h, genome: withCos(v, h.genome) }));
      const plain = { ...h, genome: { ...h.genome, cosmetic: undefined } };
      for (const st of [plain, ...states]) {
        expect(potentials(st.genome)).toEqual(potentials(h.genome));
        expect(phenotypeDelta(st.genome)).toEqual(phenotypeDelta(h.genome));
        expect(preferredDistanceM(st.genome)).toBe(preferredDistanceM(h.genome));
        expect(appraise(st)).toBe(appraise(h));
        const ctx = { nowMs: 0, going: "good", distanceM: 1600, intensity: "normal", stage: "racing" } as unknown as Parameters<typeof injuryRisk>[1];
        expect(injuryRisk(st, ctx)).toEqual(injuryRisk(h, ctx));
        const snap = (x: typeof h) => {
          const r = raceSnapshot(x, { nowMs: 0, silks: SILKS, race: { surface: "turf", distanceM: 1600, going: "good", fieldSize: 8 } as never });
          return { stats: r.horse.stats, cond: r.conditionPermille, quirks: r.quirksActive };
        };
        expect(snap(st)).toEqual(snap(h));
      }
    }
  });

  it("the foal's every other gene is the same whatever the parents' cosmetic genes", () => {
    const sire = makeHorse("perf-sire").genome;
    const dam = makeHorse("perf-dam").genome;
    const strip = (g: Genome) => ({ ...g, cosmetic: undefined });
    const a = inherit({ ...sire, cosmetic: undefined }, { ...dam, cosmetic: undefined }, "foal-seed");
    for (const v of variants) {
      const b = inherit(withCos(v, sire), withCos(v, dam), "foal-seed");
      expect(strip(b)).toEqual(strip(a));
    }
  });

  it("minting with or without rare colours gives the same horse apart from them", () => {
    const strip = (g: Genome) => ({ ...g, cosmetic: undefined });
    for (let i = 0; i < 20; i++) {
      const seed = `mint-${i}`;
      const a = generateFoundationGenome(seed, { season: 1, rarity: "rare" });
      for (const r of ["natural", ...RARE_COLOURS] as const) expect(strip(generateFoundationGenome(seed, { season: 1, rarity: "rare", rareColours: r }))).toEqual(strip(a));
    }
  });
});

describe("where rare colours come from (owner decision)", () => {
  it("default mints (starters, gifts, Club runners, Club sale lots and leases) never carry a rare colour", () => {
    for (let i = 0; i < 3000; i++) {
      const g = generateFoundationGenome(seedFrom("club-lot", i), { season: 1, evenBreeds: true });
      expect(carriedRareColours(g)).toEqual([]);
    }
    for (let i = 0; i < 40; i++) for (const h of createStarterStable({ ownerId: "o", seed: `st-${i}`, nowMs: 0, season: 1 })) expect(carriedRareColours(h.genome)).toEqual([]);
  });

  it("pack foals carry them at population frequency only (no special odds)", () => {
    const counts = Object.fromEntries(RARE_COLOURS.map((k) => [k, 0])) as Record<(typeof RARE_COLOURS)[number], number>;
    const N = 6000;
    for (let i = 0; i < N; i++) {
      const g = mintCosmetic(`pack-${i}`, base.breed, "natural");
      for (const k of RARE_COLOURS) counts[k] += g[k].filter((a) => a === RARE_ALLELE[k]).length;
    }
    for (const k of RARE_COLOURS) {
      const draws = k === "brindle" ? N : 2 * N; // brindle: one X per mint
      const expected = (NATURAL_RARE_PERMILLE[k] / 1000) * draws;
      expect(counts[k]).toBeLessThan(expected * 1.8 + 6);
      expect(counts[k]).toBeGreaterThan(expected * 0.35);
    }
    const pull = pullPack("paddock", { pulls: 0, sinceRare: 0, sinceEpic: 0 }, { serverSeed: "a".repeat(64), accountId: "acc", season: 1 }).pull;
    expect(pull.genome.cosmetic).toBeDefined();
  });

  it("house stallions: every third replacement stands for one rare colour, in turn; the first roster none", () => {
    expect([0, 1, 2, 3].map((n) => houseStudRareColour(n, 4))).toEqual([null, null, null, null]);
    const seen = [];
    for (let n = 4; n < 4 + 18; n++) {
      const r = houseStudRareColour(n, 4);
      expect(r !== null).toBe((n - 4) % 3 === 0);
      if (r) seen.push(r);
    }
    expect(seen).toEqual([...RARE_COLOURS]);
  });

  it("a house stallion's rare colour shows on him", () => {
    for (const k of RARE_COLOURS) {
      const g = showRareColour(generateFoundationGenome(`stud-${k}`, { season: 1, rarity: "common", rareColours: k }), k);
      expect(rareShows(g, k)).toBe(true);
      const col = horseColour(g, adult);
      expect(col[k]).toBe(true);
    }
  });

  it("pull proofs: a v2 genome stored before the cosmetic genes still verifies", () => {
    const pull = pullPack("paddock", { pulls: 0, sinceRare: 0, sinceEpic: 0 }, { serverSeed: "b".repeat(64), accountId: "acc", season: 1 }).pull;
    const { cosmetic: _c, ...before } = pull.genome;
    expect(expectedPullGenome(pull, before)).toEqual(before);
    expect(expectedPullGenome(pull, pull.genome)).toEqual(pull.genome);
  });
});

describe("display names cover every combination", () => {
  const bases: Partial<Genome["coat"]>[] = [
    {},
    { extension: ["e", "e"] },
    { extension: ["e", "e"], liver: ["l", "l"] },
    { agouti: ["At", "At"] },
    { agouti: ["a", "a"] },
  ];
  const dil: Partial<Genome["coat"]>[] = [{}, { cream: ["Cr", "n"] }, { cream: ["Cr", "Cr"] }, { dun: ["D", "n"] }, { roan: ["Rn", "n"] }, { grey: ["G", "n"] }];
  const g2s: Partial<Genome["genes2"]>[] = [{}, { champagne: ["Ch", "n"] }, { silver: ["Z", "n"] }, { pearl: ["prl", "prl"] }, { tobiano: ["TO", "n"] }, { leopard: ["LP", "n"], patn1: ["PATN1", "n"] }, { splash: ["SW", "n"] }];
  const cos: Partial<CosmeticGenes>[] = [
    {},
    { sooty: [90, 90] },
    { flaxen: [80, 80] },
    { pangare: [90, 90] },
    { mushroom: ["mu", "mu"] },
    { rabicano: ["Rb", "n"] },
    { brindle: ["BR1", "n"] },
    { dominantWhite: ["W", "n"] },
    { bendOr: ["BO", "n"] },
    { birdcatcher: ["Bc", "n"] },
  ];
  it("every shown trait is named, names are unique per look, appearances validate", () => {
    const seen = new Map<string, string>();
    for (const b of bases)
      for (const d of dil)
        for (const x of g2s)
          for (const c of cos) {
            const g: Genome = { ...base, coat: { ...base.coat, extension: ["E", "E"], agouti: ["A", "A"], cream: ["n", "n"], grey: ["n", "n"], roan: ["n", "n"], dun: ["n", "n"], liver: ["L", "L"], sabino: ["n", "n"], ...b, ...d }, genes2: { ...base.genes2, champagne: ["n", "n"], silver: ["n", "n"], pearl: ["n", "n"], tobiano: ["n", "n"], leopard: ["n", "n"], patn1: ["n", "n"], splash: ["n", "n"], ...x }, cosmetic: { ...WILD_COSMETIC, ...c } };
            for (const progress of [adult, { racingAge: false, starts: 0, retired: false }, { racingAge: true, starts: 0, retired: true }]) {
              const name = fullCoatName(g, progress);
              const col = horseColour(g, progress);
              expect(name.length).toBeGreaterThan(2);
              expect(HorseAppearanceSchema.safeParse(appearanceOf(g, progress, SILKS)).success).toBe(true);
              const words: [keyof typeof col, string][] = [
                ["sooty", "Sooty"],
                ["flaxen", "Flaxen"],
                ["pangare", "Pangaré"],
                ["mushroom", "Mushroom"],
                ["rabicano", "Rabicano"],
                ["brindle", "Brindle"],
                ["bendOr", "Bend Or"],
                ["birdcatcher", "Birdcatcher"],
                ["champagne", "Champagne"],
                ["silver", "Silver"],
                ["tobiano", "Tobiano"],
                ["splash", "Splash"],
              ];
              if (col.dominantWhite) expect(name).toBe("Dominant White");
              else {
                // a grey's coat colour words go with the colour; its patterns stay named
                const colourOnly = new Set(["sooty", "flaxen", "pangare", "mushroom", "brindle", "bendOr", "champagne", "silver"]);
                const greyedOut = col.grey === "dapple" || col.grey === "white";
                for (const [k, w] of words) if (col[k] && !(greyedOut && colourOnly.has(k as string))) expect(name).toContain(w);
              }
              // liver and chestnut share one look under two creams or dun (the same palette anchor)
              const same = (col.cream === 2 || col.dun) && !col.champagne;
              const norm = same && col.base === "liver" ? "chestnut" : same && col.base === "seal_brown" ? "bay" : col.base;
              const key = JSON.stringify({ ...col, markSeed: 0, base: norm });
              const was = seen.get(name);
              if (was) expect(was === key || name === "Dominant White" || name.startsWith("Grey") || name.startsWith("Dapple Grey"), `${name}: ${was} vs ${key}`).toBe(true);
              seen.set(name, key);
            }
          }
    expect(seen.size).toBeGreaterThan(300);
  });
});

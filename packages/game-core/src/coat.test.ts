import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { HorseAppearanceSchema } from "@thoroughbred/shared";
import { adultCoatName, appearanceOf, baseColour, resolveCoat, resolveMarkings, resolveMorph, rigLook, RIG_MORPH_RANGE, whiteScore } from "./coat";
import { generateFoundationGenome } from "./genome";
import { MORPH_KEYS, RigLookSchema, type CoatGenes, type Genome } from "./types";
import { SILKS } from "./test-helpers";

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
const g0 = generateFoundationGenome("coat", { season: 1 });
const withCoat = (c: Partial<CoatGenes>): Genome => ({ ...g0, coat: { ...wild, ...c } });
const adult = { racingAge: true, starts: 5, retired: false };

describe("coat colour genetics", () => {
  it.each([
    [{}, "bay", "Bay"],
    [{ agouti: ["At", "a"] }, "dark_bay", "Seal Brown"],
    [{ agouti: ["a", "a"] }, "black", "Black"],
    [{ extension: ["e", "e"] }, "chestnut", "Chestnut"],
    [{ extension: ["e", "e"], liver: ["l", "l"] }, "liver_chestnut", "Liver Chestnut"],
    [{ extension: ["e", "e"], cream: ["Cr", "n"] }, "palomino", "Palomino"],
    [{ cream: ["Cr", "n"] }, "buckskin", "Buckskin"],
    [{ agouti: ["a", "a"], cream: ["Cr", "n"] }, "black", "Smoky Black"],
    [{ extension: ["e", "e"], cream: ["Cr", "Cr"] }, "palomino", "Cremello"],
    [{ cream: ["Cr", "Cr"] }, "palomino", "Perlino"],
    [{ dun: ["D", "n"] }, "buckskin", "Bay Dun"],
    [{ agouti: ["a", "a"], dun: ["D", "n"] }, "grey", "Grullo"],
    [{ extension: ["e", "e"], roan: ["Rn", "n"] }, "roan", "Strawberry Roan"],
    [{ agouti: ["a", "a"], roan: ["Rn", "n"] }, "roan", "Blue Roan"],
  ] as [Partial<CoatGenes>, string, string][])("%j -> %s (%s)", (c, coat, name) => {
    const r = resolveCoat(withCoat(c), adult);
    expect(r.coat).toBe(coat);
    expect(r.coatName).toBe(name);
  });

  it("grey is born coloured, dapples while racing, and turns grey by 24 starts or retirement (never by calendar)", () => {
    const g = withCoat({ grey: ["G", "n"], extension: ["e", "e"] });
    expect(resolveCoat(g, { racingAge: false, starts: 0, retired: false }).coat).toBe("chestnut");
    expect(resolveCoat(g, { racingAge: true, starts: 3, retired: false }).coat).toBe("dapple_grey");
    expect(resolveCoat(g, { racingAge: true, starts: 24, retired: false }).coat).toBe("grey");
    expect(resolveCoat(g, { racingAge: true, starts: 1, retired: true }).coat).toBe("grey");
    expect(baseColour(g.coat)).toBe("chestnut");
    expect(adultCoatName(g.coat)).toBe("Grey");
  });
});

describe("markings and look", () => {
  it("are deterministic, valid for the shared contract and the rig", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const g = generateFoundationGenome(s, { season: 1 });
        const a = appearanceOf(g, adult, SILKS);
        expect(HorseAppearanceSchema.safeParse(a).success).toBe(true);
        expect(appearanceOf(g, adult, SILKS)).toEqual(a);
        const look = rigLook(g);
        expect(RigLookSchema.safeParse(look).success).toBe(true);
        for (const k of MORPH_KEYS) {
          const [lo, hi] = RIG_MORPH_RANGE[k];
          expect(look.morph[k]).toBeGreaterThanOrEqual(lo);
          expect(look.morph[k]).toBeLessThanOrEqual(hi);
          expect(Math.round(look.morph[k] * 32)).toBeCloseTo(look.morph[k] * 32, 9);
        }
      }),
      { numRuns: 3000 },
    );
  });

  it("more white genes → more white", () => {
    const plain = { ...g0, white: [0, 0] as [number, number], coat: { ...g0.coat, sabino: ["n", "n"] as ["n", "n"] } };
    const loud = { ...g0, white: [100, 100] as [number, number], coat: { ...g0.coat, sabino: ["Sb1", "Sb1"] as ["Sb1", "Sb1"] } };
    expect(whiteScore(loud)).toBeGreaterThan(whiteScore(plain));
    expect(resolveMarkings(plain).face).toBe("none");
    expect(resolveMarkings(loud).face).toBe("bald");
    expect(resolveMarkings(loud).sabino).toBeGreaterThan(0.5);
    expect(resolveMarkings(loud).legs.every((l) => l === "stocking" || l === "sock")).toBe(true);
  });

  it("breed shapes conformation: Akhal-Teke legs longer than Quarter Horse legs on average", () => {
    let at = 0;
    let qh = 0;
    for (let i = 0; i < 100; i++) {
      at += resolveMorph(generateFoundationGenome(`a${i}`, { season: 1, breed: "akhalTeke" })).legLength;
      qh += resolveMorph(generateFoundationGenome(`q${i}`, { season: 1, breed: "quarterHorse" })).legLength;
    }
    expect(at).toBeGreaterThan(qh);
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { HorseAppearanceSchema } from "@thoroughbred/shared";
import { adultCoatName, appearanceOf, baseColour, horseColour, resolveCoat, resolveMarkings, resolveMorph, rigLook, RIG_MORPH_RANGE, whiteScore } from "./coat";
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

describe("layered coat genetics (colour)", () => {
  const nocoat = { dun: false, roan: false, grey: "none", sabino: 0 } as const;
  it.each([
    [{}, "Bay", { base: "bay", cream: 0 }],
    [{ agouti: ["At", "a"] }, "Seal Brown", { base: "seal_brown", cream: 0 }],
    [{ agouti: ["At", "At"] }, "Seal Brown", { base: "seal_brown", cream: 0 }],
    [{ extension: ["e", "e"] }, "Chestnut", { base: "chestnut", cream: 0 }],
    [{ extension: ["e", "e"], liver: ["l", "l"] }, "Liver chestnut", { base: "liver", cream: 0 }],
    [{ agouti: ["a", "a"] }, "Black", { base: "black", cream: 0 }],
    [{ cream: ["Cr", "n"] }, "Buckskin", { base: "bay", cream: 1 }],
    [{ agouti: ["At", "a"], cream: ["Cr", "n"] }, "Smoky brown", { base: "seal_brown", cream: 1 }],
    [{ extension: ["e", "e"], cream: ["Cr", "n"] }, "Palomino", { base: "chestnut", cream: 1 }],
    [{ extension: ["e", "e"], liver: ["l", "l"], cream: ["Cr", "n"] }, "Dark palomino", { base: "liver", cream: 1 }],
    [{ agouti: ["a", "a"], cream: ["Cr", "n"] }, "Smoky black", { base: "black", cream: 1 }],
    [{ cream: ["Cr", "Cr"] }, "Perlino", { base: "bay", cream: 2 }],
    [{ extension: ["e", "e"], cream: ["Cr", "Cr"] }, "Cremello", { base: "chestnut", cream: 2 }],
    [{ agouti: ["a", "a"], cream: ["Cr", "Cr"] }, "Smoky cream", { base: "black", cream: 2 }],
    [{ dun: ["D", "n"] }, "Bay dun", { base: "bay", cream: 0, dun: true }],
    [{ extension: ["e", "e"], dun: ["D", "n"] }, "Red dun", { base: "chestnut", cream: 0, dun: true }],
    [{ extension: ["e", "e"], liver: ["l", "l"], dun: ["D", "n"] }, "Red dun (liver)", { base: "liver", cream: 0, dun: true }],
    [{ agouti: ["a", "a"], dun: ["D", "n"] }, "Grullo", { base: "black", cream: 0, dun: true }],
    [{ cream: ["Cr", "n"], dun: ["D", "n"] }, "Dunskin", { base: "bay", cream: 1, dun: true }],
    [{ agouti: ["At", "a"], cream: ["Cr", "n"], dun: ["D", "n"] }, "Dunskin (seal brown)", { base: "seal_brown", cream: 1, dun: true }],
    [{ extension: ["e", "e"], cream: ["Cr", "n"], dun: ["D", "n"] }, "Dunalino", { base: "chestnut", cream: 1, dun: true }],
  ] as [Partial<CoatGenes>, string, Record<string, unknown>][])("%s coat genes -> %s colour", (c, _label, want) => {
    const a = appearanceOf(withCoat(c), adult, SILKS);
    expect(a.colour).toEqual({ ...nocoat, ...want });
    if (want.dun) expect(a.dun).toBe(true);
  });

  it("roan rides the base colour: bay roan, blue roan, strawberry roan", () => {
    expect(appearanceOf(withCoat({ roan: ["Rn", "n"] }), adult, SILKS).colour).toMatchObject({ base: "bay", roan: true });
    expect(appearanceOf(withCoat({ agouti: ["a", "a"], roan: ["Rn", "n"] }), adult, SILKS).colour).toMatchObject({ base: "black", roan: true });
    expect(appearanceOf(withCoat({ extension: ["e", "e"], roan: ["Rn", "n"] }), adult, SILKS).colour).toMatchObject({ base: "chestnut", roan: true });
    expect(appearanceOf(withCoat({ roan: ["Rn", "n"] }), adult, SILKS).colour!.grey).toBe("none");
  });

  it("grey stage follows career progress: greying foal, dapple while racing, white at 24 starts / retirement", () => {
    const g = withCoat({ grey: ["G", "n"] });
    expect(horseColour(g, { racingAge: false, starts: 0, retired: false }).grey).toBe("greying");
    expect(horseColour(g, { racingAge: true, starts: 3, retired: false }).grey).toBe("dapple");
    expect(horseColour(g, { racingAge: true, starts: 24, retired: false }).grey).toBe("white");
    expect(horseColour(g, { racingAge: true, starts: 1, retired: true }).grey).toBe("white");
    // the coat under the grey is still carried
    expect(horseColour(withCoat({ grey: ["G", "n"], extension: ["e", "e"] }), adult).base).toBe("chestnut");
  });

  it("sabino copies count 0..2", () => {
    expect(horseColour(withCoat({}), adult).sabino).toBe(0);
    expect(horseColour(withCoat({ sabino: ["Sb1", "n"] }), adult).sabino).toBe(1);
    expect(horseColour(withCoat({ sabino: ["Sb1", "Sb1"] }), adult).sabino).toBe(2);
  });
});

describe("dun primitive markings", () => {  it("appearanceOf sets dun when the coat genes carry D, and never when they don't", () => {
    expect(appearanceOf(withCoat({ dun: ["D", "n"] }), adult, SILKS).dun).toBe(true);
    expect(appearanceOf(withCoat({ dun: ["D", "D"] }), adult, SILKS).dun).toBe(true);
    expect(appearanceOf(withCoat({}), adult, SILKS).dun).toBeUndefined();
  });

  it("a greyed-out coat hides the dun marking (a foal born to grey still carries it)", () => {
    const g = withCoat({ dun: ["D", "n"], grey: ["G", "n"] });
    expect(appearanceOf(g, { racingAge: false, starts: 0, retired: false }, SILKS).dun).toBe(true);
    expect(appearanceOf(g, { racingAge: true, starts: 3, retired: false }, SILKS).dun).toBeUndefined();
    expect(appearanceOf(g, { racingAge: true, starts: 30, retired: false }, SILKS).dun).toBeUndefined();
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
          // Quantised to 1/32 like the rig (a value clamped to a range bound is the bound itself).
          if (look.morph[k] !== lo && look.morph[k] !== hi) expect(Math.round(look.morph[k] * 32)).toBeCloseTo(look.morph[k] * 32, 9);
        }
      }),
      { numRuns: 300 },
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

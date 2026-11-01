/** Coat class tag (V-07), table-driven over every look the genetics draw (06 §3 classification, Jockey Club colour guide). */
import { describe, expect, it } from "vitest";
import type { HorseAppearance, HorseColour } from "@thoroughbred/shared";
import { breedOfColour, coatClassOf } from "./coatClass";
import { geneticsSummary } from "./geneticsSummary";
import { makeHorse } from "./test-helpers";

const look = (c: Partial<HorseColour>, a: Partial<HorseAppearance> = {}) =>
  ({ coat: "bay", face: "none", legs: ["none", "none", "none", "none"], colour: { base: "bay", cream: 0, dun: false, roan: false, grey: "none", sabino: 0, ...c }, head: "thoroughbred", ...a }) as HorseAppearance;

const TABLE: [string, HorseAppearance, string][] = [
  ["bay", look({}), "Thoroughbred colour"],
  ["dark bay / brown", look({ base: "seal_brown" }), "Thoroughbred colour"],
  ["black", look({ base: "black" }), "Thoroughbred colour"],
  ["chestnut", look({ base: "chestnut" }), "Thoroughbred colour"],
  ["liver chestnut", look({ base: "liver" }), "Thoroughbred colour"],
  ["greying", look({ grey: "greying" }), "Thoroughbred colour"],
  ["dapple grey", look({ grey: "dapple" }), "Thoroughbred colour"],
  ["white grey", look({ grey: "white" }), "Thoroughbred colour"],
  ["sooty bay", look({ sooty: 2 }), "Thoroughbred colour"],
  ["flaxen chestnut", look({ base: "chestnut", flaxen: true }), "Thoroughbred colour"],
  ["blaze and socks", look({}, { face: "blaze", legs: ["sock", "sock", "none", "none"] }), "Thoroughbred colour"],
  ["roan", look({ roan: true }), "rare in Thoroughbreds"],
  ["palomino", look({ base: "chestnut", cream: 1 }), "rare in Thoroughbreds"],
  ["dominant white", look({ dominantWhite: true }), "rare in Thoroughbreds"],
  ["sabino", look({ sabino: 1 }), "rare in Thoroughbreds"],
  ["rabicano", look({ rabicano: true }), "rare in Thoroughbreds"],
  ["Bend Or spots", look({ base: "chestnut", bendOr: true }), "rare in Thoroughbreds"],
  ["Birdcatcher spots", look({ birdcatcher: true }), "rare in Thoroughbreds"],
  ["pangaré", look({ pangare: true }), "rare in Thoroughbreds"],
  ["brindle", look({ brindle: true }), "rare in Thoroughbreds"],
  ["buckskin", look({ cream: 1 }), "an Akhal-Teke colour"],
  ["smoky black", look({ base: "black", cream: 1 }), "an Akhal-Teke colour"],
  ["cremello", look({ base: "chestnut", cream: 2 }), "an Akhal-Teke colour"],
  ["dun", look({ dun: true }, { dun: true }), "a Mustang colour"],
  ["champagne", look({ champagne: true }), "a Quarter Horse colour"],
  ["silver", look({ base: "black", silver: true }), "a Mustang colour"],
  ["pearl", look({ base: "chestnut", pearl: true }), "an Andalusian colour"],
  ["tobiano", look({ tobiano: 1 }), "a Paint Horse colour"],
  ["leopard", look({ leopard: "leopard" }), "an Appaloosa colour"],
  ["splash", look({ splash: 1 }), "a Paint Horse colour"],
  ["feathered", look({ base: "black" }, { feather: true }), "a Friesian colour"],
  ["mushroom", look({ base: "chestnut", mushroom: true }), "not a Thoroughbred colour"],
];

describe("coat class (Jockey Club colour guide)", () => {
  it.each(TABLE)("%s: %s", (_name, a, tag) => {
    expect(coatClassOf(a).tag).toBe(tag);
  });

  it("names the horse's own breed when it carries the colour", () => {
    expect(coatClassOf({ ...look({ cream: 1 }), head: "quarterHorse" }).tag).toBe("a Quarter Horse colour");
    expect(coatClassOf({ ...look({ tobiano: 1 }), head: "mustang" }).tag).toBe("a Paint Horse colour"); // mustangs carry it, far less than Paints
    expect(breedOfColour({ genes2: "LP" }, "thoroughbred")).toBe("appaloosa");
  });

  it("older looks without layered colour still get a tag", () => {
    expect(coatClassOf({ coat: "palomino" } as HorseAppearance).tag).toBe("rare in Thoroughbreds");
    expect(coatClassOf({ coat: "chestnut" } as HorseAppearance).tag).toBe("Thoroughbred colour");
  });

  it("the horse page's genetics summary carries it", () => {
    const h = makeHorse("coat-class-1");
    const g = geneticsSummary(h.genome, { face: "none", legs: ["none", "none", "none", "none"] }, []);
    expect(g.coat.class?.tag).toMatch(/Thoroughbred colour|rare in Thoroughbreds|colour$/);
  });
});
